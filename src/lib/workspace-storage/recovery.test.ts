import { describe, expect, it } from "vitest";
import { sha256StoredString } from "@/lib/workspace-storage/digest";
import {
  LEGACY_PROJECT_KEYS,
  WORKSPACE_INDEX_KEY,
  WORKSPACE_OPERATION_KEY,
  WORKSPACE_RESERVE_KEY,
  parseWorkspaceProjectRecordKey,
  workspaceProjectRecordKey,
} from "@/lib/workspace-storage/keys";
import {
  serializeWorkspaceJournal,
  serializeWorkspaceProjectRecord,
} from "@/lib/workspace-storage/protocol";
import {
  classifyPreJournalReserveFailure,
  classifyWorkspaceRecovery,
  prepareWorkspaceJournal,
} from "@/lib/workspace-storage/recovery";
import { CANONICAL_WORKSPACE_RESERVE } from "@/lib/workspace-storage/reserve";
import {
  DeterministicFaultController,
  MemoryWorkspaceStorageAdapter,
  WorkspaceStorageFault,
  readExact,
  recreateWorkspaceReserve,
  removeExact,
  removeWorkspaceCleanupSource,
  removeWorkspaceJournal,
  writeExact,
  writeWorkspaceIndexTarget,
  writeWorkspaceProjectTarget,
  type WorkspaceStorageAdapter,
} from "@/lib/workspace-storage/storage-adapter";
import {
  activeIndex,
  activeProjectRecord,
  canonicalIndexBytes,
  canonicalProjectRecordBytes,
  journalFor,
  LEGACY_ACTIVE_RECORD_RAW,
  PROJECT_A,
  PROJECT_B,
  WS,
  WS_OTHER,
} from "@/lib/workspace-storage/test-fixtures";
import type {
  WorkspaceOperationJournalV1,
  WorkspaceOperationKind,
} from "@/lib/workspace-storage/types";

async function digest(value: string): Promise<string> {
  const result = await sha256StoredString(value);
  if (!result.ok) throw new Error("digest unavailable in test fixture");
  return result.digest;
}

interface RecoveryFixture {
  journal: WorkspaceOperationJournalV1;
  rawJournal: string;
  storage: MemoryWorkspaceStorageAdapter;
  baseIndexRaw: string | null;
  targetRecordRaw: string;
  sourceRecordRaw: string;
  legacyRaw: string;
}

async function recoveryFixture(kind: WorkspaceOperationKind): Promise<RecoveryFixture> {
  const journal = await journalFor(kind);
  const baseIndexValue = activeIndex({
    legacyFingerprints: journal.legacyExpectedDigests,
  });
  const baseIndexRaw = journal.baseIndex.expectedDigest === null
    ? null
    : (await canonicalIndexBytes(baseIndexValue)).serialized;
  const sourceProject = await canonicalProjectRecordBytes(activeProjectRecord(PROJECT_A));
  const sourceRecordRaw = sourceProject.serialized;
  if (sourceProject.value.value.kind !== "project") {
    throw new Error("active fixture unexpectedly tombstoned");
  }
  const mutation = journal.projectMutations[0];
  const targetProject = mutation
    ? await canonicalProjectRecordBytes(
        activeProjectRecord(mutation.projectId, {
          workspaceGeneration: journal.targetGeneration,
          revision:
            mutation.mode === "create" ? 1 : 2,
          value:
            mutation.mode === "delete"
              ? { kind: "tombstone" }
              : { kind: "project", state: sourceProject.value.value.state },
        }),
      )
    : sourceProject;
  const targetRecordRaw = targetProject.serialized;
  const legacyRaw = LEGACY_ACTIVE_RECORD_RAW;

  const serialized = serializeWorkspaceJournal(journal);
  if (!serialized.ok) throw new Error(`invalid ${kind} recovery fixture`);
  const values: Record<string, string> = {
    [WORKSPACE_OPERATION_KEY]: serialized.serialized,
  };
  if (baseIndexRaw !== null) {
    values[WORKSPACE_INDEX_KEY] = baseIndexRaw;
    for (const entry of baseIndexValue.projects) {
      const baseRecord = await canonicalProjectRecordBytes(
        activeProjectRecord(entry.projectId, {
          workspaceId: baseIndexValue.workspaceId,
          workspaceGeneration: baseIndexValue.workspaceGeneration,
          value:
            entry.kind === "active"
              ? sourceProject.value.value
              : { kind: "tombstone" },
        }),
      );
      values[
        workspaceProjectRecordKey(
          baseIndexValue.workspaceId,
          baseIndexValue.workspaceGeneration,
          entry.projectId,
        )
      ] = baseRecord.serialized;
    }
  }
  for (const mutation of journal.projectMutations) {
    if (mutation.targetRecord.expectedBeforeDigest !== null) {
      values[mutation.targetRecord.key] = sourceRecordRaw;
    }
    if (mutation.sourceRecord) values[mutation.sourceRecord.key] = sourceRecordRaw;
  }
  if (journal.legacyExpectedDigests.record !== null) {
    values[LEGACY_PROJECT_KEYS.record] = legacyRaw;
  }
  for (const cleanup of journal.cleanup) {
    const identity = parseWorkspaceProjectRecordKey(cleanup.key);
    if (identity && values[cleanup.key] === undefined) {
      values[cleanup.key] = sourceRecordRaw;
    }
  }
  return {
    journal,
    rawJournal: serialized.serialized,
    storage: new MemoryWorkspaceStorageAdapter(values),
    baseIndexRaw,
    targetRecordRaw,
    sourceRecordRaw,
    legacyRaw,
  };
}

function preparationStorage(
  fixture: RecoveryFixture,
  reserve: string | null = CANONICAL_WORKSPACE_RESERVE,
): MemoryWorkspaceStorageAdapter {
  const values = { ...fixture.storage.snapshot() };
  delete values[WORKSPACE_OPERATION_KEY];
  if (reserve === null) delete values[WORKSPACE_RESERVE_KEY];
  else values[WORKSPACE_RESERVE_KEY] = reserve;
  return new MemoryWorkspaceStorageAdapter(values);
}

function preparationOptions(
  fixture: RecoveryFixture,
  releaseReserve: boolean,
): { releaseReserve: boolean; targetRecords: Record<string, string> } {
  return {
    releaseReserve,
    targetRecords: Object.fromEntries(
      fixture.journal.projectMutations.map((mutation) => [
        mutation.targetRecord.key,
        fixture.targetRecordRaw,
      ]),
    ),
  };
}

async function runRepresentativeRotationSequence(
  fixture: RecoveryFixture,
  storage: MemoryWorkspaceStorageAdapter,
): Promise<void> {
  const mutation = fixture.journal.projectMutations[0];
  if (!mutation?.sourceCleanup) throw new Error("rotation cleanup fixture missing");
  const prepared = await prepareWorkspaceJournal(
    storage,
    fixture.journal,
    preparationOptions(fixture, true),
  );
  if (!prepared.ok) return;
  const projectWrite = await writeWorkspaceProjectTarget(
    storage,
    mutation.targetRecord.key,
    fixture.targetRecordRaw,
    {
      expectedBeforeDigest: mutation.targetRecord.expectedBeforeDigest,
      targetDigest: mutation.targetRecord.targetDigest,
    },
  );
  if (!projectWrite.ok) return;
  const sourceRemoval = await removeWorkspaceCleanupSource(
    storage,
    mutation.sourceCleanup.key,
    { expectedBeforeDigest: mutation.sourceCleanup.expectedDigest },
  );
  if (!sourceRemoval.ok) return;
  const indexWrite = await writeWorkspaceIndexTarget(
    storage,
    fixture.journal.targetIndex.serializedValue,
    {
      expectedBeforeDigest: fixture.journal.baseIndex.expectedDigest,
      targetDigest: fixture.journal.targetIndex.targetDigest,
    },
  );
  if (!indexWrite.ok) return;
  const journalRemoval = await removeWorkspaceJournal(storage, {
    expectedBeforeDigest: await digest(fixture.rawJournal),
  });
  if (!journalRemoval.ok) return;
  recreateWorkspaceReserve(storage, CANONICAL_WORKSPACE_RESERVE);
}

