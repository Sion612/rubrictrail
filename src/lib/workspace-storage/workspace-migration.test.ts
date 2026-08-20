import { describe, expect, it } from "vitest";
import {
  createDefaultProjectState,
  parseProjectStorageRecordValue,
} from "@/lib/local-state";
import {
  LEGACY_PROJECT_KEYS,
  type SecureUuidSource,
  WORKSPACE_INDEX_KEY,
  WORKSPACE_LOCK_NAME,
  WORKSPACE_OPERATION_KEY,
  WORKSPACE_RESERVE_KEY,
} from "@/lib/workspace-storage/keys";
import { readWorkspaceAuthority } from "@/lib/workspace-storage/coordinator";
import {
  parseWorkspaceIndex,
  serializeWorkspaceIndex,
} from "@/lib/workspace-storage/protocol";
import { CANONICAL_WORKSPACE_RESERVE } from "@/lib/workspace-storage/reserve";
import { MemoryWorkspaceStorageAdapter } from "@/lib/workspace-storage/storage-adapter";
import {
  activeIndex,
  LEGACY_ACTIVE_RECORD_RAW,
  NULL_LEGACY_FINGERPRINTS,
} from "@/lib/workspace-storage/test-fixtures";
import {
  openOrMigrateWorkspace,
  resumeWorkspaceMigration,
} from "@/lib/workspace-storage/workspace-migration";
import type { WorkspaceExclusiveLockRunner } from "@/lib/workspace-storage/coordinator";

const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OPERATION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

class SequenceUuidSource implements SecureUuidSource {
  constructor(private readonly values: string[]) {}

  randomUUID(): string {
    const value = this.values.shift();
    if (!value) throw new Error("No fictional UUID remains");
    return value;
  }
}

class SerialWorkspaceLockRunner implements WorkspaceExclusiveLockRunner {
  readonly names: string[] = [];

  async runExclusive<T>(name: string, operation: () => Promise<T>): Promise<T> {
    this.names.push(name);
    return operation();
  }
}

function uuids(withProject = true): SequenceUuidSource {
  return new SequenceUuidSource(
    withProject
      ? [WORKSPACE_ID, PROJECT_ID, OPERATION_ID]
      : [WORKSPACE_ID, OPERATION_ID],
  );
}

function activeV3Raw(label: string): string {
  return JSON.stringify({
    ...createDefaultProjectState(),
    projectKind: "sample",
    draftText: `Fictional ${label}`,
  });
}

function activeV2Raw(label: string): string {
  const { supersededV2Fingerprint, ...state } = createDefaultProjectState();
  void supersededV2Fingerprint;
  return JSON.stringify({
    ...state,
    version: 2,
    projectKind: "sample",
    draftText: `Fictional ${label}`,
  });
}

function activeV1Raw(label: string): string {
  return JSON.stringify({
    sampleLoaded: true,
    view: "draft",
    draftText: `Fictional ${label}`,
    completedTaskIds: ["p1"],
    weeklyHours: 9,
    targetGrade: 74,
    selectedSectionId: "analysis-and-recommendations",
    readinessChecks: ["sources"],
  });
}

function clearedRecordRaw(): string {
  return JSON.stringify({
    formatVersion: 1,
    revision: 3,
    value: { kind: "cleared" },
    legacyFingerprints: { v3: null, v2: null, v1: null },
  });
}

