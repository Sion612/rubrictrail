import { describe, expect, it } from "vitest";
import { createDefaultProjectState } from "@/lib/local-state";
import {
  readWorkspaceAuthority,
  saveWorkspaceProject,
  workspaceIndexBaseline,
  workspaceProjectBaseline,
  type WorkspaceAuthoritySnapshot,
  type WorkspaceExclusiveLockRunner,
} from "@/lib/workspace-storage/coordinator";
import { sha256StoredString } from "@/lib/workspace-storage/digest";
import {
  cleanupWorkspaceLegacyData,
  deleteEntireWorkspace,
  deleteWorkspaceProject,
  inspectWorkspaceRecoveryPrivacyPurge,
  purgeWorkspaceRecoveryData,
  replaceWorkspaceProject,
  resumeWorkspaceLifecycleOperation,
} from "@/lib/workspace-storage/lifecycle";
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
  parseWorkspaceIndex,
  serializeWorkspaceIndex,
  serializeWorkspacePreferences,
  serializeWorkspaceProjectRecord,
} from "@/lib/workspace-storage/protocol";
import { classifyWorkspaceRecovery } from "@/lib/workspace-storage/recovery";
import { CANONICAL_WORKSPACE_RESERVE } from "@/lib/workspace-storage/reserve";
import { MemoryWorkspaceStorageAdapter } from "@/lib/workspace-storage/storage-adapter";
import {
  activeIndex,
  activeProjectRecord,
  NULL_LEGACY_FINGERPRINTS,
  PROJECT_A,
  PROJECT_B,
  WS,
  WS_OTHER,
} from "@/lib/workspace-storage/test-fixtures";
import type {
  WorkspaceIndexEntryV1,
  WorkspaceIndexV1,
  WorkspaceLegacyFingerprints,
  WorkspaceProjectRecordV1,
} from "@/lib/workspace-storage/types";
import type { PersistedProjectState } from "@/lib/ui-types";

const OPERATION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PROJECT_C = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const RECOVERY_WORKSPACE_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const LOCALE_KEY = "rubrictrail.locale";
const UNRELATED_KEY = "fictional.unrelated.preference";

class ImmediateWorkspaceLockRunner implements WorkspaceExclusiveLockRunner {
  runExclusive<T>(_name: string, operation: () => Promise<T>): Promise<T> {
    return operation();
  }
}

class SequenceUuidSource implements SecureUuidSource {
  constructor(private readonly values: string[]) {}

  randomUUID(): string {
    const value = this.values.shift();
    if (!value) throw new Error("No fictional UUID remains");
    return value;
  }
}

class StaleLegacyRewriteStorage extends MemoryWorkspaceStorageAdapter {
  private fired = false;

  override removeItem(key: string): void {
    super.removeItem(key);
    if (!this.fired && key === LEGACY_PROJECT_KEYS.record) {
      this.fired = true;
      super.setItem(
        LEGACY_PROJECT_KEYS.v3,
        JSON.stringify({ fictional: "stale v0.7 rewrite" }),
      );
    }
  }
}

class ProjectCleanupThirdValueStorage extends MemoryWorkspaceStorageAdapter {
  private fired = false;

  constructor(
    initialValues: Readonly<Record<string, string>>,
    private readonly firstKey: string,
    private readonly changedKey: string,
  ) {
    super(initialValues);
  }

  override removeItem(key: string): void {
    super.removeItem(key);
    if (!this.fired && key === this.firstKey) {
      this.fired = true;
      super.setItem(this.changedKey, "third-value-owned-project-bytes");
    }
  }
}

class FinalBaselineAuthorizationFlipStorage extends MemoryWorkspaceStorageAdapter {
  private journalDurable = false;
  private domainReadsAfterJournal = 0;
  private flipped = false;

  constructor(
    initialValues: Readonly<Record<string, string>>,
    private readonly firstDomainKey: string,
    private readonly flipAuthorization: () => void,
  ) {
    super(initialValues);
  }

  override setItem(key: string, value: string): void {
    super.setItem(key, value);
    if (key === WORKSPACE_OPERATION_KEY) this.journalDurable = true;
  }

  override getItem(key: string): string | null {
    const value = super.getItem(key);
    if (this.journalDurable && key === this.firstDomainKey && !this.flipped) {
      this.domainReadsAfterJournal += 1;
      if (this.domainReadsAfterJournal === 2) {
        this.flipped = true;
        this.flipAuthorization();
      }
    }
    return value;
  }
}

class JournalReadbackDropStorage extends MemoryWorkspaceStorageAdapter {
  private dropped = false;

  override setItem(key: string, value: string): void {
    super.setItem(key, value);
    if (!this.dropped && key === WORKSPACE_OPERATION_KEY) {
      this.dropped = true;
      super.removeItem(key);
    }
  }
}

class CancellationFinalAwaitTargetWriteStorage extends MemoryWorkspaceStorageAdapter {
  private cancellationArmed = false;
  private journalReads = 0;
  private injected = false;

  constructor(
    initialValues: Readonly<Record<string, string>>,
    private readonly targetKey: string,
    private readonly targetValue: string,
  ) {
    super(initialValues);
  }

  armCancellation(): void {
    this.cancellationArmed = true;
  }

  override getItem(key: string): string | null {
    const value = super.getItem(key);
    if (
      this.cancellationArmed &&
      !this.injected &&
      key === WORKSPACE_OPERATION_KEY
    ) {
      this.journalReads += 1;
      if (this.journalReads === 3) {
        this.injected = true;
        super.setItem(this.targetKey, this.targetValue);
      }
    }
    return value;
  }
}

class RecoveryAuthorityRestoringStorage extends MemoryWorkspaceStorageAdapter {
  private journalDurable = false;
  private indexReadsAfterJournal = 0;
  private restored = false;

  constructor(
    initialValues: Readonly<Record<string, string>>,
    private readonly restoredKey: string,
    private readonly restoredValue: string,
  ) {
    super(initialValues);
  }

  override setItem(key: string, value: string): void {
    super.setItem(key, value);
    if (key === WORKSPACE_OPERATION_KEY) this.journalDurable = true;
  }

