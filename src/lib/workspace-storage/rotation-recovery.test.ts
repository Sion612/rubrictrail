import { describe, expect, it } from "vitest";
import { createDefaultProjectState } from "@/lib/local-state";
import type { PersistedProjectState } from "@/lib/ui-types";
import {
  readWorkspaceAuthority,
  saveWorkspaceProject,
  workspaceIndexBaseline,
  workspaceProjectBaseline,
  type WorkspaceAuthoritySnapshot,
  type WorkspaceExclusiveLockRunner,
} from "@/lib/workspace-storage/coordinator";
import {
  LEGACY_PROJECT_KEYS,
  WORKSPACE_INDEX_KEY,
  WORKSPACE_OPERATION_KEY,
  WORKSPACE_PREFERENCES_KEY,
  WORKSPACE_RESERVE_KEY,
  workspaceProjectRecordKey,
  type SecureUuidSource,
} from "@/lib/workspace-storage/keys";
import {
  parseWorkspaceJournal,
  parseWorkspaceProjectRecord,
  serializeWorkspacePreferences,
} from "@/lib/workspace-storage/protocol";
import {
  inspectWorkspaceIndexRecovery,
  readWorkspaceRotationPreflight,
  recoverWorkspaceIndex,
  resumeWorkspaceGenerationOperation,
  rotateWorkspaceGeneration,
  workspaceRotationPolicyForCounts,
  type WorkspaceIndexRecoverySelection,
} from "@/lib/workspace-storage/rotation-recovery";
import { CANONICAL_WORKSPACE_RESERVE } from "@/lib/workspace-storage/reserve";
import {
  DeterministicFaultController,
  MemoryWorkspaceStorageAdapter,
  type WorkspaceStorageAdapter,
} from "@/lib/workspace-storage/storage-adapter";
import {
  activeIndex,
  activeProjectRecord,
  canonicalIndexBytes,
  canonicalProjectRecordBytes,
  OPERATION,
  PROJECT_A,
  PROJECT_B,
  WS,
  WS_OTHER,
} from "@/lib/workspace-storage/test-fixtures";
import type { WorkspaceIndexEntryV1 } from "@/lib/workspace-storage/types";

const PROJECT_C = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OPERATION_2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const WS_THIRD = "33333333-3333-4333-8333-333333333333";

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

class BeforeOperationLockRunner implements WorkspaceExclusiveLockRunner {
  constructor(private readonly beforeOperation: () => void) {}

  runExclusive<T>(_name: string, operation: () => Promise<T>): Promise<T> {
    this.beforeOperation();
    return operation();
  }
}

class SequenceUuidSource implements SecureUuidSource {
  constructor(private readonly values: string[]) {}

  randomUUID(): string {
    const value = this.values.shift();
    if (!value) throw new Error("Fictional UUID sequence exhausted");
    return value;
  }
}

class AfterJournalWriteStorage extends MemoryWorkspaceStorageAdapter {
  private fired = false;

  constructor(
    initialValues: Readonly<Record<string, string>>,
    private readonly afterJournal: () => void,
  ) {
    super(initialValues);
  }

  override setItem(key: string, value: string): void {
    super.setItem(key, value);
    if (key === WORKSPACE_OPERATION_KEY && !this.fired) {
      this.fired = true;
      this.afterJournal();
    }
  }
}

class FlipIntentDuringSourceConfirmationStorage extends MemoryWorkspaceStorageAdapter {
  private targetWritten = false;
  private sourceReadsAfterTarget = 0;

  constructor(
    initialValues: Readonly<Record<string, string>>,
    private readonly targetKey: string,
    private readonly sourceKey: string,
    private readonly flipIntent: () => void,
  ) {
    super(initialValues);
  }

  override setItem(key: string, value: string): void {
    super.setItem(key, value);
    if (key === this.targetKey) this.targetWritten = true;
  }

  override getItem(key: string): string | null {
    const value = super.getItem(key);
    if (this.targetWritten && key === this.sourceKey) {
      this.sourceReadsAfterTarget += 1;
      if (this.sourceReadsAfterTarget === 2) this.flipIntent();
    }
    return value;
  }
}

class CancellationSnapshotRaceStorage extends MemoryWorkspaceStorageAdapter {
  private targetWritten = false;
  private sourceReadsAfterTarget = 0;
  private intentRejected = false;
  private injected = false;

  constructor(
    initialValues: Readonly<Record<string, string>>,
    private readonly targetKey: string,
    private readonly sourceKey: string,
    private readonly mutation: "remove-source" | "replace-target",
    private readonly flipIntent: () => void,
  ) {
    super(initialValues);
  }

  override setItem(key: string, value: string): void {
    super.setItem(key, value);
    if (key === this.targetKey) this.targetWritten = true;
  }

  override getItem(key: string): string | null {
    if (
      this.intentRejected &&
      key === this.sourceKey &&
      this.sourceReadsAfterTarget === 3 &&
      !this.injected
    ) {
      // The fourth source read is the synchronous cancellation snapshot
      // callback, after removeWorkspaceJournal's final awaited confirmation.
      this.injected = true;
      if (this.mutation === "remove-source") {
        super.removeItem(this.sourceKey);
      } else {
        super.setItem(this.targetKey, "third-target-after-final-await");
      }
    }
    const value = super.getItem(key);
    if (this.targetWritten && key === this.sourceKey && !this.intentRejected) {
      this.sourceReadsAfterTarget += 1;
      if (this.sourceReadsAfterTarget === 2) {
        this.intentRejected = true;
        this.flipIntent();
      }
    } else if (this.intentRejected && key === this.sourceKey) {
      this.sourceReadsAfterTarget += 1;
    }
    return value;
  }
}

class AfterFirstSourceRemovalStorage extends MemoryWorkspaceStorageAdapter {
  private fired = false;

  constructor(
    initialValues: Readonly<Record<string, string>>,
    private readonly firstSourceKey: string,
    private readonly afterRemoval: () => void,
  ) {
    super(initialValues);
  }

  override removeItem(key: string): void {
    super.removeItem(key);
    if (!this.fired && key === this.firstSourceKey) {
      this.fired = true;
      this.afterRemoval();
    }
  }
}

function fictionalState(label: string): PersistedProjectState {
  return {
    ...createDefaultProjectState(),
    projectKind: "sample",
    view: label === "Beta" ? "draft" : "rubric",
    visitedViews: label === "Beta" ? ["overview", "draft"] : ["overview", "rubric"],
    completedTaskIds: label === "Beta" ? ["p1"] : [],
    weeklyHours: label.length + 5,
    targetGrade: label === "Beta" ? 78 : 72,
    draftText: `Fictional LumaLane ${label} draft`,
  };
}

function generatedUuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

interface SeedRecord {
  projectId: string;
  kind: "active" | "tombstone";
  state?: PersistedProjectState;
  revision?: number;
}

async function recordBytes(
  workspaceId: string,
  generation: number,
  record: SeedRecord,
): Promise<{ key: string; raw: string }> {
  const value = await canonicalProjectRecordBytes(
    activeProjectRecord(record.projectId, {
      workspaceId,
      workspaceGeneration: generation,
      revision: record.revision ?? 1,
      value:
        record.kind === "active"
          ? { kind: "project", state: record.state ?? fictionalState(record.projectId) }
          : { kind: "tombstone" },
    }),
  );
  return {
    key: workspaceProjectRecordKey(workspaceId, generation, record.projectId),
    raw: value.serialized,
  };
}

async function seedAuthority(
  records: readonly SeedRecord[],
  options: {
    workspaceId?: string;
    generation?: number;
    revision?: number;
    extraValues?: Readonly<Record<string, string>>;
    faults?: DeterministicFaultController;
  } = {},
): Promise<{
  storage: MemoryWorkspaceStorageAdapter;
  snapshot: WorkspaceAuthoritySnapshot;
}> {
  const workspaceId = options.workspaceId ?? WS;
  const generation = options.generation ?? 1;
  const entries: WorkspaceIndexEntryV1[] = records
    .map((record) => ({ projectId: record.projectId, kind: record.kind }))
    .sort((left, right) => left.projectId.localeCompare(right.projectId));
  const index = await canonicalIndexBytes(
    activeIndex({
      workspaceId,
      workspaceGeneration: generation,
      revision: options.revision ?? 1,
      projects: entries,
    }),
  );
  const values: Record<string, string> = {
    [WORKSPACE_INDEX_KEY]: index.serialized,
    [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
    ...options.extraValues,
  };
  for (const record of records) {
    const stored = await recordBytes(workspaceId, generation, record);
    values[stored.key] = stored.raw;
  }
  const storage = new MemoryWorkspaceStorageAdapter(values, options.faults);
  const authority = await readWorkspaceAuthority(storage);
  if (!authority.ok) throw new Error(`Invalid authority fixture: ${authority.reason}`);
  return { storage, snapshot: authority.snapshot };
}

async function addLooseGroup(
  values: Record<string, string>,
  workspaceId: string,
  generation: number,
  records: readonly SeedRecord[],
): Promise<void> {
  for (const record of records) {
    const stored = await recordBytes(workspaceId, generation, record);
    values[stored.key] = stored.raw;
  }
}

function alwaysReady() {
  return {
    pendingSavesDrained: () => true,
    intentStillCurrent: () => true,
  };
}

async function expectActiveProject(
  storage: WorkspaceStorageAdapter,
  workspaceId: string,
  generation: number,
  projectId: string,
  expectedState: PersistedProjectState,
  expectedRevision: number,
): Promise<void> {
  const raw = storage.getItem(
    workspaceProjectRecordKey(workspaceId, generation, projectId),
  );
  expect(raw).not.toBeNull();
  if (raw === null) throw new Error("Expected active project record");
  const parsed = parseWorkspaceProjectRecord(raw);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok || parsed.value.value.kind !== "project") return;
  expect(parsed.value.revision).toBe(expectedRevision);
  expect(parsed.value.value.state).toEqual(expectedState);
}

async function selectionForOnlyCandidate(
  storage: WorkspaceStorageAdapter,
): Promise<WorkspaceIndexRecoverySelection> {
  const inspection = await inspectWorkspaceIndexRecovery(storage);
  expect(inspection.ok).toBe(true);
  if (!inspection.ok) throw new Error("Expected recovery inspection");
  expect(inspection.authority).toBe("none");
  expect(inspection.requiresExplicitSelection).toBe(true);
  expect(inspection.candidates).toHaveLength(1);
  const candidate = inspection.candidates[0];
  if (!candidate) throw new Error("Expected exactly one recovery candidate");
  return candidate.selection;
}

describe("workspace rotation policy and preflight", () => {
  it.each([
    [1, 63, 64, "normal", false, false, false, false],
    [1, 64, 65, "compaction-recommended", true, false, false, false],
    [20, 59, 79, "normal", false, false, false, false],
    [20, 60, 80, "storage-warning", false, true, false, false],
    [40, 55, 95, "storage-warning", false, true, false, false],
    [40, 56, 96, "growth-blocked", false, true, true, false],
    [40, 59, 99, "growth-blocked", false, true, true, false],
    [40, 60, 100, "hard-limit", false, true, true, true],
  ] as const)(
    "classifies active=%i tombstones=%i at the exact policy boundary",
    (active, tombstones, physical, status, compact, warning, blocked, hard) => {
      expect(workspaceRotationPolicyForCounts(active, tombstones, physical)).toMatchObject({
        status,
        compactionRecommended: compact || tombstones >= 64,
        storageWarning: warning,
        growthBlocked: blocked,
        hardLimitReached: hard,
        recoveryOnly: false,
      });
    },
  );

  it("marks attempted 101 logical or physical records as recovery-only", () => {
    expect(workspaceRotationPolicyForCounts(101, 0)).toMatchObject({
      status: "recovery-only",
      recoveryOnly: true,
    });
    expect(workspaceRotationPolicyForCounts(1, 1, 101)).toMatchObject({
      status: "recovery-only",
      recoveryOnly: true,
    });
  });

  it("reports display preflight but repeats authority inside the mutation lock", async () => {
    const { storage, snapshot } = await seedAuthority([
      { projectId: PROJECT_A, kind: "active", state: fictionalState("Alpha") },
      { projectId: PROJECT_C, kind: "tombstone" },
    ]);
    const display = await readWorkspaceRotationPreflight(storage);
    expect(display.ok).toBe(true);
    if (!display.ok) return;

    const changedIndex = await canonicalIndexBytes({
      ...snapshot.index,
      revision: snapshot.index.revision + 1,
    });
    const result = await rotateWorkspaceGeneration(
      storage,
      new BeforeOperationLockRunner(() => {
        storage.setItem(WORKSPACE_INDEX_KEY, changedIndex.serialized);
      }),
      {
        baseline: display.baseline,
        ...alwaysReady(),
        uuidSource: new SequenceUuidSource([OPERATION]),
      },
    );
    expect(result).toEqual({ ok: false, reason: "workspace-conflict" });
  });

  it("fails closed without Web Locks and changes no bytes", async () => {
    const { storage, snapshot } = await seedAuthority([
      { projectId: PROJECT_A, kind: "active", state: fictionalState("Alpha") },
      { projectId: PROJECT_C, kind: "tombstone" },
    ]);
    const before = storage.snapshot();
    const result = await rotateWorkspaceGeneration(storage, null, {
      baseline: workspaceIndexBaseline(snapshot),
      ...alwaysReady(),
    });
    expect(result).toEqual({ ok: false, reason: "lock-unavailable" });
    expect(storage.snapshot()).toEqual(before);
  });
});