describe("workspace recovery classification", () => {
  it("classifies the exact all-before state for every operation without trusting phase", async () => {
    const cases: Array<[WorkspaceOperationKind, "cancel-or-roll-forward" | "roll-forward"]> = [
      ["migrate-single-project", "roll-forward"],
      ["create-project", "cancel-or-roll-forward"],
      ["delete-project", "cancel-or-roll-forward"],
      ["restore-as-new", "cancel-or-roll-forward"],
      ["replace-project", "cancel-or-roll-forward"],
      ["legacy-cleanup", "cancel-or-roll-forward"],
      ["recover-index", "roll-forward"],
      ["delete-workspace", "cancel-or-roll-forward"],
      ["rotate-workspace-generation", "roll-forward"],
    ];
    for (const [kind, expectedStatus] of cases) {
      const fixture = await recoveryFixture(kind);
      const result = await classifyWorkspaceRecovery(fixture.storage, fixture.rawJournal);
      expect(result.status, kind).toBe(expectedStatus);

      fixture.journal.phase = "cleanup-pending";
      const changedPhase = serializeWorkspaceJournal(fixture.journal);
      if (!changedPhase.ok) throw new Error("phase fixture invalid");
      fixture.storage.setItem(WORKSPACE_OPERATION_KEY, changedPhase.serialized);
      const sameBytesResult = await classifyWorkspaceRecovery(
        fixture.storage,
        changedPhase.serialized,
      );
      expect(sameBytesResult.status, `${kind} phase independence`).toBe(result.status);
    }
  });

  it("rolls forward mixed expected and target records before index commit", async () => {
    const fixture = await recoveryFixture("create-project");
    const mutation = fixture.journal.projectMutations[0];
    fixture.storage.setItem(mutation.targetRecord.key, fixture.targetRecordRaw);
    const result = await classifyWorkspaceRecovery(fixture.storage, fixture.rawJournal);
    expect(result.status).toBe("roll-forward");
    expect(result.observations).toContainEqual({
      key: mutation.targetRecord.key,
      role: "target-record",
      state: "target",
    });
  });

  it("requires every target before accepting a committed target index", async () => {
    const fixture = await recoveryFixture("create-project");
    fixture.storage.setItem(WORKSPACE_INDEX_KEY, fixture.journal.targetIndex.serializedValue);
    const result = await classifyWorkspaceRecovery(fixture.storage, fixture.rawJournal);
    expect(result).toMatchObject({
      status: "quarantine",
      reason: "missing-required-target",
    });
  });

  it("quarantines missing required targets for every project-mutation operation", async () => {
    const kinds: WorkspaceOperationKind[] = [
      "migrate-single-project",
      "create-project",
      "delete-project",
      "restore-as-new",
      "replace-project",
      "recover-index",
      "rotate-workspace-generation",
    ];
    for (const kind of kinds) {
      const fixture = await recoveryFixture(kind);
      const mutation = fixture.journal.projectMutations[0];
      if (kind === "replace-project") {
        fixture.storage.removeItem(mutation.targetRecord.key);
      } else {
        fixture.storage.setItem(WORKSPACE_INDEX_KEY, fixture.journal.targetIndex.serializedValue);
      }
      expect(await classifyWorkspaceRecovery(fixture.storage, fixture.rawJournal), kind).toMatchObject({
        status: "quarantine",
        reason: "missing-required-target",
      });
    }
  });

  it("quarantines a missing expected index or selected project record", async () => {
    const missingIndex = await recoveryFixture("delete-project");
    missingIndex.storage.removeItem(WORKSPACE_INDEX_KEY);
    expect(await classifyWorkspaceRecovery(missingIndex.storage, missingIndex.rawJournal)).toMatchObject({
      status: "quarantine",
      reason: "missing-required-target",
    });

    const missingRecord = await recoveryFixture("delete-project");
    missingRecord.storage.removeItem(missingRecord.journal.projectMutations[0].targetRecord.key);
    expect(await classifyWorkspaceRecovery(missingRecord.storage, missingRecord.rawJournal)).toMatchObject({
      status: "quarantine",
      reason: "missing-required-target",
    });
  });

  it("finishes exact cleanup after target authority commits", async () => {
    const fixture = await recoveryFixture("delete-project");
    const mutation = fixture.journal.projectMutations[0];
    fixture.storage.setItem(mutation.targetRecord.key, fixture.targetRecordRaw);
    fixture.storage.setItem(WORKSPACE_INDEX_KEY, fixture.journal.targetIndex.serializedValue);
    const result = await classifyWorkspaceRecovery(fixture.storage, fixture.rawJournal);
    expect(result.status).toBe("complete");
  });

  it("handles generation rotation source-only, source-plus-target, and target-only states", async () => {
    const sourceOnly = await recoveryFixture("rotate-workspace-generation");
    expect((await classifyWorkspaceRecovery(sourceOnly.storage, sourceOnly.rawJournal)).status).toBe("roll-forward");

    const sourcePlusTarget = await recoveryFixture("rotate-workspace-generation");
    const mutation = sourcePlusTarget.journal.projectMutations[0];
    sourcePlusTarget.storage.setItem(mutation.targetRecord.key, sourcePlusTarget.targetRecordRaw);
    expect((await classifyWorkspaceRecovery(sourcePlusTarget.storage, sourcePlusTarget.rawJournal)).status).toBe("roll-forward");

    const targetOnly = await recoveryFixture("rotate-workspace-generation");
    const targetMutation = targetOnly.journal.projectMutations[0];
    targetOnly.storage.setItem(targetMutation.targetRecord.key, targetOnly.targetRecordRaw);
    targetOnly.storage.removeItem(targetMutation.sourceRecord!.key);
    expect((await classifyWorkspaceRecovery(targetOnly.storage, targetOnly.rawJournal)).status).toBe("roll-forward");
  });

  it("keeps target authority and finishes source cleanup after generation rotation", async () => {
    const fixture = await recoveryFixture("rotate-workspace-generation");
    const mutation = fixture.journal.projectMutations[0];
    fixture.storage.setItem(mutation.targetRecord.key, fixture.targetRecordRaw);
    fixture.storage.setItem(WORKSPACE_INDEX_KEY, fixture.journal.targetIndex.serializedValue);
    expect((await classifyWorkspaceRecovery(fixture.storage, fixture.rawJournal)).status).toBe(
      "finish-cleanup",
    );
    fixture.storage.removeItem(mutation.sourceRecord!.key);
    expect((await classifyWorkspaceRecovery(fixture.storage, fixture.rawJournal)).status).toBe(
      "complete",
    );
  });

  it("recovers a two-project rotation after every partial source-target transition", async () => {
    const sourceA = await canonicalProjectRecordBytes(activeProjectRecord(PROJECT_A));
    const sourceB = await canonicalProjectRecordBytes(activeProjectRecord(PROJECT_B));
    const targetA = await canonicalProjectRecordBytes(
      activeProjectRecord(PROJECT_A, { workspaceGeneration: 2, revision: 2 }),
    );
    const targetB = await canonicalProjectRecordBytes(
      activeProjectRecord(PROJECT_B, { workspaceGeneration: 2, revision: 2 }),
    );
    const base = await canonicalIndexBytes(
      activeIndex({
        projects: [
          { projectId: PROJECT_A, kind: "active" },
          { projectId: PROJECT_B, kind: "active" },
        ],
      }),
    );
    const target = await canonicalIndexBytes(
      activeIndex({
        workspaceGeneration: 2,
        revision: 2,
        projects: [
          { projectId: PROJECT_A, kind: "active" },
          { projectId: PROJECT_B, kind: "active" },
        ],
      }),
    );
    const sourceKeyA = workspaceProjectRecordKey(WS, 1, PROJECT_A);
    const sourceKeyB = workspaceProjectRecordKey(WS, 1, PROJECT_B);
    const targetKeyA = workspaceProjectRecordKey(WS, 2, PROJECT_A);
    const targetKeyB = workspaceProjectRecordKey(WS, 2, PROJECT_B);
    const journal = await journalFor("rotate-workspace-generation");
    journal.baseIndex.expectedDigest = base.digest;
    journal.targetIndex = {
      key: WORKSPACE_INDEX_KEY,
      serializedValue: target.serialized,
      targetDigest: target.digest,
    };
    journal.projectMutations = [
      {
        mode: "rewrite-generation",
        projectId: PROJECT_A,
        sourceRecord: { key: sourceKeyA, expectedDigest: sourceA.digest },
        targetRecord: {
          key: targetKeyA,
          expectedBeforeDigest: null,
          targetDigest: targetA.digest,
        },
        sourceCleanup: { key: sourceKeyA, expectedDigest: sourceA.digest },
      },
      {
        mode: "rewrite-generation",
        projectId: PROJECT_B,
        sourceRecord: { key: sourceKeyB, expectedDigest: sourceB.digest },
        targetRecord: {
          key: targetKeyB,
          expectedBeforeDigest: null,
          targetDigest: targetB.digest,
        },
        sourceCleanup: { key: sourceKeyB, expectedDigest: sourceB.digest },
      },
    ];
    const serialized = serializeWorkspaceJournal(journal);
    if (!serialized.ok) throw new Error("two-project rotation journal invalid");
    const storage = new MemoryWorkspaceStorageAdapter({
      [WORKSPACE_OPERATION_KEY]: serialized.serialized,
      [WORKSPACE_INDEX_KEY]: base.serialized,
      [sourceKeyA]: sourceA.serialized,
      [sourceKeyB]: sourceB.serialized,
    });

    expect((await classifyWorkspaceRecovery(storage, serialized.serialized)).status).toBe(
      "roll-forward",
    );
    storage.setItem(targetKeyA, targetA.serialized);
    expect((await classifyWorkspaceRecovery(storage, serialized.serialized)).status).toBe(
      "roll-forward",
    );
    storage.removeItem(sourceKeyA);
    expect((await classifyWorkspaceRecovery(storage, serialized.serialized)).status).toBe(
      "roll-forward",
    );
    storage.setItem(targetKeyB, targetB.serialized);
    expect((await classifyWorkspaceRecovery(storage, serialized.serialized)).status).toBe(
      "roll-forward",
    );
    storage.setItem(WORKSPACE_INDEX_KEY, target.serialized);
    expect((await classifyWorkspaceRecovery(storage, serialized.serialized)).status).toBe(
      "finish-cleanup",
    );
    storage.removeItem(sourceKeyB);
    expect((await classifyWorkspaceRecovery(storage, serialized.serialized)).status).toBe(
      "complete",
    );
  });

  it("blocks generation rotation when any owned record is invalid", async () => {
    const fixture = await recoveryFixture("rotate-workspace-generation");
    fixture.storage.setItem(
      `rubrictrail.workspace.${WS}.generation.1.project.${PROJECT_B}.v1`,
      "{invalid-owned-record",
    );
    expect(await classifyWorkspaceRecovery(fixture.storage, fixture.rawJournal)).toMatchObject({
      status: "quarantine",
      reason: "invalid-owned-record",
    });
  });

  it("permits rotation cleanup only for a strict matching tombstone envelope", async () => {
    const fixture = await recoveryFixture("rotate-workspace-generation");
    const tombstoneKey = `rubrictrail.workspace.${WS}.generation.1.project.${PROJECT_B}.v1`;
    const tombstone = serializeWorkspaceProjectRecord(
      activeProjectRecord(PROJECT_B, { revision: 2, value: { kind: "tombstone" } }),
    );
    if (!tombstone.ok) throw new Error("tombstone fixture invalid");
    const tombstoneDigest = await digest(tombstone.serialized);
    const indexedBase = await canonicalIndexBytes(
      activeIndex({
        projects: [
          { projectId: PROJECT_A, kind: "active" },
          { projectId: PROJECT_B, kind: "tombstone" },
        ],
      }),
    );
    fixture.journal.baseIndex.expectedDigest = indexedBase.digest;
    fixture.journal.cleanup = [{ key: tombstoneKey, expectedDigest: tombstoneDigest }];
    const journal = serializeWorkspaceJournal(fixture.journal);
    if (!journal.ok) throw new Error("rotation tombstone journal invalid");
    fixture.storage.setItem(WORKSPACE_INDEX_KEY, indexedBase.serialized);
    fixture.storage.setItem(WORKSPACE_OPERATION_KEY, journal.serialized);
    fixture.storage.setItem(tombstoneKey, tombstone.serialized);
    expect((await classifyWorkspaceRecovery(fixture.storage, journal.serialized)).status).toBe(
      "roll-forward",
    );

    const activeAtCleanupKey = serializeWorkspaceProjectRecord(activeProjectRecord(PROJECT_B));
    if (!activeAtCleanupKey.ok) throw new Error("active cleanup fixture invalid");
    fixture.storage.setItem(tombstoneKey, activeAtCleanupKey.serialized);
    expect(await classifyWorkspaceRecovery(fixture.storage, journal.serialized)).toMatchObject({
      status: "quarantine",
      reason: "invalid-owned-record",
    });
  });

  it("resumes partial legacy cleanup only for exact expected or absent values", async () => {
    const fixture = await recoveryFixture("legacy-cleanup");
    fixture.storage.setItem(WORKSPACE_INDEX_KEY, fixture.journal.targetIndex.serializedValue);
    expect((await classifyWorkspaceRecovery(fixture.storage, fixture.rawJournal)).status).toBe("finish-cleanup");
    fixture.storage.removeItem(LEGACY_PROJECT_KEYS.record);
    expect((await classifyWorkspaceRecovery(fixture.storage, fixture.rawJournal)).status).toBe("complete");
  });

  it("tracks all four exact legacy digests and completes only after every removal", async () => {
    const fixture = await recoveryFixture("legacy-cleanup");
    const legacyValues = {
      record: "fictional-record-v071",
      v3: "fictional-v3",
      v2: "fictional-v2",
      v1: "fictional-v1",
    };
    for (const name of ["record", "v3", "v2", "v1"] as const) {
      fixture.journal.legacyExpectedDigests[name] = await digest(legacyValues[name]);
      fixture.storage.setItem(LEGACY_PROJECT_KEYS[name], legacyValues[name]);
    }
    const baseIndex = await canonicalIndexBytes(
      activeIndex({ legacyFingerprints: fixture.journal.legacyExpectedDigests }),
    );
    fixture.journal.baseIndex.expectedDigest = baseIndex.digest;
    fixture.journal.cleanup = (["record", "v3", "v2", "v1"] as const).map((name) => ({
      key: LEGACY_PROJECT_KEYS[name],
      expectedDigest: fixture.journal.legacyExpectedDigests[name]!,
    }));
    const serialized = serializeWorkspaceJournal(fixture.journal);
    if (!serialized.ok) throw new Error("four-key cleanup fixture invalid");
    fixture.storage.setItem(WORKSPACE_OPERATION_KEY, serialized.serialized);
    fixture.storage.setItem(WORKSPACE_INDEX_KEY, fixture.journal.targetIndex.serializedValue);
    for (const name of ["record", "v3", "v2"] as const) {
      fixture.storage.removeItem(LEGACY_PROJECT_KEYS[name]);
      expect(
        (await classifyWorkspaceRecovery(fixture.storage, serialized.serialized)).status,
        name,
      ).toBe("finish-cleanup");
    }
    fixture.storage.removeItem(LEGACY_PROJECT_KEYS.v1);
    expect(
      (await classifyWorkspaceRecovery(fixture.storage, serialized.serialized)).status,
    ).toBe("complete");
  });

  it("keeps a cleared delete-workspace index authoritative during partial exact cleanup", async () => {
    const fixture = await recoveryFixture("delete-workspace");
    fixture.storage.setItem(WORKSPACE_INDEX_KEY, fixture.journal.targetIndex.serializedValue);
    expect((await classifyWorkspaceRecovery(fixture.storage, fixture.rawJournal)).status).toBe(
      "finish-cleanup",
    );
    fixture.storage.removeItem(LEGACY_PROJECT_KEYS.record);
    expect((await classifyWorkspaceRecovery(fixture.storage, fixture.rawJournal)).status).toBe(
      "finish-cleanup",
    );
    const projectCleanup = fixture.journal.cleanup.find((entry) =>
      parseWorkspaceProjectRecordKey(entry.key),
    );
    if (!projectCleanup) throw new Error("delete-workspace project cleanup missing");
    fixture.storage.removeItem(projectCleanup.key);
    expect((await classifyWorkspaceRecovery(fixture.storage, fixture.rawJournal)).status).toBe(
      "complete",
    );
  });

  it("treats migration and explicit index recovery targets as plans, never automatic authority", async () => {
    for (const kind of ["migrate-single-project", "recover-index"] as const) {
      const fixture = await recoveryFixture(kind);
      const mutation = fixture.journal.projectMutations[0];
      fixture.storage.setItem(mutation.targetRecord.key, fixture.targetRecordRaw);
      const result = await classifyWorkspaceRecovery(fixture.storage, fixture.rawJournal);
      expect(result.status, kind).toBe("roll-forward");
      expect(result.nextActions).toContain("write-exact-target-index");
    }
  });

  it("quarantines a third-value index for every operation kind", async () => {
    const kinds: WorkspaceOperationKind[] = [
      "migrate-single-project",
      "create-project",
      "delete-project",
      "restore-as-new",
      "replace-project",
      "legacy-cleanup",
      "recover-index",
      "delete-workspace",
      "rotate-workspace-generation",
    ];
    for (const kind of kinds) {
      const fixture = await recoveryFixture(kind);
      fixture.storage.setItem(WORKSPACE_INDEX_KEY, "third-index");
      expect(await classifyWorkspaceRecovery(fixture.storage, fixture.rawJournal), kind).toMatchObject({
        status: "quarantine",
        reason: "third-value",
      });
    }
  });

  it("quarantines any third-value project, source, cleanup, or old-tab legacy rewrite", async () => {
    const alternateSource = serializeWorkspaceProjectRecord(
      activeProjectRecord(undefined, { revision: 99 }),
    );
    if (!alternateSource.ok) throw new Error("alternate source fixture invalid");
    const cases: Array<[WorkspaceOperationKind, (fixture: RecoveryFixture) => void]> = [
      ["create-project", (fixture) => fixture.storage.setItem(WORKSPACE_INDEX_KEY, "third-index")],
      ["create-project", (fixture) => fixture.storage.setItem(fixture.journal.projectMutations[0].targetRecord.key, "third-target")],
      ["rotate-workspace-generation", (fixture) => fixture.storage.setItem(fixture.journal.projectMutations[0].sourceRecord!.key, alternateSource.serialized)],
      ["legacy-cleanup", (fixture) => fixture.storage.setItem(LEGACY_PROJECT_KEYS.record, "old-tab-rewrite")],
    ];
    for (const [kind, mutate] of cases) {
      const fixture = await recoveryFixture(kind);
      mutate(fixture);
      expect(await classifyWorkspaceRecovery(fixture.storage, fixture.rawJournal), kind).toMatchObject({
        status: "quarantine",
        reason: "third-value",
      });
    }
  });

  it("classifies committed target authority and exact cleanup for every operation kind", async () => {
    const kinds: WorkspaceOperationKind[] = [
      "migrate-single-project",
      "create-project",
      "delete-project",
      "restore-as-new",
      "replace-project",
      "legacy-cleanup",
      "recover-index",
      "delete-workspace",
      "rotate-workspace-generation",
    ];
    for (const kind of kinds) {
      const fixture = await recoveryFixture(kind);
      for (const mutation of fixture.journal.projectMutations) {
        fixture.storage.setItem(mutation.targetRecord.key, fixture.targetRecordRaw);
      }
      fixture.storage.setItem(WORKSPACE_INDEX_KEY, fixture.journal.targetIndex.serializedValue);
      const committed = await classifyWorkspaceRecovery(fixture.storage, fixture.rawJournal);
      const hasPendingCleanup =
        fixture.journal.cleanup.length > 0 ||
        fixture.journal.projectMutations.some((mutation) => mutation.sourceRecord !== null);
      expect(committed.status, `${kind} committed`).toBe(
        hasPendingCleanup ? "finish-cleanup" : "complete",
      );

      for (const mutation of fixture.journal.projectMutations) {
        if (mutation.sourceCleanup) fixture.storage.removeItem(mutation.sourceCleanup.key);
      }
      for (const cleanup of fixture.journal.cleanup) {
        fixture.storage.removeItem(cleanup.key);
      }
      expect(
        (await classifyWorkspaceRecovery(fixture.storage, fixture.rawJournal)).status,
        `${kind} cleaned`,
      ).toBe("complete");
    }
  });

  it("is deterministic and idempotent for every operation's same durable bytes", async () => {
    const kinds: WorkspaceOperationKind[] = [
      "migrate-single-project",
      "create-project",
      "delete-project",
      "restore-as-new",
      "replace-project",
      "legacy-cleanup",
      "recover-index",
      "delete-workspace",
      "rotate-workspace-generation",
    ];
    for (const kind of kinds) {
      const fixture = await recoveryFixture(kind);
      const first = await classifyWorkspaceRecovery(fixture.storage, fixture.rawJournal);
      const second = await classifyWorkspaceRecovery(fixture.storage, fixture.rawJournal);
      expect(second, kind).toEqual(first);
    }
  });

  it("rejects invalid journals before reading phase or project bytes", async () => {
    const result = await classifyWorkspaceRecovery(
      new MemoryWorkspaceStorageAdapter(),
      JSON.stringify({ phase: "index-committed", projectPayload: "private" }),
    );
    expect(result).toEqual({
      status: "quarantine",
      kind: null,
      observations: [],
      reason: "invalid-journal",
      nextActions: [],
    });
  });

  it("requires the supplied recovery bytes to equal the durable journal exactly", async () => {
    const missing = await recoveryFixture("create-project");
    missing.storage.removeItem(WORKSPACE_OPERATION_KEY);
    expect(await classifyWorkspaceRecovery(missing.storage, missing.rawJournal)).toMatchObject({
      status: "quarantine",
      reason: "third-value",
    });

    const replaced = await recoveryFixture("create-project");
    replaced.storage.setItem(WORKSPACE_OPERATION_KEY, "different-journal");
    expect(await classifyWorkspaceRecovery(replaced.storage, replaced.rawJournal)).toMatchObject({
      status: "quarantine",
      reason: "third-value",
    });
  });

  it("rejects digest-matching target bytes unless they are the exact required record kind and identity", async () => {
    const cases: Array<{
      kind: WorkspaceOperationKind;
      targetRaw(fixture: RecoveryFixture): Promise<string>;
    }> = [
      {
        kind: "create-project",
        targetRaw: async () => "{\"fictional\":\"not-a-project-envelope\"}",
      },
      {
        kind: "create-project",
        targetRaw: async () =>
          (await canonicalProjectRecordBytes(activeProjectRecord(PROJECT_A))).serialized,
      },
      {
        kind: "delete-project",
        targetRaw: async () =>
          (await canonicalProjectRecordBytes(activeProjectRecord(PROJECT_A, { revision: 2 })))
            .serialized,
      },
    ];

    for (const testCase of cases) {
      const fixture = await recoveryFixture(testCase.kind);
      const mutation = fixture.journal.projectMutations[0];
      const targetRaw = await testCase.targetRaw(fixture);
      mutation.targetRecord.targetDigest = await digest(targetRaw);
      const serialized = serializeWorkspaceJournal(fixture.journal);
      if (!serialized.ok) throw new Error(`${testCase.kind} invalid-target journal failed`);
      fixture.storage.setItem(WORKSPACE_OPERATION_KEY, serialized.serialized);
      fixture.storage.setItem(mutation.targetRecord.key, targetRaw);
      expect(
        await classifyWorkspaceRecovery(fixture.storage, serialized.serialized),
        testCase.kind,
      ).toMatchObject({ status: "quarantine", reason: "invalid-owned-record" });
    }
  });

  it("rejects a digest-matching but non-canonical base index before planning recovery", async () => {
    const fixture = await recoveryFixture("create-project");
    const invalidBase = "{\"formatVersion\":1,\"corrupt\":true}";
    fixture.journal.baseIndex.expectedDigest = await digest(invalidBase);
    const serialized = serializeWorkspaceJournal(fixture.journal);
    if (!serialized.ok) throw new Error("invalid-base journal fixture failed");
    fixture.storage.setItem(WORKSPACE_OPERATION_KEY, serialized.serialized);
    fixture.storage.setItem(WORKSPACE_INDEX_KEY, invalidBase);
    expect(await classifyWorkspaceRecovery(fixture.storage, serialized.serialized)).toMatchObject({
      status: "quarantine",
      reason: "invalid-owned-record",
    });
  });
});

