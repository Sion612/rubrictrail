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

describe("activated workspace storage boundary", () => {
  it("keeps canonical storage access behind the production activation component", () => {
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
    const activationSource = readFileSync(
      join(dormantWorkspaceUiDirectory, "workspace-activation-root.tsx"),
      "utf8",
    );
    expect(activationSource).toContain('import("@/lib/workspace-storage/runtime-controller")');
    expect(activationSource).toContain('import("@/lib/workspace-storage/storage-adapter")');
  });

  it("activates only the v0.8 workspace root and package version", () => {
    const packageJson = JSON.parse(
      readFileSync(join(repositoryRoot, "package.json"), "utf8"),
    ) as { version?: unknown };
    expect(packageJson.version).toBe("0.8.0");
    const rootPage = readFileSync(join(repositoryRoot, "src", "app", "page.tsx"), "utf8");
    expect(rootPage).toContain("WorkspaceActivationRoot");
    expect(rootPage).not.toContain("workspace-storage");
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
