import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const PUBLIC_DEMO_URL = "https://sion612.github.io/rubrictrail/";
export const PUBLIC_DEMO_SOCIAL_IMAGE_URL = `${PUBLIC_DEMO_URL}opengraph-image.png`;
export const PUBLIC_DEMO_SITEMAP_URL = `${PUBLIC_DEMO_URL}sitemap.xml`;

const PUBLIC_DEMO_ORIGIN = new URL(PUBLIC_DEMO_URL).origin;
const PUBLIC_DEMO_PATH = new URL(PUBLIC_DEMO_URL).pathname;
const SELF_HOSTED_TEXT_EXTENSIONS = new Set([
  ".html",
  ".js",
  ".jsx",
  ".rsc",
  ".ts",
  ".tsx",
  ".txt",
]);

async function filesBelow(directory, { allowMissing = false } = {}) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (allowMissing && error && error.code === "ENOENT") return [];
    throw error;
  }
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(absolute) : [absolute];
    }),
  );
  return nested.flat();
}

function attributeMap(tag) {
  const attributes = new Map();
  for (const match of tag.matchAll(/\b([^\s=/>]+)\s*=\s*(["'])(.*?)\2/gu)) {
    attributes.set(match[1].toLowerCase(), match[3]);
  }
  return attributes;
}

function tagsNamed(html, tagName) {
  return [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "giu"))].map(
    (match) => attributeMap(match[0]),
  );
}

function relValues(attributes) {
  return new Set((attributes.get("rel") || "").toLowerCase().split(/\s+/u).filter(Boolean));
}

function oneMetaContent(metaTags, key, value) {
  const matches = metaTags.filter(
    (attributes) => attributes.get(key)?.toLowerCase() === value.toLowerCase(),
  );
  if (matches.length !== 1) {
    throw new Error(`Static demo must contain exactly one ${value} metadata field.`);
  }
  const content = matches[0].get("content")?.trim();
  if (!content) throw new Error(`Static demo ${value} metadata must not be empty.`);
  return content;
}

function absoluteHttpsUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS.`);
  if (["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(url.hostname)) {
    throw new Error(`${label} must not use localhost.`);
  }
  return url;
}

function expectedSocialImageUrl(value, label) {
  const url = absoluteHttpsUrl(value, label);
  const expected = new URL(PUBLIC_DEMO_SOCIAL_IMAGE_URL);
  if (url.href !== expected.href) {
    throw new Error(`${label} must resolve to ${PUBLIC_DEMO_SOCIAL_IMAGE_URL}.`);
  }
  return url;
}

function demoAssetUrl(value, label) {
  if (/^(?:data:|blob:)/iu.test(value)) return null;
  let url;
  try {
    url = new URL(value, PUBLIC_DEMO_URL);
  } catch {
    throw new Error(`${label} is not a valid URL: ${value}`);
  }
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS: ${value}`);
  if (url.origin !== PUBLIC_DEMO_ORIGIN) {
    throw new Error(`${label} uses a third-party asset URL: ${url.origin}.`);
  }
  if (!url.pathname.startsWith(PUBLIC_DEMO_PATH) || url.pathname === PUBLIC_DEMO_PATH) {
    throw new Error(`${label} escapes ${PUBLIC_DEMO_PATH}: ${value}`);
  }
  if (url.hash) throw new Error(`${label} must not contain a URL fragment: ${value}`);
  return url;
}

function outputFileForUrl(outputRoot, url, label) {
  const encodedRelative = url.pathname.slice(PUBLIC_DEMO_PATH.length);
  let segments;
  try {
    segments = encodedRelative.split("/").map((segment) => decodeURIComponent(segment));
  } catch {
    throw new Error(`${label} contains an invalid encoded path.`);
  }
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${label} has an unsafe path.`);
  }
  const candidate = path.resolve(outputRoot, ...segments);
  const relative = path.relative(outputRoot, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} resolves outside the static demo.`);
  }
  return candidate;
}

function srcsetReferences(value) {
  return value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/u)[0])
    .filter(Boolean);
}

