import { appendFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { validatedSha } from "./deployment-freshness.mjs";

const DEFAULT_DELAYS_MS = [0, 2_000, 5_000, 10_000, 15_000, 30_000];
const REQUEST_TIMEOUT_MS = 10_000;

function normalizedPageUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("The Pages smoke target must use HTTPS.");
  }
  if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
  url.search = "";
  url.hash = "";
  return url;
}

function cacheBusted(url, sha, attempt, sequence) {
  const requestUrl = new URL(url);
  requestUrl.hash = "";
  requestUrl.searchParams.set("rubrictrail-smoke", `${sha}-${attempt}-${sequence}`);
  return requestUrl;
}

function srcsetReferences(value) {
  const references = [];
  let cursor = 0;
  while (cursor < value.length) {
    while (cursor < value.length && /[\s,]/u.test(value[cursor])) cursor += 1;
    if (cursor >= value.length) break;

    const start = cursor;
    const isDataUrl = value.slice(start, start + 5).toLowerCase() === "data:";
    while (
      cursor < value.length &&
      !/\s/u.test(value[cursor]) &&
      (isDataUrl || value[cursor] !== ",")
    ) {
      cursor += 1;
    }
    references.push(value.slice(start, cursor));
    while (cursor < value.length && value[cursor] !== ",") cursor += 1;
    if (value[cursor] === ",") cursor += 1;
  }
  return references;
}

function linkedAssetUrls(html, pageUrl) {
  const assets = new Set();
  const tagPattern = /<(?:script|link|img|source)\b[^>]*>/giu;
  const attributePattern = /\b(src|href|srcset)=["']([^"']+)["']/giu;
  for (const tagMatch of html.matchAll(tagPattern)) {
    for (const attributeMatch of tagMatch[0].matchAll(attributePattern)) {
      const references =
        attributeMatch[1].toLowerCase() === "srcset"
          ? srcsetReferences(attributeMatch[2])
          : [attributeMatch[2]];
      for (const rawReference of references) {
        const reference = rawReference.trim();
        if (!reference || /^(?:data:|blob:|mailto:|#)/iu.test(reference)) continue;
        const asset = new URL(reference, pageUrl);
        if (asset.protocol !== "http:" && asset.protocol !== "https:") continue;
        if (asset.origin !== pageUrl.origin) {
          throw new Error(`The deployed HTML links to an off-origin asset: ${asset.origin}.`);
        }
        assets.add(asset.href);
      }
    }
  }
  if (assets.size === 0) {
    throw new Error("The deployed homepage did not link any same-origin assets.");
  }
  return [...assets].map((asset) => new URL(asset));
}

async function request(fetchImpl, url, options, label) {
  let response;
  try {
    response = await fetchImpl(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...options,
      headers: {
        "Cache-Control": "no-cache",
        ...(options?.headers || {}),
      },
    });
  } catch {
    throw new Error(`${label} request could not be completed.`);
  }
  return response;
}

async function requireAvailable(fetchImpl, url, label) {
  const response = await request(fetchImpl, url, { method: "GET" }, label);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${label} returned HTTP ${response.status}.`);
  }
  return response;
}

async function verifyOnce({ attempt, fetchImpl, pageUrl, sha }) {
  let sequence = 0;
  const homepage = await requireAvailable(
    fetchImpl,
    cacheBusted(pageUrl, sha, attempt, sequence++),
    "Pages homepage",
  );
  const homepageHtml = await homepage.text();
  const assets = linkedAssetUrls(homepageHtml, pageUrl);

  const markerUrl = new URL("deployment.txt", pageUrl);
  const checks = [
    (async () => {
      const marker = await requireAvailable(
        fetchImpl,
        cacheBusted(markerUrl, sha, attempt, sequence++),
        "Deployment marker",
      );
      const markerText = await marker.text();
      if (markerText !== sha) {
        throw new Error("The deployment marker does not match the verified SHA.");
      }
    })(),
    ...assets.map((asset) =>
      requireAvailable(
        fetchImpl,
        cacheBusted(asset, sha, attempt, sequence++),
        `Same-origin asset ${asset.pathname}`,
      ),
    ),
  ];
  for (const route of ["assignment", "draft"]) {
    const routeUrl = new URL(`api/live/${route}`, pageUrl);
    for (const method of ["GET", "POST"]) {
      checks.push(
        (async () => {
          const response = await request(
            fetchImpl,
            cacheBusted(routeUrl, sha, attempt, sequence++),
            {
              body: method === "POST" ? "{}" : undefined,
              headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
              method,
            },
            `Static Live boundary ${method} ${route}`,
          );
          if (response.status >= 200 && response.status < 300) {
            throw new Error(`Static Live boundary ${method} ${route} unexpectedly returned 2xx.`);
          }
        })(),
      );
    }
  }
  await Promise.all(checks);

  return { assetCount: assets.length };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function smokePages({
  delaysMs = DEFAULT_DELAYS_MS,
  fetchImpl = fetch,
  pageUrl: pageUrlValue,
  sha: shaValue,
  sleepImpl = sleep,
}) {
  if (!Array.isArray(delaysMs) || delaysMs.length === 0) {
    throw new Error("Pages smoke retries require at least one bounded attempt.");
  }
  const pageUrl = normalizedPageUrl(pageUrlValue);
  const sha = validatedSha(shaValue, "Pages smoke SHA");
  let lastError;

  for (let index = 0; index < delaysMs.length; index += 1) {
    const delayMs = delaysMs[index];
    if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 60_000) {
      throw new Error("Each Pages smoke retry delay must be between 0 and 60000 ms.");
    }
    if (delayMs > 0) await sleepImpl(delayMs);

    try {
      const result = await verifyOnce({ attempt: index + 1, fetchImpl, pageUrl, sha });
      return { ...result, attempts: index + 1, pageUrl: pageUrl.href, sha };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown Pages smoke failure.");
      console.warn(`Pages smoke attempt ${index + 1}/${delaysMs.length} failed: ${lastError.message}`);
    }
  }

  throw new Error(
    `Pages smoke failed after ${delaysMs.length} attempts: ${lastError?.message || "unknown failure"}`,
  );
}

async function appendSummary(file, lines) {
  if (!file) return;
  await appendFile(file, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const sha = validatedSha(process.env.VERIFIED_SHA, "Pages smoke SHA");
  try {
    const result = await smokePages({ pageUrl: process.env.PAGES_URL, sha });
    await appendSummary(process.env.GITHUB_STEP_SUMMARY, [
      "### Pages live smoke",
      "",
      `- Verified SHA: \`${result.sha}\``,
      `- Result: passed after ${result.attempts} attempt${result.attempts === 1 ? "" : "s"}`,
      `- Checked: homepage, deployment marker, ${result.assetCount} same-origin HTML-linked assets, and non-2xx GET/POST responses from both static Live paths`,
    ]);
    console.log(`Pages live smoke passed for ${result.sha} after ${result.attempts} attempt(s).`);
  } catch (error) {
    await appendSummary(process.env.GITHUB_STEP_SUMMARY, [
      "### Pages live smoke",
      "",
      `- Verified SHA: \`${sha}\``,
      "- Result: failed after bounded retries",
    ]);
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Pages live smoke failed.");
    process.exitCode = 1;
  });
}
