import { describe, expect, it } from "vitest";
import { createDefaultProjectState } from "@/lib/local-state";
import {
  createWorkspaceProject,
  readWorkspaceAuthority,
  restoreWorkspaceProjectAsNew,
  workspaceIndexBaseline,
  type WorkspaceAuthoritySnapshot,
  type WorkspaceExclusiveLockRunner,
} from "@/lib/workspace-storage/coordinator";
import {
  LEGACY_PROJECT_KEYS,
  type SecureUuidSource,
  WORKSPACE_INDEX_KEY,
  WORKSPACE_OPERATION_KEY,
  WORKSPACE_PREFERENCES_KEY,
  WORKSPACE_RESERVE_KEY,
  workspaceProjectRecordKey,
} from "@/lib/workspace-storage/keys";
import {
  parseWorkspaceJournal,
  serializeWorkspaceIndex,
  serializeWorkspacePreferences,
  serializeWorkspaceProjectRecord,
} from "@/lib/workspace-storage/protocol";
import { CANONICAL_WORKSPACE_RESERVE } from "@/lib/workspace-storage/reserve";
import {
  bootstrapWorkspaceRuntime,
  resumeWorkspaceCreationOperation,
} from "@/lib/workspace-storage/runtime-controller";
import { MemoryWorkspaceStorageAdapter } from "@/lib/workspace-storage/storage-adapter";
import {
  activeIndex,
  activeProjectRecord,
  LEGACY_ACTIVE_RECORD_RAW,
  NULL_LEGACY_FINGERPRINTS,
  PROJECT_A,
  PROJECT_B,
  WS,
} from "@/lib/workspace-storage/test-fixtures";
import { openOrMigrateWorkspace } from "@/lib/workspace-storage/workspace-migration";
import type { PersistedProjectState } from "@/lib/ui-types";

const PROJECT_C = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PROJECT_D = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OPERATION_C = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const OPERATION_D = "12345678-1234-4234-8234-123456789abc";

class SequenceUuidSource implements SecureUuidSource {
  constructor(private readonly values: string[]) {}

  randomUUID(): string {
    const value = this.values.shift();
    if (!value) throw new Error("No fictional UUID remains");
    return value;
  }
}

class SerialLockRunner implements WorkspaceExclusiveLockRunner {
  runExclusive<T>(_name: string, operation: () => Promise<T>): Promise<T> {
    return operation();
  }
}

class PreferenceFailingStorage extends MemoryWorkspaceStorageAdapter {
  override setItem(key: string, value: string): void {
    if (key === WORKSPACE_PREFERENCES_KEY) {
      throw new Error("Fictional preference failure");
    }
    super.setItem(key, value);
  }
}

class MutateOnKeysStorage extends MemoryWorkspaceStorageAdapter {
  private keyReads = 0;

  constructor(
    initial: Readonly<Record<string, string>>,
    private readonly mutation: (storage: MutateOnKeysStorage) => void,
  ) {
    super(initial);
  }

  override keys(): string[] {
    this.keyReads += 1;
    if (this.keyReads === 2) this.mutation(this);
    return super.keys();
  }
}

function state(label: string): PersistedProjectState {
  return {
    ...createDefaultProjectState(),
    projectKind: "sample",
    view: label.includes("plan") ? "plan" : "draft",
    weeklyHours: 6 + label.length,
    targetGrade: 70 + (label.length % 10),
    draftText: `Fictional ${label}`,
  };
}

