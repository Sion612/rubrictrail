import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(repositoryRoot, "demo", "out");
const forbidden = [
  "/api/live/",
  "OPENAI_API_KEY",
  "OPENAI_LIVE_ENABLED",
  "api.openai.com",
];
const textExtensions = new Set([".css", ".html", ".js", ".json", ".mjs", ".txt"]);
// The first phase-splitting pass produced 346,585 gzip bytes on 14 August 2026.
// Keep a small amount of build-to-build headroom without disguising the result
// as the separate 10% reduction target, which this scoped pass did not reach.
const INITIAL_ASSET_GZIP_BUDGET_BYTES = 357_000;

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(absolute) : [absolute];
    }),
  );
  return nested.flat();
}

const files = await filesBelow(outputRoot);
const indexPath = path.join(outputRoot, "index.html");
if (!files.includes(indexPath)) {
  throw new Error("The static demo does not contain an index.html entry point.");
}

const deploymentMarkerPath = path.join(outputRoot, "deployment.txt");
if (files.includes(deploymentMarkerPath)) {
  const deploymentMarker = await readFile(deploymentMarkerPath, "utf8");
  if (!/^[0-9a-f]{40}$/u.test(deploymentMarker)) {
    throw new Error("The deployment marker must contain only one complete commit SHA.");
  }
}

for (const file of files) {
  if (!textExtensions.has(path.extname(file).toLowerCase())) continue;
  const content = await readFile(file, "utf8");
  const finding = forbidden.find((value) => content.includes(value));
  if (finding) {
    throw new Error(
      `Static demo contains forbidden runtime marker ${JSON.stringify(finding)} in ${path.relative(outputRoot, file)}.`,
    );
  }
}

const indexHtml = await readFile(indexPath, "utf8");
const initialAssets = new Set();
for (const match of indexHtml.matchAll(/(?:src|href)="([^"]+)"/giu)) {
  const reference = match[1];
  let pathname;
  try {
    pathname = new URL(reference, "https://rubrictrail.invalid").pathname;
  } catch {
    continue;
  }
  if (!/\.(?:css|js)$/iu.test(pathname)) continue;
  const nextAssetMarker = "/_next/";
  const markerIndex = pathname.indexOf(nextAssetMarker);
  if (markerIndex < 0) continue;

  const relativePath = pathname.slice(markerIndex + 1);
  const absolutePath = path.resolve(
    outputRoot,
    ...relativePath.split("/").map((segment) => decodeURIComponent(segment)),
  );
  if (!absolutePath.startsWith(`${outputRoot}${path.sep}`)) {
    throw new Error(`Initial asset resolves outside the static demo: ${reference}`);
  }
  initialAssets.add(absolutePath);
}

if (initialAssets.size === 0) {
  throw new Error("The static demo index does not reference any initial JavaScript or CSS assets.");
}

let initialRawBytes = 0;
let initialGzipBytes = 0;
for (const asset of initialAssets) {
  const content = await readFile(asset);
  initialRawBytes += content.byteLength;
  initialGzipBytes += gzipSync(content, { level: 9 }).byteLength;
}

console.log(
  `Initial static assets: ${initialAssets.size} unique JS/CSS files, ${initialRawBytes} raw bytes, ${initialGzipBytes} gzip bytes.`,
);
if (initialGzipBytes > INITIAL_ASSET_GZIP_BUDGET_BYTES) {
  throw new Error(
    `Initial JS/CSS gzip size ${initialGzipBytes} exceeds the ${INITIAL_ASSET_GZIP_BUDGET_BYTES}-byte budget.`,
  );
}

console.log(`Static demo audit passed for ${files.length} files.`);