  override getItem(key: string): string | null {
    const value = super.getItem(key);
    if (this.journalDurable && !this.restored && key === WORKSPACE_INDEX_KEY) {
      this.indexReadsAfterJournal += 1;
      if (this.indexReadsAfterJournal === 2) {
        this.restored = true;
        super.setItem(this.restoredKey, this.restoredValue);
      }
    }
    return value;
  }
}

function fictionalState(label: string): PersistedProjectState {
  return {
    ...createDefaultProjectState(),
    projectKind: "sample",
    weeklyHours: label.length + 5,
    targetGrade: 65 + label.length,
    draftText: `Fictional ${label} draft`,
  };
}

async function legacyFingerprints(
  values: Partial<Record<keyof WorkspaceLegacyFingerprints, string>>,
): Promise<WorkspaceLegacyFingerprints> {
  const result: WorkspaceLegacyFingerprints = {
    ...NULL_LEGACY_FINGERPRINTS,
  };
  for (const name of ["record", "v3", "v2", "v1"] as const) {
    const raw = values[name];
    if (raw === undefined) continue;
    const digest = await sha256StoredString(raw);
    if (!digest.ok) throw new Error("Fictional legacy digest unavailable");
    result[name] = digest.digest;
  }
  return result;
}

interface SeedProject {
  projectId: string;
  state?: PersistedProjectState;
  kind?: "active" | "tombstone";
  revision?: number;
}