function linkedAssetReferences(indexHtml) {
  const references = [];
  for (const tagName of ["script", "img", "source"]) {
    for (const attributes of tagsNamed(indexHtml, tagName)) {
      if (attributes.has("src")) references.push(attributes.get("src"));
      if (attributes.has("srcset")) {
        references.push(...srcsetReferences(attributes.get("srcset")));
      }
    }
  }
  const assetLinkRels = new Set([
    "apple-touch-icon",
    "icon",
    "manifest",
    "modulepreload",
    "preload",
    "stylesheet",
  ]);
  for (const attributes of tagsNamed(indexHtml, "link")) {
    if ([...relValues(attributes)].some((rel) => assetLinkRels.has(rel))) {
      references.push(attributes.get("href"));
    }
  }
  return references.filter(Boolean);
}

function pngDimensions(content) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (content.length < 33 || !content.subarray(0, 8).equals(signature)) {
    throw new Error("The social image is not a PNG file.");
  }
  if (content.readUInt32BE(8) !== 13 || content.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("The social image does not contain a valid PNG IHDR header.");
  }
  return {
    width: content.readUInt32BE(16),
    height: content.readUInt32BE(20),
  };
}

async function requireFile(file, label) {
  try {
    return await readFile(file);
  } catch (error) {
    if (error && error.code === "ENOENT") throw new Error(`${label} file is missing.`);
    throw error;
  }
}

function auditSitemap(sitemap) {
  const urlBlocks = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/giu)];
  if (urlBlocks.length !== 1) {
    throw new Error("The demo sitemap must contain exactly one URL entry.");
  }
  const locs = [...urlBlocks[0][1].matchAll(/<loc>(.*?)<\/loc>/giu)].map((match) =>
    match[1].trim(),
  );
  if (locs.length !== 1 || locs[0] !== PUBLIC_DEMO_URL) {
    throw new Error(`The demo sitemap must contain only ${PUBLIC_DEMO_URL}.`);
  }
  if (urlBlocks[0][1].replace(/<loc>[\s\S]*?<\/loc>/giu, "").trim()) {
    throw new Error("The demo sitemap URL entry must not contain additional metadata.");
  }
  const outsideUrl = sitemap
    .replace(/<\?xml[\s\S]*?\?>/giu, "")
    .replace(/<urlset\b[^>]*>/giu, "")
    .replace(/<\/urlset>/giu, "")
    .replace(/<url>[\s\S]*?<\/url>/giu, "")
    .trim();
  if (outsideUrl) throw new Error("The demo sitemap contains unexpected content.");
}

