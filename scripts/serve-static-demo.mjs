import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configuredRoot = process.env.STATIC_DEMO_ROOT?.trim() || "demo/out";
const root = path.resolve(projectRoot, configuredRoot);
const configuredBasePath = process.env.STATIC_DEMO_BASE_PATH?.trim() || "/rubrictrail";
const basePath = `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`;
const port = Number(process.env.PORT || 3101);

if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer from 1 to 65535.");
}

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ttf", "font/ttf"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function sendText(response, status, message, allow) {
  const body = Buffer.from(`${message}\n`);
  response.writeHead(status, {
    ...(allow ? { Allow: allow } : {}),
    "Cache-Control": "no-store",
    "Content-Length": body.byteLength,
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function relativeRequestPath(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, "http://127.0.0.1").pathname);
  } catch {
    return null;
  }

  if (pathname.includes("\0")) return null;
  if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return null;

  const relative = pathname.slice(basePath.length).replace(/^\/+/, "");
  const segments = relative.split(/[\\/]+/).filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) return null;
  return segments.join(path.sep);
}

async function resolveFile(requestUrl) {
  const relative = relativeRequestPath(requestUrl);
  if (relative === null) return null;

  let candidate = path.resolve(root, relative || "index.html");
  const rootRelative = path.relative(root, candidate);
  if (rootRelative.startsWith("..") || path.isAbsolute(rootRelative)) return null;

  try {
    let details = await stat(candidate);
    if (details.isDirectory()) {
      candidate = path.join(candidate, "index.html");
      details = await stat(candidate);
    }
    if (!details.isFile()) return null;

    const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
    const realRelative = path.relative(realRoot, realCandidate);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) return null;
    return { file: realCandidate, size: details.size };
  } catch {
    return null;
  }
}

const server = createServer(async (request, response) => {
  const resolved = await resolveFile(request.url || "/");
  if (!resolved) {
    sendText(response, 404, "Not found");
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendText(response, 405, "Method not allowed", "GET, HEAD");
    return;
  }

  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Length": resolved.size,
    "Content-Type": MIME_TYPES.get(path.extname(resolved.file).toLowerCase()) || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(resolved.file)
    .on("error", () => response.destroy())
    .pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Static demo available at http://127.0.0.1:${port}${basePath}/`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
