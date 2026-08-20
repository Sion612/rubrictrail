import { describe, expect, it } from "vitest";
import {
  generateWorkspaceProjectId,
  scanWorkspaceNamespace,
} from "@/lib/workspace-storage/namespace-scan";
import {
  WORKSPACE_INDEX_KEY,
  WORKSPACE_OPERATION_KEY,
  workspaceProjectRecordKey,
} from "@/lib/workspace-storage/keys";
import {
  serializeWorkspaceIndex,
  serializeWorkspaceJournal,
  serializeWorkspaceProjectRecord,
} from "@/lib/workspace-storage/protocol";
import { MemoryWorkspaceStorageAdapter } from "@/lib/workspace-storage/storage-adapter";
import {
  activeIndex,
  activeProjectRecord,
  journalFor,
  PROJECT_A,
  PROJECT_B,
  WS,
  WS_OTHER,
} from "@/lib/workspace-storage/test-fixtures";

function serializedRecord(
  projectId = PROJECT_A,
  workspaceId = WS,
  generation = 1,
  kind: "project" | "tombstone" = "project",
): string {
  const result = serializeWorkspaceProjectRecord(
    activeProjectRecord(projectId, {
      workspaceId,
      workspaceGeneration: generation,
      value: kind === "project" ? activeProjectRecord().value : { kind: "tombstone" },
    }),
  );
  if (!result.ok) throw new Error("record fixture invalid");
  return result.serialized;
}