async function seededWorkspace(
  Storage: typeof MemoryWorkspaceStorageAdapter = MemoryWorkspaceStorageAdapter,
): Promise<{
  storage: MemoryWorkspaceStorageAdapter;
  snapshot: WorkspaceAuthoritySnapshot;
}> {
  const index = serializeWorkspaceIndex(
    activeIndex({
      projects: [
        { projectId: PROJECT_A, kind: "active" },
        { projectId: PROJECT_B, kind: "active" },
      ],
      legacyFingerprints: NULL_LEGACY_FINGERPRINTS,
    }),
  );
  if (!index.ok) throw new Error("Invalid test index");
  const values: Record<string, string> = {
    [WORKSPACE_INDEX_KEY]: index.serialized,
    [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
  };
  for (const [projectId, label] of [
    [PROJECT_A, "alpha"],
    [PROJECT_B, "beta"],
  ] as const) {
    const record = serializeWorkspaceProjectRecord({
      ...activeProjectRecord(projectId),
      value: { kind: "project", state: state(label) },
    });
    if (!record.ok) throw new Error("Invalid test record");
    values[
      workspaceProjectRecordKey(
        index.value.workspaceId,
        index.value.workspaceGeneration,
        projectId,
      )
    ] = record.serialized;
  }
  const storage = new Storage(values);
  const authority = await readWorkspaceAuthority(storage);
  if (!authority.ok) throw new Error(authority.reason);
  return { storage, snapshot: authority.snapshot };
}

async function leaveCreationPartial(
  checkpoint: string,
  kind: "create-project" | "restore-as-new" = "create-project",
): Promise<{
  storage: MemoryWorkspaceStorageAdapter;
  snapshot: WorkspaceAuthoritySnapshot;
  targetKey: string;
}> {
  const { storage, snapshot } = await seededWorkspace();
  storage.faults.armAtCheckpoint(checkpoint, "security");
  const common = {
    baseline: workspaceIndexBaseline(snapshot),
    intentStillCurrent: () => true,
    pendingSavesDrained: () => true,
    uuidSource: new SequenceUuidSource([PROJECT_C, OPERATION_C]),
  };
  const result =
    kind === "create-project"
      ? await createWorkspaceProject(storage, new SerialLockRunner(), {
          ...common,
          state: state("created"),
        })
      : await restoreWorkspaceProjectAsNew(storage, new SerialLockRunner(), {
          ...common,
          backup: { state: state("restored") },
        });
  expect(result).toEqual({ ok: false, reason: "commit-incomplete" });
  storage.faults.clear();
  const rawJournal = storage.getItem(WORKSPACE_OPERATION_KEY);
  if (rawJournal === null) throw new Error("Expected a durable journal");
  const journal = parseWorkspaceJournal(rawJournal);
  if (!journal.ok) throw new Error("Expected a valid journal");
  return {
    storage,
    snapshot,
    targetKey: journal.value.projectMutations[0].targetRecord.key,
  };
}

describe("workspace runtime bootstrap and controller", () => {
  it("uses a valid preference, switches current-tab state before best-effort preference, and never mutates index revision", async () => {
    const { storage, snapshot } = await seededWorkspace(
      PreferenceFailingStorage,
    );
    const preference = serializeWorkspacePreferences({
      formatVersion: 1,
      workspaceId: snapshot.index.workspaceId,
      workspaceGeneration: snapshot.index.workspaceGeneration,
      lastOpenedProjectId: PROJECT_A,
    });
    if (!preference.ok) throw new Error("Invalid preference fixture");
    MemoryWorkspaceStorageAdapter.prototype.setItem.call(
      storage,
      WORKSPACE_PREFERENCES_KEY,
      preference.serialized,
    );

    const opened = await bootstrapWorkspaceRuntime(
      storage,
      new SerialLockRunner(),
    );
    expect(opened).toMatchObject({ ok: true, origin: "existing" });
    if (!opened.ok) return;
    expect(opened.controller.selectedProjectId()).toBe(PROJECT_A);
    const revision = opened.controller.authoritySnapshot().index.revision;
    expect(opened.controller.switchProject(PROJECT_B)).toEqual({
      ok: true,
      selectedProjectId: PROJECT_B,
      preferenceStored: false,
    });
    expect(opened.controller.selectedProjectId()).toBe(PROJECT_B);
    expect(opened.controller.authoritySnapshot().index.revision).toBe(revision);
  });

  it("freezes create around drained saves, rebuilds baselines, and selects the new assignment", async () => {
    const { storage } = await seededWorkspace();
    const opened = await bootstrapWorkspaceRuntime(
      storage,
      new SerialLockRunner(),
    );
    if (!opened.ok) throw new Error(opened.reason);
    expect(
      opened.controller.queueProjectSave(PROJECT_A, state("pending")),
    ).toMatchObject({ ok: true });
    await expect(
      opened.controller.createProject(
        state("blocked"),
        new SequenceUuidSource([PROJECT_C, OPERATION_C]),
      ),
    ).resolves.toEqual({ ok: false, reason: "pending-save" });
    await expect(opened.controller.flushProject(PROJECT_A)).resolves.toMatchObject({
      ok: true,
    });

    const created = await opened.controller.createProject(
      state("created-plan"),
      new SequenceUuidSource([PROJECT_C, OPERATION_C]),
    );
    expect(created).toMatchObject({
      ok: true,
      projectId: PROJECT_C,
      preferenceStored: true,
    });
    if (!created.ok) return;
    expect(opened.controller.selectedProjectId()).toBe(PROJECT_C);
    expect(opened.controller.selectedState()?.draftText).toBe(
      "Fictional created-plan",
    );
    expect(
      opened.controller.queueProjectSave(PROJECT_A, state("after-create")),
    ).toMatchObject({ ok: true });
    await expect(opened.controller.flushProject(PROJECT_A)).resolves.toMatchObject({
      ok: true,
      superseded: false,
    });
  });

  it("restores only supplied state under a fresh project identity", async () => {
    const { storage } = await seededWorkspace();
    const opened = await bootstrapWorkspaceRuntime(
      storage,
      new SerialLockRunner(),
    );
    if (!opened.ok) throw new Error(opened.reason);

    const restored = await opened.controller.restoreAsNew(
      state("restored"),
      new SequenceUuidSource([PROJECT_D, OPERATION_D]),
    );

    expect(restored).toMatchObject({ ok: true, projectId: PROJECT_D });
    expect(opened.controller.selectedProjectId()).toBe(PROJECT_D);
    expect(opened.controller.selectedState()?.draftText).toBe(
      "Fictional restored",
    );
  });

  it.each([
    [
      `before:setItem:${workspaceProjectRecordKey(
        WS,
        1,
        PROJECT_C,
      )}`,
      "cancelled",
    ],
    [`before:setItem:${WORKSPACE_INDEX_KEY}`, "committed"],
    [`before:removeItem:${WORKSPACE_OPERATION_KEY}`, "committed"],
  ] as const)("recovers create partial state at %s with %s disposition", async (checkpoint, disposition) => {
    const { storage, snapshot } = await leaveCreationPartial(checkpoint);
    if (disposition === "committed") storage.removeItem(WORKSPACE_RESERVE_KEY);

    const recovered = await resumeWorkspaceCreationOperation(
      storage,
      new SerialLockRunner(),
    );

    expect(recovered).toMatchObject({
      ok: true,
      origin: "recovered-create",
      disposition,
    });
    if (!recovered.ok) return;
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    expect(storage.getItem(WORKSPACE_RESERVE_KEY)).toBe(
      CANONICAL_WORKSPACE_RESERVE,
    );
    expect(recovered.snapshot.index.projects).toHaveLength(
      disposition === "committed"
        ? snapshot.index.projects.length + 1
        : snapshot.index.projects.length,
    );
  });

  it("routes restore-as-new journal recovery through production bootstrap", async () => {
    const { storage } = await leaveCreationPartial(
      `before:setItem:${WORKSPACE_INDEX_KEY}`,
      "restore-as-new",
    );

    const opened = await bootstrapWorkspaceRuntime(
      storage,
      new SerialLockRunner(),
    );

    expect(opened).toMatchObject({ ok: true, origin: "recovered-restore" });
    if (!opened.ok) return;
    expect(opened.controller.authoritySnapshot().index.projects).toContainEqual({
      projectId: PROJECT_C,
      kind: "active",
    });
  });

  it("routes a partial v0.7.1 migration journal through production bootstrap", async () => {
    const storage = new MemoryWorkspaceStorageAdapter({
      [LEGACY_PROJECT_KEYS.record]: LEGACY_ACTIVE_RECORD_RAW,
    });
    storage.faults.armAtCheckpoint(
      `before:setItem:${WORKSPACE_INDEX_KEY}`,
      "security",
    );
    await expect(
      openOrMigrateWorkspace(storage, new SerialLockRunner(), {
        uuidSource: new SequenceUuidSource([
          "99999999-9999-4999-8999-999999999999",
          PROJECT_C,
          OPERATION_C,
        ]),
      }),
    ).resolves.toEqual({ ok: false, reason: "commit-incomplete" });
    storage.faults.clear();

    const opened = await bootstrapWorkspaceRuntime(
      storage,
      new SerialLockRunner(),
    );

    expect(opened).toMatchObject({ ok: true, origin: "resumed-migration" });
    if (!opened.ok) return;
    expect(opened.controller.authoritySnapshot().projects).toHaveLength(1);
    expect(storage.getItem(LEGACY_PROJECT_KEYS.record)).toBe(
      LEGACY_ACTIVE_RECORD_RAW,
    );
  });

  it("keeps third target, base-index, and legacy values quarantined", async () => {
    const targetThird = await leaveCreationPartial(
      `before:setItem:${WORKSPACE_INDEX_KEY}`,
    );
    targetThird.storage.setItem(targetThird.targetKey, "fictional-third-value");
    await expect(
      bootstrapWorkspaceRuntime(targetThird.storage, new SerialLockRunner()),
    ).resolves.toEqual({ ok: false, reason: "recovery-required" });
    expect(targetThird.storage.getItem(WORKSPACE_OPERATION_KEY)).not.toBeNull();

    const indexThird = await leaveCreationPartial(
      `before:setItem:${WORKSPACE_INDEX_KEY}`,
    );
    indexThird.storage.setItem(WORKSPACE_INDEX_KEY, "fictional-third-index");
    await expect(
      bootstrapWorkspaceRuntime(indexThird.storage, new SerialLockRunner()),
    ).resolves.toEqual({ ok: false, reason: "recovery-required" });
    expect(indexThird.storage.getItem(WORKSPACE_OPERATION_KEY)).not.toBeNull();

    const legacyThird = await leaveCreationPartial(
      `before:setItem:${WORKSPACE_INDEX_KEY}`,
    );
    legacyThird.storage.setItem(LEGACY_PROJECT_KEYS.v3, "fictional-old-tab-write");
    await expect(
      bootstrapWorkspaceRuntime(legacyThird.storage, new SerialLockRunner()),
    ).resolves.toEqual({ ok: false, reason: "recovery-required" });
    expect(legacyThird.storage.getItem(WORKSPACE_OPERATION_KEY)).not.toBeNull();
  });

  it("rechecks all exact raw bytes synchronously before index commit and journal removal", async () => {
    const beforeIndex = await leaveCreationPartial(
      `before:setItem:${WORKSPACE_INDEX_KEY}`,
    );
    const racingIndex = new MutateOnKeysStorage(
      beforeIndex.storage.snapshot(),
      (storage) => {
        storage.setItem(LEGACY_PROJECT_KEYS.v3, "fictional-late-old-tab-write");
      },
    );
    const baseIndex = racingIndex.getItem(WORKSPACE_INDEX_KEY);
    await expect(
      resumeWorkspaceCreationOperation(racingIndex, new SerialLockRunner()),
    ).resolves.toEqual({ ok: false, reason: "commit-incomplete" });
    expect(racingIndex.getItem(WORKSPACE_INDEX_KEY)).toBe(baseIndex);
    expect(racingIndex.getItem(WORKSPACE_OPERATION_KEY)).not.toBeNull();

    const beforeRemoval = await leaveCreationPartial(
      `before:removeItem:${WORKSPACE_OPERATION_KEY}`,
    );
    const racingRemoval = new MutateOnKeysStorage(
      beforeRemoval.storage.snapshot(),
      (storage) => {
        storage.setItem(LEGACY_PROJECT_KEYS.v3, "fictional-late-old-tab-write");
      },
    );
    await expect(
      resumeWorkspaceCreationOperation(racingRemoval, new SerialLockRunner()),
    ).resolves.toEqual({ ok: false, reason: "commit-incomplete" });
    expect(racingRemoval.getItem(WORKSPACE_OPERATION_KEY)).not.toBeNull();
    expect(racingRemoval.getItem(beforeRemoval.targetKey)).not.toBeNull();
  });

  it("fails closed without Web Locks and for unrelated lifecycle journals", async () => {
    const { storage } = await seededWorkspace();
    const before = storage.snapshot();
    await expect(bootstrapWorkspaceRuntime(storage, null)).resolves.toEqual({
      ok: false,
      reason: "lock-unavailable",
    });
    expect(storage.snapshot()).toEqual(before);
  });
});
