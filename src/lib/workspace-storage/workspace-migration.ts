import {
  digestOptionalStoredString,
  sha256StoredString,
} from "@/lib/workspace-storage/digest";
import {
  generateSecureWorkspaceUuid,
  LEGACY_PROJECT_KEYS,
  parseWorkspaceProjectRecordKey,
  type SecureUuidSource,
  WORKSPACE_INDEX_KEY,
  WORKSPACE_LOCK_NAME,
  WORKSPACE_OPERATION_KEY,
  WORKSPACE_RESERVE_KEY,
  workspaceProjectRecordKey,
} from "@/lib/workspace-storage/keys";
import {
  resolveSingleProjectMigrationSource,
  type SingleProjectMigrationSnapshot,
} from "@/lib/workspace-storage/legacy-migration";
import {
  generateWorkspaceProjectId,
  scanWorkspaceNamespace,
} from "@/lib/workspace-storage/namespace-scan";
import {
  parseWorkspaceJournal,
  serializeWorkspaceIndex,
  serializeWorkspaceJournal,
  serializeWorkspaceProjectRecord,
  validateWorkspaceJournalDigests,
} from "@/lib/workspace-storage/protocol";
import {
  classifyWorkspaceRecovery,
  prepareWorkspaceJournal,
} from "@/lib/workspace-storage/recovery";
import { CANONICAL_WORKSPACE_RESERVE } from "@/lib/workspace-storage/reserve";
import {
  readExact,
  recreateWorkspaceReserve,
  removeWorkspaceJournal,
  writeWorkspaceIndexTarget,
  writeWorkspaceProjectTarget,
  type WorkspaceStorageAdapter,
} from "@/lib/workspace-storage/storage-adapter";
import {
  readWorkspaceAuthority,
  type WorkspaceAuthoritySnapshot,
  type WorkspaceExclusiveLockRunner,
} from "@/lib/workspace-storage/coordinator";
import type {
  WorkspaceLegacyFingerprints,
  WorkspaceOperationJournalV1,
} from "@/lib/workspace-storage/types";

const LEGACY_NAMES = ["record", "v3", "v2", "v1"] as const;

export type WorkspaceMigrationOrigin =
  | "existing"
  | "initialized-empty"
  | "migrated-project"
  | "migrated-cleared"
  | "resumed-migration";

export type WorkspaceMigrationFailureReason =
  | "lock-unavailable"
  | "lock-failed"
  | "invalid-workspace"
  | "recovery-required"
  | "legacy-conflict"
  | "invalid-legacy"
  | "storage-error"
  | "digest-unavailable"
  | "reserve-degraded"
  | "id-unavailable-or-collided"
  | "commit-incomplete";

export type WorkspaceMigrationResult =
  | {
      ok: true;
      origin: WorkspaceMigrationOrigin;
      snapshot: WorkspaceAuthoritySnapshot;
      storageProtection: "healthy" | "degraded";
    }
  | { ok: false; reason: WorkspaceMigrationFailureReason };

export interface WorkspaceMigrationRequest {
  uuidSource?: SecureUuidSource | null;
}

interface LegacyRawSnapshot extends SingleProjectMigrationSnapshot {
  rawByName: Readonly<Record<(typeof LEGACY_NAMES)[number], string | null>>;
}

interface MigrationPlan {
  journal: WorkspaceOperationJournalV1;
  serializedJournal: string;
  journalDigest: string;
  serializedProject: string | null;
  projectKey: string | null;
  serializedIndex: string;
  indexDigest: string;
  legacy: LegacyRawSnapshot;
  origin: "migrated-project" | "migrated-cleared" | "resumed-migration";
}

function readLegacyRaw(storage: WorkspaceStorageAdapter): LegacyRawSnapshot | null {
  const rawByName: Record<(typeof LEGACY_NAMES)[number], string | null> = {
    record: null,
    v3: null,
    v2: null,
    v1: null,
  };
  for (const name of LEGACY_NAMES) {
    const read = readExact(storage, LEGACY_PROJECT_KEYS[name]);
    if (!read.ok) return null;
    rawByName[name] = read.value;
  }
  return {
    recordValue: rawByName.record,
    legacyV3Value: rawByName.v3,
    legacyV2Value: rawByName.v2,
    legacyV1Value: rawByName.v1,
    rawByName,
  };
}