describe("workspace namespace candidate discovery", () => {
  it("finds zero groups without creating authority", () => {
    const storage = new MemoryWorkspaceStorageAdapter({ "unrelated.key": "value" });
    expect(scanWorkspaceNamespace(storage)).toEqual({
      ok: true,
      result: {
        authority: "none",
        requiresExplicitSelection: true,
        groups: [],
        ignoredKeys: ["unrelated.key"],
        journalState: "absent",
        physicalProjectRecordCount: 0,
        growthBlocked: false,
      },
    });
  });

  it("discovers one coherent group but still requires explicit selection", () => {
    const key = workspaceProjectRecordKey(WS, 1, PROJECT_A);
    const storage = new MemoryWorkspaceStorageAdapter({ [key]: serializedRecord() });
    const scan = scanWorkspaceNamespace(storage);
    expect(scan.ok).toBe(true);
    if (!scan.ok) return;
    expect(scan.result.authority).toBe("none");
    expect(scan.result.requiresExplicitSelection).toBe(true);
    expect(scan.result.groups).toMatchObject([
      { workspaceId: WS, workspaceGeneration: 1, activeCount: 1, coherent: true },
    ]);
  });

  it("keeps multiple workspaces and generations separate without ranking them", () => {
    const storage = new MemoryWorkspaceStorageAdapter({
      [workspaceProjectRecordKey(WS, 2, PROJECT_A)]: serializedRecord(PROJECT_A, WS, 2),
      [workspaceProjectRecordKey(WS, 1, PROJECT_A)]: serializedRecord(),
      [workspaceProjectRecordKey(WS_OTHER, 1, PROJECT_B)]: serializedRecord(PROJECT_B, WS_OTHER),
    });
    const scan = scanWorkspaceNamespace(storage);
    if (!scan.ok) throw new Error("scan failed");
    expect(scan.result.groups.map((group) => [group.workspaceId, group.workspaceGeneration])).toEqual([
      [WS, 1],
      [WS, 2],
      [WS_OTHER, 1],
    ]);
    expect(scan.result.groups.every((group) => group.coherent)).toBe(true);
  });

  it("classifies tombstones, invalid values, identity mismatches, and unrelated keys", () => {
    const activeKey = workspaceProjectRecordKey(WS, 1, PROJECT_A);
    const tombstoneKey = workspaceProjectRecordKey(WS, 1, PROJECT_B);
    const invalidKey = workspaceProjectRecordKey(WS, 1, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    const mismatchedKey = workspaceProjectRecordKey(WS, 1, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    const storage = new MemoryWorkspaceStorageAdapter({
      [activeKey]: serializedRecord(),
      [tombstoneKey]: serializedRecord(PROJECT_B, WS, 1, "tombstone"),
      [invalidKey]: "{bad-json",
      [mismatchedKey]: serializedRecord(PROJECT_A),
      "rubrictrail.workspace.not-an-owned-project": "leave-me-alone",
    });
    const scan = scanWorkspaceNamespace(storage);
    if (!scan.ok) throw new Error("scan failed");
    expect(scan.result.groups[0]).toMatchObject({
      activeCount: 1,
      tombstoneCount: 1,
      invalidCount: 1,
      quarantinedCount: 1,
      coherent: false,
    });
    expect(scan.result.ignoredKeys).toEqual(["rubrictrail.workspace.not-an-owned-project"]);
  });

  it("reports every record and blocks growth at the exact 100-key boundary", () => {
    for (const count of [99, 100, 101]) {
      const initial: Record<string, string> = {};
      for (let index = 0; index < count; index += 1) {
        const projectId = `${index.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
        initial[workspaceProjectRecordKey(WS, 1, projectId)] = serializedRecord(projectId);
      }
      const scan = scanWorkspaceNamespace(new MemoryWorkspaceStorageAdapter(initial));
      if (!scan.ok) throw new Error("scan failed");
      expect(scan.result.physicalProjectRecordCount).toBe(count);
      expect(scan.result.growthBlocked).toBe(count >= 100);
      expect(scan.result.groups[0]).toMatchObject({
        overLimit: count > 100,
        coherent: count <= 100,
      });
      expect(scan.result.groups[0].records).toHaveLength(count);
    }
  });

  it("never calls a group coherent while a journal is unresolved or invalid", async () => {
    const key = workspaceProjectRecordKey(WS, 1, PROJECT_A);
    const journal = serializeWorkspaceJournal(await journalFor("create-project"));
    if (!journal.ok) throw new Error("journal fixture invalid");
    for (const [rawJournal, state] of [
      [journal.serialized, "present-unresolved"],
      ["bad-journal", "invalid"],
    ] as const) {
      const scan = scanWorkspaceNamespace(
        new MemoryWorkspaceStorageAdapter({ [key]: serializedRecord(), [WORKSPACE_OPERATION_KEY]: rawJournal }),
      );
      if (!scan.ok) throw new Error("scan failed");
      expect(scan.result.journalState).toBe(state);
      expect(scan.result.groups[0].coherent).toBe(false);
    }
  });

  it("fails visibly when storage enumeration or reads throw", () => {
    const storage = new MemoryWorkspaceStorageAdapter({
      [workspaceProjectRecordKey(WS, 1, PROJECT_A)]: serializedRecord(),
    });
    storage.faults.armAtCheckpoint("before:keys", "security");
    expect(scanWorkspaceNamespace(storage)).toEqual({ ok: false, reason: "storage-error" });
  });
});

describe("workspace project id collision checks", () => {
  it("checks extant keys, the index, and a valid journal", async () => {
    const indexed = serializeWorkspaceIndex(
      activeIndex({ projects: [{ projectId: PROJECT_B, kind: "tombstone" }] }),
    );
    const journal = serializeWorkspaceJournal(await journalFor("create-project"));
    if (!indexed.ok || !journal.ok) throw new Error("fixture serialization failed");
    const storage = new MemoryWorkspaceStorageAdapter({
      [workspaceProjectRecordKey(WS, 1, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")]:
        serializedRecord("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
      [WORKSPACE_INDEX_KEY]: indexed.serialized,
      [WORKSPACE_OPERATION_KEY]: journal.serialized,
    });
    const candidates = [
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      PROJECT_B,
      PROJECT_A,
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    ];
    const generated = await generateWorkspaceProjectId(storage, {
      randomUUID: () => candidates.shift() ?? "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    });
    expect(generated).toEqual({
      ok: true,
      projectId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    });
  });

  it("blocks generation when an authoritative index or journal is invalid", async () => {
    expect(
      await generateWorkspaceProjectId(
        new MemoryWorkspaceStorageAdapter({ [WORKSPACE_INDEX_KEY]: "bad" }),
        { randomUUID: () => PROJECT_B },
      ),
    ).toEqual({ ok: false, reason: "invalid-index" });
    expect(
      await generateWorkspaceProjectId(
        new MemoryWorkspaceStorageAdapter({ [WORKSPACE_OPERATION_KEY]: "bad" }),
        { randomUUID: () => PROJECT_B },
      ),
    ).toEqual({ ok: false, reason: "invalid-journal" });
  });

  it("fails closed when secure UUID generation is unavailable or collides eight times", async () => {
    const storage = new MemoryWorkspaceStorageAdapter({
      [workspaceProjectRecordKey(WS, 1, PROJECT_A)]: serializedRecord(),
    });
    expect((await generateWorkspaceProjectId(storage, null)).ok).toBe(false);
    expect(
      await generateWorkspaceProjectId(storage, { randomUUID: () => PROJECT_A }),
    ).toEqual({ ok: false, reason: "uuid-unavailable-or-collided" });
  });
});