async function seedValues(
  projects: readonly SeedProject[],
  options: {
    legacy?: Partial<Record<keyof WorkspaceLegacyFingerprints, string>>;
    extra?: Readonly<Record<string, string>>;
    indexOverrides?: Partial<WorkspaceIndexV1>;
  } = {},
): Promise<Record<string, string>> {
  const entries: WorkspaceIndexEntryV1[] = projects.map((project) => ({
    projectId: project.projectId,
    kind: project.kind ?? "active",
  }));
  const fingerprints = await legacyFingerprints(options.legacy ?? {});
  const index = serializeWorkspaceIndex(
    activeIndex({
      projects: entries,
      legacyFingerprints: fingerprints,
      ...options.indexOverrides,
    }),
  );
  if (!index.ok) throw new Error("Fictional workspace index invalid");
  const values: Record<string, string> = {
    [WORKSPACE_INDEX_KEY]: index.serialized,
    [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
    ...options.extra,
  };
  for (const project of projects) {
    const record: WorkspaceProjectRecordV1 = {
      ...activeProjectRecord(project.projectId),
      revision: project.revision ?? 1,
      value:
        (project.kind ?? "active") === "active"
          ? {
              kind: "project",
              state: project.state ?? fictionalState(project.projectId),
            }
          : { kind: "tombstone" },
    };
    const serialized = serializeWorkspaceProjectRecord(record);
    if (!serialized.ok) throw new Error("Fictional project record invalid");
    values[
      workspaceProjectRecordKey(
        index.value.workspaceId,
        index.value.workspaceGeneration,
        project.projectId,
      )
    ] = serialized.serialized;
  }
  for (const [name, raw] of Object.entries(options.legacy ?? {}) as Array<
    [keyof WorkspaceLegacyFingerprints, string]
  >) {
    values[LEGACY_PROJECT_KEYS[name]] = raw;
  }
  return values;
}

async function seededWorkspace(
  projects: readonly SeedProject[] = [
    { projectId: PROJECT_A, state: fictionalState("alpha") },
    { projectId: PROJECT_B, state: fictionalState("beta") },
  ],
  options: Parameters<typeof seedValues>[1] = {},
): Promise<{
  storage: MemoryWorkspaceStorageAdapter;
  snapshot: WorkspaceAuthoritySnapshot;
}> {
  const storage = new MemoryWorkspaceStorageAdapter(
    await seedValues(projects, options),
  );
  const authority = await readWorkspaceAuthority(storage);
  if (!authority.ok) throw new Error(`Seed authority failed: ${authority.reason}`);
  return { storage, snapshot: authority.snapshot };
}

function operationSource(): SecureUuidSource {
  return new SequenceUuidSource([OPERATION_ID]);
}

function activeState(
  snapshot: WorkspaceAuthoritySnapshot,
  projectId: string,
): PersistedProjectState {
  const project = snapshot.projects.find(
    (candidate) => candidate.record.projectId === projectId,
  );
  if (!project || project.record.value.kind !== "project") {
    throw new Error("Expected fictional active project");
  }
  return project.record.value.state;
}

function projectRaw(snapshot: WorkspaceAuthoritySnapshot, projectId: string): string {
  const project = snapshot.projects.find(
    (candidate) => candidate.record.projectId === projectId,
  );
  if (!project) throw new Error("Expected fictional project record");
  return project.raw;
}

function liveRequest() {
  return {
    intentStillCurrent: () => true,
    pendingSavesDrained: () => true,
    uuidSource: operationSource(),
  };
}

function generatedProjectId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

describe("dormant destructive workspace lifecycle", () => {
  it("fails closed without the global workspace Web Lock", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const baseline = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional project baseline");
    const before = storage.snapshot();

    const result = await deleteWorkspaceProject(storage, null, {
      baseline,
      ...liveRequest(),
    });

    expect(result).toEqual({ ok: false, reason: "lock-unavailable" });
    expect(storage.snapshot()).toEqual(before);
  });

  it("replaces only the selected project and preserves identity, index, and sibling bytes", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const baseline = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional project baseline");
    const siblingBefore = projectRaw(snapshot, PROJECT_B);

    const result = await replaceWorkspaceProject(
      storage,
      new ImmediateWorkspaceLockRunner(),
      {
        baseline,
        backup: { state: fictionalState("replacement") },
        ...liveRequest(),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.indexRaw).toBe(snapshot.indexRaw);
    expect(result.snapshot.index.revision).toBe(snapshot.index.revision);
    expect(projectRaw(result.snapshot, PROJECT_B)).toBe(siblingBefore);
    expect(activeState(result.snapshot, PROJECT_A).draftText).toBe(
      "Fictional replacement draft",
    );
    expect(
      result.snapshot.projects.find(
        (project) => project.record.projectId === PROJECT_A,
      )?.record.revision,
    ).toBe(2);
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    expect(storage.getItem(WORKSPACE_RESERVE_KEY)).toBe(
      CANONICAL_WORKSPACE_RESERVE,
    );
  });

  it("commits a verified non-growing replacement with an absent reserve and reports failed recreation", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const baseline = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional project baseline");
    const compactState = {
      ...activeState(snapshot, PROJECT_A),
      draftText: "x",
    };
    storage.removeItem(WORKSPACE_RESERVE_KEY);
    storage.faults.armAtCheckpoint(
      `before:setItem:${WORKSPACE_RESERVE_KEY}`,
      "quota",
    );

    const result = await replaceWorkspaceProject(
      storage,
      new ImmediateWorkspaceLockRunner(),
      {
        baseline,
        backup: { state: compactState },
        ...liveRequest(),
      },
    );

    expect(result).toEqual(
      expect.objectContaining({ ok: true, storageProtection: "degraded" }),
    );
    if (!result.ok) return;
    expect(activeState(result.snapshot, PROJECT_A).draftText).toBe("x");
    expect(result.snapshot.indexRaw).toBe(snapshot.indexRaw);
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    expect(storage.getItem(WORKSPACE_RESERVE_KEY)).toBeNull();
  });

  it("leaves project and index exact when an absent-reserve replacement journal hits quota", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const baseline = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional project baseline");
    const beforeProject = projectRaw(snapshot, PROJECT_A);
    const projectKey = snapshot.projects.find(
      (project) => project.record.projectId === PROJECT_A,
    )?.key;
    if (!projectKey) throw new Error("Missing fictional project key");
    storage.removeItem(WORKSPACE_RESERVE_KEY);
    storage.faults.armAtCheckpoint(
      `before:setItem:${WORKSPACE_OPERATION_KEY}`,
      "quota",
    );

    const result = await replaceWorkspaceProject(
      storage,
      new ImmediateWorkspaceLockRunner(),
      {
        baseline,
        backup: {
          state: { ...activeState(snapshot, PROJECT_A), draftText: "x" },
        },
        ...liveRequest(),
      },
    );

    expect(result).toEqual({ ok: false, reason: "storage-error" });
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBe(snapshot.indexRaw);
    expect(storage.getItem(projectKey)).toBe(beforeProject);
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
  });

  it("leaves project and index exact when an absent-reserve journal fails readback", async () => {
    const values = await seedValues([
      { projectId: PROJECT_A, state: fictionalState("alpha") },
      { projectId: PROJECT_B, state: fictionalState("beta") },
    ]);
    delete values[WORKSPACE_RESERVE_KEY];
    const storage = new JournalReadbackDropStorage(values);
    const authority = await readWorkspaceAuthority(storage);
    if (!authority.ok) throw new Error("Fictional authority unavailable");
    const baseline = workspaceProjectBaseline(authority.snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional project baseline");
    const before = storage.snapshot();

    const result = await replaceWorkspaceProject(
      storage,
      new ImmediateWorkspaceLockRunner(),
      {
        baseline,
        backup: {
          state: {
            ...activeState(authority.snapshot, PROJECT_A),
            draftText: "x",
          },
        },
        ...liveRequest(),
      },
    );

    expect(result).toEqual({ ok: false, reason: "storage-error" });
    expect(storage.snapshot()).toEqual(before);
  });

  it("rejects an absent-reserve exception when the reserve contains malformed bytes", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const baseline = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional project baseline");
    storage.setItem(WORKSPACE_RESERVE_KEY, "malformed-reserve");
    const before = storage.snapshot();

    const result = await replaceWorkspaceProject(
      storage,
      new ImmediateWorkspaceLockRunner(),
      {
        baseline,
        backup: {
          state: { ...activeState(snapshot, PROJECT_A), draftText: "x" },
        },
        ...liveRequest(),
      },
    );

    expect(result).toEqual({ ok: false, reason: "reserve-degraded" });
    expect(storage.snapshot()).toEqual(before);
  });

  it("keeps the journal when an absent-reserve replacement target becomes a third value", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const baseline = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional project baseline");
    const project = snapshot.projects.find(
      (candidate) => candidate.record.projectId === PROJECT_A,
    );
    if (!project) throw new Error("Missing fictional project");
    const third = serializeWorkspaceProjectRecord({
      ...project.record,
      revision: 2,
      value: { kind: "project", state: fictionalState("third value") },
    });
    if (!third.ok) throw new Error("Invalid fictional third value");
    storage.removeItem(WORKSPACE_RESERVE_KEY);
    let intentChecks = 0;

    const result = await replaceWorkspaceProject(
      storage,
      new ImmediateWorkspaceLockRunner(),
      {
        baseline,
        backup: {
          state: { ...activeState(snapshot, PROJECT_A), draftText: "x" },
        },
        intentStillCurrent: () => {
          intentChecks += 1;
          if (intentChecks === 2) storage.setItem(project.key, third.serialized);
          return intentChecks === 1;
        },
        pendingSavesDrained: () => true,
        uuidSource: operationSource(),
      },
    );

    expect(result).toEqual({ ok: false, reason: "commit-incomplete" });
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBe(snapshot.indexRaw);
    expect(storage.getItem(project.key)).toBe(third.serialized);
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).not.toBeNull();
  });

  it("cancels a replacement whose confirmed intent becomes stale before mutation", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const baseline = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional project baseline");
    let checks = 0;

    const result = await replaceWorkspaceProject(
      storage,
      new ImmediateWorkspaceLockRunner(),
      {
        baseline,
        backup: { state: fictionalState("stale replacement") },
        intentStillCurrent: () => {
          checks += 1;
          return checks === 1;
        },
        pendingSavesDrained: () => true,
        uuidSource: operationSource(),
      },
    );

    expect(result).toEqual({ ok: false, reason: "intent-stale" });
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBe(snapshot.indexRaw);
    expect(storage.getItem(snapshot.projects[0].key)).toBe(
      snapshot.projects[0].raw,
    );
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    expect(storage.getItem(WORKSPACE_RESERVE_KEY)).toBe(
      CANONICAL_WORKSPACE_RESERVE,
    );
    const authority = await readWorkspaceAuthority(storage);
    expect(authority.ok && activeState(authority.snapshot, PROJECT_A).draftText).toBe(
      "Fictional alpha draft",
    );
  });

  it("leaves a journal and refuses cancellation when a post-confirmation edit creates a third value", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const baseline = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional project baseline");
    const third = serializeWorkspaceProjectRecord({
      ...activeProjectRecord(PROJECT_A),
      revision: 2,
      value: { kind: "project", state: fictionalState("concurrent edit") },
    });
    if (!third.ok) throw new Error("Invalid fictional third value");
    const targetKey = snapshot.projects.find(
      (project) => project.record.projectId === PROJECT_A,
    )?.key;
    if (!targetKey) throw new Error("Missing fictional project key");
    let checks = 0;

    const result = await replaceWorkspaceProject(
      storage,
      new ImmediateWorkspaceLockRunner(),
      {
        baseline,
        backup: { state: fictionalState("replacement") },
        intentStillCurrent: () => {
          checks += 1;
          if (checks === 2) storage.setItem(targetKey, third.serialized);
          return checks === 1;
        },
        pendingSavesDrained: () => true,
        uuidSource: operationSource(),
      },
    );

    expect(result).toEqual({ ok: false, reason: "commit-incomplete" });
    const rawJournal = storage.getItem(WORKSPACE_OPERATION_KEY);
    expect(rawJournal).not.toBeNull();
    if (rawJournal === null) return;
    const recovery = await classifyWorkspaceRecovery(storage, rawJournal);
    expect(recovery.status).toBe("quarantine");
    if (recovery.status === "quarantine") {
      expect(recovery.reason).toBe("third-value");
    }
  });

  it("deletes the final project into an active empty workspace with a content-free tombstone", async () => {
    const { storage, snapshot } = await seededWorkspace([
      { projectId: PROJECT_A, state: fictionalState("alpha") },
    ]);
    const baseline = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional project baseline");
    const preference = serializeWorkspacePreferences({
      formatVersion: 1,
      workspaceId: WS,
      workspaceGeneration: 1,
      lastOpenedProjectId: PROJECT_A,
    });
    if (!preference.ok) throw new Error("Invalid fictional preference");
    storage.setItem(WORKSPACE_PREFERENCES_KEY, preference.serialized);

    const result = await deleteWorkspaceProject(
      storage,
      new ImmediateWorkspaceLockRunner(),
      { baseline, ...liveRequest() },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.index.status).toBe("active");
    expect(result.snapshot.index.projects).toEqual([
      { projectId: PROJECT_A, kind: "tombstone" },
    ]);
    expect(
      result.snapshot.projects[0]?.record.value,
    ).toEqual({ kind: "tombstone" });
    expect(result.snapshot.projects[0]?.raw).not.toContain("Fictional alpha draft");
    expect(storage.getItem(WORKSPACE_PREFERENCES_KEY)).toBeNull();

    const staleSave = await saveWorkspaceProject(
      storage,
      new ImmediateWorkspaceLockRunner(),
      {
        baseline,
        nextState: fictionalState("stale resurrection"),
        intentStillCurrent: () => true,
      },
    );
    expect(staleSave).toEqual({ ok: false, reason: "workspace-conflict" });
  });

  it("blocks destructive work while a pending save is not drained", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const baseline = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional project baseline");
    const before = storage.snapshot();

    const result = await deleteWorkspaceProject(
      storage,
      new ImmediateWorkspaceLockRunner(),
      {
        baseline,
        intentStillCurrent: () => true,
        pendingSavesDrained: () => false,
        uuidSource: operationSource(),
      },
    );

    expect(result).toEqual({ ok: false, reason: "pending-save" });
    expect(storage.snapshot()).toEqual(before);
  });

  it("recreates the reserve and leaves authority exact when journal creation fails", async () => {
    const { storage, snapshot } = await seededWorkspace([
      { projectId: PROJECT_A, state: fictionalState("alpha") },
    ]);
    const baseline = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional project baseline");
    const beforeIndex = snapshot.indexRaw;
    const beforeProject = snapshot.projects[0].raw;
    storage.faults.armAtCheckpoint(
      `before:setItem:${WORKSPACE_OPERATION_KEY}`,
      "quota",
    );

    const result = await deleteWorkspaceProject(
      storage,
      new ImmediateWorkspaceLockRunner(),
      { baseline, ...liveRequest() },
    );

    expect(result).toEqual({ ok: false, reason: "storage-error" });
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBe(beforeIndex);
    expect(storage.getItem(snapshot.projects[0].key)).toBe(beforeProject);
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    expect(storage.getItem(WORKSPACE_RESERVE_KEY)).toBe(
      CANONICAL_WORKSPACE_RESERVE,
    );
  });

  it("cancels when intent changes during the final awaited project baseline read", async () => {
    const values = await seedValues([
      { projectId: PROJECT_A, state: fictionalState("alpha") },
      { projectId: PROJECT_B, state: fictionalState("beta") },
    ]);
    const projectKey = workspaceProjectRecordKey(WS, 1, PROJECT_A);
    let intentCurrent = true;
    const storage = new FinalBaselineAuthorizationFlipStorage(
      values,
      projectKey,
      () => {
        intentCurrent = false;
      },
    );
    const authority = await readWorkspaceAuthority(storage);
    if (!authority.ok) throw new Error("Fictional authority unavailable");
    const baseline = workspaceProjectBaseline(authority.snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional project baseline");
    const before = storage.snapshot();

    const result = await deleteWorkspaceProject(
      storage,
      new ImmediateWorkspaceLockRunner(),
      {
        baseline,
        intentStillCurrent: () => intentCurrent,
        pendingSavesDrained: () => true,
        uuidSource: operationSource(),
      },
    );

    expect(result).toEqual({ ok: false, reason: "intent-stale" });
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBe(before[WORKSPACE_INDEX_KEY]);
    expect(storage.getItem(projectKey)).toBe(before[projectKey]);
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    expect(storage.getItem(WORKSPACE_RESERVE_KEY)).toBe(
      CANONICAL_WORKSPACE_RESERVE,
    );
  });

  it("cancels when pending work appears during the final awaited cleanup-index baseline read", async () => {
    const legacy = {
      record: JSON.stringify({ fictional: "record" }),
      v3: JSON.stringify({ fictional: "v3" }),
      v2: JSON.stringify({ fictional: "v2" }),
      v1: JSON.stringify({ fictional: "v1" }),
    };
    const values = await seedValues(
      [{ projectId: PROJECT_A, state: fictionalState("alpha") }],
      { legacy },
    );
    let pendingDrained = true;
    const storage = new FinalBaselineAuthorizationFlipStorage(
      values,
      WORKSPACE_INDEX_KEY,
      () => {
        pendingDrained = false;
      },
    );
    const authority = await readWorkspaceAuthority(storage);
    if (!authority.ok) throw new Error("Fictional authority unavailable");
    const before = storage.snapshot();

    const result = await cleanupWorkspaceLegacyData(
      storage,
      new ImmediateWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(authority.snapshot),
        intentStillCurrent: () => true,
        pendingSavesDrained: () => pendingDrained,
        uuidSource: operationSource(),
      },
    );

    expect(result).toEqual({ ok: false, reason: "pending-save" });
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBe(before[WORKSPACE_INDEX_KEY]);
    expect(storage.getItem(authority.snapshot.projects[0].key)).toBe(
      before[authority.snapshot.projects[0].key],
    );
    for (const name of LEGACY_NAMES_FOR_TEST) {
      expect(storage.getItem(LEGACY_PROJECT_KEYS[name])).toBe(
        before[LEGACY_PROJECT_KEYS[name]],
      );
    }
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    expect(storage.getItem(WORKSPACE_RESERVE_KEY)).toBe(
      CANONICAL_WORKSPACE_RESERVE,
    );
  });

  it("keeps recovery journal when a tombstone appears during cancellation's final awaited read", async () => {
    const values = await seedValues([
      { projectId: PROJECT_A, state: fictionalState("alpha") },
    ]);
    const initialStorage = new MemoryWorkspaceStorageAdapter(values);
    const initialAuthority = await readWorkspaceAuthority(initialStorage);
    if (!initialAuthority.ok) throw new Error("Fictional authority unavailable");
    const project = initialAuthority.snapshot.projects[0];
    const tombstone = serializeWorkspaceProjectRecord({
      ...project.record,
      revision: project.record.revision + 1,
      value: { kind: "tombstone" },
    });
    if (!tombstone.ok) throw new Error("Invalid fictional tombstone");
    const storage = new CancellationFinalAwaitTargetWriteStorage(
      values,
      project.key,
      tombstone.serialized,
    );
    const authority = await readWorkspaceAuthority(storage);
    if (!authority.ok) throw new Error("Fictional authority unavailable");
    const baseline = workspaceProjectBaseline(authority.snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional project baseline");
    let intentChecks = 0;

    const result = await deleteWorkspaceProject(
      storage,
      new ImmediateWorkspaceLockRunner(),
      {
        baseline,
        intentStillCurrent: () => {
          intentChecks += 1;
          if (intentChecks === 2) storage.armCancellation();
          return intentChecks === 1;
        },
        pendingSavesDrained: () => true,
        uuidSource: operationSource(),
      },
    );

    expect(result).toEqual({ ok: false, reason: "commit-incomplete" });
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBe(authority.snapshot.indexRaw);
    expect(storage.getItem(project.key)).toBe(tombstone.serialized);
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).not.toBeNull();
  });

  it("reports degraded protection without undoing a committed deletion when reserve recreation fails", async () => {
    const { storage, snapshot } = await seededWorkspace([
      { projectId: PROJECT_A, state: fictionalState("alpha") },
    ]);
    const baseline = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional project baseline");
    storage.faults.armAtCheckpoint(
      `before:setItem:${WORKSPACE_RESERVE_KEY}`,
      "security",
    );

    const result = await deleteWorkspaceProject(
      storage,
      new ImmediateWorkspaceLockRunner(),
      { baseline, ...liveRequest() },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.storageProtection).toBe("degraded");
    expect(result.snapshot.index.projects).toEqual([
      { projectId: PROJECT_A, kind: "tombstone" },
    ]);
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    expect(storage.getItem(WORKSPACE_RESERVE_KEY)).toBeNull();
  });
});