async function digestLegacyRaw(
  legacy: LegacyRawSnapshot,
): Promise<WorkspaceLegacyFingerprints | null> {
  const result: WorkspaceLegacyFingerprints = {
    record: null,
    v3: null,
    v2: null,
    v1: null,
  };
  for (const name of LEGACY_NAMES) {
    const digest = await digestOptionalStoredString(legacy.rawByName[name]);
    if (!digest.ok) return null;
    result[name] = digest.digest;
  }
  return result;
}

async function digestRequired(raw: string): Promise<string | null> {
  const digest = await sha256StoredString(raw);
  return digest.ok ? digest.digest : null;
}

function ensureWorkspaceReserve(storage: WorkspaceStorageAdapter): boolean {
  const current = readExact(storage, WORKSPACE_RESERVE_KEY);
  if (!current.ok) return false;
  if (current.value === CANONICAL_WORKSPACE_RESERVE) return true;
  return recreateWorkspaceReserve(storage, CANONICAL_WORKSPACE_RESERVE).ok;
}

function exactProjectKeys(
  storage: WorkspaceStorageAdapter,
  expected: readonly string[],
): boolean {
  try {
    const observed = storage.keys()
      .filter((key) => parseWorkspaceProjectRecordKey(key) !== null)
      .sort();
    return JSON.stringify(observed) === JSON.stringify([...expected].sort());
  } catch {
    return false;
  }
}

function exactMigrationRawState(
  storage: WorkspaceStorageAdapter,
  plan: MigrationPlan,
  expectedIndex: string | null,
  expectedProject: string | null,
): boolean {
  try {
    if (storage.getItem(WORKSPACE_OPERATION_KEY) !== plan.serializedJournal) {
      return false;
    }
    if (storage.getItem(WORKSPACE_INDEX_KEY) !== expectedIndex) return false;
    if (storage.getItem(WORKSPACE_RESERVE_KEY) !== CANONICAL_WORKSPACE_RESERVE) {
      return false;
    }
    for (const name of LEGACY_NAMES) {
      if (
        storage.getItem(LEGACY_PROJECT_KEYS[name]) !==
        plan.legacy.rawByName[name]
      ) {
        return false;
      }
    }
    if (plan.projectKey !== null) {
      if (storage.getItem(plan.projectKey) !== expectedProject) return false;
      return exactProjectKeys(
        storage,
        expectedProject === null ? [] : [plan.projectKey],
      );
    }
    return exactProjectKeys(storage, []);
  } catch {
    return false;
  }
}

function exactEmptyInitializationBaseline(
  storage: WorkspaceStorageAdapter,
): boolean {
  try {
    return (
      storage.getItem(WORKSPACE_INDEX_KEY) === null &&
      storage.getItem(WORKSPACE_OPERATION_KEY) === null &&
      storage.getItem(WORKSPACE_RESERVE_KEY) === CANONICAL_WORKSPACE_RESERVE &&
      LEGACY_NAMES.every(
        (name) => storage.getItem(LEGACY_PROJECT_KEYS[name]) === null,
      ) &&
      exactProjectKeys(storage, [])
    );
  } catch {
    return false;
  }
}

async function finishSuccessfulAuthority(
  storage: WorkspaceStorageAdapter,
  origin: WorkspaceMigrationOrigin,
): Promise<WorkspaceMigrationResult> {
  const storageProtection = recreateWorkspaceReserve(
    storage,
    CANONICAL_WORKSPACE_RESERVE,
  ).ok
    ? "healthy"
    : "degraded";
  const authority = await readWorkspaceAuthority(storage);
  if (!authority.ok) {
    return {
      ok: false,
      reason:
        authority.reason === "legacy-conflict"
          ? "legacy-conflict"
          : authority.reason === "digest-unavailable"
            ? "digest-unavailable"
            : authority.reason === "storage-error"
              ? "storage-error"
              : authority.reason === "operation-recovery-required" ||
                  authority.reason === "invalid-operation-journal"
                ? "recovery-required"
                : "invalid-workspace",
    };
  }
  return {
    ok: true,
    origin,
    snapshot: authority.snapshot,
    storageProtection,
  };
}

