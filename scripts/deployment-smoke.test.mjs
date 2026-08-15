import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  deploymentMarkerContent,
  evaluateDeploymentFreshness,
  fetchSuccessfulMainPushRuns,
} from "./deployment-freshness.mjs";
import { smokePages } from "./smoke-pages.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const WORKFLOW_ID = 4242;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function indentation(line) {
  return line.length - line.trimStart().length;
}

function withoutComment(value) {
  return value.replace(/\s+#.*$/u, "").trim();
}

function topLevelBlock(source, name) {
  const lines = source.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `${name}:`);
  assert.notEqual(start, -1, `Missing top-level ${name} block.`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim() && indentation(lines[index]) === 0) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end);
}

function childBlocks(lines, childIndent) {
  const blocks = new Map();
  let current;
  for (const line of lines) {
    const match = line.match(new RegExp(`^ {${childIndent}}([A-Za-z0-9_-]+):\\s*$`, "u"));
    if (match) {
      current = match[1];
      assert.equal(blocks.has(current), false, `Duplicate YAML block ${current}.`);
      blocks.set(current, []);
    } else if (current) {
      blocks.get(current).push(line);
    }
  }
  return blocks;
}

function mappingAt(lines, propertyIndent) {
  const mapping = {};
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || indentation(line) !== propertyIndent) continue;
    const match = line.trim().match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/u);
    if (!match) continue;
    let value = withoutComment(match[2] || "");
    if (value === ">-" || value === "|") {
      const continuations = [];
      for (let next = index + 1; next < lines.length; next += 1) {
        if (lines[next].trim() && indentation(lines[next]) <= propertyIndent) break;
        if (lines[next].trim()) continuations.push(lines[next].trim());
      }
      value = continuations.join(" ");
    }
    mapping[match[1]] = value;
  }
  return mapping;
}

function nestedMapping(lines, name, propertyIndent) {
  const start = lines.findIndex(
    (line) => indentation(line) === propertyIndent && line.trim() === `${name}:`,
  );
  assert.notEqual(start, -1, `Missing ${name} mapping.`);
  const nested = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim() && indentation(lines[index]) <= propertyIndent) break;
    nested.push(lines[index]);
  }
  return mappingAt(nested, propertyIndent + 2);
}