describe("generation rotation", () => {
  it("rewrites each active record one at a time and removes only indexed tombstones", async () => {
    const alpha = fictionalState("Alpha");
    const beta = fictionalState("Beta");
    const unrelated = await recordBytes(WS_OTHER, 7, {
      projectId: generatedUuid(900),
      kind: "tombstone",
    });
    const stalePreference = serializeWorkspacePreferences({
      formatVersion: 1,
      workspaceId: WS,
      workspaceGeneration: 1,
      lastOpenedProjectId: PROJECT_A,
    });
    if (!stalePreference.ok) throw new Error("Expected strict preference fixture");
    const { storage, snapshot } = await seedAuthority(
      [
        { projectId: PROJECT_A, kind: "active", state: alpha, revision: 2 },
        { projectId: PROJECT_B, kind: "active", state: beta, revision: 4 },
        { projectId: PROJECT_C, kind: "tombstone", revision: 3 },
      ],
      {
        extraValues: {
          [unrelated.key]: unrelated.raw,
          [WORKSPACE_PREFERENCES_KEY]: stalePreference.serialized,
        },
      },
    );

    const result = await rotateWorkspaceGeneration(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(snapshot),
        ...alwaysReady(),
        uuidSource: new SequenceUuidSource([OPERATION]),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("committed");
    expect(result.kind).toBe("rotate-workspace-generation");
    expect(result.snapshot.index).toMatchObject({
      workspaceId: WS,
      workspaceGeneration: 2,
      revision: 2,
      status: "active",
      projects: [
        { projectId: PROJECT_A, kind: "active" },
        { projectId: PROJECT_B, kind: "active" },
      ],
    });
    expect(storage.getItem(workspaceProjectRecordKey(WS, 1, PROJECT_A))).toBeNull();
    expect(storage.getItem(workspaceProjectRecordKey(WS, 1, PROJECT_B))).toBeNull();
    expect(storage.getItem(workspaceProjectRecordKey(WS, 1, PROJECT_C))).toBeNull();
    expect(storage.getItem(unrelated.key)).toBe(unrelated.raw);
    expect(storage.getItem(WORKSPACE_PREFERENCES_KEY)).toBeNull();
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    expect(storage.getItem(WORKSPACE_RESERVE_KEY)).toBe(CANONICAL_WORKSPACE_RESERVE);
    await expectActiveProject(storage, WS, 2, PROJECT_A, alpha, 3);
    await expectActiveProject(storage, WS, 2, PROJECT_B, beta, 5);
  });

  it("rotates a valid empty active workspace containing only a tombstone", async () => {
    const { storage, snapshot } = await seedAuthority([
      { projectId: PROJECT_C, kind: "tombstone" },
    ]);
    const result = await rotateWorkspaceGeneration(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(snapshot),
        ...alwaysReady(),
        uuidSource: new SequenceUuidSource([OPERATION]),
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.index).toMatchObject({
        status: "active",
        workspaceGeneration: 2,
        projects: [],
      });
    }
  });

  it("blocks invalid owned records and preserves every byte", async () => {
    const invalidKey = workspaceProjectRecordKey(WS_OTHER, 4, PROJECT_C);
    const { storage, snapshot } = await seedAuthority(
      [
        { projectId: PROJECT_A, kind: "active", state: fictionalState("Alpha") },
        { projectId: PROJECT_C, kind: "tombstone" },
      ],
      { extraValues: { [invalidKey]: "{not-valid-json" } },
    );
    const before = storage.snapshot();
    const result = await rotateWorkspaceGeneration(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(snapshot),
        ...alwaysReady(),
        uuidSource: new SequenceUuidSource([OPERATION]),
      },
    );
    expect(result).toEqual({ ok: false, reason: "invalid-owned-record" });
    expect(storage.snapshot()).toEqual(before);
  });

  it("allows rotation at 100 logical records but blocks 101 physical records", async () => {
    const hundredRecords: SeedRecord[] = [
      { projectId: generatedUuid(1), kind: "active", state: fictionalState("Alpha") },
      ...Array.from({ length: 99 }, (_, index) => ({
        projectId: generatedUuid(index + 2),
        kind: "tombstone" as const,
      })),
    ];
    const atLimit = await seedAuthority(hundredRecords);
    const rotated = await rotateWorkspaceGeneration(
      atLimit.storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(atLimit.snapshot),
        ...alwaysReady(),
        uuidSource: new SequenceUuidSource([OPERATION]),
      },
    );
    expect(rotated.ok).toBe(true);
    if (rotated.ok) expect(rotated.snapshot.index.projects).toHaveLength(1);

    const extraValues: Record<string, string> = {};
    for (let index = 0; index < 99; index += 1) {
      const extra = await recordBytes(WS_OTHER, 5, {
        projectId: generatedUuid(index + 300),
        kind: "tombstone",
      });
      extraValues[extra.key] = extra.raw;
    }
    const overPhysical = await seedAuthority(
      [
        { projectId: PROJECT_A, kind: "active", state: fictionalState("Alpha") },
        { projectId: PROJECT_C, kind: "tombstone" },
      ],
      { extraValues },
    );
    const result = await rotateWorkspaceGeneration(
      overPhysical.storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(overPhysical.snapshot),
        ...alwaysReady(),
        uuidSource: new SequenceUuidSource([OPERATION]),
      },
    );
    expect(result).toEqual({ ok: false, reason: "physical-recovery-only" });
  });

  it("blocks pending saves, stale intent, and no-benefit rotation before journaling", async () => {
    const withTombstone = await seedAuthority([
      { projectId: PROJECT_A, kind: "active", state: fictionalState("Alpha") },
      { projectId: PROJECT_C, kind: "tombstone" },
    ]);
    const pending = await rotateWorkspaceGeneration(
      withTombstone.storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(withTombstone.snapshot),
        pendingSavesDrained: () => false,
        intentStillCurrent: () => true,
      },
    );
    expect(pending).toEqual({ ok: false, reason: "pending-save" });
    expect(withTombstone.storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();

    const stale = await rotateWorkspaceGeneration(
      withTombstone.storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(withTombstone.snapshot),
        pendingSavesDrained: () => true,
        intentStillCurrent: () => false,
      },
    );
    expect(stale).toEqual({ ok: false, reason: "intent-stale" });
    expect(withTombstone.storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();

    const withoutTombstone = await seedAuthority([
      { projectId: PROJECT_A, kind: "active", state: fictionalState("Alpha") },
    ]);
    const noBenefit = await rotateWorkspaceGeneration(
      withoutTombstone.storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(withoutTombstone.snapshot),
        ...alwaysReady(),
      },
    );
    expect(noBenefit).toEqual({ ok: false, reason: "no-compaction-benefit" });
  });

  it("cancels the exact journal when intent changes immediately after prepare", async () => {
    const seeded = await seedAuthority([
      { projectId: PROJECT_A, kind: "active", state: fictionalState("Alpha") },
      { projectId: PROJECT_C, kind: "tombstone" },
    ]);
    let current = true;
    const storage = new AfterJournalWriteStorage(seeded.storage.snapshot(), () => {
      current = false;
    });
    const snapshot = await readWorkspaceAuthority(storage);
    if (!snapshot.ok) throw new Error("Expected strict authority");

    const result = await rotateWorkspaceGeneration(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(snapshot.snapshot),
        pendingSavesDrained: () => true,
        intentStillCurrent: () => current,
        uuidSource: new SequenceUuidSource([OPERATION]),
      },
    );
    expect(result).toEqual({ ok: false, reason: "intent-stale" });
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    expect(storage.getItem(workspaceProjectRecordKey(WS, 2, PROJECT_A))).toBeNull();
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBe(snapshot.snapshot.indexRaw);
    expect(storage.getItem(snapshot.snapshot.projects[0].key)).toBe(
      snapshot.snapshot.projects[0].raw,
    );
    expect(storage.getItem(WORKSPACE_RESERVE_KEY)).toBe(CANONICAL_WORKSPACE_RESERVE);

    const resumed = await resumeWorkspaceGenerationOperation(
      storage,
      new SerialWorkspaceLockRunner(),
    );
    expect(resumed.ok && "snapshot" in resumed).toBe(true);
    if (resumed.ok && "snapshot" in resumed) {
      expect(resumed.snapshot.index.workspaceGeneration).toBe(1);
    }
  });

  it("cancels an additive target when intent flips at the final source-removal guard", async () => {
    const seeded = await seedAuthority([
      { projectId: PROJECT_A, kind: "active", state: fictionalState("Alpha") },
      { projectId: PROJECT_C, kind: "tombstone" },
    ]);
    const sourceKey = workspaceProjectRecordKey(WS, 1, PROJECT_A);
    const targetKey = workspaceProjectRecordKey(WS, 2, PROJECT_A);
    let current = true;
    const storage = new FlipIntentDuringSourceConfirmationStorage(
      seeded.storage.snapshot(),
      targetKey,
      sourceKey,
      () => {
        current = false;
      },
    );
    const authority = await readWorkspaceAuthority(storage);
    if (!authority.ok) throw new Error("Expected strict authority");

    const result = await rotateWorkspaceGeneration(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(authority.snapshot),
        pendingSavesDrained: () => true,
        intentStillCurrent: () => current,
        uuidSource: new SequenceUuidSource([OPERATION]),
      },
    );

    expect(result).toEqual({ ok: false, reason: "intent-stale" });
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBe(authority.snapshot.indexRaw);
    expect(storage.getItem(sourceKey)).toBe(
      authority.snapshot.projects.find(
        (project) => project.record.projectId === PROJECT_A,
      )?.raw,
    );
    expect(storage.getItem(targetKey)).toBeNull();
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    expect(storage.getItem(WORKSPACE_RESERVE_KEY)).toBe(CANONICAL_WORKSPACE_RESERVE);
  });

  it("retains the rotation journal and unique target when the source disappears during cancellation", async () => {
    const seeded = await seedAuthority([
      { projectId: PROJECT_A, kind: "active", state: fictionalState("Alpha") },
      { projectId: PROJECT_C, kind: "tombstone" },
    ]);
    const sourceKey = workspaceProjectRecordKey(WS, 1, PROJECT_A);
    const targetKey = workspaceProjectRecordKey(WS, 2, PROJECT_A);
    let current = true;
    const storage = new CancellationSnapshotRaceStorage(
      seeded.storage.snapshot(),
      targetKey,
      sourceKey,
      "remove-source",
      () => {
        current = false;
      },
    );
    const authority = await readWorkspaceAuthority(storage);
    if (!authority.ok) throw new Error("Expected strict authority");

    const result = await rotateWorkspaceGeneration(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(authority.snapshot),
        pendingSavesDrained: () => true,
        intentStillCurrent: () => current,
        uuidSource: new SequenceUuidSource([OPERATION]),
      },
    );

    expect(result).toEqual({ ok: false, reason: "commit-incomplete" });
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBe(authority.snapshot.indexRaw);
    expect(storage.getItem(sourceKey)).toBeNull();
    const retainedTarget = storage.getItem(targetKey);
    expect(retainedTarget).not.toBeNull();
    if (retainedTarget !== null) {
      const parsed = parseWorkspaceProjectRecord(retainedTarget);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.value.workspaceGeneration).toBe(2);
        expect(parsed.value.projectId).toBe(PROJECT_A);
      }
    }
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).not.toBeNull();
  });

  it("rolls forward without claiming cancellation once the first source removal began", async () => {
    const seeded = await seedAuthority([
      { projectId: PROJECT_A, kind: "active", state: fictionalState("Alpha") },
      { projectId: PROJECT_B, kind: "active", state: fictionalState("Beta") },
      { projectId: PROJECT_C, kind: "tombstone" },
    ]);
    const firstSourceKey = workspaceProjectRecordKey(WS, 1, PROJECT_A);
    let current = true;
    const storage = new AfterFirstSourceRemovalStorage(
      seeded.storage.snapshot(),
      firstSourceKey,
      () => {
        current = false;
      },
    );
    const authority = await readWorkspaceAuthority(storage);
    if (!authority.ok) throw new Error("Expected strict authority");

    const result = await rotateWorkspaceGeneration(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(authority.snapshot),
        pendingSavesDrained: () => true,
        intentStillCurrent: () => current,
        uuidSource: new SequenceUuidSource([OPERATION]),
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshot.index.workspaceGeneration).toBe(2);
    expect(storage.getItem(workspaceProjectRecordKey(WS, 1, PROJECT_A))).toBeNull();
    expect(storage.getItem(workspaceProjectRecordKey(WS, 1, PROJECT_B))).toBeNull();
  });

  it.each([
    "reserve-removal",
    "journal-phase-update",
    "project-target-write",
    "source-cleanup",
    "index-commit",
    "journal-removal",
    "reserve-recreation",
  ])("recovers idempotently after a crash at %s", async (checkpoint) => {
    const faults = new DeterministicFaultController();
    const alpha = fictionalState("Alpha");
    const beta = fictionalState("Beta");
    const { storage, snapshot } = await seedAuthority(
      [
        { projectId: PROJECT_A, kind: "active", state: alpha, revision: 2 },
        { projectId: PROJECT_B, kind: "active", state: beta, revision: 5 },
        { projectId: PROJECT_C, kind: "tombstone" },
      ],
      { faults },
    );
    faults.armAtCheckpoint(checkpoint, "crash");
    const interrupted = await rotateWorkspaceGeneration(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(snapshot),
        ...alwaysReady(),
        uuidSource: new SequenceUuidSource([OPERATION]),
      },
    );
    expect(interrupted).toEqual({ ok: false, reason: "lock-failed" });
    faults.clear();

    const resumed = await resumeWorkspaceGenerationOperation(
      storage,
      new SerialWorkspaceLockRunner(),
    );
    expect(resumed.ok, checkpoint).toBe(true);
    const authority = await readWorkspaceAuthority(storage);
    expect(authority.ok, checkpoint).toBe(true);
    if (!authority.ok) return;
    expect(authority.snapshot.index.workspaceGeneration).toBe(
      checkpoint === "reserve-removal" ? 1 : 2,
    );
    if (checkpoint === "reserve-removal") {
      expect(storage.getItem(WORKSPACE_RESERVE_KEY)).toBe(CANONICAL_WORKSPACE_RESERVE);
      return;
    }
    await expectActiveProject(storage, WS, 2, PROJECT_A, alpha, 3);
    await expectActiveProject(storage, WS, 2, PROJECT_B, beta, 6);
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    expect(storage.getItem(WORKSPACE_RESERVE_KEY)).toBe(CANONICAL_WORKSPACE_RESERVE);
  });

  it.each(["source", "target", "index", "cleanup", "legacy"] as const)(
    "quarantines a third %s value and never guesses",
    async (kind) => {
      const faults = new DeterministicFaultController();
      const { storage, snapshot } = await seedAuthority(
        [
          { projectId: PROJECT_A, kind: "active", state: fictionalState("Alpha") },
          { projectId: PROJECT_C, kind: "tombstone" },
        ],
        { faults },
      );
      faults.armAtCheckpoint("journal-phase-update", "crash");
      await rotateWorkspaceGeneration(storage, new SerialWorkspaceLockRunner(), {
        baseline: workspaceIndexBaseline(snapshot),
        ...alwaysReady(),
        uuidSource: new SequenceUuidSource([OPERATION]),
      });
      faults.clear();
      const rawJournal = storage.getItem(WORKSPACE_OPERATION_KEY);
      if (rawJournal === null) throw new Error("Expected durable rotation journal");
      const journal = parseWorkspaceJournal(rawJournal);
      if (!journal.ok) throw new Error("Expected durable rotation journal");
      const mutation = journal.value.projectMutations[0];
      const cleanup = journal.value.cleanup[0];
      if (!mutation?.sourceRecord || !cleanup) throw new Error("Incomplete fixture journal");

      if (kind === "source") storage.setItem(mutation.sourceRecord.key, "third-source");
      if (kind === "target") storage.setItem(mutation.targetRecord.key, "third-target");
      if (kind === "index") storage.setItem(WORKSPACE_INDEX_KEY, "third-index");
      if (kind === "legacy") {
        storage.setItem(LEGACY_PROJECT_KEYS.v3, "stale-v0.7.x-rewrite");
      }
      if (kind === "cleanup") {
        const thirdCleanup = await canonicalProjectRecordBytes(
          activeProjectRecord(PROJECT_C, {
            revision: 9,
            value: { kind: "project", state: fictionalState("Cleanup third") },
          }),
        );
        storage.setItem(cleanup.key, thirdCleanup.serialized);
      }

      const resumed = await resumeWorkspaceGenerationOperation(
        storage,
        new SerialWorkspaceLockRunner(),
      );
      expect(resumed).toMatchObject({ ok: false, reason: "quarantine" });
      expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBe(rawJournal);
    },
  );

  it("makes all generation-N project baselines stale after rotation", async () => {
    const { storage, snapshot } = await seedAuthority([
      { projectId: PROJECT_A, kind: "active", state: fictionalState("Alpha") },
      { projectId: PROJECT_C, kind: "tombstone" },
    ]);
    const staleProject = workspaceProjectBaseline(snapshot, PROJECT_A);
    if (!staleProject) throw new Error("Expected project baseline");
    const rotated = await rotateWorkspaceGeneration(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: workspaceIndexBaseline(snapshot),
        ...alwaysReady(),
        uuidSource: new SequenceUuidSource([OPERATION]),
      },
    );
    expect(rotated.ok).toBe(true);

    const staleSave = await saveWorkspaceProject(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        baseline: staleProject,
        nextState: fictionalState("Stale tab write"),
        intentStillCurrent: () => true,
      },
    );
    expect(staleSave).toEqual({ ok: false, reason: "workspace-conflict" });
  });
});