async function initializeEmptyWorkspace(
  storage: WorkspaceStorageAdapter,
  request: WorkspaceMigrationRequest,
): Promise<WorkspaceMigrationResult> {
  if (!ensureWorkspaceReserve(storage)) {
    return { ok: false, reason: "reserve-degraded" };
  }
  const workspaceId = generateSecureWorkspaceUuid(request.uuidSource);
  if (workspaceId === null) {
    return { ok: false, reason: "id-unavailable-or-collided" };
  }
  const index = serializeWorkspaceIndex({
    formatVersion: 1,
    workspaceId,
    workspaceGeneration: 1,
    revision: 1,
    status: "active",
    projects: [],
    legacyFingerprints: { record: null, v3: null, v2: null, v1: null },
  });
  if (!index.ok) return { ok: false, reason: "invalid-workspace" };
  const indexDigest = await digestRequired(index.serialized);
  if (indexDigest === null) {
    return { ok: false, reason: "digest-unavailable" };
  }
  const written = await writeWorkspaceIndexTarget(storage, index.serialized, {
    expectedBeforeDigest: null,
    targetDigest: indexDigest,
    commitStillAuthorized: () => exactEmptyInitializationBaseline(storage),
  });
  if (!written.ok) {
    return {
      ok: false,
      reason:
        written.reason === "digest-unavailable"
          ? "digest-unavailable"
          : written.reason === "commit-cancelled" ||
              written.reason === "baseline-mismatch"
            ? "recovery-required"
            : "storage-error",
    };
  }
  return finishSuccessfulAuthority(storage, "initialized-empty");
}

async function buildFreshMigrationPlan(
  storage: WorkspaceStorageAdapter,
  legacy: LegacyRawSnapshot,
  request: WorkspaceMigrationRequest,
): Promise<
  | { ok: true; plan: MigrationPlan }
  | { ok: false; reason: WorkspaceMigrationFailureReason }
