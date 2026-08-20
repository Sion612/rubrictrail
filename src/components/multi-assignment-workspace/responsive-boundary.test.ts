import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd());
const dashboardDirectory = join(
  repositoryRoot,
  "src",
  "components",
  "multi-assignment-workspace",
);
const sourceExtensions = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const ignoredDirectories = new Set([".next", "node_modules", "out"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : sourceFiles(path);
    }
    return sourceExtensions.has(extname(entry.name)) && !entry.name.includes(".test.")
      ? [path]
      : [];
  });
}

function isInside(path: string, directory: string): boolean {
  const pathFromDirectory = relative(directory, path);
  return (
    pathFromDirectory !== "" &&
    pathFromDirectory !== ".." &&
    !pathFromDirectory.startsWith(`..${sep}`)
  );
}

describe("dormant responsive dashboard boundary", () => {
  it("defines bounded layouts for the required widths without hiding document overflow", () => {
    const css = readFileSync(
      join(dashboardDirectory, "multi-assignment-dashboard.module.css"),
      "utf8",
    );

    expect(css).toContain("minmax(min(100%, 19rem), 1fr)");
    expect(css).toContain("@media (max-width: 1024px)");
    expect(css).toContain("@media (max-width: 768px)");
    expect(css).toContain("@media (max-width: 390px)");
    expect(css).toContain("@media (max-width: 320px)");
    expect(css).not.toMatch(/overflow-x\s*:\s*hidden/iu);
  });

  it("is unreachable from every current production source module outside its dormant boundary", () => {
    const productionFiles = [
      ...sourceFiles(join(repositoryRoot, "src")),
      ...sourceFiles(join(repositoryRoot, "demo")),
    ].filter((path) => !isInside(path, dashboardDirectory));
    const dashboardImportPattern =
      /\b(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)["'][^"']*multi-assignment-workspace(?:\/[^"']*)?["']/u;
    const importingFiles = productionFiles
      .filter((path) => dashboardImportPattern.test(readFileSync(path, "utf8")))
      .map((path) => relative(repositoryRoot, path));

    expect(importingFiles).toEqual([]);
  });
});
