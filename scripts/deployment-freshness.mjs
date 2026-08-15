import { appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const REQUEST_TIMEOUT_MS = 15_000;
const WORKFLOW_RUNS_PER_PAGE = 100;
const WORKFLOW_RUNS_SEARCH_LIMIT = 1_000;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deploymentMarkerPath = path.join(repositoryRoot, "demo", "out", "deployment.txt");

export function validatedSha(value, label = "commit SHA") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a complete 40-character hexadecimal commit SHA.`);
  }
  return normalized;
}

function validatedPositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return normalized;
}

function validatedNumericIdentifier(value, label) {
  const normalized = String(value || "").trim();
  if (!/^[1-9]\d*$/u.test(normalized)) {
    throw new Error(`${label} must be a positive numeric identifier.`);
  }
  return normalized;
}

function validatedTimestamp(value, label) {
  const normalized = String(value || "").trim();
  const timestamp = Date.parse(normalized);
  if (!normalized || !Number.isFinite(timestamp)) {
    throw new Error(`${label} must be a valid ISO 8601 timestamp.`);
  }
  return {
    epochMilliseconds: timestamp,
    iso: new Date(timestamp).toISOString(),
  };
}

export function validatedWorkflowCandidate(candidate) {
  return {
    createdAt: validatedTimestamp(candidate?.createdAt, "triggering workflow created_at"),
    headSha: validatedSha(candidate?.headSha, "triggering workflow SHA"),
    id: validatedNumericIdentifier(candidate?.id, "triggering workflow run ID"),
    runAttempt: validatedPositiveInteger(
      candidate?.runAttempt,
      "triggering workflow run attempt",
    ),
    runNumber: validatedPositiveInteger(candidate?.runNumber, "triggering workflow run number"),
    workflowId: validatedNumericIdentifier(candidate?.workflowId, "triggering workflow ID"),
  };
}

function normalizedSuccessfulMainPushRun(run, candidate) {
  if (
    run?.event !== "push" ||
    run?.head_branch !== "main" ||
    run?.status !== "completed" ||
    run?.conclusion !== "success"
  ) {
    throw new Error("GitHub Actions returned a run outside the requested success filters.");
  }
  const normalized = {
    createdAt: validatedTimestamp(run.created_at, "workflow run created_at"),
    headSha: validatedSha(run.head_sha, "workflow run head SHA"),
    id: validatedNumericIdentifier(run.id, "workflow run ID"),
    runAttempt: validatedPositiveInteger(run.run_attempt, "workflow run attempt"),
    runNumber: validatedPositiveInteger(run.run_number, "workflow run number"),
    workflowId: validatedNumericIdentifier(run.workflow_id, "workflow ID"),
  };
  if (normalized.workflowId !== candidate.workflowId) {
    throw new Error("GitHub Actions returned a run from a different workflow.");
  }
  if (normalized.createdAt.epochMilliseconds < candidate.createdAt.epochMilliseconds) {
    throw new Error("GitHub Actions returned a run outside the requested created_at window.");
  }
  return normalized;
}

export function evaluateDeploymentFreshness(candidateInput, workflowRuns) {
  const candidate = validatedWorkflowCandidate(candidateInput);
  if (!Array.isArray(workflowRuns)) {
    throw new Error("GitHub Actions returned an invalid workflow run list.");
  }
  const normalizedRuns = workflowRuns.map((run) => normalizedSuccessfulMainPushRun(run, candidate));
  const runIds = new Set();
  const runNumbers = new Set();
  for (const run of normalizedRuns) {
    if (runIds.has(run.id) || runNumbers.has(run.runNumber)) {
      throw new Error("GitHub Actions returned duplicate workflow run identity metadata.");
    }
    runIds.add(run.id);
    runNumbers.add(run.runNumber);
  }
  const candidateRun = normalizedRuns.find((run) => run.id === candidate.id);
  if (
    !candidateRun ||
    candidateRun.headSha !== candidate.headSha ||
    candidateRun.runNumber !== candidate.runNumber ||
    candidateRun.runAttempt !== candidate.runAttempt ||
    candidateRun.createdAt.epochMilliseconds !== candidate.createdAt.epochMilliseconds
  ) {
    throw new Error("The triggering successful workflow run was not present with exact metadata.");
  }

  const supersedingRun = normalizedRuns.reduce(
    (latest, run) =>
      run.runNumber > candidate.runNumber && (!latest || run.runNumber > latest.runNumber)
        ? run
        : latest,
    null,
  );
  const latestRun = supersedingRun || candidateRun;
  return {
    candidateSha: candidate.headSha,
    latestSuccessfulSha: latestRun.headSha,
    latestRunId: latestRun.id,
    shouldDeploy: supersedingRun === null,
  };
}

export function deploymentMarkerContent(sha) {
  return validatedSha(sha, "deployment marker SHA");
}

export async function fetchSuccessfulMainPushRuns({
  apiUrl,
  candidateCreatedAt,
  fetchImpl = fetch,
  repository,
  token,
  workflowId,
}) {
  if (!token) throw new Error("GITHUB_TOKEN is required for the read-only Actions query.");
  if (!/^[^/\s]+\/[^/\s]+$/u.test(repository || "")) {
    throw new Error("GITHUB_REPOSITORY must use the owner/repository form.");
  }
  const normalizedWorkflowId = validatedNumericIdentifier(workflowId, "triggering workflow ID");
  const createdAt = validatedTimestamp(candidateCreatedAt, "triggering workflow created_at");

  const endpoint = new URL(
    `/repos/${repository}/actions/workflows/${normalizedWorkflowId}/runs`,
    apiUrl,
  );
  endpoint.searchParams.set("branch", "main");
  endpoint.searchParams.set("event", "push");
  endpoint.searchParams.set("status", "success");
  endpoint.searchParams.set("created", `>=${createdAt.iso}`);
  endpoint.searchParams.set("exclude_pull_requests", "true");
  endpoint.searchParams.set("per_page", String(WORKFLOW_RUNS_PER_PAGE));

  async function fetchPage(page) {
    const pageEndpoint = new URL(endpoint);
    pageEndpoint.searchParams.set("page", String(page));

    let response;
    try {
      response = await fetchImpl(pageEndpoint, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "rubrictrail-pages-freshness",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Error("The read-only GitHub Actions freshness request could not be completed.");
    }

    if (!response.ok) {
      throw new Error(`The GitHub Actions freshness request returned HTTP ${response.status}.`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("The GitHub Actions freshness response was not valid JSON.");
    }
    if (
      !Number.isSafeInteger(payload?.total_count) ||
      payload.total_count < 0 ||
      !Array.isArray(payload?.workflow_runs) ||
      payload.workflow_runs.length > WORKFLOW_RUNS_PER_PAGE
    ) {
      throw new Error("The GitHub Actions freshness response had an invalid paginated run list.");
    }
    return payload;
  }

  const firstPage = await fetchPage(1);
  if (firstPage.total_count > WORKFLOW_RUNS_SEARCH_LIMIT) {
    throw new Error(
      `GitHub Actions reported more than ${WORKFLOW_RUNS_SEARCH_LIMIT} matching runs in the candidate-created window; freshness cannot be proven within the documented search limit.`,
    );
  }

  const pageCount = Math.max(1, Math.ceil(firstPage.total_count / WORKFLOW_RUNS_PER_PAGE));
  const pages = [firstPage];
  for (let page = 2; page <= pageCount; page += 1) {
    const payload = await fetchPage(page);
    if (payload.total_count !== firstPage.total_count) {
      throw new Error("The GitHub Actions freshness result changed during pagination.");
    }
    pages.push(payload);
  }

  const uniqueRuns = new Map();
  for (const run of pages.flatMap((payload) => payload.workflow_runs)) {
    const runId = String(run?.id || "");
    if (!/^[1-9]\d*$/u.test(runId) || uniqueRuns.has(runId)) {
      throw new Error("The GitHub Actions freshness response contained invalid or duplicate runs.");
    }
    uniqueRuns.set(runId, run);
  }
  if (uniqueRuns.size !== firstPage.total_count) {
    throw new Error("The GitHub Actions freshness response did not include every matching run.");
  }
  return [...uniqueRuns.values()];
}

async function appendLines(file, lines) {
  if (!file) throw new Error("The required GitHub workflow command file is unavailable.");
  await appendFile(file, `${lines.join("\n")}\n`, "utf8");
}

export async function runFreshnessCheck(environment = process.env, fetchImpl = fetch) {
  const candidate = validatedWorkflowCandidate({
    createdAt: environment.EXPECTED_CREATED_AT,
    headSha: environment.EXPECTED_SHA,
    id: environment.EXPECTED_RUN_ID,
    runAttempt: environment.EXPECTED_RUN_ATTEMPT,
    runNumber: environment.EXPECTED_RUN_NUMBER,
    workflowId: environment.EXPECTED_WORKFLOW_ID,
  });
  const workflowRuns = await fetchSuccessfulMainPushRuns({
    apiUrl: environment.GITHUB_API_URL || "https://api.github.com",
    candidateCreatedAt: candidate.createdAt.iso,
    fetchImpl,
    repository: environment.GITHUB_REPOSITORY,
    token: environment.GITHUB_TOKEN,
    workflowId: candidate.workflowId,
  });
  const result = evaluateDeploymentFreshness(
    {
      createdAt: candidate.createdAt.iso,
      headSha: candidate.headSha,
      id: candidate.id,
      runAttempt: candidate.runAttempt,
      runNumber: candidate.runNumber,
      workflowId: candidate.workflowId,
    },
    workflowRuns,
  );

  await appendLines(environment.GITHUB_OUTPUT, [
    `should_deploy=${result.shouldDeploy}`,
    `verified_sha=${result.candidateSha}`,
    `latest_successful_sha=${result.latestSuccessfulSha}`,
  ]);
  await appendLines(environment.GITHUB_STEP_SUMMARY, [
    "### Pages deployment freshness",
    "",
    `- Triggering verified SHA: \`${result.candidateSha}\``,
    `- Latest successful main push CI SHA: \`${result.latestSuccessfulSha}\``,
    `- Result: ${result.shouldDeploy ? "current; deployment may continue" : "superseded; deployment skipped"}`,
  ]);

  console.log(
    result.shouldDeploy
      ? `Deployment freshness passed for ${result.candidateSha}.`
      : `Deployment ${result.candidateSha} is superseded by ${result.latestSuccessfulSha}; skipping it.`,
  );
  return result;
}

export async function writeDeploymentMarker(environment = process.env) {
  const content = deploymentMarkerContent(environment.VERIFIED_SHA);
  await writeFile(deploymentMarkerPath, content, { encoding: "utf8", flag: "w" });
  console.log(`Wrote deployment marker for ${content}.`);
  return deploymentMarkerPath;
}

async function main() {
  const command = process.argv[2];
  if (command === "check") {
    await runFreshnessCheck();
    return;
  }
  if (command === "marker") {
    await writeDeploymentMarker();
    return;
  }
  throw new Error("Expected the deployment-freshness command to be check or marker.");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Deployment freshness failed.");
    process.exitCode = 1;
  });
}