> {
  const source = resolveSingleProjectMigrationSource(legacy);
  if (!source.ok) {
    return {
      ok: false,
      reason:
        source.reason === "conflict"
          ? "legacy-conflict"
          : source.reason === "invalid"
            ? "invalid-legacy"
            : "invalid-legacy",
    };
  }
  if (source.kind === "project" && source.state.projectKind === "none") {
    return { ok: false, reason: "invalid-legacy" };
  }
  const legacyDigests = await digestLegacyRaw(legacy);
  if (legacyDigests === null) {
    return { ok: false, reason: "digest-unavailable" };
  }
  const workspaceId = generateSecureWorkspaceUuid(request.uuidSource);
  if (workspaceId === null) {
    return { ok: false, reason: "id-unavailable-or-collided" };
  }
  let projectId: string | null = null;
  let serializedProject: string | null = null;
  let projectKey: string | null = null;
  let projectDigest: string | null = null;
  if (source.kind === "project") {
    const generated = await generateWorkspaceProjectId(
      storage,
      request.uuidSource,
    );
    if (!generated.ok) {
      return {
        ok: false,
        reason:
          generated.reason === "digest-unavailable"
            ? "digest-unavailable"
            : generated.reason === "storage-error"
              ? "storage-error"
              : generated.reason === "uuid-unavailable-or-collided"
                ? "id-unavailable-or-collided"
                : "recovery-required",
      };
    }
    projectId = generated.projectId;
    projectKey = workspaceProjectRecordKey(workspaceId, 1, projectId);
    const project = serializeWorkspaceProjectRecord({
      formatVersion: 1,
      workspaceId,
      workspaceGeneration: 1,
      projectId,
      revision: 1,
      value: { kind: "project", state: source.state },
    });
    if (!project.ok) return { ok: false, reason: "invalid-legacy" };
    serializedProject = project.serialized;
    projectDigest = await digestRequired(project.serialized);
    if (projectDigest === null) {
      return { ok: false, reason: "digest-unavailable" };
    }
  }
  const index = serializeWorkspaceIndex({
    formatVersion: 1,
    workspaceId,
    workspaceGeneration: 1,
    revision: 1,
    status: "active",
    projects:
      projectId === null ? [] : [{ projectId, kind: "active" as const }],
    legacyFingerprints: legacyDigests,
  });
  if (!index.ok) return { ok: false, reason: "invalid-workspace" };
  const indexDigest = await digestRequired(index.serialized);
  if (indexDigest === null) {
    return { ok: false, reason: "digest-unavailable" };
  }
  const operationId = generateSecureWorkspaceUuid(request.uuidSource);
  if (operationId === null) {
    return { ok: false, reason: "id-unavailable-or-collided" };
  }
  const journal: WorkspaceOperationJournalV1 = {
    formatVersion: 1,
    operationId,
    kind: "migrate-single-project",
    workspaceId,
    sourceGeneration: null,
    targetGeneration: 1,
    phase: "prepared",
    baseIndex: { key: WORKSPACE_INDEX_KEY, expectedDigest: null },
    targetIndex: {
      key: WORKSPACE_INDEX_KEY,
      serializedValue: index.serialized,
      targetDigest: indexDigest,
    },
    legacyExpectedDigests: legacyDigests,
    projectMutations:
      projectId === null || projectKey === null || projectDigest === null
        ? []
        : [
            {
              mode: "create",
              projectId,
              sourceRecord: null,
              targetRecord: {
                key: projectKey,
                expectedBeforeDigest: null,
                targetDigest: projectDigest,
              },
              sourceCleanup: null,
            },
          ],
    cleanup: [],
  };
  const serializedJournal = serializeWorkspaceJournal(journal);
  if (!serializedJournal.ok) {
    return { ok: false, reason: "invalid-workspace" };
  }
  const journalDigest = await digestRequired(serializedJournal.serialized);
  if (journalDigest === null) {
    return { ok: false, reason: "digest-unavailable" };
  }
  return {
    ok: true,
    plan: {
      journal,
      serializedJournal: serializedJournal.serialized,
      journalDigest,
      serializedProject,
      projectKey,
      serializedIndex: index.serialized,
      indexDigest,
      legacy,
      origin:
        source.kind === "project" ? "migrated-project" : "migrated-cleared",
    },
  };
}

async function buildRecoveryMigrationPlan(
  storage: WorkspaceStorageAdapter,
  rawJournal: string,
): Promise<
  | { ok: true; plan: MigrationPlan }
  | { ok: false; reason: WorkspaceMigrationFailureReason }