describe("workspace first migration", () => {
  it("initializes no-data as an active empty workspace without a journal", async () => {
    const storage = new MemoryWorkspaceStorageAdapter();
    const locks = new SerialWorkspaceLockRunner();

    const result = await openOrMigrateWorkspace(storage, locks, {
      uuidSource: new SequenceUuidSource([WORKSPACE_ID]),
    });

    expect(result).toMatchObject({
      ok: true,
      origin: "initialized-empty",
      storageProtection: "healthy",
    });
    if (!result.ok) return;
    expect(result.snapshot.index).toMatchObject({
      workspaceId: WORKSPACE_ID,
      status: "active",
      projects: [],
      legacyFingerprints: { record: null, v3: null, v2: null, v1: null },
    });
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    expect(storage.getItem(WORKSPACE_RESERVE_KEY)).toBe(
      CANONICAL_WORKSPACE_RESERVE,
    );
    expect(locks.names).toEqual([WORKSPACE_LOCK_NAME]);
  });

  it("migrates a cleared v0.7.1 record to active empty authority and retains its exact fingerprint and bytes", async () => {
    const legacyRaw = clearedRecordRaw();
    const storage = new MemoryWorkspaceStorageAdapter({
      [LEGACY_PROJECT_KEYS.record]: legacyRaw,
    });

    const result = await openOrMigrateWorkspace(
      storage,
      new SerialWorkspaceLockRunner(),
      { uuidSource: uuids(false) },
    );

    expect(result).toMatchObject({ ok: true, origin: "migrated-cleared" });
    if (!result.ok) return;
    expect(result.snapshot.index.status).toBe("active");
    expect(result.snapshot.index.projects).toEqual([]);
    expect(result.snapshot.index.legacyFingerprints.record).toMatch(/^[0-9a-f]{64}$/);
    expect(storage.getItem(LEGACY_PROJECT_KEYS.record)).toBe(legacyRaw);
  });

  it.each([
    ["record", LEGACY_PROJECT_KEYS.record, LEGACY_ACTIVE_RECORD_RAW],
    ["v3", LEGACY_PROJECT_KEYS.v3, activeV3Raw("v3")],
    ["v2", LEGACY_PROJECT_KEYS.v2, activeV2Raw("v2")],
    ["v1", LEGACY_PROJECT_KEYS.v1, activeV1Raw("v1")],
  ] as const)("migrates valid %s authority without changing the legacy source", async (_name, key, raw) => {
    const storage = new MemoryWorkspaceStorageAdapter({ [key]: raw });
    const result = await openOrMigrateWorkspace(
      storage,
      new SerialWorkspaceLockRunner(),
      { uuidSource: uuids() },
    );

    expect(result).toMatchObject({ ok: true, origin: "migrated-project" });
    if (!result.ok) return;
    expect(result.snapshot.index.status).toBe("active");
    expect(result.snapshot.projects).toHaveLength(1);
    expect(result.snapshot.projects[0].record.value.kind).toBe("project");
    expect(storage.getItem(key)).toBe(raw);
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
  });

  it("fails closed for divergent legacy authority, missing Web Locks, and orphan project namespace", async () => {
    const conflict = new MemoryWorkspaceStorageAdapter({
      [LEGACY_PROJECT_KEYS.v3]: activeV3Raw("new"),
      [LEGACY_PROJECT_KEYS.v2]: activeV2Raw("old"),
    });
    await expect(
      openOrMigrateWorkspace(conflict, new SerialWorkspaceLockRunner(), {
        uuidSource: uuids(),
      }),
    ).resolves.toEqual({ ok: false, reason: "legacy-conflict" });
    expect(conflict.getItem(WORKSPACE_INDEX_KEY)).toBeNull();

    const noLocks = new MemoryWorkspaceStorageAdapter({
      [LEGACY_PROJECT_KEYS.record]: LEGACY_ACTIVE_RECORD_RAW,
    });
    const before = noLocks.snapshot();
    await expect(openOrMigrateWorkspace(noLocks, null)).resolves.toEqual({
      ok: false,
      reason: "lock-unavailable",
    });
    expect(noLocks.snapshot()).toEqual(before);

    const orphan = new MemoryWorkspaceStorageAdapter({
      "rubrictrail.workspace.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.generation.1.project.bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.v1":
        "fictional-third-value",
    });
    await expect(
      openOrMigrateWorkspace(orphan, new SerialWorkspaceLockRunner(), {
        uuidSource: uuids(),
      }),
    ).resolves.toEqual({ ok: false, reason: "recovery-required" });
  });

  it("rolls forward after a project write and after an index commit", async () => {
    for (const checkpoint of [
      `before:setItem:${WORKSPACE_INDEX_KEY}`,
      `before:removeItem:${WORKSPACE_OPERATION_KEY}`,
    ]) {
      const storage = new MemoryWorkspaceStorageAdapter({
        [LEGACY_PROJECT_KEYS.record]: LEGACY_ACTIVE_RECORD_RAW,
      });
      storage.faults.armAtCheckpoint(checkpoint, "security");
      const first = await openOrMigrateWorkspace(
        storage,
        new SerialWorkspaceLockRunner(),
        { uuidSource: uuids() },
      );
      expect(first).toEqual({ ok: false, reason: "commit-incomplete" });
      expect(storage.getItem(WORKSPACE_OPERATION_KEY)).not.toBeNull();
      storage.faults.clear();

      const resumed = await resumeWorkspaceMigration(
        storage,
        new SerialWorkspaceLockRunner(),
      );
      expect(resumed).toMatchObject({ ok: true, origin: "resumed-migration" });
      expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
      expect(storage.getItem(LEGACY_PROJECT_KEYS.record)).toBe(
        LEGACY_ACTIVE_RECORD_RAW,
      );
    }
  });

  it("quarantines a third target value and detects a stale v0.7.x rewrite", async () => {
    const storage = new MemoryWorkspaceStorageAdapter({
      [LEGACY_PROJECT_KEYS.record]: LEGACY_ACTIVE_RECORD_RAW,
    });
    storage.faults.armAtCheckpoint(
      `before:setItem:${WORKSPACE_INDEX_KEY}`,
      "security",
    );
    await openOrMigrateWorkspace(storage, new SerialWorkspaceLockRunner(), {
      uuidSource: uuids(),
    });
    storage.faults.clear();
    const targetKey = storage
      .keys()
      .find((key) => key.includes(".project."));
    if (!targetKey) throw new Error("Migration target was not written");
    storage.setItem(targetKey, "fictional-third-value");
    await expect(
      resumeWorkspaceMigration(storage, new SerialWorkspaceLockRunner()),
    ).resolves.toEqual({ ok: false, reason: "recovery-required" });

    const clean = new MemoryWorkspaceStorageAdapter({
      [LEGACY_PROJECT_KEYS.record]: LEGACY_ACTIVE_RECORD_RAW,
    });
    const migrated = await openOrMigrateWorkspace(
      clean,
      new SerialWorkspaceLockRunner(),
      { uuidSource: uuids() },
    );
    expect(migrated.ok).toBe(true);
    clean.setItem(
      LEGACY_PROJECT_KEYS.record,
      JSON.stringify({
        ...parseProjectStorageRecordValue(LEGACY_ACTIVE_RECORD_RAW),
        fictionalOldTabRewrite: true,
      }),
    );
    await expect(readWorkspaceAuthority(clean)).resolves.toEqual({
      ok: false,
      reason: "legacy-conflict",
    });
  });

  it("does not publish an index when reserve allocation fails", async () => {
    const storage = new MemoryWorkspaceStorageAdapter({
      [LEGACY_PROJECT_KEYS.record]: LEGACY_ACTIVE_RECORD_RAW,
    });
    storage.faults.armAtCheckpoint(
      `before:setItem:${WORKSPACE_RESERVE_KEY}`,
      "quota",
    );
    const beforeLegacy = storage.getItem(LEGACY_PROJECT_KEYS.record);

    await expect(
      openOrMigrateWorkspace(storage, new SerialWorkspaceLockRunner(), {
        uuidSource: uuids(),
      }),
    ).resolves.toEqual({ ok: false, reason: "reserve-degraded" });
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBeNull();
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    expect(storage.getItem(LEGACY_PROJECT_KEYS.record)).toBe(beforeLegacy);
  });

  it("keeps a valid existing workspace unchanged and repairs only the reserve", async () => {
    const firstStorage = new MemoryWorkspaceStorageAdapter();
    const first = await openOrMigrateWorkspace(
      firstStorage,
      new SerialWorkspaceLockRunner(),
      { uuidSource: new SequenceUuidSource([WORKSPACE_ID]) },
    );
    if (!first.ok) throw new Error("Empty fixture initialization failed");
    firstStorage.removeItem(WORKSPACE_RESERVE_KEY);
    const indexBefore = firstStorage.getItem(WORKSPACE_INDEX_KEY);

    const reopened = await openOrMigrateWorkspace(
      firstStorage,
      new SerialWorkspaceLockRunner(),
    );

    expect(reopened).toMatchObject({ ok: true, origin: "existing" });
    expect(firstStorage.getItem(WORKSPACE_INDEX_KEY)).toBe(indexBefore);
    expect(firstStorage.getItem(WORKSPACE_RESERVE_KEY)).toBe(
      CANONICAL_WORKSPACE_RESERVE,
    );
    const parsed = parseWorkspaceIndex(indexBefore ?? "");
    expect(parsed.ok).toBe(true);
  });

  it("opens a valid explicitly cleared workspace without turning it into an active workspace", async () => {
    const index = serializeWorkspaceIndex(
      activeIndex({
        revision: 4,
        status: "cleared",
        projects: [],
        legacyFingerprints: NULL_LEGACY_FINGERPRINTS,
      }),
    );
    if (!index.ok) throw new Error("Invalid cleared fixture");
    const storage = new MemoryWorkspaceStorageAdapter({
      [WORKSPACE_INDEX_KEY]: index.serialized,
      [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
    });

    const opened = await openOrMigrateWorkspace(
      storage,
      new SerialWorkspaceLockRunner(),
    );

    expect(opened).toMatchObject({ ok: true, origin: "existing" });
    if (!opened.ok) return;
    expect(opened.snapshot.index.status).toBe("cleared");
    expect(opened.snapshot.index.projects).toEqual([]);
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBe(index.serialized);
  });
});