async function assertNoPagesCanonicalInSelfHostedRoots(selfHostedRoots) {
  for (const root of selfHostedRoots) {
    const files = await filesBelow(root, { allowMissing: true });
    for (const file of files) {
      if (!SELF_HOSTED_TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
      const content = await readFile(file, "utf8");
      if (content.includes(PUBLIC_DEMO_URL) && /\bcanonical\b/iu.test(content)) {
        throw new Error(
          `The self-hosted application contains the Pages canonical in ${path.relative(root, file)}.`,
        );
      }
    }
  }
}

export async function auditStaticDemoMetadata({
  outputRoot,
  selfHostedRoots = [],
}) {
  const indexPath = path.join(outputRoot, "index.html");
  const indexHtml = await requireFile(indexPath, "Static demo index");
  const html = indexHtml.toString("utf8");

  const canonicalLinks = tagsNamed(html, "link").filter((attributes) =>
    relValues(attributes).has("canonical"),
  );
  if (canonicalLinks.length !== 1) {
    throw new Error("Static demo must contain exactly one canonical link.");
  }
  const canonicalValue = canonicalLinks[0].get("href")?.trim();
  if (!canonicalValue) throw new Error("Static demo canonical link must have an href.");
  const canonical = absoluteHttpsUrl(canonicalValue, "Static demo canonical");
  if (canonical.href !== PUBLIC_DEMO_URL) {
    throw new Error(`Static demo canonical must be exactly ${PUBLIC_DEMO_URL}.`);
  }

  const metaTags = tagsNamed(html, "meta");
  const openGraphUrl = absoluteHttpsUrl(
    oneMetaContent(metaTags, "property", "og:url"),
    "Open Graph URL",
  );
  if (openGraphUrl.href !== PUBLIC_DEMO_URL) {
    throw new Error(`Open Graph URL must be exactly ${PUBLIC_DEMO_URL}.`);
  }
  if (oneMetaContent(metaTags, "property", "og:type") !== "website") {
    throw new Error("Open Graph type must be website.");
  }
  oneMetaContent(metaTags, "property", "og:title");
  oneMetaContent(metaTags, "property", "og:description");
  oneMetaContent(metaTags, "property", "og:site_name");

  const openGraphImage = expectedSocialImageUrl(
    oneMetaContent(metaTags, "property", "og:image"),
    "Open Graph image URL",
  );
  const twitterImage = expectedSocialImageUrl(
    oneMetaContent(metaTags, "name", "twitter:image"),
    "Twitter image URL",
  );
  if (oneMetaContent(metaTags, "name", "twitter:card") !== "summary_large_image") {
    throw new Error("Twitter card must be summary_large_image.");
  }
  oneMetaContent(metaTags, "name", "twitter:title");
  oneMetaContent(metaTags, "name", "twitter:description");

  const robotsMeta = oneMetaContent(metaTags, "name", "robots")
    .toLowerCase()
    .split(",")
    .map((value) => value.trim());
  if (!robotsMeta.includes("index") || !robotsMeta.includes("follow")) {
    throw new Error("Static demo robots metadata must allow indexing and following.");
  }

  const faviconLinks = tagsNamed(html, "link").filter((attributes) =>
    relValues(attributes).has("icon"),
  );
  if (faviconLinks.length !== 1) {
    throw new Error("Static demo must contain exactly one favicon link.");
  }
  const faviconUrl = demoAssetUrl(faviconLinks[0].get("href"), "Favicon URL");
  const faviconPath = outputFileForUrl(outputRoot, faviconUrl, "Favicon URL");
  const favicon = await requireFile(faviconPath, "Favicon");
  if (!favicon.subarray(0, 256).toString("utf8").includes("<svg")) {
    throw new Error("The favicon file is not the expected local SVG image.");
  }

  const socialImagePath = outputFileForUrl(
    outputRoot,
    openGraphImage,
    "Open Graph image URL",
  );
  if (outputFileForUrl(outputRoot, twitterImage, "Twitter image URL") !== socialImagePath) {
    throw new Error("Open Graph and Twitter must use the same local social image.");
  }
  const socialImage = await requireFile(socialImagePath, "Social image");
  const dimensions = pngDimensions(socialImage);
  if (dimensions.width !== 1200 || dimensions.height !== 630) {
    throw new Error(
      `The social image must be exactly 1200x630, observed ${dimensions.width}x${dimensions.height}.`,
    );
  }

  for (const [index, reference] of linkedAssetReferences(html).entries()) {
    const label = `HTML asset ${index + 1}`;
    const assetUrl = demoAssetUrl(reference, label);
    if (assetUrl) {
      await requireFile(outputFileForUrl(outputRoot, assetUrl, label), label);
    }
  }

  const robots = (
    await requireFile(path.join(outputRoot, "robots.txt"), "Demo robots.txt")
  ).toString("utf8").replace(/\r\n/gu, "\n").trim();
  const expectedRobots = [
    "User-Agent: *",
    "Allow: /rubrictrail/",
    "",
    `Sitemap: ${PUBLIC_DEMO_SITEMAP_URL}`,
  ].join("\n");
  if (robots !== expectedRobots) {
    throw new Error("Demo robots.txt does not match the public subpath and sitemap boundary.");
  }

  const sitemap = (
    await requireFile(path.join(outputRoot, "sitemap.xml"), "Demo sitemap")
  ).toString("utf8");
  auditSitemap(sitemap);

  for (const [label, content] of [
    ["exported HTML", html],
    ["robots.txt", robots],
    ["sitemap.xml", sitemap],
  ]) {
    if (/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/iu.test(content)) {
      throw new Error(`Static demo ${label} contains a localhost URL.`);
    }
  }

  await assertNoPagesCanonicalInSelfHostedRoots(selfHostedRoots);

  return {
    canonical: canonical.href,
    faviconPath,
    socialImageBytes: socialImage.byteLength,
    socialImageHeight: dimensions.height,
    socialImagePath,
    socialImageWidth: dimensions.width,
  };
}