describe("reserve, exact storage, and deterministic fault injection", () => {
  it("writes and removes only after exact readback", () => {
    const storage = new MemoryWorkspaceStorageAdapter();
    expect(writeExact(storage, "fixture", "value")).toEqual({ ok: true });
    expect(readExact(storage, "fixture")).toEqual({ ok: true, value: "value" });
    expect(removeExact(storage, "fixture")).toEqual({ ok: true });
  });

  it("simulates a deterministic readback mismatch without trusting setItem success", () => {
    const storage = new MemoryWorkspaceStorageAdapter();
    storage.setReadOverride("fixture", "different");
    expect(writeExact(storage, "fixture", "value")).toEqual({
      ok: false,
      reason: "readback-mismatch",
    });
  });

  it("reproduces crash, quota, and security faults by step or checkpoint", () => {
    const controller = new DeterministicFaultController();
    controller.armAtStep(2, "crash");
    controller.checkpoint("one");
    expect(() => controller.checkpoint("two")).toThrowError(WorkspaceStorageFault);
    controller.armAtCheckpoint("quota-boundary", "quota");
    expect(() => controller.checkpoint("quota-boundary")).toThrowError(
      expect.objectContaining({ kind: "quota" }),
    );
    controller.armAtCheckpoint("security-boundary", "security");
    expect(() => controller.checkpoint("security-boundary")).toThrowError(
      expect.objectContaining({ kind: "security" }),
    );
  });

  it("prepares a destructive journal only after reserve removal and exact readback", async () => {
    const fixture = await recoveryFixture("legacy-cleanup");
    const storage = preparationStorage(fixture);
    const result = await prepareWorkspaceJournal(
      storage,
      fixture.journal,
      preparationOptions(fixture, true),
    );
    expect(result).toMatchObject({ ok: true, status: "prepared" });
    expect(storage.snapshot()[WORKSPACE_RESERVE_KEY]).toBeUndefined();
    expect(storage.snapshot()[WORKSPACE_OPERATION_KEY]).toBe(
      result.ok ? result.serializedJournal : undefined,
    );
  });

  it("validates every planned target record before creating a durable journal", async () => {
    const invalidBytes = await recoveryFixture("create-project");
    const invalidStorage = preparationStorage(invalidBytes);
    const invalidBefore = invalidStorage.snapshot();
    const targetKey = invalidBytes.journal.projectMutations[0].targetRecord.key;
    expect(
      await prepareWorkspaceJournal(invalidStorage, invalidBytes.journal, {
        releaseReserve: false,
        targetRecords: { [targetKey]: "not-a-record" },
      }),
    ).toMatchObject({ ok: false, status: "failed", reason: "invalid-target-record" });
    expect(invalidStorage.snapshot()).toEqual(invalidBefore);

    const extraKey = await recoveryFixture("create-project");
    const extraStorage = preparationStorage(extraKey);
    expect(
      await prepareWorkspaceJournal(extraStorage, extraKey.journal, {
        ...preparationOptions(extraKey, false),
        targetRecords: {
          ...preparationOptions(extraKey, false).targetRecords,
          "unowned.extra": "not-used",
        },
      }),
    ).toMatchObject({ ok: false, reason: "invalid-target-record" });

    const staleRewrite = await recoveryFixture("rotate-workspace-generation");
    const mutation = staleRewrite.journal.projectMutations[0];
    const wrongRevision = await canonicalProjectRecordBytes(
      activeProjectRecord(PROJECT_A, { workspaceGeneration: 2, revision: 1 }),
    );
    mutation.targetRecord.targetDigest = wrongRevision.digest;
    const rewriteStorage = preparationStorage(staleRewrite);
    expect(
      await prepareWorkspaceJournal(rewriteStorage, staleRewrite.journal, {
        releaseReserve: false,
        targetRecords: { [mutation.targetRecord.key]: wrongRevision.serialized },
      }),
    ).toMatchObject({ ok: false, reason: "invalid-target-record" });
  });

  it("binds first migration to the exact resolved v0.7.1 authority", async () => {
    const altered = await recoveryFixture("migrate-single-project");
    const mutation = altered.journal.projectMutations[0];
    const alteredRecord = activeProjectRecord(mutation.projectId);
    if (alteredRecord.value.kind !== "project") {
      throw new Error("migration target fixture unexpectedly tombstoned");
    }
    alteredRecord.value.state = {
      ...alteredRecord.value.state,
      draftText: "Fictional but not derived from the retained legacy authority.",
    };
    const alteredTarget = await canonicalProjectRecordBytes(alteredRecord);
    mutation.targetRecord.targetDigest = alteredTarget.digest;
    const alteredJournal = serializeWorkspaceJournal(altered.journal);
    if (!alteredJournal.ok) throw new Error("altered migration journal invalid");
    altered.storage.setItem(WORKSPACE_OPERATION_KEY, alteredJournal.serialized);
    expect(
      await classifyWorkspaceRecovery(altered.storage, alteredJournal.serialized),
    ).toMatchObject({ status: "quarantine", reason: "invalid-owned-record" });
    const alteredStorage = preparationStorage(altered);
    const alteredBefore = alteredStorage.snapshot();
    expect(
      await prepareWorkspaceJournal(alteredStorage, altered.journal, {
        releaseReserve: false,
        targetRecords: { [mutation.targetRecord.key]: alteredTarget.serialized },
      }),
    ).toMatchObject({ ok: false, status: "failed", reason: "invalid-target-record" });
    expect(alteredStorage.snapshot()).toEqual(alteredBefore);

    const hidden = await recoveryFixture("migrate-single-project");
    const emptyTargetIndex = await canonicalIndexBytes(
      activeIndex({
        revision: 1,
        projects: [],
        legacyFingerprints: hidden.journal.legacyExpectedDigests,
      }),
    );
    hidden.journal.projectMutations = [];
    hidden.journal.targetIndex = {
      key: WORKSPACE_INDEX_KEY,
      serializedValue: emptyTargetIndex.serialized,
      targetDigest: emptyTargetIndex.digest,
    };
    const hiddenJournal = serializeWorkspaceJournal(hidden.journal);
    if (!hiddenJournal.ok) throw new Error("empty migration journal invalid");
    hidden.storage.setItem(WORKSPACE_OPERATION_KEY, hiddenJournal.serialized);
    expect(
      await classifyWorkspaceRecovery(hidden.storage, hiddenJournal.serialized),
    ).toMatchObject({ status: "quarantine", reason: "invalid-owned-record" });
    const hiddenStorage = preparationStorage(hidden);
    const hiddenBefore = hiddenStorage.snapshot();
    expect(
      await prepareWorkspaceJournal(hiddenStorage, hidden.journal, {
        releaseReserve: false,
        targetRecords: {},
      }),
    ).toMatchObject({ ok: false, status: "failed", reason: "invalid-target-record" });
    expect(hiddenStorage.snapshot()).toEqual(hiddenBefore);
  });

  it("migrates an exact v0.7.1 cleared record only to an active empty workspace", async () => {
    const clearedLegacyRaw = JSON.stringify({
      formatVersion: 1,
      revision: 1,
      value: { kind: "cleared" },
      legacyFingerprints: { v3: null, v2: null, v1: null },
    });
    const clearedDigest = await digest(clearedLegacyRaw);
    const fixture = await recoveryFixture("migrate-single-project");
    fixture.journal.legacyExpectedDigests = {
      record: clearedDigest,
      v3: null,
      v2: null,
      v1: null,
    };
    fixture.journal.projectMutations = [];
    const emptyTargetIndex = await canonicalIndexBytes(
      activeIndex({
        revision: 1,
        projects: [],
        legacyFingerprints: fixture.journal.legacyExpectedDigests,
      }),
    );
    fixture.journal.targetIndex = {
      key: WORKSPACE_INDEX_KEY,
      serializedValue: emptyTargetIndex.serialized,
      targetDigest: emptyTargetIndex.digest,
    };
    const storage = new MemoryWorkspaceStorageAdapter({
      [LEGACY_PROJECT_KEYS.record]: clearedLegacyRaw,
      [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
    });
    expect(
      await prepareWorkspaceJournal(storage, fixture.journal, {
        releaseReserve: false,
        targetRecords: {},
      }),
    ).toMatchObject({ ok: true, status: "prepared" });
    expect(storage.snapshot()[LEGACY_PROJECT_KEYS.record]).toBe(clearedLegacyRaw);
  });

  it("never starts first migration while any pre-existing workspace candidate exists", async () => {
    const candidateCases = [
      [workspaceProjectRecordKey(WS, 9, PROJECT_B), activeProjectRecord(PROJECT_B, {
        workspaceGeneration: 9,
      })],
      [workspaceProjectRecordKey(WS_OTHER, 1, PROJECT_B), activeProjectRecord(PROJECT_B, {
        workspaceId: WS_OTHER,
      })],
    ] as const;

    for (let count = 1; count <= candidateCases.length; count += 1) {
      const fixture = await recoveryFixture("migrate-single-project");
      for (const [key, record] of candidateCases.slice(0, count)) {
        const serializedRecord = await canonicalProjectRecordBytes(record);
        fixture.storage.setItem(key, serializedRecord.serialized);
      }
      expect(
        await classifyWorkspaceRecovery(fixture.storage, fixture.rawJournal),
        `${count} candidate group(s)`,
      ).toMatchObject({ status: "quarantine", reason: "invalid-owned-record" });

      const storage = preparationStorage(fixture);
      const before = storage.snapshot();
      expect(
        await prepareWorkspaceJournal(
          storage,
          fixture.journal,
          preparationOptions(fixture, false),
        ),
        `${count} candidate group(s)`,
      ).toMatchObject({ ok: false, status: "quarantine", reason: "baseline-conflict" });
      expect(storage.snapshot()).toEqual(before);
    }

    const partial = await recoveryFixture("migrate-single-project");
    const targetKey = partial.journal.projectMutations[0].targetRecord.key;
    partial.storage.setItem(targetKey, partial.targetRecordRaw);
    expect(
      (await classifyWorkspaceRecovery(partial.storage, partial.rawJournal)).status,
    ).toBe("roll-forward");
  });

  it("never lets recover-index replace an existing strict workspace index", async () => {
    for (const workspaceId of [WS, WS_OTHER]) {
      const fixture = await recoveryFixture("recover-index");
      const authoritativeIndex = await canonicalIndexBytes(activeIndex({ workspaceId }));
      const authoritativeRecord = await canonicalProjectRecordBytes(
        activeProjectRecord(PROJECT_A, { workspaceId }),
      );
      fixture.journal.baseIndex.expectedDigest = authoritativeIndex.digest;
      const serialized = serializeWorkspaceJournal(fixture.journal);
      if (!serialized.ok) throw new Error("recover-index authority fixture invalid");
      fixture.storage.setItem(WORKSPACE_INDEX_KEY, authoritativeIndex.serialized);
      fixture.storage.setItem(
        workspaceProjectRecordKey(workspaceId, 1, PROJECT_A),
        authoritativeRecord.serialized,
      );
      fixture.storage.setItem(WORKSPACE_OPERATION_KEY, serialized.serialized);

      expect(
        await classifyWorkspaceRecovery(fixture.storage, serialized.serialized),
        workspaceId,
      ).toMatchObject({ status: "quarantine", reason: "invalid-owned-record" });

      const storage = preparationStorage(fixture);
      const before = storage.snapshot();
      expect(
        await prepareWorkspaceJournal(
          storage,
          fixture.journal,
          preparationOptions(fixture, false),
        ),
        workspaceId,
      ).toMatchObject({ ok: false, status: "quarantine", reason: "baseline-conflict" });
      expect(storage.snapshot(), workspaceId).toEqual(before);
    }
  });

  it("allows explicit recover-index only when the observed index is missing or corrupt", async () => {
    const missing = await recoveryFixture("recover-index");
    expect(
      await prepareWorkspaceJournal(
        preparationStorage(missing),
        missing.journal,
        preparationOptions(missing, false),
      ),
    ).toMatchObject({ ok: true, status: "prepared" });

    const corrupt = await recoveryFixture("recover-index");
    const corruptIndex = "corrupt-workspace-index";
    corrupt.journal.baseIndex.expectedDigest = await digest(corruptIndex);
    const serialized = serializeWorkspaceJournal(corrupt.journal);
    if (!serialized.ok) throw new Error("corrupt-index recovery fixture invalid");
    corrupt.storage.setItem(WORKSPACE_INDEX_KEY, corruptIndex);
    corrupt.storage.setItem(WORKSPACE_OPERATION_KEY, serialized.serialized);
    expect(
      (await classifyWorkspaceRecovery(corrupt.storage, serialized.serialized)).status,
    ).toBe("roll-forward");
    expect(
      await prepareWorkspaceJournal(
        preparationStorage(corrupt),
        corrupt.journal,
        preparationOptions(corrupt, false),
      ),
    ).toMatchObject({ ok: true, status: "prepared" });

    const incomplete = await recoveryFixture("recover-index");
    const incompleteIndex = await canonicalIndexBytes(
      activeIndex({
        workspaceId: WS_OTHER,
        projects: [{ projectId: PROJECT_B, kind: "active" }],
      }),
    );
    incomplete.journal.baseIndex.expectedDigest = incompleteIndex.digest;
    const incompleteJournal = serializeWorkspaceJournal(incomplete.journal);
    if (!incompleteJournal.ok) throw new Error("incomplete-index recovery fixture invalid");
    incomplete.storage.setItem(WORKSPACE_INDEX_KEY, incompleteIndex.serialized);
    incomplete.storage.setItem(WORKSPACE_OPERATION_KEY, incompleteJournal.serialized);
    expect(
      (await classifyWorkspaceRecovery(
        incomplete.storage,
        incompleteJournal.serialized,
      )).status,
    ).toBe("roll-forward");
    expect(
      await prepareWorkspaceJournal(
        preparationStorage(incomplete),
        incomplete.journal,
        preparationOptions(incomplete, false),
      ),
    ).toMatchObject({ ok: true, status: "prepared" });
  });

  it("binds every generation rewrite digest to the exact source state and next revision", async () => {
    for (const kind of ["recover-index", "rotate-workspace-generation"] as const) {
      const fixture = await recoveryFixture(kind);
      const mutation = fixture.journal.projectMutations[0];
      const changed = activeProjectRecord(mutation.projectId, {
        workspaceGeneration: fixture.journal.targetGeneration,
        revision: 2,
      });
      if (changed.value.kind !== "project") {
        throw new Error("rewrite target fixture unexpectedly tombstoned");
      }
      changed.value.state = {
        ...changed.value.state,
        draftText: "A different fictional state must not pass as a generation rewrite.",
      };
      const changedTarget = await canonicalProjectRecordBytes(changed);
      mutation.targetRecord.targetDigest = changedTarget.digest;
      const serialized = serializeWorkspaceJournal(fixture.journal);
      if (!serialized.ok) throw new Error(`${kind} altered journal invalid`);
      fixture.storage.setItem(WORKSPACE_OPERATION_KEY, serialized.serialized);
      expect(
        await classifyWorkspaceRecovery(fixture.storage, serialized.serialized),
        kind,
      ).toMatchObject({ status: "quarantine", reason: "invalid-owned-record" });

      const storage = preparationStorage(fixture);
      const before = storage.snapshot();
      expect(
        await prepareWorkspaceJournal(storage, fixture.journal, {
          releaseReserve: false,
          targetRecords: { [mutation.targetRecord.key]: changedTarget.serialized },
        }),
        kind,
      ).toMatchObject({ ok: false, status: "failed", reason: "invalid-target-record" });
      expect(storage.snapshot()).toEqual(before);
    }
  });

  it("applies the recovery namespace role rules before creating a journal", async () => {
    const recover = await recoveryFixture("recover-index");
    const recoverStorage = preparationStorage(recover);
    const unexpectedTarget = await canonicalProjectRecordBytes(
      activeProjectRecord(PROJECT_B, { workspaceGeneration: 2 }),
    );
    recoverStorage.setItem(
      workspaceProjectRecordKey(WS, 2, PROJECT_B),
      unexpectedTarget.serialized,
    );
    const recoverBefore = recoverStorage.snapshot();
    expect(
      await prepareWorkspaceJournal(
        recoverStorage,
        recover.journal,
        preparationOptions(recover, false),
      ),
    ).toMatchObject({ ok: false, status: "quarantine", reason: "baseline-conflict" });
    expect(recoverStorage.snapshot()).toEqual(recoverBefore);

    const rotation = await recoveryFixture("rotate-workspace-generation");
    const rotationStorage = preparationStorage(rotation);
    const unexpectedSource = await canonicalProjectRecordBytes(activeProjectRecord(PROJECT_B));
    rotationStorage.setItem(
      workspaceProjectRecordKey(WS, 1, PROJECT_B),
      unexpectedSource.serialized,
    );
    const rotationBefore = rotationStorage.snapshot();
    expect(
      await prepareWorkspaceJournal(
        rotationStorage,
        rotation.journal,
        preparationOptions(rotation, false),
      ),
    ).toMatchObject({ ok: false, status: "quarantine", reason: "baseline-conflict" });
    expect(rotationStorage.snapshot()).toEqual(rotationBefore);

    const foreignInvalid = await recoveryFixture("rotate-workspace-generation");
    const foreignInvalidKey = workspaceProjectRecordKey(WS_OTHER, 1, PROJECT_B);
    foreignInvalid.storage.setItem(foreignInvalidKey, "invalid-owned-project-record");
    expect(
      await classifyWorkspaceRecovery(foreignInvalid.storage, foreignInvalid.rawJournal),
    ).toMatchObject({ status: "quarantine", reason: "invalid-owned-record" });
    const foreignInvalidPreparation = preparationStorage(foreignInvalid);
    const foreignInvalidBefore = foreignInvalidPreparation.snapshot();
    expect(
      await prepareWorkspaceJournal(
        foreignInvalidPreparation,
        foreignInvalid.journal,
        preparationOptions(foreignInvalid, false),
      ),
    ).toMatchObject({ ok: false, status: "quarantine", reason: "baseline-conflict" });
    expect(foreignInvalidPreparation.snapshot()).toEqual(foreignInvalidBefore);
  });

  it("requires delete-workspace to cover every discoverable owned project record", async () => {
    const fixture = await recoveryFixture("delete-workspace");
    const extraKey = workspaceProjectRecordKey(WS, 2, PROJECT_B);
    const extra = await canonicalProjectRecordBytes(
      activeProjectRecord(PROJECT_B, { workspaceGeneration: 2 }),
    );

    fixture.storage.setItem(extraKey, extra.serialized);
    expect(await classifyWorkspaceRecovery(fixture.storage, fixture.rawJournal)).toMatchObject({
      status: "quarantine",
      reason: "invalid-owned-record",
    });

    const preparation = preparationStorage(fixture);
    const before = preparation.snapshot();
    expect(
      await prepareWorkspaceJournal(
        preparation,
        fixture.journal,
        preparationOptions(fixture, true),
      ),
    ).toMatchObject({ ok: false, status: "quarantine", reason: "baseline-conflict" });
    expect(preparation.snapshot()).toEqual(before);
  });

  it("deletes explicitly captured project records across workspace groups without guessing", async () => {
    const fixture = await recoveryFixture("delete-workspace");
    const foreignKey = workspaceProjectRecordKey(WS_OTHER, 1, PROJECT_B);
    const foreign = await canonicalProjectRecordBytes(
      activeProjectRecord(PROJECT_B, { workspaceId: WS_OTHER }),
    );
    fixture.journal.cleanup.push({ key: foreignKey, expectedDigest: foreign.digest });
    const serialized = serializeWorkspaceJournal(fixture.journal);
    if (!serialized.ok) throw new Error("cross-workspace delete fixture invalid");
    fixture.storage.setItem(foreignKey, foreign.serialized);
    fixture.storage.setItem(WORKSPACE_OPERATION_KEY, serialized.serialized);

    expect(
      (await classifyWorkspaceRecovery(fixture.storage, serialized.serialized)).status,
    ).toBe("cancel-or-roll-forward");
    const preparation = preparationStorage(fixture);
    expect(
      await prepareWorkspaceJournal(
        preparation,
        fixture.journal,
        preparationOptions(fixture, true),
      ),
    ).toMatchObject({ ok: true, status: "prepared" });

    fixture.storage.setItem(WORKSPACE_INDEX_KEY, fixture.journal.targetIndex.serializedValue);
    fixture.storage.removeItem(foreignKey);
    expect(
      (await classifyWorkspaceRecovery(fixture.storage, serialized.serialized)).status,
    ).toBe("finish-cleanup");
    for (const cleanup of fixture.journal.cleanup) fixture.storage.removeItem(cleanup.key);
    expect(
      (await classifyWorkspaceRecovery(fixture.storage, serialized.serialized)).status,
    ).toBe("complete");

    const thirdValue = await recoveryFixture("delete-workspace");
    thirdValue.journal.cleanup.push({ key: foreignKey, expectedDigest: foreign.digest });
    const thirdSerialized = serializeWorkspaceJournal(thirdValue.journal);
    if (!thirdSerialized.ok) throw new Error("cross-workspace third-value fixture invalid");
    thirdValue.storage.setItem(foreignKey, "changed-after-confirmation");
    thirdValue.storage.setItem(WORKSPACE_OPERATION_KEY, thirdSerialized.serialized);
    expect(
      await classifyWorkspaceRecovery(thirdValue.storage, thirdSerialized.serialized),
    ).toMatchObject({ status: "quarantine", reason: "third-value" });
  });

  it("requires every record referenced by the base index before preparing an operation", async () => {
    for (const state of ["missing", "invalid"] as const) {
      const fixture = await recoveryFixture("legacy-cleanup");
      const storage = preparationStorage(fixture);
      const projectKey = workspaceProjectRecordKey(WS, 1, PROJECT_A);
      if (state === "missing") {
        fixture.storage.removeItem(projectKey);
        storage.removeItem(projectKey);
      } else {
        fixture.storage.setItem(projectKey, "not-a-workspace-project-record");
        storage.setItem(projectKey, "not-a-workspace-project-record");
      }
      expect(
        await classifyWorkspaceRecovery(fixture.storage, fixture.rawJournal),
        `${state} recovery`,
      ).toMatchObject({ status: "quarantine", reason: "invalid-owned-record" });
      const before = storage.snapshot();

      expect(
        await prepareWorkspaceJournal(
          storage,
          fixture.journal,
          preparationOptions(fixture, true),
        ),
        state,
      ).toMatchObject({ ok: false, status: "quarantine", reason: "baseline-conflict" });
      expect(storage.snapshot(), state).toEqual(before);
      expect(storage.snapshot()[LEGACY_PROJECT_KEYS.record], state).toBe(fixture.legacyRaw);
      expect(storage.snapshot()[WORKSPACE_OPERATION_KEY], state).toBeUndefined();
    }

    const committedCleanup = await recoveryFixture("legacy-cleanup");
    committedCleanup.storage.setItem(
      WORKSPACE_INDEX_KEY,
      committedCleanup.journal.targetIndex.serializedValue,
    );
    committedCleanup.storage.removeItem(workspaceProjectRecordKey(WS, 1, PROJECT_A));
    expect(
      await classifyWorkspaceRecovery(committedCleanup.storage, committedCleanup.rawJournal),
    ).toMatchObject({ status: "quarantine", reason: "invalid-owned-record" });

    const unchangedReplace = await recoveryFixture("replace-project");
    unchangedReplace.storage.removeItem(workspaceProjectRecordKey(WS, 1, PROJECT_A));
    expect(
      await classifyWorkspaceRecovery(unchangedReplace.storage, unchangedReplace.rawJournal),
    ).toMatchObject({ status: "quarantine", reason: "missing-required-target" });
  });

  it("rejects a project record whose kind disagrees with its indexed tombstone", async () => {
    const fixture = await recoveryFixture("legacy-cleanup");
    const base = await canonicalIndexBytes(
      activeIndex({
        projects: [{ projectId: PROJECT_A, kind: "tombstone" }],
        legacyFingerprints: fixture.journal.legacyExpectedDigests,
      }),
    );
    const target = await canonicalIndexBytes(
      activeIndex({
        revision: 2,
        projects: [{ projectId: PROJECT_A, kind: "tombstone" }],
        legacyFingerprints: { record: null, v3: null, v2: null, v1: null },
      }),
    );
    fixture.journal.baseIndex.expectedDigest = base.digest;
    fixture.journal.targetIndex.serializedValue = target.serialized;
    fixture.journal.targetIndex.targetDigest = target.digest;

    const storage = preparationStorage(fixture);
    storage.setItem(WORKSPACE_INDEX_KEY, base.serialized);
    const before = storage.snapshot();
    expect(
      await prepareWorkspaceJournal(
        storage,
        fixture.journal,
        preparationOptions(fixture, true),
      ),
    ).toMatchObject({ ok: false, status: "quarantine", reason: "baseline-conflict" });
    expect(storage.snapshot()).toEqual(before);
    expect(storage.snapshot()[LEGACY_PROJECT_KEYS.record]).toBe(fixture.legacyRaw);
    expect(storage.snapshot()[WORKSPACE_OPERATION_KEY]).toBeUndefined();
  });

  it("keeps the reserve for growth and releases it only for a verified non-growing replace", async () => {
    for (const kind of [
      "migrate-single-project",
      "create-project",
      "restore-as-new",
    ] as const) {
      const fixture = await recoveryFixture(kind);
      const storage = preparationStorage(fixture);
      const before = storage.snapshot();
      expect(
        await prepareWorkspaceJournal(storage, fixture.journal, preparationOptions(fixture, true)),
        kind,
      ).toMatchObject({ ok: false, status: "failed", reason: "reserve-policy" });
      expect(storage.snapshot(), kind).toEqual(before);
    }

    const nonGrowing = await recoveryFixture("replace-project");
    const nonGrowingStorage = preparationStorage(nonGrowing);
    expect(
      await prepareWorkspaceJournal(
        nonGrowingStorage,
        nonGrowing.journal,
        preparationOptions(nonGrowing, true),
      ),
    ).toMatchObject({ ok: true, status: "prepared" });
    expect(nonGrowingStorage.snapshot()[WORKSPACE_RESERVE_KEY]).toBeUndefined();

    const growing = await recoveryFixture("replace-project");
    const growingRecord = activeProjectRecord(PROJECT_A, { revision: 2 });
    if (growingRecord.value.kind !== "project") throw new Error("replace fixture tombstoned");
    growingRecord.value.state = {
      ...growingRecord.value.state,
      draftText: "fictional expansion ".repeat(512),
    };
    const growingTarget = await canonicalProjectRecordBytes(growingRecord);
    const growingMutation = growing.journal.projectMutations[0];
    growingMutation.targetRecord.targetDigest = growingTarget.digest;
    const growingStorage = preparationStorage(growing);
    const growingBefore = growingStorage.snapshot();
    expect(
      await prepareWorkspaceJournal(growingStorage, growing.journal, {
        releaseReserve: true,
        targetRecords: { [growingMutation.targetRecord.key]: growingTarget.serialized },
      }),
    ).toMatchObject({ ok: false, status: "failed", reason: "reserve-policy" });
    expect(growingStorage.snapshot()).toEqual(growingBefore);
  });

  it("rejects an invalid journal before any storage access", async () => {
    const invalid = await journalFor("migrate-single-project");
    invalid.baseIndex.expectedDigest = "a".repeat(64);
    const storage: WorkspaceStorageAdapter = {
      getItem: () => {
        throw new Error("storage must not be read");
      },
      setItem: () => {
        throw new Error("storage must not be written");
      },
      removeItem: () => {
        throw new Error("storage must not be changed");
      },
      keys: () => {
        throw new Error("storage must not be enumerated");
      },
    };
    await expect(
      prepareWorkspaceJournal(storage, invalid, {
        releaseReserve: false,
        targetRecords: {},
      }),
    ).resolves.toEqual({ ok: false, status: "failed", reason: "invalid-journal" });
  });

  it("accepts a journal that became durable before an injected post-write crash", async () => {
    const fixture = await recoveryFixture("legacy-cleanup");
    const storage = preparationStorage(fixture);
    storage.faults.armAtCheckpoint(`after:setItem:${WORKSPACE_OPERATION_KEY}`, "crash");
    await expect(
      prepareWorkspaceJournal(storage, fixture.journal, preparationOptions(fixture, true)),
    ).rejects.toMatchObject({
      kind: "crash",
      checkpointName: `after:setItem:${WORKSPACE_OPERATION_KEY}`,
    });
    const durableJournal = storage.snapshot()[WORKSPACE_OPERATION_KEY];
    expect(durableJournal).toBe(fixture.rawJournal);
    if (!durableJournal) throw new Error("crash fixture lost its durable journal");
    storage.faults.clear();
    expect((await classifyWorkspaceRecovery(storage, durableJournal)).status).toBe(
      "cancel-or-roll-forward",
    );
  });

  it("changes no project or index bytes when reserve removal fails", async () => {
    const fixture = await recoveryFixture("delete-workspace");
    const storage = preparationStorage(fixture);
    const before = storage.snapshot();
    storage.faults.armAtCheckpoint(`before:removeItem:${WORKSPACE_RESERVE_KEY}`, "security");
    const result = await prepareWorkspaceJournal(
      storage,
      fixture.journal,
      preparationOptions(fixture, true),
    );
    expect(result).toMatchObject({ ok: false, status: "failed" });
    expect(storage.snapshot()).toEqual(before);
  });

  it("recreates a reserve removed durably before a reported removal failure", async () => {
    const fixture = await recoveryFixture("delete-workspace");
    const storage = preparationStorage(fixture);
    const before = storage.snapshot();
    storage.faults.armAtCheckpoint(`after:removeItem:${WORKSPACE_RESERVE_KEY}`, "security");
    const result = await prepareWorkspaceJournal(
      storage,
      fixture.journal,
      preparationOptions(fixture, true),
    );
    expect(result).toMatchObject({ ok: false, status: "failed", reason: "storage-error" });
    expect(storage.snapshot()).toEqual(before);
    expect(storage.snapshot()[WORKSPACE_OPERATION_KEY]).toBeUndefined();
  });

  it("recreates the reserve after journal failure without mutating domain bytes", async () => {
    const fixture = await recoveryFixture("legacy-cleanup");
    const storage = preparationStorage(fixture);
    const before = storage.snapshot();
    storage.faults.armAtCheckpoint(`before:setItem:${WORKSPACE_OPERATION_KEY}`, "quota");
    const result = await prepareWorkspaceJournal(
      storage,
      fixture.journal,
      preparationOptions(fixture, true),
    );
    expect(result).toMatchObject({ ok: false, status: "failed" });
    expect(storage.snapshot()).toEqual(before);
  });

  it("enters degraded mode when both journal creation and reserve recreation fail", async () => {
    const fixture = await recoveryFixture("legacy-cleanup");
    const backing = preparationStorage(fixture);
    let reserveWasRemoved = false;
    const storage: WorkspaceStorageAdapter = {
      getItem: (key) => backing.getItem(key),
      keys: () => backing.keys(),
      removeItem: (key) => {
        backing.removeItem(key);
        if (key === WORKSPACE_RESERVE_KEY) reserveWasRemoved = true;
      },
      setItem: (key, value) => {
        if (
          key === WORKSPACE_OPERATION_KEY ||
          (key === WORKSPACE_RESERVE_KEY && reserveWasRemoved)
        ) {
          throw new DOMException("Injected quota boundary", "QuotaExceededError");
        }
        backing.setItem(key, value);
      },
    };
    const result = await prepareWorkspaceJournal(
      storage,
      fixture.journal,
      preparationOptions(fixture, true),
    );
    expect(result).toMatchObject({ ok: false, status: "degraded" });
    expect(backing.snapshot()[WORKSPACE_INDEX_KEY]).toBe(fixture.baseIndexRaw);
    expect(backing.snapshot()[WORKSPACE_RESERVE_KEY]).toBeUndefined();
  });

  it("rejects missing, malformed, and wrong-size reserve values before journal creation", async () => {
    const fixture = await recoveryFixture("create-project");
    for (const reserve of [null, "{}", CANONICAL_WORKSPACE_RESERVE.slice(1)]) {
      const storage = preparationStorage(fixture, reserve);
      expect(
        await prepareWorkspaceJournal(
          storage,
          fixture.journal,
          preparationOptions(fixture, false),
        ),
      ).toMatchObject({
        ok: false,
        status: "degraded",
        reason: "invalid-reserve",
      });
      expect(storage.snapshot()[WORKSPACE_OPERATION_KEY]).toBeUndefined();
    }
  });

  it("classifies missing reserve without a journal as pre-journal recovery, never authority", () => {
    expect(classifyPreJournalReserveFailure(new MemoryWorkspaceStorageAdapter())).toBe(
      "recreate-reserve",
    );
    expect(
      classifyPreJournalReserveFailure(
        new MemoryWorkspaceStorageAdapter({
          [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
        }),
      ),
    ).toBe("healthy");
  });

  it("injects every semantic crash through a representative rotation sequence", async () => {
    const checkpoints = [
      "reserve-removal",
      "journal-phase-update",
      "project-target-write",
      "index-commit",
      "source-cleanup",
      "journal-removal",
      "reserve-recreation",
    ] as const;

    for (const checkpoint of checkpoints) {
      const fixture = await recoveryFixture("rotate-workspace-generation");
      const mutation = fixture.journal.projectMutations[0];
      if (!mutation.sourceCleanup) throw new Error("rotation cleanup fixture missing");
      const storage = preparationStorage(fixture);

      if (checkpoint === "reserve-removal" || checkpoint === "journal-phase-update") {
        storage.faults.armAtCheckpoint(checkpoint, "crash");
        await expect(
          prepareWorkspaceJournal(storage, fixture.journal, preparationOptions(fixture, true)),
          checkpoint,
        ).rejects.toMatchObject({ kind: "crash", checkpointName: checkpoint });
      } else {
        const prepared = await prepareWorkspaceJournal(
          storage,
          fixture.journal,
          preparationOptions(fixture, true),
        );
        expect(prepared, checkpoint).toMatchObject({ ok: true, status: "prepared" });
        storage.faults.armAtCheckpoint(checkpoint, "crash");
        const journalDigest = await digest(fixture.rawJournal);
        const runRemainingSequence = async (): Promise<void> => {
          const projectWrite = await writeWorkspaceProjectTarget(
            storage,
            mutation.targetRecord.key,
            fixture.targetRecordRaw,
            {
              expectedBeforeDigest: mutation.targetRecord.expectedBeforeDigest,
              targetDigest: mutation.targetRecord.targetDigest,
            },
          );
          expect(projectWrite.ok).toBe(true);
          const sourceRemoval = await removeWorkspaceCleanupSource(
            storage,
            mutation.sourceCleanup!.key,
            { expectedBeforeDigest: mutation.sourceCleanup!.expectedDigest },
          );
          expect(sourceRemoval.ok).toBe(true);
          const indexWrite = await writeWorkspaceIndexTarget(
            storage,
            fixture.journal.targetIndex.serializedValue,
            {
              expectedBeforeDigest: fixture.journal.baseIndex.expectedDigest,
              targetDigest: fixture.journal.targetIndex.targetDigest,
            },
          );
          expect(indexWrite.ok).toBe(true);
          const journalRemoval = await removeWorkspaceJournal(storage, {
            expectedBeforeDigest: journalDigest,
          });
          expect(journalRemoval.ok).toBe(true);
          recreateWorkspaceReserve(storage, CANONICAL_WORKSPACE_RESERVE);
        };
        await expect(runRemainingSequence(), checkpoint).rejects.toThrow(
          expect.objectContaining({ kind: "crash", checkpointName: checkpoint }),
        );
      }

      storage.faults.clear();
      const snapshot = storage.snapshot();
      if (checkpoint === "reserve-removal") {
        expect(snapshot[WORKSPACE_OPERATION_KEY]).toBeUndefined();
        expect(classifyPreJournalReserveFailure(storage)).toBe("recreate-reserve");
        continue;
      }
      if (checkpoint === "journal-removal" || checkpoint === "reserve-recreation") {
        expect(snapshot[WORKSPACE_OPERATION_KEY]).toBeUndefined();
        expect(snapshot[WORKSPACE_INDEX_KEY]).toBe(fixture.journal.targetIndex.serializedValue);
        expect(classifyPreJournalReserveFailure(storage)).toBe(
          checkpoint === "reserve-recreation" ? "healthy" : "recreate-reserve",
        );
        continue;
      }
      const durableJournal = snapshot[WORKSPACE_OPERATION_KEY];
      if (!durableJournal) throw new Error(`${checkpoint} lost the durable journal`);
      const plan = await classifyWorkspaceRecovery(storage, durableJournal);
      const expectedStatus = checkpoint === "index-commit"
        ? "complete"
        : "roll-forward";
      expect(plan.status, checkpoint).toBe(expectedStatus);
    }
  });

  it("fails safely at every concrete storage and readback checkpoint in a rotation", async () => {
    const baselineFixture = await recoveryFixture("rotate-workspace-generation");
    const baselineStorage = preparationStorage(baselineFixture);
    await runRepresentativeRotationSequence(baselineFixture, baselineStorage);
    const checkpoints = [...baselineStorage.faults.visitedCheckpoints()];
    expect(checkpoints.some((name) => name.startsWith("before:getItem:"))).toBe(true);
    expect(checkpoints.some((name) => name.startsWith("after:getItem:"))).toBe(true);
    expect(checkpoints.some((name) => name.startsWith("before:setItem:"))).toBe(true);
    expect(checkpoints.some((name) => name.startsWith("after:setItem:"))).toBe(true);
    expect(checkpoints.some((name) => name.startsWith("before:removeItem:"))).toBe(true);
    expect(checkpoints.some((name) => name.startsWith("after:removeItem:"))).toBe(true);
    expect(checkpoints.some((name) => name.startsWith("readback:"))).toBe(true);
    for (const semantic of [
      "reserve-removal",
      "journal-phase-update",
      "project-target-write",
      "source-cleanup",
      "index-commit",
      "journal-removal",
      "reserve-recreation",
    ]) {
      expect(checkpoints, semantic).toContain(semantic);
    }

    for (let step = 1; step <= checkpoints.length; step += 1) {
      const fixture = await recoveryFixture("rotate-workspace-generation");
      const storage = preparationStorage(fixture);
      storage.faults.armAtStep(step, "crash");
      let observedError: unknown;
      try {
        await runRepresentativeRotationSequence(fixture, storage);
      } catch (error) {
        observedError = error;
      }
      expect(observedError, `step ${step}: ${checkpoints[step - 1]}`).toMatchObject({
        kind: "crash",
        checkpointName: checkpoints[step - 1],
      });
      storage.faults.clear();

      const snapshot = storage.snapshot();
      const durableJournal = snapshot[WORKSPACE_OPERATION_KEY];
      if (durableJournal !== undefined) {
        const plan = await classifyWorkspaceRecovery(storage, durableJournal);
        expect(plan.status, `step ${step}: ${checkpoints[step - 1]}`).not.toBe(
          "quarantine",
        );
        continue;
      }

      const mutation = fixture.journal.projectMutations[0];
      if (!mutation?.sourceCleanup) throw new Error("rotation cleanup fixture missing");
      if (snapshot[WORKSPACE_INDEX_KEY] === fixture.journal.targetIndex.serializedValue) {
        expect(snapshot[mutation.targetRecord.key], `step ${step}`).toBe(
          fixture.targetRecordRaw,
        );
        expect(snapshot[mutation.sourceCleanup.key], `step ${step}`).toBeUndefined();
      } else {
        expect(snapshot[WORKSPACE_INDEX_KEY], `step ${step}`).toBe(fixture.baseIndexRaw);
        expect(snapshot[mutation.sourceCleanup.key], `step ${step}`).toBe(
          fixture.sourceRecordRaw,
        );
        expect(snapshot[mutation.targetRecord.key], `step ${step}`).toBeUndefined();
      }
    }
  });

  it("recovers after a crash at each of the four exact legacy removals", async () => {
    const createFixture = async (): Promise<RecoveryFixture> => {
      const fixture = await recoveryFixture("legacy-cleanup");
      const legacyValues = {
        record: LEGACY_ACTIVE_RECORD_RAW,
        v3: "fictional-retained-v3",
        v2: "fictional-retained-v2",
        v1: "fictional-retained-v1",
      };
      for (const name of ["record", "v3", "v2", "v1"] as const) {
        fixture.journal.legacyExpectedDigests[name] = await digest(legacyValues[name]);
      }
      const baseIndex = await canonicalIndexBytes(
        activeIndex({ legacyFingerprints: fixture.journal.legacyExpectedDigests }),
      );
      const targetIndex = await canonicalIndexBytes(
        activeIndex({
          revision: 2,
          legacyFingerprints: { record: null, v3: null, v2: null, v1: null },
        }),
      );
      fixture.journal.baseIndex.expectedDigest = baseIndex.digest;
      fixture.journal.targetIndex = {
        key: WORKSPACE_INDEX_KEY,
        serializedValue: targetIndex.serialized,
        targetDigest: targetIndex.digest,
      };
      fixture.journal.cleanup = (["record", "v3", "v2", "v1"] as const).map(
        (name) => ({
          key: LEGACY_PROJECT_KEYS[name],
          expectedDigest: fixture.journal.legacyExpectedDigests[name]!,
        }),
      );
      const serialized = serializeWorkspaceJournal(fixture.journal);
      if (!serialized.ok) throw new Error("four-key legacy cleanup fixture invalid");
      const storageValues: Record<string, string> = {
        [WORKSPACE_OPERATION_KEY]: serialized.serialized,
        [WORKSPACE_INDEX_KEY]: baseIndex.serialized,
        [workspaceProjectRecordKey(WS, 1, PROJECT_A)]: fixture.sourceRecordRaw,
      };
      for (const name of ["record", "v3", "v2", "v1"] as const) {
        storageValues[LEGACY_PROJECT_KEYS[name]] = legacyValues[name];
      }
      return {
        ...fixture,
        journal: serialized.value,
        rawJournal: serialized.serialized,
        storage: new MemoryWorkspaceStorageAdapter(storageValues),
        baseIndexRaw: baseIndex.serialized,
        legacyRaw: legacyValues.record,
      };
    };

    const runCleanup = async (
      fixture: RecoveryFixture,
      storage: MemoryWorkspaceStorageAdapter,
    ): Promise<void> => {
      const prepared = await prepareWorkspaceJournal(
        storage,
        fixture.journal,
        preparationOptions(fixture, true),
      );
      if (!prepared.ok) return;
      const indexWrite = await writeWorkspaceIndexTarget(
        storage,
        fixture.journal.targetIndex.serializedValue,
        {
          expectedBeforeDigest: fixture.journal.baseIndex.expectedDigest,
          targetDigest: fixture.journal.targetIndex.targetDigest,
        },
      );
      if (!indexWrite.ok) return;
      for (const cleanup of fixture.journal.cleanup) {
        const removed = await removeWorkspaceCleanupSource(storage, cleanup.key, {
          expectedBeforeDigest: cleanup.expectedDigest,
        });
        if (!removed.ok) return;
      }
      const journalRemoval = await removeWorkspaceJournal(storage, {
        expectedBeforeDigest: await digest(fixture.rawJournal),
      });
      if (!journalRemoval.ok) return;
      recreateWorkspaceReserve(storage, CANONICAL_WORKSPACE_RESERVE);
    };

    const baseline = await createFixture();
    const baselineStorage = preparationStorage(baseline);
    await runCleanup(baseline, baselineStorage);
    const sourceCleanupSteps = baselineStorage.faults
      .visitedCheckpoints()
      .flatMap((name, index) => (name === "source-cleanup" ? [index + 1] : []));
    expect(sourceCleanupSteps).toHaveLength(4);

    for (const [cleanupIndex, step] of sourceCleanupSteps.entries()) {
      const fixture = await createFixture();
      const storage = preparationStorage(fixture);
      storage.faults.armAtStep(step, "crash");
      let observedError: unknown;
      try {
        await runCleanup(fixture, storage);
      } catch (error) {
        observedError = error;
      }
      expect(observedError, `legacy cleanup ${cleanupIndex + 1}`).toMatchObject({
        kind: "crash",
        checkpointName: "source-cleanup",
      });
      storage.faults.clear();
      const durableJournal = storage.snapshot()[WORKSPACE_OPERATION_KEY];
      if (!durableJournal) throw new Error("legacy cleanup crash lost its journal");
      const plan = await classifyWorkspaceRecovery(storage, durableJournal);
      expect(plan.status, `legacy cleanup ${cleanupIndex + 1}`).toBe(
        cleanupIndex === 3 ? "complete" : "finish-cleanup",
      );
      const removedCount = fixture.journal.cleanup.filter(
        (entry) => storage.snapshot()[entry.key] === undefined,
      ).length;
      expect(removedCount).toBe(cleanupIndex + 1);
    }
  });
});
