import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(repositoryRoot, "demo", "out");
const forbidden = [
  "/api/live/",
  "OPENAI_API_KEY",
  "OPENAI_LIVE_ENABLED",
  "api.openai.com",
];
const textExtensions = new Set([".css", ".html", ".js", ".json", ".mjs", ".txt"]);

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
if (!files.some((file) => path.basename(file) === "index.html")) {
  throw new Error("The static demo does not contain an index.html entry point.");
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

console.log(`Static demo audit passed for ${files.length} files.`);