function inlineList(value) {
  assert.match(value, /^\[.*\]$/u);
  return value
    .slice(1, -1)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function workflowPolicy(source) {
  const jobs = childBlocks(topLevelBlock(source, "jobs"), 2);
  const parsedJobs = {};
  for (const [name, lines] of jobs) {
    const properties = mappingAt(lines, 4);
    parsedJobs[name] = {
      if: properties.if,
      needs: properties.needs
        ? properties.needs.startsWith("[")
          ? inlineList(properties.needs)
          : [properties.needs]
        : [],
      permissions: nestedMapping(lines, "permissions", 4),
      uses: lines
        .map((line) => line.trim().match(/^-?\s*uses:\s*([^\s#]+)/u)?.[1])
        .filter(Boolean),
    };
  }
  const eventBlocks = childBlocks(topLevelBlock(source, "on"), 2);
  assert.equal(eventBlocks.has("workflow_run"), true, "Missing workflow_run trigger.");
  return {
    concurrency: mappingAt(topLevelBlock(source, "concurrency"), 2),
    jobs: parsedJobs,
    workflowRun: mappingAt(eventBlocks.get("workflow_run"), 4),
  };
}

function run({
  conclusion = "success",
  createdAt,
  event = "push",
  headBranch = "main",
  id,
  runAttempt = 1,
  runNumber = id,
  sha,
  status = "completed",
  updatedAt = createdAt,
  workflowId = WORKFLOW_ID,
}) {
  return {
    conclusion,
    created_at: createdAt,
    event,
    head_branch: headBranch,
    head_sha: sha,
    id,
    run_attempt: runAttempt,
    run_number: runNumber,
    status,
    updated_at: updatedAt,
    workflow_id: workflowId,
  };
}

function candidateFor(workflowRun) {
  return {
    createdAt: workflowRun.created_at,
    headSha: workflowRun.head_sha,
    id: workflowRun.id,
    runAttempt: workflowRun.run_attempt,
    runNumber: workflowRun.run_number,
    workflowId: workflowRun.workflow_id,
  };
}

function freshnessQueryOptions(overrides = {}) {
  return {
    apiUrl: "https://api.github.test",
    candidateCreatedAt: "2026-08-15T10:00:00Z",
    repository: "Sion612/rubrictrail",
    token: "test-token",
    workflowId: WORKFLOW_ID,
    ...overrides,
  };
}

test("allows a successful candidate when no newer successful main push exists", () => {
  const candidate = run({ createdAt: "2026-08-15T11:00:00Z", id: 2, sha: SHA_B });
  assert.deepEqual(evaluateDeploymentFreshness(candidateFor(candidate), [candidate]), {
    candidateSha: SHA_B,
    latestRunId: "2",
    latestSuccessfulSha: SHA_B,
    shouldDeploy: true,
  });
});

test("marks a candidate superseded only by a larger successful run number", () => {
  const candidate = run({ createdAt: "2026-08-15T10:00:00Z", id: 10, runNumber: 20, sha: SHA_A });
  const newerSuccess = run({
    createdAt: "2026-08-15T11:00:00Z",
    id: 11,
    runNumber: 21,
    sha: SHA_B,
  });
  assert.deepEqual(evaluateDeploymentFreshness(candidateFor(candidate), [newerSuccess, candidate]), {
    candidateSha: SHA_A,
    latestRunId: "11",
    latestSuccessfulSha: SHA_B,
    shouldDeploy: false,
  });
});

test("uses original run numbers so an older rerun cannot supersede a newer commit", () => {
  const candidate = run({ createdAt: "2026-08-15T12:00:00Z", id: 200, runNumber: 200, sha: SHA_C });
  const result = evaluateDeploymentFreshness(candidateFor(candidate), [candidate]);
  assert.equal(result.shouldDeploy, true);

  const rerunCandidate = run({
    createdAt: "2026-08-15T10:00:00Z",
    id: 150,
    runAttempt: 4,
    runNumber: 150,
    sha: SHA_A,
    updatedAt: "2026-08-15T13:00:00Z",
  });
  assert.equal(
    evaluateDeploymentFreshness(candidateFor(rerunCandidate), [candidate, rerunCandidate])
      .shouldDeploy,
    false,
  );
});

test("fails closed for unexpected filters, candidate metadata, and identifiers", () => {
  const candidate = run({ createdAt: "2026-08-15T11:00:00Z", id: 2, sha: SHA_B });
  assert.throws(
    () =>
      evaluateDeploymentFreshness(candidateFor(candidate), [
        run({ createdAt: "2026-08-15T11:00:00Z", event: "pull_request", id: 1, sha: SHA_A }),
      ]),
    /outside the requested success filters/u,
  );
  assert.throws(() => deploymentMarkerContent("abc"), /40-character hexadecimal/u);
  assert.equal(deploymentMarkerContent(SHA_A.toUpperCase()), SHA_A);
  assert.throws(
    () => evaluateDeploymentFreshness(candidateFor(candidate), [{ ...candidate, run_number: 0 }]),
    /workflow run number must be a positive safe integer/u,
  );
  assert.throws(
    () => evaluateDeploymentFreshness(candidateFor(candidate), [{ ...candidate, run_attempt: 2 }]),
    /not present with exact metadata/u,
  );
  assert.throws(
    () => evaluateDeploymentFreshness(candidateFor(candidate), [{ ...candidate, workflow_id: 9999 }]),
    /different workflow/u,
  );
  assert.throws(
    () =>
      evaluateDeploymentFreshness(candidateFor(candidate), [
        candidate,
        run({ createdAt: "2026-08-15T12:00:00Z", id: 3, runNumber: 2, sha: SHA_C }),
      ]),
    /duplicate workflow run identity metadata/u,
  );
});

test("queries only the candidate-created success window without exposing an error body", async () => {
  let observedUrl;
  const runs = await fetchSuccessfulMainPushRuns(freshnessQueryOptions({
    fetchImpl: async (url, options) => {
      observedUrl = new URL(url);
      assert.equal(options.headers.Authorization, "Bearer test-token");
      assert.ok(options.signal instanceof AbortSignal);
      return new Response(JSON.stringify({ total_count: 0, workflow_runs: [] }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    },
  }));
  assert.deepEqual(runs, []);
  assert.equal(observedUrl.pathname, `/repos/Sion612/rubrictrail/actions/workflows/${WORKFLOW_ID}/runs`);
  assert.equal(observedUrl.searchParams.get("branch"), "main");
  assert.equal(observedUrl.searchParams.get("created"), ">=2026-08-15T10:00:00.000Z");
  assert.equal(observedUrl.searchParams.get("event"), "push");
  assert.equal(observedUrl.searchParams.get("status"), "success");
  assert.equal(observedUrl.searchParams.get("per_page"), "100");
  assert.equal(observedUrl.searchParams.get("page"), "1");

  await assert.rejects(
    fetchSuccessfulMainPushRuns(freshnessQueryOptions({
      fetchImpl: async () => new Response("private response body", { status: 503 }),
    })),
    (error) => error.message === "The GitHub Actions freshness request returned HTTP 503.",
  );
});

test("a newer failed CI does not supersede a successful candidate", async () => {
  const candidate = run({ createdAt: "2026-08-15T10:00:00Z", id: 10, sha: SHA_A });
  const runs = await fetchSuccessfulMainPushRuns(freshnessQueryOptions({
    fetchImpl: async (input) => {
      assert.equal(new URL(input).searchParams.get("status"), "success");
      return new Response(JSON.stringify({ total_count: 1, workflow_runs: [candidate] }), {
        status: 200,
      });
    },
  }));
  assert.equal(evaluateDeploymentFreshness(candidateFor(candidate), runs).shouldDeploy, true);
});

test("paginates the bounded candidate window without assuming API order", async () => {
  const startingTime = Date.parse("2026-08-15T10:00:00Z");
  const allRuns = Array.from({ length: 101 }, (_, index) => {
    const id = index + 1;
    return run({
      createdAt: new Date(startingTime + index * 1_000).toISOString(),
      id,
      sha: id.toString(16).padStart(40, "0"),
    });
  });
  const requestedPages = [];
  const runs = await fetchSuccessfulMainPushRuns(freshnessQueryOptions({
    fetchImpl: async (input) => {
      const page = Number(new URL(input).searchParams.get("page"));
      requestedPages.push(page);
      const workflowRuns = page === 1 ? allRuns.slice(0, 100).reverse() : allRuns.slice(100);
      return new Response(JSON.stringify({ total_count: allRuns.length, workflow_runs: workflowRuns }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    },
  }));

  assert.deepEqual(requestedPages, [1, 2]);
  assert.equal(runs.length, 101);
  assert.equal(evaluateDeploymentFreshness(candidateFor(allRuns[0]), runs).shouldDeploy, false);
  assert.equal(
    evaluateDeploymentFreshness(candidateFor(allRuns.at(-1)), [allRuns.at(-1)]).shouldDeploy,
    true,
  );
});

test("does not inherit the lifetime 1000-run cliff when the candidate window is small", async () => {
  const candidate = run({ createdAt: "2026-08-15T10:00:00Z", id: 1001, sha: SHA_A });
  const newerSuccess = run({ createdAt: "2026-08-15T11:00:00Z", id: 1002, sha: SHA_B });
  let createdFilter;
  const runs = await fetchSuccessfulMainPushRuns(freshnessQueryOptions({
    fetchImpl: async (input) => {
      createdFilter = new URL(input).searchParams.get("created");
      return new Response(
        JSON.stringify({ total_count: 2, workflow_runs: [candidate, newerSuccess] }),
        { status: 200 },
      );
    },
  }));

  assert.equal(createdFilter, ">=2026-08-15T10:00:00.000Z");
  assert.equal(evaluateDeploymentFreshness(candidateFor(candidate), runs).shouldDeploy, false);
});

test("fails closed when the bounded window is incomplete, changes, or exceeds the search limit", async () => {
  await assert.rejects(
    fetchSuccessfulMainPushRuns(freshnessQueryOptions({
      fetchImpl: async () =>
        new Response(JSON.stringify({ total_count: 1_001, workflow_runs: [] }), { status: 200 }),
    })),
    /candidate-created window.*documented search limit/u,
  );

  await assert.rejects(
    fetchSuccessfulMainPushRuns(freshnessQueryOptions({
      fetchImpl: async (input) => {
        const page = Number(new URL(input).searchParams.get("page"));
        return new Response(
          JSON.stringify({
            total_count: page === 1 ? 101 : 102,
            workflow_runs: page === 1 ? Array.from({ length: 100 }, (_, index) => run({ id: index + 1, sha: SHA_A })) : [],
          }),
          { status: 200 },
        );
      },
    })),
    /changed during pagination/u,
  );
});

function successfulPagesFetch(requestLog) {
  return async (input, options = {}) => {
    const url = new URL(input);
    const method = options.method || "GET";
    requestLog.push({ method, url });
    if (url.pathname.endsWith("/deployment.txt")) return new Response(SHA_A, { status: 200 });
    if (url.pathname.includes("/api/live/")) return new Response("not an API", { status: 404 });
    if (url.pathname.endsWith("/app.js") || url.pathname.endsWith("/styles.css")) {
      return new Response("asset", { status: 200 });
    }
    if (url.pathname === "/rubrictrail/") {
      return new Response(
        '<!doctype html><link rel="stylesheet" href="./styles.css"><script src="/rubrictrail/app.js"></script>',
        { headers: { "Content-Type": "text/html" }, status: 200 },
      );
    }
    return new Response("missing", { status: 404 });
  };
}

test("smokes the homepage, exact marker, linked assets, and disabled Live paths", async () => {
  const requests = [];
  const result = await smokePages({
    delaysMs: [0],
    fetchImpl: successfulPagesFetch(requests),
    pageUrl: "https://example.github.io/rubrictrail/",
    sha: SHA_A,
  });

  assert.equal(result.assetCount, 2);
  assert.equal(result.attempts, 1);
  assert.ok(requests.every(({ url }) => url.origin === "https://example.github.io"));
  assert.ok(requests.every(({ url }) => url.searchParams.has("rubrictrail-smoke")));
  for (const route of ["assignment", "draft"]) {
    assert.ok(requests.some(({ method, url }) => method === "GET" && url.pathname.endsWith(route)));
    assert.ok(requests.some(({ method, url }) => method === "POST" && url.pathname.endsWith(route)));
  }
});

test("checks src, href, and every same-origin srcset candidate with URL details preserved", async () => {
  const requests = [];
  const result = await smokePages({
    delaysMs: [0],
    fetchImpl: async (input, options = {}) => {
      const url = new URL(input);
      requests.push({ method: options.method || "GET", url });
      if (url.pathname.endsWith("/deployment.txt")) return new Response(SHA_A, { status: 200 });
      if (url.pathname.includes("/api/live/")) return new Response(null, { status: 404 });
      if (url.pathname === "/rubrictrail/") {
        return new Response(
          [
            '<link rel="stylesheet" href="./styles.css?theme=dark#sheet">',
            '<script src="/rubrictrail/app.js?v=2#main"></script>',
            '<img src="./poster.png#poster" srcset="./small.png?density=1#small 1x, /rubrictrail/large.png 2x">',
            '<source srcset="./wide.webp 640w, ./wider.webp?width=1280#wide 1280w">',
          ].join(""),
          { status: 200 },
        );
      }
      return new Response("asset", { status: 200 });
    },
    pageUrl: "https://example.github.io/rubrictrail/",
    sha: SHA_A,
  });

  assert.equal(result.assetCount, 7);
  const assetRequests = requests.filter(
    ({ url }) => !url.pathname.endsWith("/deployment.txt") && !url.pathname.includes("/api/live/") && url.pathname !== "/rubrictrail/",
  );
  assert.deepEqual(
    assetRequests.map(({ url }) => url.pathname).sort(),
    [
      "/rubrictrail/app.js",
      "/rubrictrail/large.png",
      "/rubrictrail/poster.png",
      "/rubrictrail/small.png",
      "/rubrictrail/styles.css",
      "/rubrictrail/wide.webp",
      "/rubrictrail/wider.webp",
    ],
  );
  assert.ok(assetRequests.every(({ url }) => url.origin === "https://example.github.io"));
  assert.ok(assetRequests.every(({ url }) => url.hash === ""));
  assert.equal(assetRequests.find(({ url }) => url.pathname.endsWith("styles.css")).url.searchParams.get("theme"), "dark");
  assert.equal(assetRequests.find(({ url }) => url.pathname.endsWith("small.png")).url.searchParams.get("density"), "1");
  assert.equal(assetRequests.find(({ url }) => url.pathname.endsWith("wider.webp")).url.searchParams.get("width"), "1280");
});

test("retries bounded failures and never includes a response body in the error", async () => {
  let attempts = 0;
  await assert.rejects(
    smokePages({
      delaysMs: [0, 0],
      fetchImpl: async () => {
        attempts += 1;
        return new Response("student data must not appear", { status: 503 });
      },
      pageUrl: "https://example.github.io/rubrictrail/",
      sha: SHA_A,
      sleepImpl: async () => {},
    }),
    (error) =>
      error.message.includes("HTTP 503") && !error.message.includes("student data must not appear"),
  );
  assert.equal(attempts, 2);
});

test("fails closed on a mismatched marker and never requests off-origin assets", async () => {
  let offOriginRequested = false;
  await assert.rejects(
    smokePages({
      delaysMs: [0],
      fetchImpl: async (input) => {
        const url = new URL(input);
        if (url.origin === "https://cdn.example.test") offOriginRequested = true;
        if (url.pathname === "/rubrictrail/") {
          return new Response(
            '<source srcset="./safe.png 1x, https://cdn.example.test/app.png 2x">',
            { status: 200 },
          );
        }
        return new Response(SHA_B, { status: 200 });
      },
      pageUrl: "https://example.github.io/rubrictrail/",
      sha: SHA_A,
    }),
    /off-origin asset/u,
  );
  assert.equal(offOriginRequested, false);

  await assert.rejects(
    smokePages({
      delaysMs: [0],
      fetchImpl: async (input) => {
        const url = new URL(input);
        if (url.pathname.endsWith("/deployment.txt")) return new Response(SHA_B, { status: 200 });
        if (url.pathname.includes("/api/live/")) return new Response(null, { status: 404 });
        if (url.pathname === "/rubrictrail/") {
          return new Response('<script src="./app.js"></script>', { status: 200 });
        }
        return new Response("asset", { status: 200 });
      },
      pageUrl: "https://example.github.io/rubrictrail/",
      sha: SHA_A,
    }),
    /marker does not match/u,
  );
});

test("wires the freshness, marker, smoke, permissions, and pinned Actions into CI", async () => {
  const [deploymentWorkflow, ciWorkflow] = await Promise.all([
    readFile(path.join(repositoryRoot, ".github", "workflows", "deploy-pages.yml"), "utf8"),
    readFile(path.join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8"),
  ]);
  const policy = workflowPolicy(deploymentWorkflow);

  assert.deepEqual(policy.workflowRun, {
    branches: "[main]",
    types: "[completed]",
    workflows: "[CI]",
  });
  assert.deepEqual(policy.concurrency, {
    "cancel-in-progress": "false",
    group: "pages-${{ github.event.workflow_run.conclusion }}",
    queue: "max",
  });
  assert.deepEqual(Object.keys(policy.jobs).sort(), ["build", "deploy", "freshness", "smoke"]);
  assert.deepEqual(policy.jobs.freshness.permissions, { actions: "read", contents: "read" });
  assert.deepEqual(policy.jobs.build.permissions, { contents: "read" });
  assert.deepEqual(policy.jobs.smoke.permissions, { contents: "read" });
  assert.deepEqual(policy.jobs.deploy.permissions, { "id-token": "write", pages: "write" });
  assert.deepEqual(policy.jobs.build.needs, ["freshness"]);
  assert.deepEqual(policy.jobs.deploy.needs, ["freshness", "build"]);
  assert.deepEqual(policy.jobs.smoke.needs, ["freshness", "deploy"]);
  assert.match(policy.jobs.freshness.if, /workflow_run\.conclusion == 'success'/u);
  assert.match(policy.jobs.freshness.if, /workflow_run\.event == 'push'/u);
  assert.match(policy.jobs.freshness.if, /workflow_run\.head_branch == 'main'/u);
  assert.match(policy.jobs.freshness.if, /head_repository\.full_name == github\.repository/u);
  assert.equal(policy.jobs.build.if, "needs.freshness.outputs.should_deploy == 'true'");
  assert.equal(
    policy.jobs.deploy.if,
    "needs.freshness.outputs.should_deploy == 'true' && needs.build.result == 'success'",
  );
  assert.equal(
    policy.jobs.smoke.if,
    "needs.freshness.outputs.should_deploy == 'true' && needs.deploy.result == 'success'",
  );
  for (const [jobName, job] of Object.entries(policy.jobs)) {
    if (jobName !== "deploy") {
      assert.equal(Object.values(job.permissions).includes("write"), false);
    }
    for (const action of job.uses) {
      assert.match(action, /^[^@\s]+@[0-9a-f]{40}$/u);
    }
  }
  assert.match(deploymentWorkflow, /node scripts\/deployment-freshness\.mjs check/u);
  assert.match(
    deploymentWorkflow,
    /EXPECTED_CREATED_AT: \$\{\{ github\.event\.workflow_run\.created_at \}\}/u,
  );
  assert.match(deploymentWorkflow, /EXPECTED_RUN_ATTEMPT: \$\{\{ github\.event\.workflow_run\.run_attempt \}\}/u);
  assert.match(deploymentWorkflow, /EXPECTED_RUN_ID: \$\{\{ github\.event\.workflow_run\.id \}\}/u);
  assert.match(deploymentWorkflow, /EXPECTED_RUN_NUMBER: \$\{\{ github\.event\.workflow_run\.run_number \}\}/u);
  assert.match(deploymentWorkflow, /EXPECTED_WORKFLOW_ID: \$\{\{ github\.event\.workflow_run\.workflow_id \}\}/u);
  assert.doesNotMatch(deploymentWorkflow, /CI_WORKFLOW_FILE/u);
  assert.match(deploymentWorkflow, /node scripts\/deployment-freshness\.mjs marker/u);
  assert.match(deploymentWorkflow, /node scripts\/smoke-pages\.mjs/u);
  assert.doesNotMatch(deploymentWorkflow, /workflow_dispatch/u);
  assert.match(ciWorkflow, /pnpm test:deployment-smoke/u);
});
