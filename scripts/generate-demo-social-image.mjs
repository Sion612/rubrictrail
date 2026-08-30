import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ImageResponse } from "next/og.js";
import { createElement } from "react";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(
  repositoryRoot,
  "docs",
  "assets",
  "rubrictrail-workspace.png",
);
const outputPath = path.join(
  repositoryRoot,
  "demo",
  "public",
  "opengraph-image.png",
);

const workspaceImage = await readFile(sourcePath, "base64");
const response = new ImageResponse(
  createElement("div", {
    style: {
      alignItems: "flex-start",
      background: "#e7eeea",
      backgroundImage: `url(data:image/png;base64,${workspaceImage})`,
      backgroundPosition: "top left",
      backgroundRepeat: "no-repeat",
      backgroundSize: "1200px 750px",
      display: "flex",
      height: "100%",
      overflow: "hidden",
      width: "100%",
    },
  }),
  { width: 1200, height: 630 },
);

if (response.headers.get("content-type") !== "image/png") {
  throw new Error("The demo social-image generator did not return PNG content.");
}

const image = Buffer.from(await response.arrayBuffer());
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, image);
console.log(`Generated demo social image: ${image.byteLength} bytes at 1200x630.`);
