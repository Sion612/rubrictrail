import { describe, expect, it } from "vitest";
import { createDefaultProjectState } from "@/lib/local-state";
import {
  parseProjectBackupText,
  serializeProjectBackup,
} from "@/lib/project-backup";
import { SAMPLE_DRAFT_CHECK } from "@/lib/sample-data";
import {
  createWorkspaceProject,
  readWorkspaceAuthority,
  readWorkspacePreferenceBestEffort,
  restoreWorkspaceProjectAsNew,
  saveWorkspaceProject,
  switchWorkspaceProject,
  writeWorkspacePreferenceBestEffort,
  workspaceIndexBaseline,
  workspaceProjectBaseline,
  type WorkspaceAuthoritySnapshot,
  type WorkspaceExclusiveLockRunner,
} from "@/lib/workspace-storage/coordinator";
import { WorkspacePendingSaveManager } from "@/lib/workspace-storage/coordinator-pending";
import {
  WORKSPACE_INDEX_KEY,
  LEGACY_PROJECT_KEYS,
  WORKSPACE_LOCK_NAME,
  WORKSPACE_OPERATION_KEY,
  WORKSPACE_PREFERENCES_KEY,
  WORKSPACE_RESERVE_KEY,
  workspaceProjectRecordKey,
  type SecureUuidSource,
} from "@/lib/workspace-storage/keys";
import {
  parseWorkspacePreferences,
  serializeWorkspaceIndex,
  serializeWorkspaceJournal,
  serializeWorkspaceProjectRecord,
} from "@/lib/workspace-storage/protocol";
import { classifyWorkspaceRecovery } from "@/lib/workspace-storage/recovery";
import { CANONICAL_WORKSPACE_RESERVE } from "@/lib/workspace-storage/reserve";
import { MemoryWorkspaceStorageAdapter } from "@/lib/workspace-storage/storage-adapter";
import {
  activeIndex,
  activeProjectRecord,
  journalFor,
  NULL_LEGACY_FINGERPRINTS,
  PROJECT_A,
  PROJECT_B,
  WS,
  WS_OTHER,
} from "@/lib/workspace-storage/test-fixtures";
import type {
  WorkspaceIndexEntryV1,
  WorkspaceIndexV1,
  WorkspaceProjectRecordV1,
} from "@/lib/workspace-storage/types";
import type { PersistedProjectState } from "@/lib/ui-types";

