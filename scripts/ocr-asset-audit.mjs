import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const EXPECTED_OCR_PACKAGES = Object.freeze({
  "@tesseract.js-data/chi_sim": "1.0.0",
  "@tesseract.js-data/eng": "1.0.0",
  "tesseract.js": "7.0.0",
  "tesseract.js-core": "7.0.0",
});

export const REQUIRED_OCR_ASSETS = Object.freeze([
  "core/tesseract-core-lstm.wasm.js",
  "core/tesseract-core-relaxedsimd-lstm.wasm.js",
  "core/tesseract-core-simd-lstm.wasm.js",
  "lang/chi_sim.traineddata.gz",
  "lang/eng.traineddata.gz",
  "licenses/tesseract-js-core.LICENSE",
  "licenses/tesseract-js.LICENSE.md",
  "worker.min.js",
  "worker.min.js.LICENSE.txt",
  "worker.min.js.map",
]);

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

export async function auditOcrAssets(outputRoot, indexHtml) {
  if (/\/ocr\//iu.test(indexHtml)) {
    throw new Error("OCR assets must not be referenced by the initial static HTML.");
  }

  const ocrRoot = path.resolve(outputRoot, "ocr");
  const manifestPath = path.join(ocrRoot, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error("The static demo is missing a valid local OCR manifest.", {
      cause: error,
    });
  }

  if (
    manifest.formatVersion !== 1 ||
    manifest.engine !== "tesseract.js" ||
    JSON.stringify(manifest.languages) !== JSON.stringify(["eng", "chi_sim"]) ||
    JSON.stringify(manifest.packages) !== JSON.stringify(EXPECTED_OCR_PACKAGES) ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error("The local OCR manifest has unexpected engine, language or package metadata.");
  }

  const manifestPaths = manifest.files.map((entry) => entry?.path);
  if (JSON.stringify([...manifestPaths].sort()) !== JSON.stringify(REQUIRED_OCR_ASSETS)) {
    throw new Error("The local OCR manifest does not contain exactly the required runtime assets.");
  }

  let totalBytes = 0;
  for (const entry of manifest.files) {
    if (
      typeof entry.path !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9./_-]*$/u.test(entry.path) ||
      entry.path.includes("..") ||
      path.isAbsolute(entry.path) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes <= 0 ||
      !/^[0-9a-f]{64}$/u.test(entry.sha256)
    ) {
      throw new Error("The local OCR manifest contains an unsafe or malformed file entry.");
    }
    const absolutePath = path.resolve(ocrRoot, ...entry.path.split("/"));
    if (!absolutePath.startsWith(`${ocrRoot}${path.sep}`)) {
      throw new Error(`OCR asset resolves outside the static demo: ${entry.path}`);
    }

    let content;
    try {
      content = await readFile(absolutePath);
    } catch (error) {
      throw new Error(`Required local OCR asset is missing: ${entry.path}`, {
        cause: error,
      });
    }
    const details = await stat(absolutePath);
    if (details.size !== entry.bytes || sha256(content) !== entry.sha256) {
      throw new Error(`Local OCR asset integrity mismatch: ${entry.path}`);
    }
    totalBytes += details.size;
  }

  return { fileCount: manifest.files.length, totalBytes };
}