> {
  const parsed = parseWorkspaceJournal(rawJournal);
  if (!parsed.ok || parsed.value.kind !== "migrate-single-project") {
    return { ok: false, reason: "recovery-required" };
  }
  const validated = await validateWorkspaceJournalDigests(parsed.value);
  if (!validated.ok) {
    return {
      ok: false,
      reason:
        validated.reason === "digest-unavailable"
          ? "digest-unavailable"
          : "recovery-required",
    };
  }
  const recovery = await classifyWorkspaceRecovery(storage, rawJournal);
  if (recovery.status === "quarantine") {
    return { ok: false, reason: "recovery-required" };
  }
  const legacy = readLegacyRaw(storage);
  if (legacy === null) return { ok: false, reason: "storage-error" };
  const source = resolveSingleProjectMigrationSource(legacy);
  if (!source.ok) {
    return {
      ok: false,
      reason:
        source.reason === "conflict"
          ? "legacy-conflict"
          : "recovery-required",
    };
  }
  let serializedProject: string | null = null;
  let projectKey: string | null = null;
  if (source.kind === "project") {
    const mutation = parsed.value.projectMutations[0];
    if (!mutation || source.state.projectKind === "none") {
      return { ok: false, reason: "recovery-required" };
    }
    const project = serializeWorkspaceProjectRecord({
      formatVersion: 1,
      workspaceId: parsed.value.workspaceId,
      workspaceGeneration: 1,
      projectId: mutation.projectId,
      revision: 1,
      value: { kind: "project", state: source.state },
    });
    if (!project.ok) return { ok: false, reason: "recovery-required" };
    const digest = await digestRequired(project.serialized);
    if (
      digest === null ||
      digest !== mutation.targetRecord.targetDigest ||
      mutation.targetRecord.expectedBeforeDigest !== null
    ) {
      return { ok: false, reason: "recovery-required" };
    }
    serializedProject = project.serialized;
    projectKey = mutation.targetRecord.key;
  } else if (parsed.value.projectMutations.length !== 0) {
    return { ok: false, reason: "recovery-required" };
  }
  const journalDigest = await digestRequired(rawJournal);
  if (journalDigest === null) {
    return { ok: false, reason: "digest-unavailable" };
  }
  return {
    ok: true,
    plan: {
      journal: parsed.value,
      serializedJournal: rawJournal,
      journalDigest,
      serializedProject,
      projectKey,
      serializedIndex: parsed.value.targetIndex.serializedValue,
      indexDigest: parsed.value.targetIndex.targetDigest,
      legacy,
      origin: "resumed-migration",
    },
  };
}

async function executeMigrationPlan(
  storage: WorkspaceStorageAdapter,
  plan: MigrationPlan,
): Promise<WorkspaceMigrationResult> {
  if (!ensureWorkspaceReserve(storage)) {
    return { ok: false, reason: "reserve-degraded" };
  }
  if (plan.projectKey !== null && plan.serializedProject !== null) {
    const mutation = plan.journal.projectMutations[0];
    if (!mutation) return { ok: false, reason: "recovery-required" };
    const target = readExact(storage, plan.projectKey);
    if (!target.ok) return { ok: false, reason: "storage-error" };
    if (target.value !== null && target.value !== plan.serializedProject) {
      return { ok: false, reason: "recovery-required" };
    }
    const projectWritten = await writeWorkspaceProjectTarget(
      storage,
      plan.projectKey,
      plan.serializedProject,
      {
        expectedBeforeDigest: null,
        targetDigest: mutation.targetRecord.targetDigest,
        commitStillAuthorized: () =>
          exactMigrationRawState(storage, plan, null, null),
      },
    );
    if (!projectWritten.ok) {
      return { ok: false, reason: "commit-incomplete" };
    }
  }
  const index = readExact(storage, WORKSPACE_INDEX_KEY);
  if (!index.ok) return { ok: false, reason: "storage-error" };
  if (index.value !== null && index.value !== plan.serializedIndex) {
    return { ok: false, reason: "recovery-required" };
  }
  const indexWritten = await writeWorkspaceIndexTarget(
    storage,
    plan.serializedIndex,
    {
      expectedBeforeDigest: null,
      targetDigest: plan.indexDigest,
      commitStillAuthorized: () =>
        exactMigrationRawState(
          storage,
          plan,
          null,
          plan.serializedProject,
        ),
    },
  );
  if (!indexWritten.ok) {
    return { ok: false, reason: "commit-incomplete" };
  }
  const removed = await removeWorkspaceJournal(storage, {
    expectedBeforeDigest: plan.journalDigest,
    commitStillAuthorized: () =>
      exactMigrationRawState(
        storage,
        plan,
        plan.serializedIndex,
        plan.serializedProject,
      ),
  });
  if (!removed.ok) return { ok: false, reason: "commit-incomplete" };
  return finishSuccessfulAuthority(storage, plan.origin);
}