describe("explicit index recovery", () => {
  it("discovers one coherent group without granting authority or auto-recovering it", async () => {
    const values: Record<string, string> = {
      [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
    };
    await addLooseGroup(values, WS, 3, [
      { projectId: PROJECT_A, kind: "active", state: fictionalState("Alpha") },
      { projectId: PROJECT_C, kind: "tombstone" },
    ]);
    const storage = new MemoryWorkspaceStorageAdapter(values);
    const before = storage.snapshot();

    const inspection = await inspectWorkspaceIndexRecovery(storage);

    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;
    expect(inspection).toMatchObject({
      authority: "none",
      requiresExplicitSelection: true,
      indexState: "missing",
      physicalRecordCount: 2,
      candidates: [
        {
          workspaceId: WS,
          sourceGeneration: 3,
          activeCount: 1,
          tombstoneCount: 1,
        },
      ],
    });
    expect(storage.snapshot()).toEqual(before);
    expect(await readWorkspaceAuthority(storage)).toEqual({
      ok: false,
      reason: "missing-index",
    });
  });

  it("rewrites only the explicitly selected group into a fresh generation", async () => {
    const alpha = fictionalState("Alpha");
    const beta = fictionalState("Beta");
    const values: Record<string, string> = {
      [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
    };
    await addLooseGroup(values, WS, 3, [
      { projectId: PROJECT_A, kind: "active", state: alpha, revision: 2 },
      { projectId: PROJECT_C, kind: "tombstone", revision: 4 },
    ]);
    await addLooseGroup(values, WS_OTHER, 8, [
      { projectId: PROJECT_B, kind: "active", state: beta, revision: 6 },
    ]);
    const storage = new MemoryWorkspaceStorageAdapter(values);
    const inspection = await inspectWorkspaceIndexRecovery(storage);
    if (!inspection.ok) throw new Error("Expected recovery candidates");
    expect(inspection.candidates).toHaveLength(2);
    const selected = inspection.candidates.find(
      (candidate) => candidate.workspaceId === WS_OTHER,
    );
    if (!selected) throw new Error("Expected explicitly selected second group");
    const unselectedBefore = Object.fromEntries(
      Object.entries(storage.snapshot()).filter(([key]) => key.includes(WS)),
    );

    const result = await recoverWorkspaceIndex(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        selection: selected.selection,
        ...alwaysReady(),
        uuidSource: new SequenceUuidSource([OPERATION]),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("recover-index");
    expect(result.snapshot.index).toMatchObject({
      workspaceId: WS_OTHER,
      workspaceGeneration: 9,
      revision: 1,
      status: "active",
      projects: [{ projectId: PROJECT_B, kind: "active" }],
    });
    await expectActiveProject(storage, WS_OTHER, 9, PROJECT_B, beta, 7);
    expect(storage.getItem(workspaceProjectRecordKey(WS_OTHER, 8, PROJECT_B))).toBeNull();
    for (const [key, raw] of Object.entries(unselectedBefore)) {
      expect(storage.getItem(key), key).toBe(raw);
    }
  });

  it("recovers a tombstone-only group as a valid empty active workspace", async () => {
    const values: Record<string, string> = {
      [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
    };
    await addLooseGroup(values, WS, 6, [
      { projectId: PROJECT_C, kind: "tombstone", revision: 3 },
    ]);
    const storage = new MemoryWorkspaceStorageAdapter(values);
    const selection = await selectionForOnlyCandidate(storage);
    const result = await recoverWorkspaceIndex(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        selection,
        ...alwaysReady(),
        uuidSource: new SequenceUuidSource([OPERATION]),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.index).toMatchObject({
      workspaceId: WS,
      workspaceGeneration: 7,
      revision: 1,
      status: "active",
      projects: [],
    });
    expect(storage.getItem(workspaceProjectRecordKey(WS, 6, PROJECT_C))).toBeNull();
  });

  it("never ranks same-workspace generations and leaves the unselected one untouched", async () => {
    const values: Record<string, string> = {
      [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
    };
    await addLooseGroup(values, WS, 2, [
      { projectId: PROJECT_A, kind: "active", state: fictionalState("Older") },
    ]);
    await addLooseGroup(values, WS, 8, [
      { projectId: PROJECT_B, kind: "active", state: fictionalState("Newer") },
    ]);
    const storage = new MemoryWorkspaceStorageAdapter(values);
    const inspection = await inspectWorkspaceIndexRecovery(storage);
    if (!inspection.ok) throw new Error("Expected recovery candidates");
    const selected = inspection.candidates.find(
      (candidate) => candidate.sourceGeneration === 2,
    );
    if (!selected) throw new Error("Expected explicit older-generation selection");
    const unselectedKey = workspaceProjectRecordKey(WS, 8, PROJECT_B);
    const unselectedRaw = storage.getItem(unselectedKey);

    const result = await recoverWorkspaceIndex(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        selection: selected.selection,
        ...alwaysReady(),
        uuidSource: new SequenceUuidSource([OPERATION]),
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshot.index.workspaceGeneration).toBe(3);
    expect(storage.getItem(unselectedKey)).toBe(unselectedRaw);
  });

  it("marks only the malformed record's group incoherent and still grants no authority", async () => {
    const values: Record<string, string> = {
      [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
    };
    await addLooseGroup(values, WS, 3, [
      { projectId: PROJECT_A, kind: "active", state: fictionalState("Alpha") },
    ]);
    values[workspaceProjectRecordKey(WS_OTHER, 4, PROJECT_B)] = "malformed";
    const storage = new MemoryWorkspaceStorageAdapter(values);

    const inspection = await inspectWorkspaceIndexRecovery(storage);

    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;
    expect(inspection.authority).toBe("none");
    expect(inspection.recoveryOnly).toBe(true);
    expect(inspection.candidates).toHaveLength(1);
    expect(inspection.candidates[0]).toMatchObject({
      workspaceId: WS,
      sourceGeneration: 3,
    });
    expect(inspection.incoherentGroups).toEqual([
      { workspaceId: WS_OTHER, sourceGeneration: 4, recordCount: 1 },
    ]);
  });

  it("treats an active projectKind-none envelope as an incoherent group", async () => {
    const none = await canonicalProjectRecordBytes(
      activeProjectRecord(PROJECT_A, {
        value: { kind: "project", state: createDefaultProjectState() },
      }),
    );
    const storage = new MemoryWorkspaceStorageAdapter({
      [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
      [workspaceProjectRecordKey(WS, 1, PROJECT_A)]: none.serialized,
    });
    const inspection = await inspectWorkspaceIndexRecovery(storage);
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;
    expect(inspection.candidates).toEqual([]);
    expect(inspection.incoherentGroups).toEqual([
      { workspaceId: WS, sourceGeneration: 1, recordCount: 1 },
    ]);
    expect(inspection.recoveryOnly).toBe(true);
  });

  it("distinguishes corrupt and incomplete indexes without adopting either", async () => {
    for (const [rawIndex, expectedState] of [
      ["corrupt-index", "corrupt"],
      [
        (
          await canonicalIndexBytes(
            activeIndex({
              projects: [{ projectId: PROJECT_B, kind: "active" }],
            }),
          )
        ).serialized,
        "incomplete",
      ],
    ] as const) {
      const values: Record<string, string> = {
        [WORKSPACE_INDEX_KEY]: rawIndex,
        [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
      };
      await addLooseGroup(values, WS, 1, [
        { projectId: PROJECT_A, kind: "active", state: fictionalState("Alpha") },
      ]);
      const inspection = await inspectWorkspaceIndexRecovery(
        new MemoryWorkspaceStorageAdapter(values),
      );
      expect(inspection.ok).toBe(true);
      if (inspection.ok) {
        expect(inspection.indexState).toBe(expectedState);
        expect(inspection.authority).toBe("none");
      }
    }
  });

  it("refuses explicit recovery when a strict index already has authority", async () => {
    const { storage } = await seedAuthority([
      { projectId: PROJECT_A, kind: "active", state: fictionalState("Alpha") },
    ]);
    expect(await inspectWorkspaceIndexRecovery(storage)).toEqual({
      ok: false,
      reason: "existing-authority",
    });
  });

  it.each(["source", "index", "legacy"] as const)(
    "rejects an exact selection after its %s baseline changes",
    async (baselineKind) => {
      const values: Record<string, string> = {
        [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
      };
      await addLooseGroup(values, WS, 3, [
        { projectId: PROJECT_A, kind: "active", state: fictionalState("Alpha") },
      ]);
      const storage = new MemoryWorkspaceStorageAdapter(values);
      const selection = await selectionForOnlyCandidate(storage);
      const changedSource =
        baselineKind === "source"
          ? await recordBytes(WS, 3, {
              projectId: PROJECT_A,
              kind: "active",
              state: fictionalState("Changed source"),
              revision: 2,
            })
          : null;
      let expectedAfterBaselineChange: Readonly<Record<string, string>> | null = null;

      const result = await recoverWorkspaceIndex(
        storage,
        new BeforeOperationLockRunner(() => {
          if (changedSource) storage.setItem(changedSource.key, changedSource.raw);
          if (baselineKind === "index") {
            storage.setItem(WORKSPACE_INDEX_KEY, "new-corruption");
          }
          if (baselineKind === "legacy") {
            storage.setItem("rubrictrail.project.v3", "legacy-drift");
          }
          expectedAfterBaselineChange = storage.snapshot();
        }),
        {
          selection,
          ...alwaysReady(),
          uuidSource: new SequenceUuidSource([OPERATION]),
        },
      );
      expect(result).toEqual({ ok: false, reason: "selection-stale" });
      expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
      expect(storage.snapshot()).toEqual(expectedAfterBaselineChange);
    },
  );

  it("rejects a non-fresh target generation", async () => {
    const values: Record<string, string> = {
      [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
    };
    await addLooseGroup(values, WS, 3, [
      { projectId: PROJECT_A, kind: "active", state: fictionalState("Alpha") },
    ]);
    await addLooseGroup(values, WS, 4, [
      { projectId: PROJECT_B, kind: "active", state: fictionalState("Occupied") },
    ]);
    const storage = new MemoryWorkspaceStorageAdapter(values);
    const inspection = await inspectWorkspaceIndexRecovery(storage);
    if (!inspection.ok) throw new Error("Expected candidates");
    const selection = inspection.candidates.find(
      (candidate) => candidate.sourceGeneration === 3,
    )?.selection;
    if (!selection) throw new Error("Expected generation 3 candidate");
    const before = storage.snapshot();
    const result = await recoverWorkspaceIndex(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        selection,
        ...alwaysReady(),
        uuidSource: new SequenceUuidSource([OPERATION]),
      },
    );
    expect(result).toEqual({ ok: false, reason: "target-generation-occupied" });
    expect(storage.snapshot()).toEqual(before);
  });

  it("permits 200 physical keys for explicit recovery but blocks 201", async () => {
    async function recoveryStorage(extraCount: number) {
      const values: Record<string, string> = {
        [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
      };
      await addLooseGroup(values, WS, 1, [
        { projectId: PROJECT_A, kind: "active", state: fictionalState("Selected") },
      ]);
      await addLooseGroup(
        values,
        WS_OTHER,
        5,
        Array.from({ length: 100 }, (_, index) => ({
          projectId: generatedUuid(index + 400),
          kind: "tombstone" as const,
        })),
      );
      await addLooseGroup(
        values,
        WS_THIRD,
        6,
        Array.from({ length: extraCount }, (_, index) => ({
          projectId: generatedUuid(index + 600),
          kind: "tombstone" as const,
        })),
      );
      return new MemoryWorkspaceStorageAdapter(values);
    }

    const atLimit = await recoveryStorage(99);
    const atLimitSelection = (
      await inspectWorkspaceIndexRecovery(atLimit)
    );
    if (!atLimitSelection.ok) throw new Error("Expected 200-key inspection");
    const selected = atLimitSelection.candidates.find(
      (candidate) => candidate.workspaceId === WS,
    );
    if (!selected) throw new Error("Expected selected recovery group");
    const permitted = await recoverWorkspaceIndex(
      atLimit,
      new SerialWorkspaceLockRunner(),
      {
        selection: selected.selection,
        ...alwaysReady(),
        uuidSource: new SequenceUuidSource([OPERATION]),
      },
    );
    expect(permitted.ok).toBe(true);

    const overLimit = await recoveryStorage(100);
    const overInspection = await inspectWorkspaceIndexRecovery(overLimit);
    if (!overInspection.ok) throw new Error("Expected 201-key inspection");
    const overSelected = overInspection.candidates.find(
      (candidate) => candidate.workspaceId === WS,
    );
    if (!overSelected) throw new Error("Expected over-limit selected group");
    const before = overLimit.snapshot();
    const blocked = await recoverWorkspaceIndex(
      overLimit,
      new SerialWorkspaceLockRunner(),
      {
        selection: overSelected.selection,
        ...alwaysReady(),
        uuidSource: new SequenceUuidSource([OPERATION]),
      },
    );
    expect(blocked).toEqual({ ok: false, reason: "physical-hard-limit" });
    expect(overLimit.snapshot()).toEqual(before);
  });

  it("fails closed without Web Locks and changes no candidate bytes", async () => {
    const values: Record<string, string> = {
      [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
    };
    await addLooseGroup(values, WS, 3, [
      { projectId: PROJECT_A, kind: "active", state: fictionalState("Alpha") },
    ]);
    const storage = new MemoryWorkspaceStorageAdapter(values);
    const selection = await selectionForOnlyCandidate(storage);
    const before = storage.snapshot();
    const result = await recoverWorkspaceIndex(storage, null, {
      selection,
      ...alwaysReady(),
    });
    expect(result).toEqual({ ok: false, reason: "lock-unavailable" });
    expect(storage.snapshot()).toEqual(before);
  });

  it("cancels fresh index recovery when intent flips at its final source-removal guard", async () => {
    const values: Record<string, string> = {
      [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
    };
    await addLooseGroup(values, WS, 3, [
      { projectId: PROJECT_A, kind: "active", state: fictionalState("Alpha") },
      { projectId: PROJECT_C, kind: "tombstone" },
    ]);
    const sourceKey = workspaceProjectRecordKey(WS, 3, PROJECT_A);
    const targetKey = workspaceProjectRecordKey(WS, 4, PROJECT_A);
    let current = true;
    const storage = new FlipIntentDuringSourceConfirmationStorage(
      values,
      targetKey,
      sourceKey,
      () => {
        current = false;
      },
    );
    const selection = await selectionForOnlyCandidate(storage);
    const sourceBefore = storage.getItem(sourceKey);

    const result = await recoverWorkspaceIndex(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        selection,
        pendingSavesDrained: () => true,
        intentStillCurrent: () => current,
        uuidSource: new SequenceUuidSource([OPERATION]),
      },
    );

    expect(result).toEqual({ ok: false, reason: "intent-stale" });
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBeNull();
    expect(storage.getItem(sourceKey)).toBe(sourceBefore);
    expect(storage.getItem(targetKey)).toBeNull();
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    expect(storage.getItem(WORKSPACE_RESERVE_KEY)).toBe(CANONICAL_WORKSPACE_RESERVE);
    const resumed = await resumeWorkspaceGenerationOperation(
      storage,
      new SerialWorkspaceLockRunner(),
    );
    expect(resumed).toEqual({
      ok: true,
      status: "no-operation-no-authority",
      authority: "none",
    });
  });

  it("retains the recovery journal and source when its target changes during cancellation", async () => {
    const values: Record<string, string> = {
      [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
    };
    await addLooseGroup(values, WS, 3, [
      { projectId: PROJECT_A, kind: "active", state: fictionalState("Alpha") },
      { projectId: PROJECT_C, kind: "tombstone" },
    ]);
    const sourceKey = workspaceProjectRecordKey(WS, 3, PROJECT_A);
    const targetKey = workspaceProjectRecordKey(WS, 4, PROJECT_A);
    let current = true;
    const storage = new CancellationSnapshotRaceStorage(
      values,
      targetKey,
      sourceKey,
      "replace-target",
      () => {
        current = false;
      },
    );
    const selection = await selectionForOnlyCandidate(storage);
    const sourceBefore = storage.getItem(sourceKey);

    const result = await recoverWorkspaceIndex(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        selection,
        pendingSavesDrained: () => true,
        intentStillCurrent: () => current,
        uuidSource: new SequenceUuidSource([OPERATION]),
      },
    );

    expect(result).toEqual({ ok: false, reason: "commit-incomplete" });
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBeNull();
    expect(storage.getItem(sourceKey)).toBe(sourceBefore);
    expect(storage.getItem(targetKey)).toBe("third-target-after-final-await");
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).not.toBeNull();
  });

  it("restores only the reserve after a pre-journal crash and still grants no authority", async () => {
    const faults = new DeterministicFaultController();
    const values: Record<string, string> = {
      [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
    };
    await addLooseGroup(values, WS, 3, [
      { projectId: PROJECT_A, kind: "active", state: fictionalState("Alpha") },
    ]);
    const storage = new MemoryWorkspaceStorageAdapter(values, faults);
    const selection = await selectionForOnlyCandidate(storage);
    faults.armAtCheckpoint("reserve-removal", "crash");
    const interrupted = await recoverWorkspaceIndex(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        selection,
        ...alwaysReady(),
        uuidSource: new SequenceUuidSource([OPERATION]),
      },
    );
    expect(interrupted).toEqual({ ok: false, reason: "lock-failed" });
    faults.clear();

    const reserved = await resumeWorkspaceGenerationOperation(
      storage,
      new SerialWorkspaceLockRunner(),
    );
    expect(reserved).toEqual({
      ok: true,
      status: "reserve-recreated-no-authority",
      authority: "none",
    });
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBeNull();
    expect(storage.getItem(WORKSPACE_RESERVE_KEY)).toBe(CANONICAL_WORKSPACE_RESERVE);

    const explicitRetry = await recoverWorkspaceIndex(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        selection,
        ...alwaysReady(),
        uuidSource: new SequenceUuidSource([OPERATION_2]),
      },
    );
    expect(explicitRetry.ok).toBe(true);
  });

  it.each([
    "journal-phase-update",
    "project-target-write",
    "source-cleanup",
    "index-commit",
    "journal-removal",
    "reserve-recreation",
  ])("rolls forward an explicitly selected group after a crash at %s", async (checkpoint) => {
    const faults = new DeterministicFaultController();
    const alpha = fictionalState("Alpha");
    const values: Record<string, string> = {
      [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
    };
    await addLooseGroup(values, WS, 3, [
      { projectId: PROJECT_A, kind: "active", state: alpha, revision: 2 },
      { projectId: PROJECT_C, kind: "tombstone" },
    ]);
    const storage = new MemoryWorkspaceStorageAdapter(values, faults);
    const selection = await selectionForOnlyCandidate(storage);
    faults.armAtCheckpoint(checkpoint, "crash");
    const interrupted = await recoverWorkspaceIndex(
      storage,
      new SerialWorkspaceLockRunner(),
      {
        selection,
        ...alwaysReady(),
        uuidSource: new SequenceUuidSource([OPERATION]),
      },
    );
    expect(interrupted).toEqual({ ok: false, reason: "lock-failed" });
    faults.clear();

    const resumed = await resumeWorkspaceGenerationOperation(
      storage,
      new SerialWorkspaceLockRunner(),
    );
    expect(resumed.ok, checkpoint).toBe(true);
    const authority = await readWorkspaceAuthority(storage);
    expect(authority.ok, checkpoint).toBe(true);
    if (!authority.ok) return;
    expect(authority.snapshot.index).toMatchObject({
      workspaceId: WS,
      workspaceGeneration: 4,
      revision: 1,
      projects: [{ projectId: PROJECT_A, kind: "active" }],
    });
    await expectActiveProject(storage, WS, 4, PROJECT_A, alpha, 3);
  });

  it("quarantines a third target during explicit recovery", async () => {
    const faults = new DeterministicFaultController();
    const values: Record<string, string> = {
      [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
    };
    await addLooseGroup(values, WS, 3, [
      { projectId: PROJECT_A, kind: "active", state: fictionalState("Alpha") },
    ]);
    const storage = new MemoryWorkspaceStorageAdapter(values, faults);
    const selection = await selectionForOnlyCandidate(storage);
    faults.armAtCheckpoint("journal-phase-update", "crash");
    await recoverWorkspaceIndex(storage, new SerialWorkspaceLockRunner(), {
      selection,
      ...alwaysReady(),
      uuidSource: new SequenceUuidSource([OPERATION]),
    });
    faults.clear();
    const rawJournal = storage.getItem(WORKSPACE_OPERATION_KEY);
    if (rawJournal === null) throw new Error("Expected recovery journal");
    const journal = parseWorkspaceJournal(rawJournal);
    if (!journal.ok) throw new Error("Expected recovery journal");
    const mutation = journal.value.projectMutations[0];
    if (!mutation) throw new Error("Expected recovery mutation");
    storage.setItem(mutation.targetRecord.key, "third-target");

    const resumed = await resumeWorkspaceGenerationOperation(
      storage,
      new SerialWorkspaceLockRunner(),
    );
    expect(resumed).toMatchObject({ ok: false, reason: "quarantine" });
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBe(rawJournal);
  });
});
