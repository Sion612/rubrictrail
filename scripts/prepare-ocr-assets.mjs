import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");

const packageVersions = Object.freeze({
  "@tesseract.js-data/chi_sim": "1.0.0",
  "@tesseract.js-data/eng": "1.0.0",
  "tesseract.js": "7.0.0",
  "tesseract.js-core": "7.0.0",
});

const copiedAssets = Object.freeze([
  {
    packageName: "tesseract.js",
    source: "dist/worker.min.js",
    destination: "worker.min.js",
    sha256: "576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d",
  },
  {
    packageName: "tesseract.js",
    source: "dist/worker.min.js.map",
    destination: "worker.min.js.map",
    sha256: "5cfacf7eb569f0e6e6302a7f045b2d76a2161b537230b90de790b81f5563fd7f",
  },
  {
    packageName: "tesseract.js",
    source: "dist/worker.min.js.LICENSE.txt",
    destination: "worker.min.js.LICENSE.txt",
    sha256: "45f54171aeaa1d10c0c1a66f374b7bba1f02472b1487fbe892eec04f840002ac",
  },
  {
    packageName: "tesseract.js-core",
    source: "tesseract-core-lstm.wasm.js",
    destination: "core/tesseract-core-lstm.wasm.js",
    sha256: "eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680",
  },
  {
    packageName: "tesseract.js-core",
    source: "tesseract-core-simd-lstm.wasm.js",
    destination: "core/tesseract-core-simd-lstm.wasm.js",
    sha256: "c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38",
  },
  {
    packageName: "tesseract.js-core",
    source: "tesseract-core-relaxedsimd-lstm.wasm.js",
    destination: "core/tesseract-core-relaxedsimd-lstm.wasm.js",
    sha256: "861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3",
  },
  {
    packageName: "@tesseract.js-data/eng",
    source: "4.0.0_best_int/eng.traineddata.gz",
    destination: "lang/eng.traineddata.gz",
    sha256: "45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91",
  },
  {
    packageName: "@tesseract.js-data/chi_sim",
    source: "4.0.0_best_int/chi_sim.traineddata.gz",
    destination: "lang/chi_sim.traineddata.gz",
    sha256: "b8a23f10c7de500891eb458a8adc9cc58ab7f242f08b7d149f5e9aea4ad5db7c",
  },
  {
    packageName: "tesseract.js",
    source: "LICENSE.md",
    destination: "licenses/tesseract-js.LICENSE.md",
    sha256: "b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1",
  },
  {
    packageName: "tesseract.js-core",
    source: "LICENSE",
    destination: "licenses/tesseract-js-core.LICENSE",
    sha256: "c6596eb7be8581c18be736c846fb9173b69eccf6ef94c5135893ec56bd92ba08",
  },
]);

async function packageDirectory(packageName) {
  const packagePath = path.join(repositoryRoot, "node_modules", ...packageName.split("/"));
  const manifest = JSON.parse(await readFile(path.join(packagePath, "package.json"), "utf8"));
  const expectedVersion = packageVersions[packageName];

  if (manifest.version !== expectedVersion) {
    throw new Error(
      `Expected ${packageName}@${expectedVersion}, found ${String(manifest.version)}.`,
    );
  }

  return packagePath;
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function prepareTarget(relativePublicDirectory) {
  const publicDirectory = path.resolve(repositoryRoot, relativePublicDirectory);
  const expectedParent = path.resolve(repositoryRoot, path.dirname(relativePublicDirectory));

  if (path.dirname(publicDirectory) !== expectedParent || path.basename(publicDirectory) !== "ocr") {
    throw new Error(`Refusing unexpected OCR target: ${publicDirectory}`);
  }

  await mkdir(expectedParent, { recursive: true });
  const stagingDirectory = await mkdtemp(path.join(expectedParent, ".ocr-staging-"));

  try {
    const packageDirectories = new Map();
    const files = [];

    for (const asset of copiedAssets) {
      let sourceDirectory = packageDirectories.get(asset.packageName);
      if (!sourceDirectory) {
        sourceDirectory = await packageDirectory(asset.packageName);
        packageDirectories.set(asset.packageName, sourceDirectory);
      }

      const sourcePath = path.join(sourceDirectory, ...asset.source.split("/"));
      const sourceHash = await sha256(sourcePath);
      if (sourceHash !== asset.sha256) {
        throw new Error(
          `Integrity check failed for ${asset.packageName}/${asset.source}: expected ${asset.sha256}, found ${sourceHash}.`,
        );
      }
      const destinationPath = path.join(stagingDirectory, ...asset.destination.split("/"));
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await copyFile(sourcePath, destinationPath);
      const details = await stat(destinationPath);
      files.push({
        path: asset.destination,
        bytes: details.size,
        sha256: await sha256(destinationPath),
      });
    }

    files.sort((left, right) => left.path.localeCompare(right.path));
    const manifest = {
      formatVersion: 1,
      engine: "tesseract.js",
      languages: ["eng", "chi_sim"],
      packages: packageVersions,
      files,
    };
    await writeFile(
      path.join(stagingDirectory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );

    await rm(publicDirectory, { recursive: true, force: true });
    await rename(stagingDirectory, publicDirectory);
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

const target = process.argv[2] ?? "all";
const targets = {
  root: ["public/ocr"],
  demo: ["demo/public/ocr"],
  all: ["public/ocr", "demo/public/ocr"],
}[target];

if (!targets) {
  throw new Error("Usage: node scripts/prepare-ocr-assets.mjs [root|demo|all]");
}

for (const targetDirectory of targets) {
  await prepareTarget(targetDirectory);
}

console.log(`Prepared pinned local OCR assets for: ${targets.join(", ")}`);
