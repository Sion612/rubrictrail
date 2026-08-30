import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { deflateSync } from "node:zlib";

import {
  auditStaticDemoMetadata,
  PUBLIC_DEMO_SITEMAP_URL,
  PUBLIC_DEMO_SOCIAL_IMAGE_URL,
  PUBLIC_DEMO_URL,
} from "./static-demo-metadata-audit.mjs";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(content) {
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function solidPng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rowBytes = width * 4 + 1;
  const pixels = Buffer.alloc(rowBytes * height);
  for (let row = 0; row < height; row += 1) {
    const rowStart = row * rowBytes;
    pixels[rowStart] = 0;
    for (let column = 0; column < width; column += 1) {
      const pixel = rowStart + 1 + column * 4;
      pixels[pixel] = 11;
      pixels[pixel + 1] = 107;
      pixels[pixel + 2] = 91;
      pixels[pixel + 3] = 255;
    }
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const VALID_SOCIAL_IMAGE = solidPng(1200, 630);

function indexHtml({
  canonicalTags = `<link rel="canonical" href="${PUBLIC_DEMO_URL}">`,
  extraAsset = "",
  faviconUrl = "/rubrictrail/icon.svg",
  openGraphImageUrl = PUBLIC_DEMO_SOCIAL_IMAGE_URL,
  openGraphUrl = PUBLIC_DEMO_URL,
  twitterImageUrl = PUBLIC_DEMO_SOCIAL_IMAGE_URL,
} = {}) {
  return `<!doctype html>
<html><head>
${canonicalTags}
<meta name="robots" content="index, follow">
<meta property="og:type" content="website">
<meta property="og:title" content="RubricTrail">
<meta property="og:description" content="Local-first assignment planning">
<meta property="og:site_name" content="RubricTrail">
<meta property="og:url" content="${openGraphUrl}">
<meta property="og:image" content="${openGraphImageUrl}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="RubricTrail">
<meta name="twitter:description" content="Local-first assignment planning">
<meta name="twitter:image" content="${twitterImageUrl}">
<link rel="icon" href="${faviconUrl}">
<link rel="stylesheet" href="/rubrictrail/app.css">
${extraAsset}
</head><body></body></html>`;
}

function sitemap(locations = [PUBLIC_DEMO_URL], extra = "") {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locations.map((location) => `<url><loc>${location}</loc>${extra}</url>`).join("\n")}
</urlset>`;
}

async function fixture(options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "rubrictrail-metadata-audit-"));
  const outputRoot = path.join(root, "demo-out");
  const selfHostedRoot = path.join(root, "self-hosted");
  await Promise.all([
    mkdir(outputRoot, { recursive: true }),
    mkdir(selfHostedRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(outputRoot, "index.html"), indexHtml(options), "utf8"),
    writeFile(path.join(outputRoot, "icon.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>", "utf8"),
    writeFile(path.join(outputRoot, "opengraph-image.png"), VALID_SOCIAL_IMAGE),
    writeFile(path.join(outputRoot, "app.css"), "body{}", "utf8"),
    writeFile(
      path.join(outputRoot, "robots.txt"),
      `User-Agent: *\nAllow: /rubrictrail/\n\nSitemap: ${PUBLIC_DEMO_SITEMAP_URL}\n`,
      "utf8",
    ),
    writeFile(path.join(outputRoot, "sitemap.xml"), sitemap(), "utf8"),
    writeFile(path.join(selfHostedRoot, "index.html"), options.selfHostedHtml || "<title>RubricTrail</title>", "utf8"),
  ]);
  if (options.removeFavicon) await rm(path.join(outputRoot, "icon.svg"));
  if (options.removeSocialImage) await rm(path.join(outputRoot, "opengraph-image.png"));
  if (options.socialImage) {
    await writeFile(path.join(outputRoot, "opengraph-image.png"), options.socialImage);
  }
  if (options.sitemapLocations || options.sitemapExtra) {
    await writeFile(
      path.join(outputRoot, "sitemap.xml"),
      sitemap(options.sitemapLocations || [PUBLIC_DEMO_URL], options.sitemapExtra || ""),
      "utf8",
    );
  }
  return {
    audit: () => auditStaticDemoMetadata({ outputRoot, selfHostedRoots: [selfHostedRoot] }),
    cleanup: () => rm(root, { force: true, recursive: true }),
  };
}

async function rejects(options, pattern) {
  const current = await fixture(options);
  try {
    await assert.rejects(current.audit(), pattern);
  } finally {
    await current.cleanup();
  }
}

test("accepts the exact public-demo metadata and local assets", async () => {
  const current = await fixture();
  try {
    const result = await current.audit();
    assert.equal(result.canonical, PUBLIC_DEMO_URL);
    assert.equal(result.socialImageWidth, 1200);
    assert.equal(result.socialImageHeight, 630);
  } finally {
    await current.cleanup();
  }
});

test("rejects a missing canonical", () =>
  rejects({ canonicalTags: "" }, /exactly one canonical/u));

test("rejects more than one canonical", () =>
  rejects(
    {
      canonicalTags: `<link rel="canonical" href="${PUBLIC_DEMO_URL}"><link rel="canonical" href="${PUBLIC_DEMO_URL}">`,
    },
    /exactly one canonical/u,
  ));

test("rejects an incorrect canonical", () =>
  rejects(
    { canonicalTags: '<link rel="canonical" href="https://example.test/rubrictrail/">' },
    /canonical must be exactly/u,
  ));

test("rejects a relative canonical", () =>
  rejects(
    { canonicalTags: '<link rel="canonical" href="/rubrictrail/">' },
    /canonical must be an absolute URL/u,
  ));

test("rejects a localhost canonical", () =>
  rejects(
    { canonicalTags: '<link rel="canonical" href="https://localhost/rubrictrail/">' },
    /canonical must not use localhost/u,
  ));

test("rejects an incorrect Open Graph URL", () =>
  rejects({ openGraphUrl: "https://sion612.github.io/" }, /Open Graph URL must be exactly/u));

test("rejects an incorrect social-image URL", () =>
  rejects(
    { twitterImageUrl: "https://sion612.github.io/rubrictrail/wrong.png" },
    /Twitter image URL must resolve/u,
  ));

test("rejects a social-image URL with an unexpected query", () =>
  rejects(
    { openGraphImageUrl: `${PUBLIC_DEMO_SOCIAL_IMAGE_URL}?unexpected` },
    /Open Graph image URL must resolve/u,
  ));

test("rejects missing favicon and social-image files", async (context) => {
  await context.test("favicon", () => rejects({ removeFavicon: true }, /Favicon file is missing/u));
  await context.test("social image", () =>
    rejects({ removeSocialImage: true }, /Social image file is missing/u));
});

test("rejects assets that escape the public demo base path", () =>
  rejects({ extraAsset: '<script src="/outside.js"></script>' }, /escapes \/rubrictrail\//u));

test("rejects third-party asset URLs", () =>
  rejects(
    { extraAsset: '<img src="https://cdn.example.test/tracker.png">' },
    /third-party asset URL/u,
  ));

test("rejects a missing linked local asset", () =>
  rejects(
    { extraAsset: '<script src="/rubrictrail/missing.js"></script>' },
    /HTML asset \d+ file is missing/u,
  ));

test("rejects extra sitemap URLs or per-URL metadata", async (context) => {
  await context.test("extra URL", () =>
    rejects(
      { sitemapLocations: [PUBLIC_DEMO_URL, `${PUBLIC_DEMO_URL}other/`] },
      /exactly one URL entry/u,
    ));
  await context.test("extra metadata", () =>
    rejects({ sitemapExtra: "<priority>1</priority>" }, /must not contain additional metadata/u));
});

test("rejects the Pages canonical in self-hosted output", () =>
  rejects(
    {
      selfHostedHtml: `<link rel="canonical" href="${PUBLIC_DEMO_URL}">`,
    },
    /self-hosted application contains the Pages canonical/u,
  ));

test("rejects a non-PNG or incorrectly sized social image", async (context) => {
  await context.test("wrong type", () =>
    rejects({ socialImage: Buffer.from("not an image") }, /not a PNG file/u));
  await context.test("wrong size", () =>
    rejects({ socialImage: solidPng(600, 315) }, /must be exactly 1200x630/u));
});
