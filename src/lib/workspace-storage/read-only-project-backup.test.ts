import { describe, expect, it } from "vitest";

import { serializeProjectBackup } from "@/lib/project-backup";
import { workspaceProjectRecordKey } from "@/lib/workspace-storage/keys";
import {
  serializeWorkspaceProjectRecord,
} from "@/lib/workspace-storage/protocol";
import {
  inspectWorkspaceReadOnlyProjectBackups,
  revalidateWorkspaceReadOnlyProjectBackup,
} from "@/lib/workspace-storage/read-only-project-backup";
import { MemoryWorkspaceStorageAdapter } from "@/lib/workspace-storage/storage-adapter";
import {
  activeProjectRecord,
  PROJECT_A,
  PROJECT_B,
  WS,
} from "@/lib/workspace-storage/test-fixtures";

function recordBytes(
  projectId = PROJECT_A,
  value = activeProjectRecord(projectId).value,
): string {
  const serialized = serializeWorkspaceProjectRecord(
    activeProjectRecord(projectId, { value }),
  );
  if (!serialized.ok) throw new Error("fixture project record is invalid");
  return serialized.serialized;
}

describe("read-only workspace project backups", () => {
  it("discovers strict active records without granting authority or writing storage", () => {
    const activeKey = workspaceProjectRecordKey(WS, 1, PROJECT_A);
    const tombstoneKey = workspaceProjectRecordKey(WS, 1, PROJECT_B);
    const invalidId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const invalidKey = workspaceProjectRecordKey(WS, 1, invalidId);
    const mismatchedId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const mismatchedKey = workspaceProjectRecordKey(WS, 1, mismatchedId);
    const storage = new MemoryWorkspaceStorageAdapter({
      [activeKey]: recordBytes(),
      [tombstoneKey]: recordBytes(PROJECT_B, { kind: "tombstone" }),
      [invalidKey]: "{invalid-json",
      [mismatchedKey]: recordBytes(),
      "unrelated.key": "untouched",
    });
    const before = storage.snapshot();

    const result = inspectWorkspaceReadOnlyProjectBackups(storage);

    expect(result).toMatchObject({
      ok: true,
      authorityDecision: "not-performed",
      excludedInvalidRecordCount: 2,
      tombstoneCount: 1,
    });
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      candidateId: activeKey,
      key: activeKey,
      expectedRaw: recordBytes(),
    });
    expect(storage.snapshot()).toEqual(before);
  });

  it("keeps valid records exportable even when their group is incoherent", () => {
    const activeKey = workspaceProjectRecordKey(WS, 1, PROJECT_A);
    const invalidKey = workspaceProjectRecordKey(
      WS,
      1,
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );
    const result = inspectWorkspaceReadOnlyProjectBackups(
      new MemoryWorkspaceStorageAdapter({
        [activeKey]: recordBytes(),
        [invalidKey]: "invalid",
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      excludedInvalidRecordCount: 1,
      candidates: [{ key: activeKey }],
    });
  });

  it("revalidates exact bytes and rejects a removed or changed record", () => {
    const key = workspaceProjectRecordKey(WS, 1, PROJECT_A);
    const storage = new MemoryWorkspaceStorageAdapter({ [key]: recordBytes() });
    const inspected = inspectWorkspaceReadOnlyProjectBackups(storage);
    if (!inspected.ok || !inspected.candidates[0]) throw new Error("missing fixture candidate");

    expect(
      revalidateWorkspaceReadOnlyProjectBackup(storage, inspected.candidates[0]),
    ).toMatchObject({ ok: true, state: { projectKind: "sample" } });

    storage.setItem(key, recordBytes(PROJECT_A, { kind: "tombstone" }));
    expect(
      revalidateWorkspaceReadOnlyProjectBackup(storage, inspected.candidates[0]),
    ).toEqual({ ok: false, reason: "record-changed" });

    storage.removeItem(key);
    expect(
      revalidateWorkspaceReadOnlyProjectBackup(storage, inspected.candidates[0]),
    ).toEqual({ ok: false, reason: "record-changed" });
  });

  it("creates the unchanged portable backup format without workspace identities", () => {
    const key = workspaceProjectRecordKey(WS, 1, PROJECT_A);
    const storage = new MemoryWorkspaceStorageAdapter({ [key]: recordBytes() });
    const inspected = inspectWorkspaceReadOnlyProjectBackups(storage);
    if (!inspected.ok || !inspected.candidates[0]) throw new Error("missing fixture candidate");
    const validated = revalidateWorkspaceReadOnlyProjectBackup(
      storage,
      inspected.candidates[0],
    );
    if (!validated.ok) throw new Error("fixture candidate changed");

    const serialized = serializeProjectBackup(
      validated.state,
      "2026-08-21T00:00:00.000Z",
    );
    expect(Object.keys(JSON.parse(serialized) as Record<string, unknown>).sort()).toEqual([
      "exportedAt",
      "format",
      "formatVersion",
      "project",
    ]);
    expect(serialized).not.toContain(WS);
    expect(serialized).not.toContain(PROJECT_A);
    expect(serialized).not.toContain("workspaceGeneration");
    expect(serialized).not.toContain("operationId");
  });

  it("fails visibly when storage enumeration or candidate revalidation cannot be read", () => {
    const key = workspaceProjectRecordKey(WS, 1, PROJECT_A);
    const scanStorage = new MemoryWorkspaceStorageAdapter({ [key]: recordBytes() });
    scanStorage.faults.armAtCheckpoint("before:keys", "security");
    expect(inspectWorkspaceReadOnlyProjectBackups(scanStorage)).toEqual({
      ok: false,
      reason: "storage-error",
    });

    const readStorage = new MemoryWorkspaceStorageAdapter({ [key]: recordBytes() });
    const inspected = inspectWorkspaceReadOnlyProjectBackups(readStorage);
    if (!inspected.ok || !inspected.candidates[0]) throw new Error("missing fixture candidate");
    readStorage.faults.armAtCheckpoint(`before:getItem:${key}`, "security");
    expect(
      revalidateWorkspaceReadOnlyProjectBackup(readStorage, inspected.candidates[0]),
    ).toEqual({ ok: false, reason: "storage-error" });
  });
});