const PROJECT_C = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PROJECT_D = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OPERATION_D = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const OPERATION_E = "12345678-1234-4234-8234-123456789abc";

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
  private tail: Promise<void> = Promise.resolve();

  runExclusive<T>(name: string, operation: () => Promise<T>): Promise<T> {
    this.names.push(name);
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

class RejectingWorkspaceLockRunner implements WorkspaceExclusiveLockRunner {
  runExclusive<T>(): Promise<T> {
    return Promise.reject(new Error("Fictional lock rejection"));
  }
}

class BeforeOperationLockRunner implements WorkspaceExclusiveLockRunner {
  constructor(private readonly beforeOperation: () => void) {}

  runExclusive<T>(_name: string, operation: () => Promise<T>): Promise<T> {
    this.beforeOperation();
    return operation();
  }
}

class BeforeFirstTargetWriteStorage extends MemoryWorkspaceStorageAdapter {
  private fired = false;

  constructor(
    initialValues: Readonly<Record<string, string>>,
    private readonly targetKey: string,
    private readonly beforeWrite: () => void,
  ) {
    super(initialValues);
  }

  override setItem(key: string, value: string): void {
    if (!this.fired && key === this.targetKey) {
      this.fired = true;
      this.beforeWrite();
    }
    super.setItem(key, value);
  }
}

function fictionalState(
  label: string,
  overrides: Partial<PersistedProjectState> = {},
): PersistedProjectState {
  const base = createDefaultProjectState();
  return {
    ...base,
    projectKind: "sample",
    weeklyHours: label.length + 4,
    targetGrade: 60 + label.length,
    draftText: `Fictional ${label} draft`,
    ...overrides,
  };
}

function fictionalSampleState(
  label: string,
  withCheck: boolean,
  overrides: Partial<PersistedProjectState> = {},
): PersistedProjectState {
  const base = createDefaultProjectState();
  const draftText = `Fictional ${label} sample draft`;
  return {
    ...base,
    projectKind: "sample",
    view: withCheck ? "draft" : "rubric",
    visitedViews: withCheck ? ["overview", "draft"] : ["overview", "rubric"],
    completedTaskIds: withCheck ? ["p1"] : [],
    weeklyHours: withCheck ? 7 : 11,
    targetGrade: withCheck ? 72 : 81,
    draftText,
    draftResult: withCheck ? SAMPLE_DRAFT_CHECK : null,
    checkedDraftText: withCheck ? draftText : null,
    readinessChecks: withCheck ? ["sources"] : [],
    ...overrides,
  };
}

interface SeedProject {
  projectId: string;
  state?: PersistedProjectState;
  kind?: "active" | "tombstone";
  revision?: number;
}

async function seededWorkspace(
  projects: readonly SeedProject[] = [
    { projectId: PROJECT_A, state: fictionalState("alpha") },
    { projectId: PROJECT_B, state: fictionalState("beta") },
  ],
  indexOverrides: Partial<WorkspaceIndexV1> = {},
): Promise<{
  storage: MemoryWorkspaceStorageAdapter;
  snapshot: WorkspaceAuthoritySnapshot;
}> {
  const entries: WorkspaceIndexEntryV1[] = projects.map((project) => ({
    projectId: project.projectId,
    kind: project.kind ?? "active",
  }));
  const index = serializeWorkspaceIndex(
    activeIndex({
      projects: entries,
      legacyFingerprints: NULL_LEGACY_FINGERPRINTS,
      ...indexOverrides,
    }),
  );
  if (!index.ok) throw new Error("Fictional index is invalid");

  const values: Record<string, string> = {
    [WORKSPACE_INDEX_KEY]: index.serialized,
    [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
  };
  for (const project of projects) {
    const kind = project.kind ?? "active";
    const record: WorkspaceProjectRecordV1 = {
      ...activeProjectRecord(project.projectId),
      revision: project.revision ?? 1,
      value:
        kind === "active"
          ? {
              kind: "project",
              state: project.state ?? fictionalState(project.projectId),
            }
          : { kind: "tombstone" },
    };
    const serialized = serializeWorkspaceProjectRecord(record);
    if (!serialized.ok) throw new Error("Fictional project is invalid");
    values[
      workspaceProjectRecordKey(
        index.value.workspaceId,
        index.value.workspaceGeneration,
        project.projectId,
      )
    ] = serialized.serialized;
  }

  const storage = new MemoryWorkspaceStorageAdapter(values);
  const authority = await readWorkspaceAuthority(storage);
  if (!authority.ok) {
    throw new Error(`Fictional authority failed: ${authority.reason}`);
  }
  return { storage, snapshot: authority.snapshot };
}

function generatedProjectId(number: number): string {
  return `${number.toString(16).padStart(8, "0")}-0000-4000-8000-${number
    .toString(16)
    .padStart(12, "0")}`;
}

function activeState(snapshot: WorkspaceAuthoritySnapshot, projectId: string) {
  const project = snapshot.projects.find(
    (candidate) => candidate.record.projectId === projectId,
  );
  if (!project || project.record.value.kind !== "project") {
    throw new Error("Expected an active fictional project");
  }
  return project.record.value.state;
}

describe("dormant workspace coordinator authority", () => {
  it("reads two strict projects without mixing their independent state", async () => {
    const { snapshot } = await seededWorkspace();

    expect(snapshot.index.projects).toEqual([
      { projectId: PROJECT_A, kind: "active" },
      { projectId: PROJECT_B, kind: "active" },
    ]);
    expect(activeState(snapshot, PROJECT_A).draftText).toBe(
      "Fictional alpha draft",
    );
    expect(activeState(snapshot, PROJECT_B).draftText).toBe(
      "Fictional beta draft",
    );
    expect(workspaceProjectBaseline(snapshot, PROJECT_A)?.projectId).toBe(
      PROJECT_A,
    );
  });

  it("retains independent full sample workflow, draft, check, progress, and tracker fields", async () => {
    const alpha = fictionalSampleState("alpha", true);
    const beta = fictionalSampleState("beta", false, {
      view: "progress",
      completedTaskIds: ["p2"],
    });
    const { snapshot } = await seededWorkspace([
      { projectId: PROJECT_A, state: alpha },
      { projectId: PROJECT_B, state: beta },
    ]);

    expect(activeState(snapshot, PROJECT_A)).toMatchObject({
      view: "draft",
      visitedViews: ["overview", "draft"],
      completedTaskIds: ["p1"],
      weeklyHours: 7,
      targetGrade: 72,
      draftText: "Fictional alpha sample draft",
      checkedDraftText: "Fictional alpha sample draft",
      readinessChecks: ["sources"],
    });
    expect(activeState(snapshot, PROJECT_A).draftResult).toEqual(
      SAMPLE_DRAFT_CHECK,
    );
    expect(activeState(snapshot, PROJECT_B)).toMatchObject({
      view: "progress",
      completedTaskIds: ["p2"],
      weeklyHours: 11,
      targetGrade: 81,
      draftText: "Fictional beta sample draft",
      draftResult: null,
      checkedDraftText: null,
      readinessChecks: [],
    });
  });

  it("fails closed instead of hiding an indexed active no-project record", async () => {
    const index = serializeWorkspaceIndex(
      activeIndex({
        projects: [{ projectId: PROJECT_A, kind: "active" }],
        legacyFingerprints: NULL_LEGACY_FINGERPRINTS,
      }),
    );
    const record = serializeWorkspaceProjectRecord({
      ...activeProjectRecord(PROJECT_A),
      value: { kind: "project", state: createDefaultProjectState() },
    });
    if (!index.ok || !record.ok) {
      throw new Error("Fictional active no-project fixture is invalid");
    }
    const storage = new MemoryWorkspaceStorageAdapter({
      [WORKSPACE_INDEX_KEY]: index.serialized,
      [workspaceProjectRecordKey(WS, 1, PROJECT_A)]: record.serialized,
      [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
    });

    await expect(readWorkspaceAuthority(storage)).resolves.toEqual({
      ok: false,
      reason: "invalid-project-record",
    });
  });

  it("fails closed for a valid pending journal, an invalid journal, or legacy drift", async () => {
    const validJournalSeed = await seededWorkspace([
      { projectId: PROJECT_A, state: fictionalState("alpha") },
    ]);
    const validJournal = serializeWorkspaceJournal(
      await journalFor("create-project"),
    );
    if (!validJournal.ok) throw new Error("Fictional journal is invalid");
    validJournalSeed.storage.setItem(
      WORKSPACE_OPERATION_KEY,
      validJournal.serialized,
    );
    await expect(
      readWorkspaceAuthority(validJournalSeed.storage),
    ).resolves.toEqual({
      ok: false,
      reason: "operation-recovery-required",
    });

    const invalidJournalSeed = await seededWorkspace();
    invalidJournalSeed.storage.setItem(
      WORKSPACE_OPERATION_KEY,
      "fictional-invalid-journal",
    );
    await expect(
      readWorkspaceAuthority(invalidJournalSeed.storage),
    ).resolves.toEqual({
      ok: false,
      reason: "invalid-operation-journal",
    });

    const legacyDriftSeed = await seededWorkspace();
    legacyDriftSeed.storage.setItem(
      "rubrictrail.project.v3",
      "fictional-stale-tab-write",
    );
    await expect(readWorkspaceAuthority(legacyDriftSeed.storage)).resolves.toEqual(
      { ok: false, reason: "legacy-conflict" },
    );
  });
});

describe("dormant workspace coordinator switching and preference", () => {
  it("switches current-tab selection without revising the index", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const indexBefore = storage.getItem(WORKSPACE_INDEX_KEY);

    const switched = switchWorkspaceProject(
      snapshot,
      { selectedProjectId: PROJECT_A, pendingProjectIds: [] },
      PROJECT_B,
    );

    expect(switched).toMatchObject({
      ok: true,
      selection: { selectedProjectId: PROJECT_B },
    });
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBe(indexBefore);
    expect(storage.getItem(WORKSPACE_PREFERENCES_KEY)).toBeNull();
    expect(
      writeWorkspacePreferenceBestEffort(storage, snapshot.index, PROJECT_B),
    ).toBe(true);
    const preferenceRaw = storage.getItem(WORKSPACE_PREFERENCES_KEY);
    const preference = preferenceRaw
      ? parseWorkspacePreferences(preferenceRaw)
      : null;
    expect(preference?.ok && preference.value.lastOpenedProjectId).toBe(
      PROJECT_B,
    );
  });

  it("blocks a switch while the selected project has a pending save", async () => {
    const { storage, snapshot } = await seededWorkspace();

    const switched = switchWorkspaceProject(
      snapshot,
      { selectedProjectId: PROJECT_A, pendingProjectIds: [PROJECT_A] },
      PROJECT_B,
    );

    expect(switched).toEqual({
      ok: false,
      reason: "pending-save",
      selection: {
        selectedProjectId: PROJECT_A,
        pendingProjectIds: [PROJECT_A],
      },
    });
    expect(storage.getItem(WORKSPACE_PREFERENCES_KEY)).toBeNull();
  });

  it("does not reverse a successful UI switch when preference storage fails", async () => {
    const { storage, snapshot } = await seededWorkspace();
    storage.faults.armAtCheckpoint(
      `before:setItem:${WORKSPACE_PREFERENCES_KEY}`,
      "security",
    );

    const switched = switchWorkspaceProject(
      snapshot,
      { selectedProjectId: PROJECT_A, pendingProjectIds: [] },
      PROJECT_B,
    );

    expect(switched).toEqual({
      ok: true,
      selection: { selectedProjectId: PROJECT_B, pendingProjectIds: [] },
    });
    const currentTabSelection = switched.ok
      ? switched.selection
      : { selectedProjectId: PROJECT_A, pendingProjectIds: [] };
    expect(
      writeWorkspacePreferenceBestEffort(storage, snapshot.index, PROJECT_B),
    ).toBe(false);
    expect(currentTabSelection.selectedProjectId).toBe(PROJECT_B);
  });

  it("ignores and best-effort removes a dangling preference", async () => {
    const { storage, snapshot } = await seededWorkspace();
    storage.setItem(
      WORKSPACE_PREFERENCES_KEY,
      JSON.stringify({
        formatVersion: 1,
        workspaceId: WS,
        workspaceGeneration: 1,
        lastOpenedProjectId: PROJECT_C,
      }),
    );

    expect(readWorkspacePreferenceBestEffort(storage, snapshot.index)).toBeNull();
    expect(storage.getItem(WORKSPACE_PREFERENCES_KEY)).toBeNull();
  });
});

describe("dormant workspace coordinator project saves", () => {
  it("writes only the selected project record and leaves index and sibling bytes exact", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const locks = new SerialWorkspaceLockRunner();
    const baseline = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional baseline");
    const siblingBefore = snapshot.projects.find(
      (project) => project.record.projectId === PROJECT_B,
    )?.raw;

    const saved = await saveWorkspaceProject(storage, locks, {
      baseline,
      nextState: fictionalState("alpha-saved", {
        view: "draft",
      }),
      intentStillCurrent: () => true,
    });

    expect(saved).toMatchObject({ ok: true });
    if (!saved.ok) return;
    expect(saved.project.record.revision).toBe(2);
    expect(activeState(saved.snapshot, PROJECT_A).view).toBe("draft");
    expect(
      saved.snapshot.projects.find(
        (project) => project.record.projectId === PROJECT_B,
      )?.raw,
    ).toBe(siblingBefore);
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBe(snapshot.indexRaw);
    expect(locks.names).toEqual([WORKSPACE_LOCK_NAME]);
  });

  it("makes concurrent same-project saves an explicit one-success/one-conflict", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const locks = new SerialWorkspaceLockRunner();
    const baseline = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional baseline");

    const results = await Promise.all([
      saveWorkspaceProject(storage, locks, {
        baseline,
        nextState: fictionalState("same-a"),
        intentStillCurrent: () => true,
      }),
      saveWorkspaceProject(storage, locks, {
        baseline,
        nextState: fictionalState("same-b"),
        intentStillCurrent: () => true,
      }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, reason: "project-conflict" },
    ]);
  });

  it("rejects a stale unlocked display snapshot by exact project baseline", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const locks = new SerialWorkspaceLockRunner();
    const baseline = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional baseline");
    const first = await saveWorkspaceProject(storage, locks, {
      baseline,
      nextState: fictionalState("newer-display-state"),
      intentStillCurrent: () => true,
    });
    expect(first.ok).toBe(true);

    await expect(
      saveWorkspaceProject(storage, locks, {
        baseline,
        nextState: fictionalState("stale-display-state"),
        intentStillCurrent: () => true,
      }),
    ).resolves.toEqual({ ok: false, reason: "project-conflict" });
  });

  it("detects legacy drift introduced while waiting for the global lock", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const baseline = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional baseline");
    const projectBefore = baseline.raw;

    const saved = await saveWorkspaceProject(
      storage,
      new BeforeOperationLockRunner(() => {
        storage.setItem(
          LEGACY_PROJECT_KEYS.v3,
          "fictional-write-while-waiting-for-lock",
        );
      }),
      {
        baseline,
        nextState: fictionalState("must-not-save"),
        intentStillCurrent: () => true,
      },
    );

    expect(saved).toEqual({ ok: false, reason: "legacy-conflict" });
    expect(storage.getItem(workspaceProjectRecordKey(WS, 1, PROJECT_A))).toBe(
      projectBefore,
    );
  });

  it("serializes different-project saves without creating a false conflict", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const locks = new SerialWorkspaceLockRunner();
    const baselineA = workspaceProjectBaseline(snapshot, PROJECT_A);
    const baselineB = workspaceProjectBaseline(snapshot, PROJECT_B);
    if (!baselineA || !baselineB) throw new Error("Missing fictional baselines");

    const [savedA, savedB] = await Promise.all([
      saveWorkspaceProject(storage, locks, {
        baseline: baselineA,
        nextState: fictionalState("independent-a", { view: "rubric" }),
        intentStillCurrent: () => true,
      }),
      saveWorkspaceProject(storage, locks, {
        baseline: baselineB,
        nextState: fictionalState("independent-b", { view: "progress" }),
        intentStillCurrent: () => true,
      }),
    ]);

    expect(savedA.ok).toBe(true);
    expect(savedB.ok).toBe(true);
    const final = await readWorkspaceAuthority(storage);
    expect(final.ok).toBe(true);
    if (!final.ok) return;
    expect(activeState(final.snapshot, PROJECT_A).view).toBe("rubric");
    expect(activeState(final.snapshot, PROJECT_B).view).toBe("progress");
    expect(final.snapshot.indexRaw).toBe(snapshot.indexRaw);
  });

  it("revalidates pending intent inside the lock before writing", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const baseline = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional baseline");
    const before = storage.snapshot();

    const saved = await saveWorkspaceProject(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline,
        nextState: fictionalState("stale-intent"),
        intentStillCurrent: () => false,
      },
    );

    expect(saved).toEqual({ ok: false, reason: "intent-stale" });
    expect(storage.snapshot()).toEqual(before);
  });

  it("fails closed without Web Locks and on lock rejection", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const baseline = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional baseline");
    const request = {
      baseline,
      nextState: fictionalState("no-lock"),
      intentStillCurrent: () => true,
    };
    const before = storage.snapshot();

    await expect(saveWorkspaceProject(storage, null, request)).resolves.toEqual({
      ok: false,
      reason: "lock-unavailable",
    });
    await expect(
      saveWorkspaceProject(storage, new RejectingWorkspaceLockRunner(), request),
    ).resolves.toEqual({ ok: false, reason: "lock-failed" });
    expect(storage.snapshot()).toEqual(before);
  });

  it("allows only a non-growing edit when the reserve is degraded", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const baseline = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional baseline");
    storage.removeItem(WORKSPACE_RESERVE_KEY);

    const grown = await saveWorkspaceProject(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline,
        nextState: fictionalState("grown", { draftText: "x".repeat(2_000) }),
        intentStillCurrent: () => true,
      },
    );
    expect(grown).toEqual({ ok: false, reason: "reserve-degraded" });

    const compact = await saveWorkspaceProject(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline,
        nextState: fictionalState("x", { draftText: "" }),
        intentStillCurrent: () => true,
      },
    );
    expect(compact.ok).toBe(true);
  });

  it("rejects a normal save that would hide an assignment as projectKind none", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const baseline = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional baseline");
    const before = storage.snapshot();

    const saved = await saveWorkspaceProject(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline,
        nextState: createDefaultProjectState(),
        intentStillCurrent: () => true,
      },
    );

    expect(saved).toEqual({ ok: false, reason: "invalid-state" });
    expect(storage.snapshot()).toEqual(before);
  });

  it("keeps a newer same-project pending save when an in-flight revision completes", async () => {
    const seeded = await seededWorkspace();
    const manager = new WorkspacePendingSaveManager(seeded.snapshot);
    expect(manager.queue(PROJECT_A, fictionalState("queued-n"))).toMatchObject({
      ok: true,
    });
    const projectKey = workspaceProjectRecordKey(WS, 1, PROJECT_A);
    const storage = new BeforeFirstTargetWriteStorage(
      seeded.storage.snapshot(),
      projectKey,
      () => {
        expect(
          manager.queue(PROJECT_A, fictionalState("queued-n-plus-one")),
        ).toMatchObject({ ok: true });
      },
    );

    const first = await manager.flushProject(
      storage,
      new SerialWorkspaceLockRunner(),
      PROJECT_A,
    );

    expect(first).toMatchObject({ ok: true, superseded: true });
    expect(manager.hasPending(PROJECT_A)).toBe(true);
    expect(manager.baselineFor(PROJECT_A)?.projectRevision).toBe(2);

    const second = await manager.flushProject(
      storage,
      new SerialWorkspaceLockRunner(),
      PROJECT_A,
    );
    expect(second).toMatchObject({ ok: true, superseded: false });
    expect(manager.hasPending(PROJECT_A)).toBe(false);
    expect(manager.baselineFor(PROJECT_A)?.projectRevision).toBe(3);
    const final = await readWorkspaceAuthority(storage);
    expect(final.ok).toBe(true);
    if (!final.ok) return;
    expect(activeState(final.snapshot, PROJECT_A).draftText).toBe(
      "Fictional queued-n-plus-one draft",
    );
  });

  it("tracks and flushes project A and B pending state independently", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const manager = new WorkspacePendingSaveManager(snapshot);
    expect(manager.hasPending(PROJECT_C)).toBe(false);
    expect(manager.queue(PROJECT_A, createDefaultProjectState())).toEqual({
      ok: false,
      reason: "invalid-state",
    });
    expect(manager.hasPending(PROJECT_A)).toBe(false);
    expect(manager.queue(PROJECT_A, fictionalState("manager-a"))).toMatchObject({
      ok: true,
    });
    expect(manager.queue(PROJECT_B, fictionalState("manager-b"))).toMatchObject({
      ok: true,
    });
    expect(manager.pendingProjectIds()).toEqual([PROJECT_A, PROJECT_B]);

    const locks = new SerialWorkspaceLockRunner();
    const [savedA, savedB] = await Promise.all([
      manager.flushProject(storage, locks, PROJECT_A),
      manager.flushProject(storage, locks, PROJECT_B),
    ]);

    expect(savedA).toMatchObject({ ok: true, superseded: false });
    expect(savedB).toMatchObject({ ok: true, superseded: false });
    expect(manager.pendingProjectIds()).toEqual([]);
    expect(manager.baselineFor(PROJECT_A)?.projectRevision).toBe(2);
    expect(manager.baselineFor(PROJECT_B)?.projectRevision).toBe(2);
  });

  it("does not start or clear a second concurrent flush for the same project", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const manager = new WorkspacePendingSaveManager(snapshot);
    manager.queue(PROJECT_A, fictionalState("single-flight"));
    const locks = new SerialWorkspaceLockRunner();

    const firstPromise = manager.flushProject(storage, locks, PROJECT_A);
    const second = await manager.flushProject(storage, locks, PROJECT_A);
    const first = await firstPromise;

    expect(second).toEqual({ ok: false, reason: "save-in-flight" });
    expect(first).toMatchObject({ ok: true, superseded: false });
    expect(manager.hasPending(PROJECT_A)).toBe(false);
    expect(manager.baselineFor(PROJECT_A)?.projectRevision).toBe(2);
  });

  it("retains pending state and its baseline when an autosave write fails", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const manager = new WorkspacePendingSaveManager(snapshot);
    manager.queue(PROJECT_A, fictionalState("retry-after-failure"));
    storage.faults.armAtCheckpoint(
      `before:setItem:${workspaceProjectRecordKey(WS, 1, PROJECT_A)}`,
      "security",
    );

    const saved = await manager.flushProject(
      storage,
      new SerialWorkspaceLockRunner(),
      PROJECT_A,
    );

    expect(saved).toEqual({ ok: false, reason: "storage-error" });
    expect(manager.hasPending(PROJECT_A)).toBe(true);
    expect(manager.baselineFor(PROJECT_A)?.projectRevision).toBe(1);
  });
});