async function migrateWithinLock(
  storage: WorkspaceStorageAdapter,
  request: WorkspaceMigrationRequest,
  requireMigrationJournal: boolean,
): Promise<WorkspaceMigrationResult> {
  try {
    const journal = readExact(storage, WORKSPACE_OPERATION_KEY);
    if (!journal.ok) return { ok: false, reason: "storage-error" };
    if (journal.value !== null) {
      const recoveryPlan = await buildRecoveryMigrationPlan(
        storage,
        journal.value,
      );
      return recoveryPlan.ok
        ? executeMigrationPlan(storage, recoveryPlan.plan)
        : recoveryPlan;
    }
    if (requireMigrationJournal) {
      return { ok: false, reason: "recovery-required" };
    }

    const index = readExact(storage, WORKSPACE_INDEX_KEY);
    if (!index.ok) return { ok: false, reason: "storage-error" };
    if (index.value !== null) {
      const authority = await readWorkspaceAuthority(storage);
      if (!authority.ok) {
        return {
          ok: false,
          reason:
            authority.reason === "legacy-conflict"
              ? "legacy-conflict"
              : authority.reason === "digest-unavailable"
                ? "digest-unavailable"
                : authority.reason === "storage-error"
                  ? "storage-error"
                  : "invalid-workspace",
        };
      }
      return finishSuccessfulAuthority(storage, "existing");
    }

    const namespace = scanWorkspaceNamespace(storage);
    if (!namespace.ok) return { ok: false, reason: "storage-error" };
    if (
      namespace.result.journalState !== "absent" ||
      namespace.result.physicalProjectRecordCount !== 0
    ) {
      return { ok: false, reason: "recovery-required" };
    }
    const legacy = readLegacyRaw(storage);
    if (legacy === null) return { ok: false, reason: "storage-error" };
    const source = resolveSingleProjectMigrationSource(legacy);
    if (!source.ok && source.reason === "absent") {
      return initializeEmptyWorkspace(storage, request);
    }
    if (!source.ok) {
      return {
        ok: false,
        reason:
          source.reason === "conflict" ? "legacy-conflict" : "invalid-legacy",
      };
    }
    if (!ensureWorkspaceReserve(storage)) {
      return { ok: false, reason: "reserve-degraded" };
    }
    const fresh = await buildFreshMigrationPlan(storage, legacy, request);
    if (!fresh.ok) return fresh;
    const prepared = await prepareWorkspaceJournal(storage, fresh.plan.journal, {
      releaseReserve: false,
      targetRecords:
        fresh.plan.projectKey === null || fresh.plan.serializedProject === null
          ? {}
          : {
              [fresh.plan.projectKey]: fresh.plan.serializedProject,
            },
    });
    if (!prepared.ok) {
      return {
        ok: false,
        reason:
          prepared.reason === "invalid-reserve"
            ? "reserve-degraded"
            : prepared.reason === "baseline-conflict" ||
                prepared.reason === "third-value-journal"
              ? "recovery-required"
              : prepared.reason === "invalid-journal" ||
                  prepared.reason === "invalid-target-record"
                ? "invalid-workspace"
                : "storage-error",
      };
    }
    return executeMigrationPlan(storage, fresh.plan);
  } catch {
    return { ok: false, reason: "storage-error" };
  }
}

export async function openOrMigrateWorkspace(
  storage: WorkspaceStorageAdapter,
  locks: WorkspaceExclusiveLockRunner | null,
  request: WorkspaceMigrationRequest = {},
): Promise<WorkspaceMigrationResult> {
  if (!locks) return { ok: false, reason: "lock-unavailable" };
  try {
    return await locks.runExclusive(WORKSPACE_LOCK_NAME, () =>
      migrateWithinLock(storage, request, false),
    );
  } catch {
    return { ok: false, reason: "lock-failed" };
  }
}

/** Resumes only an exact, valid migrate-single-project journal. */
export async function resumeWorkspaceMigration(
  storage: WorkspaceStorageAdapter,
  locks: WorkspaceExclusiveLockRunner | null,
): Promise<WorkspaceMigrationResult> {
  if (!locks) return { ok: false, reason: "lock-unavailable" };
  try {
    return await locks.runExclusive(WORKSPACE_LOCK_NAME, () =>
      migrateWithinLock(storage, {}, true),
    );
  } catch {
    return { ok: false, reason: "lock-failed" };
  }
}