describe("legacy and whole-workspace cleanup", () => {
  const legacy = {
    record: JSON.stringify({ fictional: "record" }),
    v3: JSON.stringify({ fictional: "v3" }),
    v2: JSON.stringify({ fictional: "v2" }),
    v1: JSON.stringify({ fictional: "v1" }),
  };

  it("commits null fingerprints, removes legacy values in fixed order, and preserves project bytes", async () => {
    const { storage, snapshot } = await seededWorkspace(undefined, { legacy });
    const projectBefore = projectRaw(snapshot, PROJECT_A);
    storage.faults.clear();

    const result = await cleanupWorkspaceLegacyData(
      storage,
      new ImmediateWorkspaceLockRunner(),
      { baseline: workspaceIndexBaseline(snapshot), ...liveRequest() },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.index.revision).toBe(snapshot.index.revision + 1);
    expect(result.snapshot.index.legacyFingerprints).toEqual(
      NULL_LEGACY_FINGERPRINTS,
    );
    expect(projectRaw(result.snapshot, PROJECT_A)).toBe(projectBefore);
    expect(LEGACY_NAMES_FOR_TEST.map((name) => storage.getItem(LEGACY_PROJECT_KEYS[name]))).toEqual([
      null,
      null,
      null,
      null,
    ]);
    const removals = storage.faults
      .visitedCheckpoints()
      .filter((checkpoint) => checkpoint.startsWith("before:removeItem:"));
    expect(removals.slice(1, 5)).toEqual(
      LEGACY_NAMES_FOR_TEST.map(
        (name) => `before:removeItem:${LEGACY_PROJECT_KEYS[name]}`,
      ),
    );
    expect(storage.getItem(WORKSPACE_RESERVE_KEY)).toBe(
      CANONICAL_WORKSPACE_RESERVE,
    );
  });

  it("stops on a stale-v0.7 third value during partial legacy cleanup", async () => {
    const values = await seedValues(
      [
        { projectId: PROJECT_A, state: fictionalState("alpha") },
        { projectId: PROJECT_B, state: fictionalState("beta") },
      ],
      { legacy },
    );
    const storage = new StaleLegacyRewriteStorage(values);
    const authority = await readWorkspaceAuthority(storage);
    if (!authority.ok) throw new Error("Fictional authority unavailable");

    const result = await cleanupWorkspaceLegacyData(
      storage,
      new ImmediateWorkspaceLockRunner(),
      { baseline: workspaceIndexBaseline(authority.snapshot), ...liveRequest() },
    );

    expect(result).toEqual({ ok: false, reason: "commit-incomplete" });
    expect(storage.getItem(LEGACY_PROJECT_KEYS.record)).toBeNull();
    expect(storage.getItem(LEGACY_PROJECT_KEYS.v3)).toContain("stale v0.7 rewrite");
    expect(storage.getItem(LEGACY_PROJECT_KEYS.v2)).toBe(legacy.v2);
    const targetIndex = storage.getItem(WORKSPACE_INDEX_KEY);
    expect(targetIndex).not.toBeNull();
    if (targetIndex === null) return;
    const parsedIndex = parseWorkspaceIndex(targetIndex);
    expect(parsedIndex.ok && parsedIndex.value.legacyFingerprints).toEqual(
      NULL_LEGACY_FINGERPRINTS,
    );
    const rawJournal = storage.getItem(WORKSPACE_OPERATION_KEY);
    expect(rawJournal).not.toBeNull();
    if (rawJournal === null) return;
    expect((await classifyWorkspaceRecovery(storage, rawJournal)).status).toBe(
      "quarantine",
    );
  });

  it("clears every exact owned project and legacy value while preserving unrelated and locale keys", async () => {
    const orphanKey = workspaceProjectRecordKey(WS_OTHER, 7, PROJECT_C);
    const { storage, snapshot } = await seededWorkspace(undefined, {
      legacy,
      extra: {
        [orphanKey]: "invalid-but-exact-owned-project-bytes",
        [LOCALE_KEY]: "zh-CN",
        [UNRELATED_KEY]: "keep me",
      },
    });
    const preference = serializeWorkspacePreferences({
      formatVersion: 1,
      workspaceId: WS,
      workspaceGeneration: 1,
      lastOpenedProjectId: PROJECT_A,
    });
    if (!preference.ok) throw new Error("Invalid fictional preference");
    storage.setItem(WORKSPACE_PREFERENCES_KEY, preference.serialized);

    const result = await deleteEntireWorkspace(
      storage,
      new ImmediateWorkspaceLockRunner(),
      { baseline: workspaceIndexBaseline(snapshot), ...liveRequest() },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.index).toMatchObject({
      status: "cleared",
      workspaceGeneration: 2,
      revision: snapshot.index.revision + 1,
      projects: [],
      legacyFingerprints: NULL_LEGACY_FINGERPRINTS,
    });
    expect(
      storage.keys().filter((key) => key.includes(".project.")),
    ).toEqual([]);
    expect(LEGACY_NAMES_FOR_TEST.map((name) => storage.getItem(LEGACY_PROJECT_KEYS[name]))).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(storage.getItem(WORKSPACE_PREFERENCES_KEY)).toBeNull();
    expect(storage.getItem(LOCALE_KEY)).toBe("zh-CN");
    expect(storage.getItem(UNRELATED_KEY)).toBe("keep me");
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).not.toBeNull();
    expect(storage.getItem(WORKSPACE_RESERVE_KEY)).toBe(
      CANONICAL_WORKSPACE_RESERVE,
    );
  });

  it("keeps a third-value owned record and durable journal during partial workspace cleanup", async () => {
    const values = await seedValues(
      [
        { projectId: PROJECT_A, state: fictionalState("alpha") },
        { projectId: PROJECT_B, state: fictionalState("beta") },
      ],
      { legacy, extra: { [UNRELATED_KEY]: "keep me" } },
    );
    const firstKey = workspaceProjectRecordKey(WS, 1, PROJECT_A);
    const changedKey = workspaceProjectRecordKey(WS, 1, PROJECT_B);
    const storage = new ProjectCleanupThirdValueStorage(
      values,
      firstKey,
      changedKey,
    );
    const authority = await readWorkspaceAuthority(storage);
    if (!authority.ok) throw new Error("Fictional authority unavailable");

    const result = await deleteEntireWorkspace(
      storage,
      new ImmediateWorkspaceLockRunner(),
      { baseline: workspaceIndexBaseline(authority.snapshot), ...liveRequest() },
    );

    expect(result).toEqual({ ok: false, reason: "commit-incomplete" });
    expect(storage.getItem(firstKey)).toBeNull();
    expect(storage.getItem(changedKey)).toBe("third-value-owned-project-bytes");
    expect(storage.getItem(UNRELATED_KEY)).toBe("keep me");
    const indexRaw = storage.getItem(WORKSPACE_INDEX_KEY);
    expect(indexRaw).not.toBeNull();
    if (indexRaw === null) return;
    const index = parseWorkspaceIndex(indexRaw);
    expect(index.ok && index.value.status).toBe("cleared");
    const rawJournal = storage.getItem(WORKSPACE_OPERATION_KEY);
    expect(rawJournal).not.toBeNull();
    if (rawJournal === null) return;
    expect((await classifyWorkspaceRecovery(storage, rawJournal)).status).toBe(
      "quarantine",
    );
  });
});

