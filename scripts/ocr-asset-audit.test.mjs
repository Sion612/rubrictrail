import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  auditOcrAssets,
  EXPECTED_OCR_PACKAGES,
  REQUIRED_OCR_ASSETS,
} from "./ocr-asset-audit.mjs";

const temporaryDirectories = [];

async function fixture() {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "rubrictrail-ocr-audit-"));
  temporaryDirectories.push(outputRoot);
  const files = [];
  for (const [index, relativePath] of REQUIRED_OCR_ASSETS.entries()) {
    const absolutePath = path.join(outputRoot, "ocr", ...relativePath.split("/"));
    const content = Buffer.from(`fictional-${index}`);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
    files.push({
      path: relativePath,
      bytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }
  const manifest = {
    formatVersion: 1,
    engine: "tesseract.js",
    languages: ["eng", "chi_sim"],
    packages: EXPECTED_OCR_PACKAGES,
    files,
  };
  const manifestPath = path.join(outputRoot, "ocr", "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  return { outputRoot, manifest, manifestPath };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("auditOcrAssets", () => {
  it("accepts a complete deferred same-output-root fixture", async () => {
    const { outputRoot } = await fixture();
    assert.deepEqual(await auditOcrAssets(outputRoot, "<html></html>"), {
      fileCount: REQUIRED_OCR_ASSETS.length,
      totalBytes: 110,
    });
  });

  it("rejects a missing manifest or required asset", async () => {
    const empty = await mkdtemp(path.join(os.tmpdir(), "rubrictrail-ocr-empty-"));
    temporaryDirectories.push(empty);
    await assert.rejects(() => auditOcrAssets(empty, "<html></html>"), /manifest/u);

    const { outputRoot } = await fixture();
    await rm(path.join(outputRoot, "ocr", ...REQUIRED_OCR_ASSETS[0].split("/")));
    await assert.rejects(() => auditOcrAssets(outputRoot, "<html></html>"), /missing/u);
  });

  it("rejects path escape, integrity mismatch and initial eager references", async () => {
    const escaped = await fixture();
    escaped.manifest.files[0].path = "../outside.js";
    await writeFile(escaped.manifestPath, JSON.stringify(escaped.manifest), "utf8");
    await assert.rejects(
      () => auditOcrAssets(escaped.outputRoot, "<html></html>"),
      /required|unsafe/u,
    );

    const changed = await fixture();
    changed.manifest.files[0].sha256 = "0".repeat(64);
    await writeFile(changed.manifestPath, JSON.stringify(changed.manifest), "utf8");
    await assert.rejects(
      () => auditOcrAssets(changed.outputRoot, "<html></html>"),
      /integrity/u,
    );

    const eager = await fixture();
    await assert.rejects(
      () => auditOcrAssets(
        eager.outputRoot,
        '<script src="/rubrictrail/ocr/worker.min.js"></script>',
      ),
      /initial static HTML/u,
    );
  });
});
