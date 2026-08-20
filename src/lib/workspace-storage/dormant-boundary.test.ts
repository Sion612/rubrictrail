import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd());
const workspaceStorageDirectory = join(repositoryRoot, "src", "lib", "workspace-storage");
const dormantWorkspaceUiDirectory = join(
  repositoryRoot,
  "src",
  "components",
  "multi-assignment-workspace",
);
const sourceExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const ignoredSourceDirectories = new Set([".next", "node_modules", "out"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ignoredSourceDirectories.has(entry.name) ? [] : sourceFiles(path);
    }
    return sourceExtensions.has(extname(entry.name)) &&
      !entry.name.includes(".test.")
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

describe("dormant workspace storage boundary", () => {
  it("is unreachable from every current non-test production source module", () => {
    const productionFiles = [
      ...sourceFiles(join(repositoryRoot, "src")).filter(
        (path) =>
          !isInside(path, workspaceStorageDirectory) &&
          !isInside(path, dormantWorkspaceUiDirectory),
      ),
      ...sourceFiles(join(repositoryRoot, "demo")),
      ...sourceFiles(repositoryRoot).filter(
        (path) => relative(repositoryRoot, path) === "next.config.ts",
      ),
    ];
    const workspaceImportPattern =
      /\b(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)["'][^"']*workspace-storage(?:\/[^"']*)?["']/u;
    const importingFiles = productionFiles.filter((path) =>
      workspaceImportPattern.test(readFileSync(path, "utf8")),
    );
    expect(importingFiles).toEqual([]);
  });

  it("does not activate or version the v0.8 workspace", () => {
    const packageJson = JSON.parse(
      readFileSync(join(repositoryRoot, "package.json"), "utf8"),
    ) as { version?: unknown };
    expect(packageJson.version).toBe("0.7.1");
    expect(readFileSync(join(repositoryRoot, "src", "app", "page.tsx"), "utf8")).not.toContain(
      "workspace-storage",
    );
  });

  it("keeps each workspace runtime module free of direct Node, network, log, and localStorage usage", () => {
    const runtimeFiles = sourceFiles(workspaceStorageDirectory).filter(
      (path) => !path.endsWith(`${sep}test-fixtures.ts`),
    );
    const forbiddenPatterns: Array<{ label: string; pattern: RegExp }> = [
      {
        label: "node-import",
        pattern: /(?:from\s+|import\s+|import\s*\(\s*)["']node:/u,
      },
      { label: "process", pattern: /\bprocess(?:\.|\[)/u },
      { label: "buffer", pattern: /\bBuffer\b/u },
      {
        label: "network",
        pattern:
          /\b(?:fetch\s*\(|XMLHttpRequest\b|WebSocket\b|EventSource\b|navigator\.sendBeacon\b)/u,
      },
      {
        label: "console-log",
        pattern: /\bconsole\.(?:debug|error|info|log|warn)\b/u,
      },
      { label: "direct-local-storage", pattern: /\blocalStorage\b/u },
    ];
    const violations = runtimeFiles.flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return forbiddenPatterns
        .filter(({ pattern }) => pattern.test(source))
        .map(({ label }) => `${relative(repositoryRoot, path)}:${label}`);
    });

    expect(violations).toEqual([]);
  });
});