const LEGACY_NAMES_FOR_TEST = ["record", "v3", "v2", "v1"] as const;

describe("deterministic lifecycle journal recovery", () => {
  it("rolls forward a recovery-only privacy purge with more than 200 exact owned records", async () => {
    const storage = new MemoryWorkspaceStorageAdapter({
      [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
      [WORKSPACE_PREFERENCES_KEY]: "invalid-recovery-preference",
      [LOCALE_KEY]: "zh-CN",
      [UNRELATED_KEY]: "keep me",
    });
    for (let index = 1; index <= 205; index += 1) {
      const key = workspaceProjectRecordKey(WS_OTHER, 7, generatedProjectId(index));
      const raw = `fictional-recovery-owned-${index}`;
      storage.setItem(key, raw);
    }
    const inspected = await inspectWorkspaceRecoveryPrivacyPurge(storage);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.baseline.ownedProjectDigests).toHaveLength(205);

    const resumed = await purgeWorkspaceRecoveryData(
      storage,
      new ImmediateWorkspaceLockRunner(),
      {
        baseline: inspected.baseline,
        intentStillCurrent: () => true,
        pendingSavesDrained: () => true,
        uuidSource: new SequenceUuidSource([
          OPERATION_ID,
          RECOVERY_WORKSPACE_ID,
        ]),
      },
    );

    expect(resumed).toEqual(expect.objectContaining({ ok: true }));
    if (!resumed.ok) return;
    expect(resumed.snapshot.index.status).toBe("cleared");
    expect(resumed.snapshot.index.workspaceGeneration).toBe(1);
    expect(resumed.snapshot.index.workspaceId).toBe(RECOVERY_WORKSPACE_ID);
    expect(storage.keys().filter((key) => key.includes(".project."))).toEqual([]);
    expect(storage.getItem(UNRELATED_KEY)).toBe("keep me");
    expect(storage.getItem(LOCALE_KEY)).toBe("zh-CN");
    expect(storage.getItem(WORKSPACE_PREFERENCES_KEY)).toBeNull();
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    expect(storage.getItem(WORKSPACE_RESERVE_KEY)).toBe(
      CANONICAL_WORKSPACE_RESERVE,
    );
  });

  it("refuses recovery-only purge inspection when strict authority exists", async () => {
    const { storage } = await seededWorkspace();

    await expect(inspectWorkspaceRecoveryPrivacyPurge(storage)).resolves.toEqual(
      { ok: false, reason: "recovery-not-eligible" },
    );
  });

  it("allows explicit recovery-only purge of an indexed active-none record", async () => {
    const projectKey = workspaceProjectRecordKey(WS, 1, PROJECT_A);
    const storage = new MemoryWorkspaceStorageAdapter(
      await seedValues([
        { projectId: PROJECT_A, state: createDefaultProjectState() },
      ]),
    );
    const inspected = await inspectWorkspaceRecoveryPrivacyPurge(storage);
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;

    const result = await purgeWorkspaceRecoveryData(
      storage,
      new ImmediateWorkspaceLockRunner(),
      {
        baseline: inspected.baseline,
        intentStillCurrent: () => true,
        pendingSavesDrained: () => true,
        uuidSource: new SequenceUuidSource([
          OPERATION_ID,
          RECOVERY_WORKSPACE_ID,
        ]),
      },
    );

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    if (!result.ok) return;
    expect(result.snapshot.index.status).toBe("cleared");
    expect(storage.getItem(projectKey)).toBeNull();
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
  });

  it("rejects a stale corrupt-index recovery preview without writing a journal", async () => {
    const ownedKey = workspaceProjectRecordKey(WS_OTHER, 4, PROJECT_C);
    const storage = new MemoryWorkspaceStorageAdapter({
      [WORKSPACE_INDEX_KEY]: "{\"corrupt\":true}",
      [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
      [ownedKey]: "fictional-original-owned-record",
    });
    const inspected = await inspectWorkspaceRecoveryPrivacyPurge(storage);
    if (!inspected.ok) throw new Error("Recovery purge preview unavailable");
    storage.setItem(ownedKey, "fictional-new-third-value");

    const result = await purgeWorkspaceRecoveryData(
      storage,
      new ImmediateWorkspaceLockRunner(),
      {
        baseline: inspected.baseline,
        intentStillCurrent: () => true,
        pendingSavesDrained: () => true,
        uuidSource: new SequenceUuidSource([
          OPERATION_ID,
          RECOVERY_WORKSPACE_ID,
        ]),
      },
    );

    expect(result).toEqual({ ok: false, reason: "workspace-conflict" });
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBe("{\"corrupt\":true}");
    expect(storage.getItem(ownedKey)).toBe("fictional-new-third-value");
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
  });

  it("cancels before clearing when a missing project is restored after the purge journal becomes durable", async () => {
    const values = await seedValues([
      { projectId: PROJECT_A, state: fictionalState("restored") },
    ]);
    const projectKey = workspaceProjectRecordKey(WS, 1, PROJECT_A);
    const projectRaw = values[projectKey];
    if (!projectRaw) throw new Error("Missing fictional project bytes");
    delete values[projectKey];
    const storage = new RecoveryAuthorityRestoringStorage(
      values,
      projectKey,
      projectRaw,
    );
    const inspected = await inspectWorkspaceRecoveryPrivacyPurge(storage);
    if (!inspected.ok) throw new Error("Recovery purge preview unavailable");
    const originalIndex = storage.getItem(WORKSPACE_INDEX_KEY);

    const result = await purgeWorkspaceRecoveryData(
      storage,
      new ImmediateWorkspaceLockRunner(),
      {
        baseline: inspected.baseline,
        intentStillCurrent: () => true,
        pendingSavesDrained: () => true,
        uuidSource: new SequenceUuidSource([
          OPERATION_ID,
          RECOVERY_WORKSPACE_ID,
        ]),
      },
    );

    expect(result).toEqual({ ok: false, reason: "workspace-conflict" });
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBe(originalIndex);
    expect(storage.getItem(projectKey)).toBe(projectRaw);
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    const authority = await readWorkspaceAuthority(storage);
    expect(authority.ok).toBe(true);
    if (authority.ok) expect(authority.snapshot.index.status).toBe("active");
  });

  it("resumes a recovery-only purge after its cleared-index commit checkpoint", async () => {
    const ownedKey = workspaceProjectRecordKey(WS_OTHER, 3, PROJECT_C);
    const storage = new MemoryWorkspaceStorageAdapter({
      [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
      [ownedKey]: "fictional-corrupt-owned-record",
    });
    const inspected = await inspectWorkspaceRecoveryPrivacyPurge(storage);
    if (!inspected.ok) throw new Error("Recovery purge preview unavailable");
    storage.faults.armAtCheckpoint("index-commit");

    const interrupted = await purgeWorkspaceRecoveryData(
      storage,
      new ImmediateWorkspaceLockRunner(),
      {
        baseline: inspected.baseline,
        intentStillCurrent: () => true,
        pendingSavesDrained: () => true,
        uuidSource: new SequenceUuidSource([
          OPERATION_ID,
          RECOVERY_WORKSPACE_ID,
        ]),
      },
    );
    expect(interrupted).toEqual({ ok: false, reason: "lock-failed" });
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).not.toBeNull();
    storage.faults.clear();

    const resumed = await resumeWorkspaceLifecycleOperation(
      storage,
      new ImmediateWorkspaceLockRunner(),
    );
    expect(resumed.ok).toBe(true);
    if (resumed.ok) expect(resumed.snapshot.index.status).toBe("cleared");
    expect(storage.getItem(ownedKey)).toBeNull();
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
  });

  it("cancels an unstarted replacement without needing the backup payload", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const baseline = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional project baseline");
    storage.faults.armAtCheckpoint("journal-phase-update");

    const interrupted = await replaceWorkspaceProject(
      storage,
      new ImmediateWorkspaceLockRunner(),
      {
        baseline,
        backup: { state: fictionalState("replacement") },
        ...liveRequest(),
      },
    );
    expect(interrupted).toEqual({ ok: false, reason: "lock-failed" });
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).not.toBeNull();

    storage.faults.clear();
    const resumed = await resumeWorkspaceLifecycleOperation(
      storage,
      new ImmediateWorkspaceLockRunner(),
    );
    expect(resumed.ok && resumed.changed).toBe(false);
    if (resumed.ok) {
      expect(activeState(resumed.snapshot, PROJECT_A).draftText).toBe(
        "Fictional alpha draft",
      );
    }
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    expect(storage.getItem(WORKSPACE_RESERVE_KEY)).toBe(
      CANONICAL_WORKSPACE_RESERVE,
    );
  });

  it("accepts an exact written replacement target and completes idempotently", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const baseline = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional project baseline");
    storage.faults.armAtCheckpoint("project-target-write");

    const interrupted = await replaceWorkspaceProject(
      storage,
      new ImmediateWorkspaceLockRunner(),
      {
        baseline,
        backup: { state: fictionalState("replacement") },
        ...liveRequest(),
      },
    );
    expect(interrupted).toEqual({ ok: false, reason: "lock-failed" });
    storage.faults.clear();

    const resumed = await resumeWorkspaceLifecycleOperation(
      storage,
      new ImmediateWorkspaceLockRunner(),
    );
    expect(resumed.ok).toBe(true);
    if (resumed.ok) {
      expect(activeState(resumed.snapshot, PROJECT_A).draftText).toBe(
        "Fictional replacement draft",
      );
    }
    const repeated = await resumeWorkspaceLifecycleOperation(
      storage,
      new ImmediateWorkspaceLockRunner(),
    );
    expect(repeated.ok && repeated.changed).toBe(false);
  });

  it("rolls forward a delete whose cleared index write was interrupted", async () => {
    const { storage, snapshot } = await seededWorkspace([
      { projectId: PROJECT_A, state: fictionalState("alpha") },
    ]);
    const baseline = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional project baseline");
    storage.faults.armAtCheckpoint("index-commit");

    const interrupted = await deleteWorkspaceProject(
      storage,
      new ImmediateWorkspaceLockRunner(),
      { baseline, ...liveRequest() },
    );
    expect(interrupted).toEqual({ ok: false, reason: "lock-failed" });
    storage.faults.clear();

    const resumed = await resumeWorkspaceLifecycleOperation(
      storage,
      new ImmediateWorkspaceLockRunner(),
    );
    expect(resumed.ok).toBe(true);
    if (resumed.ok) {
      expect(resumed.snapshot.index.status).toBe("active");
      expect(resumed.snapshot.index.projects).toEqual([
        { projectId: PROJECT_A, kind: "tombstone" },
      ]);
    }
  });

  it("resumes partial exact legacy cleanup and treats a second recovery as complete", async () => {
    const legacy = {
      record: JSON.stringify({ fictional: "record" }),
      v3: JSON.stringify({ fictional: "v3" }),
      v2: JSON.stringify({ fictional: "v2" }),
      v1: JSON.stringify({ fictional: "v1" }),
    };
    const { storage, snapshot } = await seededWorkspace(undefined, { legacy });
    storage.faults.armAtCheckpoint("source-cleanup");

    const interrupted = await cleanupWorkspaceLegacyData(
      storage,
      new ImmediateWorkspaceLockRunner(),
      { baseline: workspaceIndexBaseline(snapshot), ...liveRequest() },
    );
    expect(interrupted).toEqual({ ok: false, reason: "lock-failed" });
    storage.faults.clear();

    const resumed = await resumeWorkspaceLifecycleOperation(
      storage,
      new ImmediateWorkspaceLockRunner(),
    );
    expect(resumed.ok).toBe(true);
    if (resumed.ok) {
      expect(resumed.snapshot.index.legacyFingerprints).toEqual(
        NULL_LEGACY_FINGERPRINTS,
      );
    }
    const repeated = await resumeWorkspaceLifecycleOperation(
      storage,
      new ImmediateWorkspaceLockRunner(),
    );
    expect(repeated.ok && repeated.changed).toBe(false);
  });

  it("never resumes a journal after a third-value project write", async () => {
    const { storage, snapshot } = await seededWorkspace();
    const baseline = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!baseline) throw new Error("Missing fictional project baseline");
    storage.faults.armAtCheckpoint("journal-phase-update");
    await deleteWorkspaceProject(
      storage,
      new ImmediateWorkspaceLockRunner(),
      { baseline, ...liveRequest() },
    );
    storage.faults.clear();
    storage.setItem(snapshot.projects[0].key, "third-value-project-bytes");

    const resumed = await resumeWorkspaceLifecycleOperation(
      storage,
      new ImmediateWorkspaceLockRunner(),
    );
    expect(resumed).toEqual({ ok: false, reason: "recovery-required" });
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).not.toBeNull();
    expect(storage.getItem(snapshot.projects[0].key)).toBe(
      "third-value-project-bytes",
    );
  });
});