describe("dormant workspace coordinator create and restore-as-new", () => {
  it("blocks membership growth until autosaves drain, then rebuilds baselines from the returned snapshot", async () => {
    const { storage, snapshot } = await seededWorkspace([
      { projectId: PROJECT_A, state: fictionalState("alpha") },
    ]);
    const manager = new WorkspacePendingSaveManager(snapshot);
    expect(manager.membershipChangeReady()).toBe(true);
    expect(manager.queue(PROJECT_A, fictionalState("before-create"))).toMatchObject({
      ok: true,
    });
    expect(manager.membershipChangeReady()).toBe(false);
    const beforeBlockedCreate = storage.snapshot();

    const blocked = await createWorkspaceProject(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(snapshot),
        state: fictionalState("blocked-by-pending"),
        intentStillCurrent: () => true,
        pendingSavesDrained: () => manager.membershipChangeReady(),
        uuidSource: new SequenceUuidSource([PROJECT_C, OPERATION_D]),
      },
    );
    expect(blocked).toEqual({ ok: false, reason: "pending-save" });
    expect(storage.snapshot()).toEqual(beforeBlockedCreate);

    const inFlight = manager.flushProject(
      storage,
      new SerialWorkspaceLockRunner(),
      PROJECT_A,
    );
    expect(manager.membershipChangeReady()).toBe(false);
    const flushed = await inFlight;
    expect(flushed).toMatchObject({ ok: true, superseded: false });
    expect(manager.membershipChangeReady()).toBe(true);
    if (!flushed.ok) return;

    const created = await createWorkspaceProject(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(flushed.snapshot),
        state: fictionalState("created-after-drain"),
        intentStillCurrent: () => true,
        pendingSavesDrained: () => manager.membershipChangeReady(),
        uuidSource: new SequenceUuidSource([PROJECT_C, OPERATION_D]),
      },
    );
    expect(created).toMatchObject({ ok: true, projectId: PROJECT_C });
    if (!created.ok) return;
    expect(created.snapshot.index.revision).toBe(
      flushed.snapshot.index.revision + 1,
    );

    // Membership changes invalidate every embedded index baseline. Rebuilding
    // from the returned authority snapshot is safe only after the old manager
    // has no pending or in-flight state.
    const rebuilt = new WorkspacePendingSaveManager(created.snapshot);
    expect(rebuilt.baselineFor(PROJECT_A)?.index.revision).toBe(
      created.snapshot.index.revision,
    );
    expect(rebuilt.queue(PROJECT_A, fictionalState("after-create"))).toMatchObject({
      ok: true,
    });
    const savedExisting = await rebuilt.flushProject(
      storage,
      new SerialWorkspaceLockRunner(),
      PROJECT_A,
    );
    expect(savedExisting).toMatchObject({ ok: true, superseded: false });
    if (!savedExisting.ok) return;
    expect(savedExisting.project.record.revision).toBe(3);
    expect(savedExisting.snapshot.indexRaw).toBe(created.snapshot.indexRaw);
  });

  it("journal-creates a second assignment with a fresh identity", async () => {
    const { storage, snapshot } = await seededWorkspace([
      { projectId: PROJECT_A, state: fictionalState("alpha") },
    ]);
    const locks = new SerialWorkspaceLockRunner();

    const created = await createWorkspaceProject(storage, locks, {
      baseline: workspaceIndexBaseline(snapshot),
      state: fictionalState("created", { view: "plan" }),
      intentStillCurrent: () => true,
      pendingSavesDrained: () => true,
      uuidSource: new SequenceUuidSource([PROJECT_C, OPERATION_D]),
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.projectId).toBe(PROJECT_C);
    expect(created.project.record.revision).toBe(1);
    expect(created.snapshot.index.revision).toBe(snapshot.index.revision + 1);
    expect(created.snapshot.index.projects).toEqual([
      { projectId: PROJECT_A, kind: "active" },
      { projectId: PROJECT_C, kind: "active" },
    ]);
    expect(activeState(created.snapshot, PROJECT_C).view).toBe("plan");
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    expect(storage.getItem(WORKSPACE_RESERVE_KEY)).toBe(
      CANONICAL_WORKSPACE_RESERVE,
    );
    expect(locks.names).toEqual([WORKSPACE_LOCK_NAME]);
  });

  it("rejects no-project state for create and restore-as-new", async () => {
    const first = await seededWorkspace([
      { projectId: PROJECT_A, state: fictionalState("alpha") },
    ]);
    const beforeCreate = first.storage.snapshot();
    const created = await createWorkspaceProject(
      first.storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(first.snapshot),
        state: createDefaultProjectState(),
        intentStillCurrent: () => true,
        pendingSavesDrained: () => true,
        uuidSource: new SequenceUuidSource([PROJECT_C, OPERATION_D]),
      },
    );
    expect(created).toEqual({ ok: false, reason: "invalid-state" });
    expect(first.storage.snapshot()).toEqual(beforeCreate);

    const second = await seededWorkspace([
      { projectId: PROJECT_A, state: fictionalState("alpha") },
    ]);
    const beforeRestore = second.storage.snapshot();
    const restored = await restoreWorkspaceProjectAsNew(
      second.storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(second.snapshot),
        backup: { state: createDefaultProjectState() },
        intentStillCurrent: () => true,
        pendingSavesDrained: () => true,
        uuidSource: new SequenceUuidSource([PROJECT_C, OPERATION_D]),
      },
    );
    expect(restored).toEqual({ ok: false, reason: "invalid-state" });
    expect(second.storage.snapshot()).toEqual(beforeRestore);
  });

  it("restores only backup project state and ignores supplied identity metadata", async () => {
    const { storage, snapshot } = await seededWorkspace([
      { projectId: PROJECT_A, state: fictionalState("alpha") },
    ]);
    const backupText = serializeProjectBackup(
      fictionalSampleState("restored", true, { view: "progress" }),
      "2026-08-20T00:00:00.000Z",
    );
    const parsedBackup = parseProjectBackupText(backupText);
    const importedBackup = {
      ...parsedBackup,
      workspaceId: WS_OTHER,
      workspaceGeneration: 99,
      projectId: PROJECT_B,
      revision: 88,
      preference: PROJECT_B,
    };

    const restored = await restoreWorkspaceProjectAsNew(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(snapshot),
        backup: importedBackup,
        intentStillCurrent: () => true,
        pendingSavesDrained: () => true,
        uuidSource: new SequenceUuidSource([PROJECT_D, OPERATION_E]),
      },
    );

    expect(restored).toMatchObject({ ok: true });
    if (!restored.ok) return;
    expect(restored.projectId).toBe(PROJECT_D);
    expect(restored.project.record).toMatchObject({
      workspaceId: WS,
      workspaceGeneration: 1,
      projectId: PROJECT_D,
      revision: 1,
    });
    expect(activeState(restored.snapshot, PROJECT_D)).toEqual(
      importedBackup.state,
    );
    expect(storage.getItem(WORKSPACE_PREFERENCES_KEY)).toBeNull();
  });

  it("rechecks the 96-record logical growth block inside the lock", async () => {
    const projects = Array.from({ length: 96 }, (_, index) => ({
      projectId: generatedProjectId(index + 1),
      kind: "tombstone" as const,
    }));
    const { storage, snapshot } = await seededWorkspace(projects);
    const before = storage.snapshot();

    const created = await createWorkspaceProject(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(snapshot),
        state: fictionalState("blocked-logical"),
        intentStillCurrent: () => true,
        pendingSavesDrained: () => true,
        uuidSource: new SequenceUuidSource([]),
      },
    );

    expect(created).toEqual({
      ok: false,
      reason: "growth-blocked-logical",
    });
    expect(storage.snapshot()).toEqual(before);
  });

  it("rechecks the 100-key physical growth block across generations", async () => {
    const { storage, snapshot } = await seededWorkspace([
      { projectId: PROJECT_A, state: fictionalState("alpha") },
    ]);
    const indexBefore = storage.getItem(WORKSPACE_INDEX_KEY);

    const created = await createWorkspaceProject(
      storage,
      new BeforeOperationLockRunner(() => {
        for (let index = 1; index < 100; index += 1) {
          storage.setItem(
            workspaceProjectRecordKey(WS_OTHER, 2, generatedProjectId(index)),
            "fictional-quarantined-record",
          );
        }
      }),
      {
        baseline: workspaceIndexBaseline(snapshot),
        state: fictionalState("blocked-physical"),
        intentStillCurrent: () => true,
        pendingSavesDrained: () => true,
        uuidSource: new SequenceUuidSource([]),
      },
    );

    expect(created).toEqual({
      ok: false,
      reason: "growth-blocked-physical",
    });
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBe(indexBefore);
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
  });

  it("allows the 95th logical record to create the 96th, then blocks further growth", async () => {
    const projects = Array.from({ length: 95 }, (_, index) => ({
      projectId: generatedProjectId(index + 1),
      kind: "tombstone" as const,
    }));
    const { storage, snapshot } = await seededWorkspace(projects);

    const created = await createWorkspaceProject(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(snapshot),
        state: fictionalState("record-96"),
        intentStillCurrent: () => true,
        pendingSavesDrained: () => true,
        uuidSource: new SequenceUuidSource([PROJECT_C, OPERATION_D]),
      },
    );

    expect(created).toMatchObject({ ok: true, projectId: PROJECT_C });
    if (!created.ok) return;
    expect(created.snapshot.index.projects).toHaveLength(96);
    const blocked = await createWorkspaceProject(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(created.snapshot),
        state: fictionalState("record-97"),
        intentStillCurrent: () => true,
        pendingSavesDrained: () => true,
        uuidSource: new SequenceUuidSource([PROJECT_D, OPERATION_E]),
      },
    );
    expect(blocked).toEqual({
      ok: false,
      reason: "growth-blocked-logical",
    });
  });

  it("leaves domain bytes unchanged when the durable journal write fails", async () => {
    const { storage, snapshot } = await seededWorkspace([
      { projectId: PROJECT_A, state: fictionalState("alpha") },
    ]);
    storage.faults.armAtCheckpoint(
      `before:setItem:${WORKSPACE_OPERATION_KEY}`,
      "security",
    );
    const indexBefore = storage.getItem(WORKSPACE_INDEX_KEY);

    const created = await createWorkspaceProject(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(snapshot),
        state: fictionalState("journal-failure"),
        intentStillCurrent: () => true,
        pendingSavesDrained: () => true,
        uuidSource: new SequenceUuidSource([PROJECT_C, OPERATION_D]),
      },
    );

    expect(created).toEqual({ ok: false, reason: "storage-error" });
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBe(indexBefore);
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    expect(storage.getItem(workspaceProjectRecordKey(WS, 1, PROJECT_C))).toBeNull();
  });

  it("leaves a classifiable journal when index commit fails after the project write", async () => {
    const { storage, snapshot } = await seededWorkspace([
      { projectId: PROJECT_A, state: fictionalState("alpha") },
    ]);
    storage.faults.armAtCheckpoint(
      `before:setItem:${WORKSPACE_INDEX_KEY}`,
      "security",
    );

    const created = await createWorkspaceProject(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(snapshot),
        state: fictionalState("index-failure"),
        intentStillCurrent: () => true,
        pendingSavesDrained: () => true,
        uuidSource: new SequenceUuidSource([PROJECT_C, OPERATION_D]),
      },
    );

    expect(created).toEqual({ ok: false, reason: "commit-incomplete" });
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBe(snapshot.indexRaw);
    expect(storage.getItem(workspaceProjectRecordKey(WS, 1, PROJECT_C))).not.toBeNull();
    const journal = storage.getItem(WORKSPACE_OPERATION_KEY);
    expect(journal).not.toBeNull();
    if (journal === null) return;
    await expect(classifyWorkspaceRecovery(storage, journal)).resolves.toMatchObject({
      status: "roll-forward",
      kind: "create-project",
    });
  });

  it("retains a classifiable completed journal when exact removal fails", async () => {
    const { storage, snapshot } = await seededWorkspace([
      { projectId: PROJECT_A, state: fictionalState("alpha") },
    ]);
    storage.faults.armAtCheckpoint(
      `before:removeItem:${WORKSPACE_OPERATION_KEY}`,
      "security",
    );

    const created = await createWorkspaceProject(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(snapshot),
        state: fictionalState("journal-removal-failure"),
        intentStillCurrent: () => true,
        pendingSavesDrained: () => true,
        uuidSource: new SequenceUuidSource([PROJECT_C, OPERATION_D]),
      },
    );

    expect(created).toEqual({ ok: false, reason: "commit-incomplete" });
    const committedIndex = storage.getItem(WORKSPACE_INDEX_KEY);
    expect(committedIndex).not.toBe(snapshot.indexRaw);
    const journal = storage.getItem(WORKSPACE_OPERATION_KEY);
    expect(journal).not.toBeNull();
    if (journal === null) return;
    await expect(classifyWorkspaceRecovery(storage, journal)).resolves.toMatchObject({
      status: "complete",
      kind: "create-project",
    });
  });

  it("fails after eight in-lock project-ID collisions without creating a journal", async () => {
    const { storage, snapshot } = await seededWorkspace([
      { projectId: PROJECT_A, state: fictionalState("alpha") },
    ]);
    const indexBefore = storage.getItem(WORKSPACE_INDEX_KEY);

    const created = await createWorkspaceProject(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(snapshot),
        state: fictionalState("collided"),
        intentStillCurrent: () => true,
        pendingSavesDrained: () => true,
        uuidSource: new SequenceUuidSource(Array(8).fill(PROJECT_A)),
      },
    );

    expect(created).toEqual({
      ok: false,
      reason: "id-unavailable-or-collided",
    });
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBe(indexBefore);
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
  });

  it("collision-checks project IDs added while the request waits for the lock", async () => {
    const { storage, snapshot } = await seededWorkspace([
      { projectId: PROJECT_A, state: fictionalState("alpha") },
    ]);

    const created = await createWorkspaceProject(
      storage,
      new BeforeOperationLockRunner(() => {
        storage.setItem(
          workspaceProjectRecordKey(WS_OTHER, 2, PROJECT_C),
          "fictional-quarantined-collision",
        );
      }),
      {
        baseline: workspaceIndexBaseline(snapshot),
        state: fictionalState("collision-retry"),
        intentStillCurrent: () => true,
        pendingSavesDrained: () => true,
        uuidSource: new SequenceUuidSource([
          PROJECT_C,
          PROJECT_D,
          OPERATION_E,
        ]),
      },
    );

    expect(created).toMatchObject({ ok: true, projectId: PROJECT_D });
  });

  it("fails closed before growth when Web Locks are unavailable", async () => {
    const { storage, snapshot } = await seededWorkspace([
      { projectId: PROJECT_A, state: fictionalState("alpha") },
    ]);
    const before = storage.snapshot();

    const created = await createWorkspaceProject(storage, null, {
      baseline: workspaceIndexBaseline(snapshot),
      state: fictionalState("no-web-locks"),
      intentStillCurrent: () => true,
      pendingSavesDrained: () => true,
      uuidSource: new SequenceUuidSource([PROJECT_C, OPERATION_D]),
    });

    expect(created).toEqual({ ok: false, reason: "lock-unavailable" });
    expect(storage.snapshot()).toEqual(before);
  });

  it("rejects a stale creation intent before writing the operation journal", async () => {
    const { storage, snapshot } = await seededWorkspace([
      { projectId: PROJECT_A, state: fictionalState("alpha") },
    ]);
    const before = storage.snapshot();

    const created = await createWorkspaceProject(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(snapshot),
        state: fictionalState("stale-create"),
        intentStillCurrent: () => false,
        pendingSavesDrained: () => true,
        uuidSource: new SequenceUuidSource([PROJECT_C, OPERATION_D]),
      },
    );

    expect(created).toEqual({ ok: false, reason: "intent-stale" });
    expect(storage.snapshot()).toEqual(before);
  });

  it("cancels the exact journal when creation intent becomes stale during preparation", async () => {
    const { storage, snapshot } = await seededWorkspace([
      { projectId: PROJECT_A, state: fictionalState("alpha") },
    ]);
    const before = storage.snapshot();
    let checks = 0;

    const created = await createWorkspaceProject(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(snapshot),
        state: fictionalState("stale-after-journal"),
        intentStillCurrent: () => {
          checks += 1;
          return checks === 1;
        },
        pendingSavesDrained: () => true,
        uuidSource: new SequenceUuidSource([PROJECT_C, OPERATION_D]),
      },
    );

    expect(created).toEqual({ ok: false, reason: "intent-stale" });
    expect(checks).toBe(2);
    expect(storage.snapshot()).toEqual(before);
  });

  it("keeps a valid prepared journal when stale-intent cancellation cannot be verified", async () => {
    const { storage, snapshot } = await seededWorkspace([
      { projectId: PROJECT_A, state: fictionalState("alpha") },
    ]);
    let checks = 0;
    storage.faults.armAtCheckpoint(
      `before:removeItem:${WORKSPACE_OPERATION_KEY}`,
      "security",
    );

    const created = await createWorkspaceProject(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(snapshot),
        state: fictionalState("stale-cancel-failure"),
        intentStillCurrent: () => {
          checks += 1;
          return checks === 1;
        },
        pendingSavesDrained: () => true,
        uuidSource: new SequenceUuidSource([PROJECT_C, OPERATION_D]),
      },
    );

    expect(created).toEqual({ ok: false, reason: "commit-incomplete" });
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBe(snapshot.indexRaw);
    expect(storage.getItem(workspaceProjectRecordKey(WS, 1, PROJECT_C))).toBeNull();
    const journal = storage.getItem(WORKSPACE_OPERATION_KEY);
    expect(journal).not.toBeNull();
    if (journal === null) return;
    await expect(classifyWorkspaceRecovery(storage, journal)).resolves.toMatchObject({
      status: "cancel-or-roll-forward",
      kind: "create-project",
    });
  });
});
