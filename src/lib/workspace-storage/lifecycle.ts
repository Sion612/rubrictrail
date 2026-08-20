import type { PersistedProjectState } from "@/lib/ui-types";
import type {
  WorkspaceAuthoritySnapshot,
  WorkspaceAuthorityReadFailureReason,
  WorkspaceCoordinatorMutationFailureReason,
  WorkspaceExclusiveLockRunner,
  WorkspaceIndexBaseline,
  WorkspaceProjectBaseline,
  WorkspaceProjectSnapshot,
} from "@/lib/workspace-storage/coordinator";
import {
  readWorkspaceAuthority,
} from "@/lib/workspace-storage/coordinator";
import {
  digestOptionalStoredString,
  sha256StoredString,
} from "@/lib/workspace-storage/digest";
import {
  generateCollisionCheckedUuid,
  generateSecureWorkspaceUuid,
  LEGACY_PROJECT_KEYS,
  parseWorkspaceProjectRecordKey,
  type SecureUuidSource,
  WORKSPACE_INDEX_KEY,
  WORKSPACE_LOCK_NAME,
  WORKSPACE_OPERATION_KEY,
  WORKSPACE_PREFERENCES_KEY,
  WORKSPACE_RESERVE_KEY,
} from "@/lib/workspace-storage/keys";
import {
  parseWorkspaceJournal,
  parseWorkspaceIndex,
  parseWorkspacePreferences,
  parseWorkspaceProjectRecord,
  serializeWorkspaceIndex,
  serializeWorkspaceJournal,
  serializeWorkspaceProjectRecord,
  workspaceProjectRecordMatchesKey,
} from "@/lib/workspace-storage/protocol";
import {
  classifyWorkspaceRecovery,
  prepareWorkspaceJournal,
  reconstructWorkspaceLegacyResolutionTargetRecord,
} from "@/lib/workspace-storage/recovery";
import {
  CANONICAL_WORKSPACE_RESERVE,
  classifyWorkspaceReserve,
} from "@/lib/workspace-storage/reserve";
import {
  readExact,
  recreateWorkspaceReserve,
  removeExact,
  removeWorkspaceCleanupSource,
  removeWorkspaceJournal,
  writeWorkspaceIndexTarget,
  writeWorkspaceJournalPhase,
  writeWorkspaceProjectTarget,
  type WorkspaceStorageAdapter,
} from "@/lib/workspace-storage/storage-adapter";
import type {
  WorkspaceIndexV1,
  WorkspaceLegacyFingerprints,
  WorkspaceOperationJournalV1,
  WorkspaceOperationPhase,
} from "@/lib/workspace-storage/types";

const LEGACY_NAMES = ["record", "v3", "v2", "v1"] as const;
const LIFECYCLE_KINDS = [
  "replace-project",
  "delete-project",
  "legacy-cleanup",
  "delete-workspace",
] as const;

type WorkspaceLifecycleKind = (typeof LIFECYCLE_KINDS)[number];

export type WorkspaceLifecycleFailureReason =
  | WorkspaceCoordinatorMutationFailureReason
  | "no-operation"
  | "recovery-not-eligible"
  | "unsupported-operation";

export interface WorkspaceLifecycleSuccess {
  ok: true;
  snapshot: WorkspaceAuthoritySnapshot;
  storageProtection: "healthy" | "degraded";
  preferenceCleaned: boolean;
  changed: boolean;
}

export type WorkspaceLifecycleResult =
  | WorkspaceLifecycleSuccess
  | { ok: false; reason: WorkspaceLifecycleFailureReason };

interface WorkspaceDestructiveIntent {
  intentStillCurrent: () => boolean;
  pendingSavesDrained: () => boolean;
  uuidSource?: SecureUuidSource | null;
}

export interface WorkspaceReplaceProjectRequest
  extends WorkspaceDestructiveIntent {
  baseline: WorkspaceProjectBaseline;
  backup: Readonly<{ state: PersistedProjectState }>;
}

export interface WorkspaceDeleteProjectRequest extends WorkspaceDestructiveIntent {
  baseline: WorkspaceProjectBaseline;
}

export interface WorkspaceLegacyCleanupRequest extends WorkspaceDestructiveIntent {
  baseline: WorkspaceIndexBaseline;
}

export interface WorkspaceDeleteRequest extends WorkspaceDestructiveIntent {
  baseline: WorkspaceIndexBaseline;
}

export interface WorkspaceRecoveryPrivacyPurgeBaseline {
  indexDigest: string | null;
  ownedProjectDigests: ReadonlyArray<{
    key: string;
    digest: string;
  }>;
  legacyDigests: WorkspaceLegacyFingerprints;
}

export type WorkspaceRecoveryPrivacyPurgeInspectionResult =
  | { ok: true; baseline: WorkspaceRecoveryPrivacyPurgeBaseline }
  | {
      ok: false;
      reason:
        | "recovery-not-eligible"
        | "recovery-required"
        | "workspace-conflict"
        | "digest-unavailable"
        | "storage-error";
    };

export interface WorkspaceRecoveryPrivacyPurgeRequest
  extends WorkspaceDestructiveIntent {
  baseline: WorkspaceRecoveryPrivacyPurgeBaseline;
}

interface JournalCursor {
  value: WorkspaceOperationJournalV1;
  serialized: string;
  digest: string;
}

type JournalCursorResult =
  | { ok: true; cursor: JournalCursor }
  | { ok: false; reason: "invalid-request" | "digest-unavailable" };

function lifecycleKind(value: string): value is WorkspaceLifecycleKind {
  return (LIFECYCLE_KINDS as readonly string[]).includes(value);
}

function callbackIsTrue(callback: () => boolean): boolean {
  try {
    return callback();
  } catch {
    return false;
  }
}

function indexBaselineMatches(
  snapshot: WorkspaceAuthoritySnapshot,
  baseline: WorkspaceIndexBaseline,
): boolean {
  return (
    snapshot.index.workspaceId === baseline.workspaceId &&
    snapshot.index.workspaceGeneration === baseline.workspaceGeneration &&
    snapshot.index.revision === baseline.revision &&
    snapshot.indexRaw === baseline.raw &&
    snapshot.indexDigest === baseline.digest
  );
}

function findActiveProject(
  snapshot: WorkspaceAuthoritySnapshot,
  baseline: WorkspaceProjectBaseline,
): WorkspaceProjectSnapshot | null {
  const project =
    snapshot.projects.find(
      (candidate) => candidate.record.projectId === baseline.projectId,
    ) ?? null;
  if (
    !project ||
    project.record.value.kind !== "project" ||
    project.record.revision !== baseline.projectRevision ||
    project.raw !== baseline.raw ||
    project.digest !== baseline.digest
  ) {
    return null;
  }
  return project;
}

function authorityFailureReason(
  reason: WorkspaceAuthorityReadFailureReason,
): WorkspaceCoordinatorMutationFailureReason {
  if (
    reason === "operation-recovery-required" ||
    reason === "invalid-operation-journal"
  ) {
    return "recovery-required";
  }
  if (reason === "legacy-conflict") return "legacy-conflict";
  if (reason === "digest-unavailable") return "digest-unavailable";
  if (reason === "concurrent-change") return "workspace-conflict";
  return reason === "storage-error" ? "storage-error" : "workspace-conflict";
}

function preparationFailureReason(
  result: Exclude<
    Awaited<ReturnType<typeof prepareWorkspaceJournal>>,
    { ok: true }
  >,
): WorkspaceCoordinatorMutationFailureReason {
  if (result.reason === "invalid-reserve") return "reserve-degraded";
  if (result.reason === "third-value-journal") return "recovery-required";
  if (result.reason === "baseline-conflict") return "workspace-conflict";
  if (
    result.reason === "invalid-journal" ||
    result.reason === "invalid-target-record" ||
    result.reason === "reserve-policy"
  ) {
    return "invalid-request";
  }
  return "storage-error";
}

async function digestRaw(raw: string): Promise<string | null> {
  const digest = await sha256StoredString(raw);
  return digest.ok ? digest.digest : null;
}

async function canonicalJournal(
  journal: WorkspaceOperationJournalV1,
): Promise<JournalCursorResult> {
  const serialized = serializeWorkspaceJournal(journal);
  if (!serialized.ok) return { ok: false, reason: "invalid-request" };
  const digest = await digestRaw(serialized.serialized);
  if (digest === null) return { ok: false, reason: "digest-unavailable" };
  return {
    ok: true,
    cursor: {
      value: serialized.value,
      serialized: serialized.serialized,
      digest,
    },
  };
}

async function advanceJournal(
  storage: WorkspaceStorageAdapter,
  cursor: JournalCursor,
  phase: WorkspaceOperationPhase,
): Promise<JournalCursor | null> {
  const next = await canonicalJournal({ ...cursor.value, phase });
  if (!next.ok) return null;
  const written = await writeWorkspaceJournalPhase(
    storage,
    next.cursor.serialized,
    {
      expectedBeforeDigest: cursor.digest,
      targetDigest: next.cursor.digest,
    },
  );
  return written.ok ? next.cursor : null;
}

const JOURNAL_PHASE_RANK: Record<WorkspaceOperationPhase, number> = {
  prepared: 0,
  "records-writing": 1,
  "records-written": 2,
  "index-committed": 3,
  "cleanup-pending": 4,
};

async function ensureJournalPhase(
  storage: WorkspaceStorageAdapter,
  cursor: JournalCursor,
  phase: WorkspaceOperationPhase,
): Promise<JournalCursor | null> {
  return JOURNAL_PHASE_RANK[cursor.value.phase] >= JOURNAL_PHASE_RANK[phase]
    ? cursor
    : advanceJournal(storage, cursor, phase);
}

async function digestAtKey(
  storage: WorkspaceStorageAdapter,
  key: string,
): Promise<
  | { ok: true; raw: string | null; digest: string | null }
  | { ok: false; reason: "storage-error" | "digest-unavailable" }
> {
  const read = readExact(storage, key);
  if (!read.ok) return { ok: false, reason: "storage-error" };
  const digest = await digestOptionalStoredString(read.value);
  return digest.ok
    ? { ok: true, raw: read.value, digest: digest.digest }
    : { ok: false, reason: "digest-unavailable" };
}

interface ExactCancellationSnapshot {
  key: string;
  raw: string | null;
}

async function captureCancellationBaselines(
  storage: WorkspaceStorageAdapter,
  cursor: JournalCursor,
): Promise<ExactCancellationSnapshot[] | null> {
  const snapshots = new Map<string, string | null>();
  const capture = async (
    key: string,
    expectedDigest: string | null,
  ): Promise<boolean> => {
    const observed = await digestAtKey(storage, key);
    if (!observed.ok || observed.digest !== expectedDigest) return false;
    const prior = snapshots.get(key);
    if (snapshots.has(key) && prior !== observed.raw) return false;
    snapshots.set(key, observed.raw);
    return true;
  };

  const journalRead = readExact(storage, WORKSPACE_OPERATION_KEY);
  if (!journalRead.ok || journalRead.value !== cursor.serialized) return null;
  snapshots.set(WORKSPACE_OPERATION_KEY, cursor.serialized);

  if (
    !(await capture(
      WORKSPACE_INDEX_KEY,
      cursor.value.baseIndex.expectedDigest,
    ))
  ) {
    return null;
  }
  for (const mutation of cursor.value.projectMutations) {
    if (
      !(await capture(
        mutation.targetRecord.key,
        mutation.targetRecord.expectedBeforeDigest,
      ))
    ) {
      return null;
    }
    if (
      mutation.sourceRecord &&
      !(await capture(
        mutation.sourceRecord.key,
        mutation.sourceRecord.expectedDigest,
      ))
    ) {
      return null;
    }
    if (
      mutation.sourceCleanup &&
      !(await capture(
        mutation.sourceCleanup.key,
        mutation.sourceCleanup.expectedDigest,
      ))
    ) {
      return null;
    }
  }
  for (const cleanup of cursor.value.cleanup) {
    if (!(await capture(cleanup.key, cleanup.expectedDigest))) return null;
  }
  for (const name of LEGACY_NAMES) {
    if (
      !(await capture(
        LEGACY_PROJECT_KEYS[name],
        cursor.value.legacyExpectedDigests[name],
      ))
    ) {
      return null;
    }
  }
  return [...snapshots].map(([key, raw]) => ({ key, raw }));
}

function cancellationSnapshotsStillExact(
  storage: WorkspaceStorageAdapter,
  snapshots: readonly ExactCancellationSnapshot[],
): boolean {
  try {
    return snapshots.every(({ key, raw }) => storage.getItem(key) === raw);
  } catch {
    return false;
  }
}

async function cancelPreparedJournal(
  storage: WorkspaceStorageAdapter,
  cursor: JournalCursor,
  reserveWasReleased: boolean,
): Promise<"cancelled" | "degraded" | "incomplete"> {
  const snapshots = await captureCancellationBaselines(storage, cursor);
  if (!snapshots) return "incomplete";
  const removed = await removeWorkspaceJournal(storage, {
    expectedBeforeDigest: cursor.digest,
    commitStillAuthorized: () =>
      cancellationSnapshotsStillExact(storage, snapshots),
  });
  if (!removed.ok) return "incomplete";
  if (!reserveWasReleased) return "cancelled";
  return recreateWorkspaceReserve(storage, CANONICAL_WORKSPACE_RESERVE).ok
    ? "cancelled"
    : "degraded";
}

function currentIntentFailure(
  request: WorkspaceDestructiveIntent,
): "pending-save" | "intent-stale" | null {
  if (!callbackIsTrue(request.pendingSavesDrained)) return "pending-save";
  return callbackIsTrue(request.intentStillCurrent) ? null : "intent-stale";
}

type WorkspaceCommitRejectionReason =
  | "pending-save"
  | "intent-stale"
  | "workspace-conflict";

interface WorkspaceCommitAuthorization {
  check: () => boolean;
  rejectedReason: () => WorkspaceCommitRejectionReason | null;
}

function commitAuthorization(
  request: WorkspaceDestructiveIntent,
  exactBaselineStillSafe: (() => boolean) | null = null,
): WorkspaceCommitAuthorization {
  let rejection: WorkspaceCommitRejectionReason | null = null;
  return {
    check: () => {
      const reason = currentIntentFailure(request);
      if (reason !== null) {
        rejection ??= reason;
        return false;
      }
      if (exactBaselineStillSafe && !callbackIsTrue(exactBaselineStillSafe)) {
        rejection ??= "workspace-conflict";
        return false;
      }
      return true;
    },
    rejectedReason: () => rejection,
  };
}

async function cancelUnauthorizedCommit(
  storage: WorkspaceStorageAdapter,
  cursor: JournalCursor,
  reserveWasReleased: boolean,
  authorization: WorkspaceCommitAuthorization,
): Promise<WorkspaceLifecycleResult> {
  const reason = authorization.rejectedReason();
  if (reason === null) return { ok: false, reason: "commit-incomplete" };
  const cancelled = await cancelPreparedJournal(
    storage,
    cursor,
    reserveWasReleased,
  );
  return {
    ok: false,
    reason:
      cancelled === "cancelled"
        ? reason
        : cancelled === "degraded"
          ? "reserve-degraded"
          : "commit-incomplete",
  };
}

async function preparedOrFailure(
  storage: WorkspaceStorageAdapter,
  journal: WorkspaceOperationJournalV1,
  releaseReserve: boolean,
  targetRecords: Readonly<Record<string, string>>,
): Promise<
  | { ok: true; cursor: JournalCursor }
  | { ok: false; reason: WorkspaceCoordinatorMutationFailureReason }
> {
  const canonical = await canonicalJournal(journal);
  if (!canonical.ok) return canonical;
  const prepared = await prepareWorkspaceJournal(storage, canonical.cursor.value, {
    releaseReserve,
    targetRecords,
  });
  if (!prepared.ok) {
    return { ok: false, reason: preparationFailureReason(prepared) };
  }
  if (prepared.serializedJournal !== canonical.cursor.serialized) {
    return { ok: false, reason: "commit-incomplete" };
  }
  return canonical;
}

type ReplaceJournalPreparationResult =
  | {
      ok: true;
      cursor: JournalCursor;
      reserveNeedsRecreation: boolean;
    }
  | { ok: false; reason: WorkspaceCoordinatorMutationFailureReason };

async function prepareReplaceJournal(
  storage: WorkspaceStorageAdapter,
  journal: WorkspaceOperationJournalV1,
  targetRecord: Readonly<{ key: string; serialized: string }>,
  sourceRecord: WorkspaceProjectSnapshot,
  baseline: WorkspaceProjectBaseline,
): Promise<ReplaceJournalPreparationResult> {
  const canonical = await canonicalJournal(journal);
  if (!canonical.ok) return canonical;
  const nonGrowing = targetRecord.serialized.length <= sourceRecord.raw.length;
  const targets = { [targetRecord.key]: targetRecord.serialized };
  const reserve = readExact(storage, WORKSPACE_RESERVE_KEY);
  if (!reserve.ok) return { ok: false, reason: "storage-error" };
  const reserveState = classifyWorkspaceReserve(reserve.value);
  if (reserveState === "invalid" || (!nonGrowing && reserveState === "missing")) {
    return { ok: false, reason: "reserve-degraded" };
  }

  if (reserveState === "valid") {
    const prepared = await preparedOrFailure(
      storage,
      canonical.cursor.value,
      nonGrowing,
      targets,
    );
    return prepared.ok
      ? {
          ok: true,
          cursor: prepared.cursor,
          reserveNeedsRecreation: nonGrowing,
        }
      : prepared;
  }

  // The shared preparer deliberately rejects every missing reserve. Running it
  // first still gives this one ADR-approved exception the complete journal,
  // target-record, authority, cleanup, and digest validation used elsewhere.
  const validation = await prepareWorkspaceJournal(
    storage,
    canonical.cursor.value,
    { releaseReserve: false, targetRecords: targets },
  );
  if (validation.ok) {
    return validation.serializedJournal === canonical.cursor.serialized
      ? {
          ok: true,
          cursor: canonical.cursor,
          reserveNeedsRecreation: false,
        }
      : { ok: false, reason: "commit-incomplete" };
  }
  if (validation.reason !== "invalid-reserve") {
    return { ok: false, reason: preparationFailureReason(validation) };
  }

  const confirmedReserve = readExact(storage, WORKSPACE_RESERVE_KEY);
  if (!confirmedReserve.ok) return { ok: false, reason: "storage-error" };
  const confirmedReserveState = classifyWorkspaceReserve(confirmedReserve.value);
  if (confirmedReserveState === "invalid") {
    return { ok: false, reason: "reserve-degraded" };
  }
  if (confirmedReserveState === "valid") {
    const prepared = await preparedOrFailure(
      storage,
      canonical.cursor.value,
      true,
      targets,
    );
    return prepared.ok
      ? {
          ok: true,
          cursor: prepared.cursor,
          reserveNeedsRecreation: true,
        }
      : prepared;
  }

  const authority = await readWorkspaceAuthority(storage);
  if (!authority.ok) {
    return { ok: false, reason: authorityFailureReason(authority.reason) };
  }
  if (!indexBaselineMatches(authority.snapshot, baseline.index)) {
    return { ok: false, reason: "workspace-conflict" };
  }
  const exactSource = findActiveProject(authority.snapshot, baseline);
  if (
    !exactSource ||
    exactSource.key !== sourceRecord.key ||
    targetRecord.key !== exactSource.key ||
    targetRecord.serialized.length > exactSource.raw.length
  ) {
    return { ok: false, reason: "workspace-conflict" };
  }
  const existingJournal = readExact(storage, WORKSPACE_OPERATION_KEY);
  if (!existingJournal.ok) return { ok: false, reason: "storage-error" };
  if (existingJournal.value !== null) {
    return { ok: false, reason: "recovery-required" };
  }

  const written = await writeWorkspaceJournalPhase(
    storage,
    canonical.cursor.serialized,
    {
      expectedBeforeDigest: null,
      targetDigest: canonical.cursor.digest,
      commitStillAuthorized: () => {
        const latestReserve = readExact(storage, WORKSPACE_RESERVE_KEY);
        return latestReserve.ok && latestReserve.value === null;
      },
    },
  );
  const observedJournal = readExact(storage, WORKSPACE_OPERATION_KEY);
  if (!observedJournal.ok) return { ok: false, reason: "storage-error" };
  if (observedJournal.value === canonical.cursor.serialized) {
    return {
      ok: true,
      cursor: canonical.cursor,
      reserveNeedsRecreation: true,
    };
  }
  if (observedJournal.value !== null) {
    return { ok: false, reason: "recovery-required" };
  }
  return {
    ok: false,
    reason:
      written.ok || written.reason === "commit-cancelled"
        ? "reserve-degraded"
        : "storage-error",
  };
}

function bestEffortRemovePreference(
  storage: WorkspaceStorageAdapter,
  index: WorkspaceIndexV1,
  projectId: string | null,
): boolean {
  try {
    const raw = storage.getItem(WORKSPACE_PREFERENCES_KEY);
    if (raw === null) return true;
    const parsed = parseWorkspacePreferences(raw);
    const remove =
      projectId === null
        ? true
        : parsed.ok &&
          parsed.value.workspaceId === index.workspaceId &&
          parsed.value.workspaceGeneration === index.workspaceGeneration &&
          parsed.value.lastOpenedProjectId === projectId;
    if (!remove) return true;
    if (storage.getItem(WORKSPACE_PREFERENCES_KEY) !== raw) return false;
    return removeExact(storage, WORKSPACE_PREFERENCES_KEY).ok;
  } catch {
    return false;
  }
}

async function finishOperation(
  storage: WorkspaceStorageAdapter,
  cursor: JournalCursor,
  reserveWasReleased: boolean,
  preferenceCleaned: boolean,
): Promise<WorkspaceLifecycleResult> {
  const removed = await removeWorkspaceJournal(storage, {
    expectedBeforeDigest: cursor.digest,
  });
  if (!removed.ok) return { ok: false, reason: "commit-incomplete" };
  const reserveHealthy =
    !reserveWasReleased ||
    recreateWorkspaceReserve(storage, CANONICAL_WORKSPACE_RESERVE).ok;
  const authority = await readWorkspaceAuthority(storage);
  if (!authority.ok) {
    return { ok: false, reason: authorityFailureReason(authority.reason) };
  }
  return {
    ok: true,
    snapshot: authority.snapshot,
    storageProtection: reserveHealthy ? "healthy" : "degraded",
    preferenceCleaned,
    changed: true,
  };
}

async function executeProjectLifecycleTarget(
  storage: WorkspaceStorageAdapter,
  cursor: JournalCursor,
  serializedProject: string,
  serializedIndex: string,
  writeIndex: boolean,
  reserveWasReleased: boolean,
  authorization: WorkspaceCommitAuthorization,
  preferenceCleanup: () => boolean,
): Promise<WorkspaceLifecycleResult> {
  let current = await advanceJournal(storage, cursor, "records-writing");
  if (!current) return { ok: false, reason: "commit-incomplete" };
  const mutation = current.value.projectMutations[0];
  if (!mutation) return { ok: false, reason: "commit-incomplete" };
  const projectWritten = await writeWorkspaceProjectTarget(
    storage,
    mutation.targetRecord.key,
    serializedProject,
    {
      expectedBeforeDigest: mutation.targetRecord.expectedBeforeDigest,
      targetDigest: mutation.targetRecord.targetDigest,
      commitStillAuthorized: authorization.check,
    },
  );
  if (!projectWritten.ok) {
    return projectWritten.reason === "commit-cancelled"
      ? cancelUnauthorizedCommit(
          storage,
          current,
          reserveWasReleased,
          authorization,
        )
      : { ok: false, reason: "commit-incomplete" };
  }

  current = await advanceJournal(storage, current, "records-written");
  if (!current) return { ok: false, reason: "commit-incomplete" };
  if (writeIndex) {
    const indexWritten = await writeWorkspaceIndexTarget(storage, serializedIndex, {
      expectedBeforeDigest: current.value.baseIndex.expectedDigest,
      targetDigest: current.value.targetIndex.targetDigest,
    });
    if (!indexWritten.ok) return { ok: false, reason: "commit-incomplete" };
  }
  current = await advanceJournal(storage, current, "index-committed");
  if (!current) return { ok: false, reason: "commit-incomplete" };
  return finishOperation(
    storage,
    current,
    reserveWasReleased,
    preferenceCleanup(),
  );
}

export async function replaceWorkspaceProject(
  storage: WorkspaceStorageAdapter,
  locks: WorkspaceExclusiveLockRunner | null,
  request: WorkspaceReplaceProjectRequest,
): Promise<WorkspaceLifecycleResult> {
  if (!locks) return { ok: false, reason: "lock-unavailable" };
  try {
    return await locks.runExclusive(WORKSPACE_LOCK_NAME, async () => {
      const authority = await readWorkspaceAuthority(storage);
      if (!authority.ok) {
        return { ok: false, reason: authorityFailureReason(authority.reason) };
      }
      if (!indexBaselineMatches(authority.snapshot, request.baseline.index)) {
        return { ok: false, reason: "workspace-conflict" };
      }
      if (authority.snapshot.index.status !== "active") {
        return { ok: false, reason: "workspace-not-active" };
      }
      const currentProject = findActiveProject(authority.snapshot, request.baseline);
      if (!currentProject) return { ok: false, reason: "project-conflict" };
      if (
        currentProject.record.revision >= Number.MAX_SAFE_INTEGER ||
        request.backup.state.projectKind === "none"
      ) {
        return { ok: false, reason: "invalid-state" };
      }
      const initialIntentFailure = currentIntentFailure(request);
      if (initialIntentFailure) {
        return { ok: false, reason: initialIntentFailure };
      }

      const targetProject = serializeWorkspaceProjectRecord({
        ...currentProject.record,
        revision: currentProject.record.revision + 1,
        value: { kind: "project", state: request.backup.state },
      });
      if (!targetProject.ok) return { ok: false, reason: "invalid-state" };
      const targetDigest = await digestRaw(targetProject.serialized);
      if (targetDigest === null) {
        return { ok: false, reason: "digest-unavailable" };
      }
      const operationId = generateSecureWorkspaceUuid(request.uuidSource);
      if (operationId === null) {
        return { ok: false, reason: "id-unavailable-or-collided" };
      }
      const journal: WorkspaceOperationJournalV1 = {
        formatVersion: 1,
        operationId,
        kind: "replace-project",
        workspaceId: authority.snapshot.index.workspaceId,
        sourceGeneration: authority.snapshot.index.workspaceGeneration,
        targetGeneration: authority.snapshot.index.workspaceGeneration,
        phase: "prepared",
        baseIndex: {
          key: WORKSPACE_INDEX_KEY,
          expectedDigest: authority.snapshot.indexDigest,
        },
        targetIndex: {
          key: WORKSPACE_INDEX_KEY,
          serializedValue: authority.snapshot.indexRaw,
          targetDigest: authority.snapshot.indexDigest,
        },
        legacyExpectedDigests: {
          ...authority.snapshot.index.legacyFingerprints,
        },
        projectMutations: [
          {
            mode: "replace",
            projectId: currentProject.record.projectId,
            sourceRecord: null,
            targetRecord: {
              key: currentProject.key,
              expectedBeforeDigest: currentProject.digest,
              targetDigest,
            },
            sourceCleanup: null,
          },
        ],
        cleanup: [],
      };
      const prepared = await prepareReplaceJournal(
        storage,
        journal,
        { key: currentProject.key, serialized: targetProject.serialized },
        currentProject,
        request.baseline,
      );
      if (!prepared.ok) return prepared;

      const postPreparationFailure = currentIntentFailure(request);
      if (postPreparationFailure) {
        const cancelled = await cancelPreparedJournal(
          storage,
          prepared.cursor,
          prepared.reserveNeedsRecreation,
        );
        return {
          ok: false,
          reason:
            cancelled === "cancelled"
              ? postPreparationFailure
              : cancelled === "degraded"
                ? "reserve-degraded"
                : "commit-incomplete",
        };
      }
      return executeProjectLifecycleTarget(
        storage,
        prepared.cursor,
        targetProject.serialized,
        authority.snapshot.indexRaw,
        false,
        prepared.reserveNeedsRecreation,
        commitAuthorization(request),
        () => true,
      );
    });
  } catch {
    return { ok: false, reason: "lock-failed" };
  }
}

export async function deleteWorkspaceProject(
  storage: WorkspaceStorageAdapter,
  locks: WorkspaceExclusiveLockRunner | null,
  request: WorkspaceDeleteProjectRequest,
): Promise<WorkspaceLifecycleResult> {
  if (!locks) return { ok: false, reason: "lock-unavailable" };
  try {
    return await locks.runExclusive(WORKSPACE_LOCK_NAME, async () => {
      const authority = await readWorkspaceAuthority(storage);
      if (!authority.ok) {
        return { ok: false, reason: authorityFailureReason(authority.reason) };
      }
      if (!indexBaselineMatches(authority.snapshot, request.baseline.index)) {
        return { ok: false, reason: "workspace-conflict" };
      }
      if (authority.snapshot.index.status !== "active") {
        return { ok: false, reason: "workspace-not-active" };
      }
      const currentProject = findActiveProject(authority.snapshot, request.baseline);
      if (!currentProject) return { ok: false, reason: "project-conflict" };
      if (
        currentProject.record.revision >= Number.MAX_SAFE_INTEGER ||
        authority.snapshot.index.revision >= Number.MAX_SAFE_INTEGER
      ) {
        return { ok: false, reason: "invalid-request" };
      }
      const initialIntentFailure = currentIntentFailure(request);
      if (initialIntentFailure) {
        return { ok: false, reason: initialIntentFailure };
      }

      const tombstone = serializeWorkspaceProjectRecord({
        ...currentProject.record,
        revision: currentProject.record.revision + 1,
        value: { kind: "tombstone" },
      });
      if (!tombstone.ok) return { ok: false, reason: "invalid-request" };
      const tombstoneDigest = await digestRaw(tombstone.serialized);
      if (tombstoneDigest === null) {
        return { ok: false, reason: "digest-unavailable" };
      }
      const targetIndex = serializeWorkspaceIndex({
        ...authority.snapshot.index,
        revision: authority.snapshot.index.revision + 1,
        status: "active",
        projects: authority.snapshot.index.projects.map((entry) =>
          entry.projectId === currentProject.record.projectId
            ? { ...entry, kind: "tombstone" as const }
            : entry,
        ),
      });
      if (!targetIndex.ok) return { ok: false, reason: "invalid-request" };
      const targetIndexDigest = await digestRaw(targetIndex.serialized);
      if (targetIndexDigest === null) {
        return { ok: false, reason: "digest-unavailable" };
      }
      const operationId = generateSecureWorkspaceUuid(request.uuidSource);
      if (operationId === null) {
        return { ok: false, reason: "id-unavailable-or-collided" };
      }
      const journal: WorkspaceOperationJournalV1 = {
        formatVersion: 1,
        operationId,
        kind: "delete-project",
        workspaceId: authority.snapshot.index.workspaceId,
        sourceGeneration: authority.snapshot.index.workspaceGeneration,
        targetGeneration: authority.snapshot.index.workspaceGeneration,
        phase: "prepared",
        baseIndex: {
          key: WORKSPACE_INDEX_KEY,
          expectedDigest: authority.snapshot.indexDigest,
        },
        targetIndex: {
          key: WORKSPACE_INDEX_KEY,
          serializedValue: targetIndex.serialized,
          targetDigest: targetIndexDigest,
        },
        legacyExpectedDigests: {
          ...authority.snapshot.index.legacyFingerprints,
        },
        projectMutations: [
          {
            mode: "delete",
            projectId: currentProject.record.projectId,
            sourceRecord: null,
            targetRecord: {
              key: currentProject.key,
              expectedBeforeDigest: currentProject.digest,
              targetDigest: tombstoneDigest,
            },
            sourceCleanup: null,
          },
        ],
        cleanup: [],
      };
      const prepared = await preparedOrFailure(storage, journal, true, {
        [currentProject.key]: tombstone.serialized,
      });
      if (!prepared.ok) return prepared;

      const postPreparationFailure = currentIntentFailure(request);
      if (postPreparationFailure) {
        const cancelled = await cancelPreparedJournal(storage, prepared.cursor, true);
        return {
          ok: false,
          reason:
            cancelled === "cancelled"
              ? postPreparationFailure
              : cancelled === "degraded"
                ? "reserve-degraded"
                : "commit-incomplete",
        };
      }
      return executeProjectLifecycleTarget(
        storage,
        prepared.cursor,
        tombstone.serialized,
        targetIndex.serialized,
        true,
        true,
        commitAuthorization(request),
        () =>
          bestEffortRemovePreference(
            storage,
            authority.snapshot.index,
            currentProject.record.projectId,
          ),
      );
    });
  } catch {
    return { ok: false, reason: "lock-failed" };
  }
}

async function exactCleanupEntries(
  storage: WorkspaceStorageAdapter,
  keys: readonly string[],
): Promise<
  | { ok: true; entries: Array<{ key: string; expectedDigest: string }> }
  | { ok: false; reason: "storage-error" | "digest-unavailable" }
> {
  const entries: Array<{ key: string; expectedDigest: string }> = [];
  for (const key of [...keys].sort()) {
    const observed = await digestAtKey(storage, key);
    if (!observed.ok) return observed;
    if (observed.raw === null || observed.digest === null) continue;
    entries.push({ key, expectedDigest: observed.digest });
  }
  return { ok: true, entries };
}

async function removeCleanupEntries(
  storage: WorkspaceStorageAdapter,
  entries: readonly { key: string; expectedDigest: string }[],
): Promise<boolean> {
  for (const entry of entries) {
    const removed = await removeWorkspaceCleanupSource(storage, entry.key, {
      expectedBeforeDigest: entry.expectedDigest,
    });
    if (!removed.ok) return false;
  }
  return true;
}

function cleanupCompletionIsExact(
  storage: WorkspaceStorageAdapter,
  kind: WorkspaceLifecycleKind,
): boolean {
  try {
    for (const name of LEGACY_NAMES) {
      if (storage.getItem(LEGACY_PROJECT_KEYS[name]) !== null) return false;
    }
    return (
      kind !== "delete-workspace" ||
      storage
        .keys()
        .every((key) => parseWorkspaceProjectRecordKey(key) === null)
    );
  } catch {
    return false;
  }
}

async function executeCleanupLifecycle(
  storage: WorkspaceStorageAdapter,
  cursor: JournalCursor,
  authorization: WorkspaceCommitAuthorization,
  preferenceCleanup: () => boolean,
): Promise<WorkspaceLifecycleResult> {
  let current = await advanceJournal(storage, cursor, "records-writing");
  if (!current) return { ok: false, reason: "commit-incomplete" };
  current = await advanceJournal(storage, current, "records-written");
  if (!current) return { ok: false, reason: "commit-incomplete" };
  const indexWritten = await writeWorkspaceIndexTarget(
    storage,
    current.value.targetIndex.serializedValue,
    {
      expectedBeforeDigest: current.value.baseIndex.expectedDigest,
      targetDigest: current.value.targetIndex.targetDigest,
      commitStillAuthorized: authorization.check,
    },
  );
  if (!indexWritten.ok) {
    return indexWritten.reason === "commit-cancelled"
      ? cancelUnauthorizedCommit(storage, current, true, authorization)
      : { ok: false, reason: "commit-incomplete" };
  }
  current = await advanceJournal(storage, current, "index-committed");
  if (!current) return { ok: false, reason: "commit-incomplete" };
  current = await advanceJournal(storage, current, "cleanup-pending");
  if (!current) return { ok: false, reason: "commit-incomplete" };

  const cleanupByKey = new Map(
    current.value.cleanup.map((entry) => [entry.key, entry] as const),
  );
  const projectEntries = current.value.cleanup
    .filter((entry) => parseWorkspaceProjectRecordKey(entry.key) !== null)
    .sort((left, right) => (left.key < right.key ? -1 : 1));
  if (!(await removeCleanupEntries(storage, projectEntries))) {
    return { ok: false, reason: "commit-incomplete" };
  }
  const legacyEntries = LEGACY_NAMES.flatMap((name) => {
    const entry = cleanupByKey.get(LEGACY_PROJECT_KEYS[name]);
    return entry ? [entry] : [];
  });
  if (!(await removeCleanupEntries(storage, legacyEntries))) {
    return { ok: false, reason: "commit-incomplete" };
  }
  if (!cleanupCompletionIsExact(storage, current.value.kind as WorkspaceLifecycleKind)) {
    return { ok: false, reason: "commit-incomplete" };
  }
  return finishOperation(storage, current, true, preferenceCleanup());
}

export async function cleanupWorkspaceLegacyData(
  storage: WorkspaceStorageAdapter,
  locks: WorkspaceExclusiveLockRunner | null,
  request: WorkspaceLegacyCleanupRequest,
): Promise<WorkspaceLifecycleResult> {
  if (!locks) return { ok: false, reason: "lock-unavailable" };
  try {
    return await locks.runExclusive(WORKSPACE_LOCK_NAME, async () => {
      const authority = await readWorkspaceAuthority(storage);
      if (!authority.ok) {
        return { ok: false, reason: authorityFailureReason(authority.reason) };
      }
      if (!indexBaselineMatches(authority.snapshot, request.baseline)) {
        return { ok: false, reason: "workspace-conflict" };
      }
      if (
        authority.snapshot.index.status !== "active"
      ) {
        return { ok: false, reason: "workspace-not-active" };
      }
      if (authority.snapshot.index.revision >= Number.MAX_SAFE_INTEGER) {
        return { ok: false, reason: "invalid-request" };
      }
      const initialIntentFailure = currentIntentFailure(request);
      if (initialIntentFailure) {
        return { ok: false, reason: initialIntentFailure };
      }
      if (
        Object.values(authority.snapshot.index.legacyFingerprints).every(
          (digest) => digest === null,
        )
      ) {
        const reserveHealthy = recreateWorkspaceReserve(
          storage,
          CANONICAL_WORKSPACE_RESERVE,
        ).ok;
        return {
          ok: true,
          snapshot: authority.snapshot,
          storageProtection: reserveHealthy ? "healthy" : "degraded",
          preferenceCleaned: true,
          changed: false,
        };
      }

      const targetIndex = serializeWorkspaceIndex({
        ...authority.snapshot.index,
        revision: authority.snapshot.index.revision + 1,
        legacyFingerprints: {
          record: null,
          v3: null,
          v2: null,
          v1: null,
        },
      });
      if (!targetIndex.ok) return { ok: false, reason: "invalid-request" };
      const targetDigest = await digestRaw(targetIndex.serialized);
      if (targetDigest === null) {
        return { ok: false, reason: "digest-unavailable" };
      }
      const cleanup = LEGACY_NAMES.flatMap((name) => {
        const expectedDigest = authority.snapshot.index.legacyFingerprints[name];
        return expectedDigest === null
          ? []
          : [{ key: LEGACY_PROJECT_KEYS[name], expectedDigest }];
      });
      const operationId = generateSecureWorkspaceUuid(request.uuidSource);
      if (operationId === null) {
        return { ok: false, reason: "id-unavailable-or-collided" };
      }
      const journal: WorkspaceOperationJournalV1 = {
        formatVersion: 1,
        operationId,
        kind: "legacy-cleanup",
        workspaceId: authority.snapshot.index.workspaceId,
        sourceGeneration: authority.snapshot.index.workspaceGeneration,
        targetGeneration: authority.snapshot.index.workspaceGeneration,
        phase: "prepared",
        baseIndex: {
          key: WORKSPACE_INDEX_KEY,
          expectedDigest: authority.snapshot.indexDigest,
        },
        targetIndex: {
          key: WORKSPACE_INDEX_KEY,
          serializedValue: targetIndex.serialized,
          targetDigest,
        },
        legacyExpectedDigests: {
          ...authority.snapshot.index.legacyFingerprints,
        },
        projectMutations: [],
        cleanup,
      };
      const prepared = await preparedOrFailure(storage, journal, true, {});
      if (!prepared.ok) return prepared;
      const postPreparationFailure = currentIntentFailure(request);
      if (postPreparationFailure) {
        const cancelled = await cancelPreparedJournal(storage, prepared.cursor, true);
        return {
          ok: false,
          reason:
            cancelled === "cancelled"
              ? postPreparationFailure
              : cancelled === "degraded"
                ? "reserve-degraded"
                : "commit-incomplete",
        };
      }
      return executeCleanupLifecycle(
        storage,
        prepared.cursor,
        commitAuthorization(request),
        () => true,
      );
    });
  } catch {
    return { ok: false, reason: "lock-failed" };
  }
}

async function allOwnedProjectCleanup(
  storage: WorkspaceStorageAdapter,
): Promise<
  | { ok: true; entries: Array<{ key: string; expectedDigest: string }> }
  | { ok: false; reason: "storage-error" | "digest-unavailable" }
> {
  let keys: string[];
  try {
    keys = storage
      .keys()
      .filter((key) => parseWorkspaceProjectRecordKey(key) !== null)
      .sort();
  } catch {
    return { ok: false, reason: "storage-error" };
  }
  return exactCleanupEntries(storage, keys);
}

function recoveryPrivacyPurgeEligibilityFailure(
  reason: WorkspaceAuthorityReadFailureReason,
): WorkspaceRecoveryPrivacyPurgeInspectionResult | null {
  if (
    reason === "missing-index" ||
    reason === "invalid-index" ||
    reason === "invalid-project-record"
  ) {
    return null;
  }
  if (
    reason === "operation-recovery-required" ||
    reason === "invalid-operation-journal"
  ) {
    return { ok: false, reason: "recovery-required" };
  }
  if (reason === "concurrent-change") {
    return { ok: false, reason: "workspace-conflict" };
  }
  if (reason === "digest-unavailable") {
    return { ok: false, reason: "digest-unavailable" };
  }
  return {
    ok: false,
    reason:
      reason === "storage-error" ? "storage-error" : "recovery-not-eligible",
  };
}

function sameStringArrays(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Captures only keys and exact digests for an explicitly confirmed
 * recovery-only privacy purge. It never selects a namespace group and never
 * returns project bytes to the caller.
 */
export async function inspectWorkspaceRecoveryPrivacyPurge(
  storage: WorkspaceStorageAdapter,
): Promise<WorkspaceRecoveryPrivacyPurgeInspectionResult> {
  const authority = await readWorkspaceAuthority(storage);
  if (authority.ok) return { ok: false, reason: "recovery-not-eligible" };
  const eligibilityFailure = recoveryPrivacyPurgeEligibilityFailure(
    authority.reason,
  );
  if (eligibilityFailure) return eligibilityFailure;

  const journal = readExact(storage, WORKSPACE_OPERATION_KEY);
  if (!journal.ok) return { ok: false, reason: "storage-error" };
  if (journal.value !== null) return { ok: false, reason: "recovery-required" };
  const index = await digestAtKey(storage, WORKSPACE_INDEX_KEY);
  if (!index.ok) return index;

  let projectKeys: string[];
  try {
    projectKeys = storage
      .keys()
      .filter((key) => parseWorkspaceProjectRecordKey(key) !== null)
      .sort();
  } catch {
    return { ok: false, reason: "storage-error" };
  }
  const ownedProjectDigests: Array<{ key: string; digest: string }> = [];
  for (const key of projectKeys) {
    const observed = await digestAtKey(storage, key);
    if (!observed.ok) return observed;
    if (observed.raw === null || observed.digest === null) {
      return { ok: false, reason: "workspace-conflict" };
    }
    ownedProjectDigests.push({ key, digest: observed.digest });
  }

  const legacyDigests: WorkspaceLegacyFingerprints = {
    record: null,
    v3: null,
    v2: null,
    v1: null,
  };
  for (const name of LEGACY_NAMES) {
    const observed = await digestAtKey(storage, LEGACY_PROJECT_KEYS[name]);
    if (!observed.ok) return observed;
    legacyDigests[name] = observed.digest;
  }

  const indexConfirmed = await digestAtKey(storage, WORKSPACE_INDEX_KEY);
  if (!indexConfirmed.ok) return indexConfirmed;
  if (indexConfirmed.digest !== index.digest) {
    return { ok: false, reason: "workspace-conflict" };
  }
  let confirmedKeys: string[];
  try {
    confirmedKeys = storage
      .keys()
      .filter((key) => parseWorkspaceProjectRecordKey(key) !== null)
      .sort();
  } catch {
    return { ok: false, reason: "storage-error" };
  }
  if (!sameStringArrays(projectKeys, confirmedKeys)) {
    return { ok: false, reason: "workspace-conflict" };
  }
  for (const entry of ownedProjectDigests) {
    const confirmed = await digestAtKey(storage, entry.key);
    if (!confirmed.ok) return confirmed;
    if (confirmed.digest !== entry.digest) {
      return { ok: false, reason: "workspace-conflict" };
    }
  }
  for (const name of LEGACY_NAMES) {
    const confirmed = await digestAtKey(storage, LEGACY_PROJECT_KEYS[name]);
    if (!confirmed.ok) return confirmed;
    if (confirmed.digest !== legacyDigests[name]) {
      return { ok: false, reason: "workspace-conflict" };
    }
  }
  const journalConfirmed = readExact(storage, WORKSPACE_OPERATION_KEY);
  if (!journalConfirmed.ok) return { ok: false, reason: "storage-error" };
  if (journalConfirmed.value !== null) {
    return { ok: false, reason: "recovery-required" };
  }
  return {
    ok: true,
    baseline: {
      indexDigest: index.digest,
      ownedProjectDigests,
      legacyDigests,
    },
  };
}

function sameRecoveryPrivacyPurgeBaseline(
  left: WorkspaceRecoveryPrivacyPurgeBaseline,
  right: WorkspaceRecoveryPrivacyPurgeBaseline,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

interface RecoveryPrivacyPurgeCommitBaseline {
  indexRaw: string | null;
  ownedProjects: ReadonlyArray<{ key: string; raw: string }>;
  legacyRaw: Readonly<Record<(typeof LEGACY_NAMES)[number], string | null>>;
}

async function captureRecoveryPrivacyPurgeCommitBaseline(
  storage: WorkspaceStorageAdapter,
  baseline: WorkspaceRecoveryPrivacyPurgeBaseline,
): Promise<
  | { ok: true; baseline: RecoveryPrivacyPurgeCommitBaseline }
  | {
      ok: false;
      reason: "storage-error" | "digest-unavailable" | "workspace-conflict";
    }
> {
  const index = await digestAtKey(storage, WORKSPACE_INDEX_KEY);
  if (!index.ok) return index;
  if (index.digest !== baseline.indexDigest) {
    return { ok: false, reason: "workspace-conflict" };
  }

  let keys: string[];
  try {
    keys = storage
      .keys()
      .filter((key) => parseWorkspaceProjectRecordKey(key) !== null)
      .sort();
  } catch {
    return { ok: false, reason: "storage-error" };
  }
  if (
    !sameStringArrays(
      keys,
      baseline.ownedProjectDigests.map((entry) => entry.key),
    )
  ) {
    return { ok: false, reason: "workspace-conflict" };
  }
  const ownedProjects: Array<{ key: string; raw: string }> = [];
  for (const entry of baseline.ownedProjectDigests) {
    const observed = await digestAtKey(storage, entry.key);
    if (!observed.ok) return observed;
    if (observed.raw === null || observed.digest !== entry.digest) {
      return { ok: false, reason: "workspace-conflict" };
    }
    ownedProjects.push({ key: entry.key, raw: observed.raw });
  }

  const legacyRaw: Record<(typeof LEGACY_NAMES)[number], string | null> = {
    record: null,
    v3: null,
    v2: null,
    v1: null,
  };
  for (const name of LEGACY_NAMES) {
    const observed = await digestAtKey(storage, LEGACY_PROJECT_KEYS[name]);
    if (!observed.ok) return observed;
    if (observed.digest !== baseline.legacyDigests[name]) {
      return { ok: false, reason: "workspace-conflict" };
    }
    legacyRaw[name] = observed.raw;
  }

  const authority = await readWorkspaceAuthority(storage);
  if (authority.ok) return { ok: false, reason: "workspace-conflict" };
  if (recoveryPrivacyPurgeEligibilityFailure(authority.reason) !== null) {
    return { ok: false, reason: "workspace-conflict" };
  }
  return {
    ok: true,
    baseline: { indexRaw: index.raw, ownedProjects, legacyRaw },
  };
}

function recoveryPrivacyPurgeCommitBaselineStillExact(
  storage: WorkspaceStorageAdapter,
  baseline: RecoveryPrivacyPurgeCommitBaseline,
): boolean {
  try {
    if (storage.getItem(WORKSPACE_INDEX_KEY) !== baseline.indexRaw) return false;
    const keys = storage
      .keys()
      .filter((key) => parseWorkspaceProjectRecordKey(key) !== null)
      .sort();
    if (!sameStringArrays(keys, baseline.ownedProjects.map((entry) => entry.key))) {
      return false;
    }
    for (const entry of baseline.ownedProjects) {
      if (storage.getItem(entry.key) !== entry.raw) return false;
    }
    for (const name of LEGACY_NAMES) {
      if (storage.getItem(LEGACY_PROJECT_KEYS[name]) !== baseline.legacyRaw[name]) {
        return false;
      }
    }
    // The captured bytes were reclassified as recovery-only immediately before
    // journaling. Exact byte equality preserves that deterministic conclusion;
    // any repair that could restore strict authority changes a captured value or
    // the owned-key set and therefore cancels before the cleared-index commit.
    return true;
  } catch {
    return false;
  }
}

/**
 * Explicit privacy deletion for a missing/corrupt authority. This path is
 * separate from normal deleteEntireWorkspace: it requires a stable preview,
 * refuses a valid authority, journals every exact owned value, and creates a
 * fresh content-free cleared guard before cleanup.
 */
export async function purgeWorkspaceRecoveryData(
  storage: WorkspaceStorageAdapter,
  locks: WorkspaceExclusiveLockRunner | null,
  request: WorkspaceRecoveryPrivacyPurgeRequest,
): Promise<WorkspaceLifecycleResult> {
  if (!locks) return { ok: false, reason: "lock-unavailable" };
  try {
    return await locks.runExclusive(WORKSPACE_LOCK_NAME, async () => {
      const inspected = await inspectWorkspaceRecoveryPrivacyPurge(storage);
      if (!inspected.ok) return inspected;
      if (
        !sameRecoveryPrivacyPurgeBaseline(inspected.baseline, request.baseline)
      ) {
        return { ok: false, reason: "workspace-conflict" };
      }
      const initialIntentFailure = currentIntentFailure(request);
      if (initialIntentFailure) {
        return { ok: false, reason: initialIntentFailure };
      }

      const operationId = generateSecureWorkspaceUuid(request.uuidSource);
      if (operationId === null) {
        return { ok: false, reason: "id-unavailable-or-collided" };
      }
      const extantWorkspaceIds = new Set(
        inspected.baseline.ownedProjectDigests.flatMap((entry) => {
          const identity = parseWorkspaceProjectRecordKey(entry.key);
          return identity ? [identity.workspaceId] : [];
        }),
      );
      const indexRead = readExact(storage, WORKSPACE_INDEX_KEY);
      if (!indexRead.ok) return { ok: false, reason: "storage-error" };
      if (indexRead.value !== null) {
        const parsedIndex = parseWorkspaceIndex(indexRead.value);
        if (parsedIndex.ok) extantWorkspaceIds.add(parsedIndex.value.workspaceId);
      }
      const targetWorkspaceId = generateCollisionCheckedUuid(
        (candidate) => extantWorkspaceIds.has(candidate),
        request.uuidSource,
      );
      if (targetWorkspaceId === null) {
        return { ok: false, reason: "id-unavailable-or-collided" };
      }
      const targetIndex = serializeWorkspaceIndex({
        formatVersion: 1,
        workspaceId: targetWorkspaceId,
        workspaceGeneration: 1,
        revision: 1,
        status: "cleared",
        projects: [],
        legacyFingerprints: {
          record: null,
          v3: null,
          v2: null,
          v1: null,
        },
      });
      if (!targetIndex.ok) return { ok: false, reason: "invalid-request" };
      const targetIndexDigest = await digestRaw(targetIndex.serialized);
      if (targetIndexDigest === null) {
        return { ok: false, reason: "digest-unavailable" };
      }

      const reserve = readExact(storage, WORKSPACE_RESERVE_KEY);
      if (!reserve.ok) return { ok: false, reason: "storage-error" };
      if (reserve.value !== CANONICAL_WORKSPACE_RESERVE) {
        const established = recreateWorkspaceReserve(
          storage,
          CANONICAL_WORKSPACE_RESERVE,
        );
        if (!established.ok) {
          return { ok: false, reason: "reserve-degraded" };
        }
      }
      const cleanup = [
        ...inspected.baseline.ownedProjectDigests.map((entry) => ({
          key: entry.key,
          expectedDigest: entry.digest,
        })),
        ...LEGACY_NAMES.flatMap((name) => {
          const expectedDigest = inspected.baseline.legacyDigests[name];
          return expectedDigest === null
            ? []
            : [{ key: LEGACY_PROJECT_KEYS[name], expectedDigest }];
        }),
      ];
      const journalValue: WorkspaceOperationJournalV1 = {
        formatVersion: 1,
        operationId,
        kind: "delete-workspace",
        workspaceId: targetWorkspaceId,
        sourceGeneration: null,
        targetGeneration: 1,
        phase: "prepared",
        baseIndex: {
          key: WORKSPACE_INDEX_KEY,
          expectedDigest: inspected.baseline.indexDigest,
        },
        targetIndex: {
          key: WORKSPACE_INDEX_KEY,
          serializedValue: targetIndex.serialized,
          targetDigest: targetIndexDigest,
        },
        legacyExpectedDigests: { ...inspected.baseline.legacyDigests },
        projectMutations: [],
        cleanup,
      };
      const commitBaseline = await captureRecoveryPrivacyPurgeCommitBaseline(
        storage,
        inspected.baseline,
      );
      if (!commitBaseline.ok) return commitBaseline;
      const prepared = await preparedOrFailure(storage, journalValue, true, {});
      if (!prepared.ok) return prepared;

      const postPreparationFailure = currentIntentFailure(request);
      if (postPreparationFailure) {
        const cancelled = await cancelPreparedJournal(storage, prepared.cursor, true);
        return {
          ok: false,
          reason:
            cancelled === "cancelled"
              ? postPreparationFailure
              : cancelled === "degraded"
                ? "reserve-degraded"
                : "commit-incomplete",
        };
      }
      return executeCleanupLifecycle(
        storage,
        prepared.cursor,
        commitAuthorization(request, () =>
          recoveryPrivacyPurgeCommitBaselineStillExact(
            storage,
            commitBaseline.baseline,
          ),
        ),
        () => bestEffortRemovePreference(storage, targetIndex.value, null),
      );
    });
  } catch {
    return { ok: false, reason: "lock-failed" };
  }
}

export async function deleteEntireWorkspace(
  storage: WorkspaceStorageAdapter,
  locks: WorkspaceExclusiveLockRunner | null,
  request: WorkspaceDeleteRequest,
): Promise<WorkspaceLifecycleResult> {
  if (!locks) return { ok: false, reason: "lock-unavailable" };
  try {
    return await locks.runExclusive(WORKSPACE_LOCK_NAME, async () => {
      const authority = await readWorkspaceAuthority(storage);
      if (!authority.ok) {
        return { ok: false, reason: authorityFailureReason(authority.reason) };
      }
      if (!indexBaselineMatches(authority.snapshot, request.baseline)) {
        return { ok: false, reason: "workspace-conflict" };
      }
      if (
        authority.snapshot.index.status !== "active"
      ) {
        return { ok: false, reason: "workspace-not-active" };
      }
      if (
        authority.snapshot.index.workspaceGeneration >= Number.MAX_SAFE_INTEGER ||
        authority.snapshot.index.revision >= Number.MAX_SAFE_INTEGER
      ) {
        return { ok: false, reason: "invalid-request" };
      }
      const initialIntentFailure = currentIntentFailure(request);
      if (initialIntentFailure) {
        return { ok: false, reason: initialIntentFailure };
      }

      const ownedProjects = await allOwnedProjectCleanup(storage);
      if (!ownedProjects.ok) return ownedProjects;
      const legacyCleanup = LEGACY_NAMES.flatMap((name) => {
        const expectedDigest = authority.snapshot.index.legacyFingerprints[name];
        return expectedDigest === null
          ? []
          : [{ key: LEGACY_PROJECT_KEYS[name], expectedDigest }];
      });
      const targetIndex = serializeWorkspaceIndex({
        formatVersion: 1,
        workspaceId: authority.snapshot.index.workspaceId,
        workspaceGeneration: authority.snapshot.index.workspaceGeneration + 1,
        revision: authority.snapshot.index.revision + 1,
        status: "cleared",
        projects: [],
        legacyFingerprints: {
          record: null,
          v3: null,
          v2: null,
          v1: null,
        },
      });
      if (!targetIndex.ok) return { ok: false, reason: "invalid-request" };
      const targetDigest = await digestRaw(targetIndex.serialized);
      if (targetDigest === null) {
        return { ok: false, reason: "digest-unavailable" };
      }
      const operationId = generateSecureWorkspaceUuid(request.uuidSource);
      if (operationId === null) {
        return { ok: false, reason: "id-unavailable-or-collided" };
      }
      const journal: WorkspaceOperationJournalV1 = {
        formatVersion: 1,
        operationId,
        kind: "delete-workspace",
        workspaceId: authority.snapshot.index.workspaceId,
        sourceGeneration: authority.snapshot.index.workspaceGeneration,
        targetGeneration: authority.snapshot.index.workspaceGeneration + 1,
        phase: "prepared",
        baseIndex: {
          key: WORKSPACE_INDEX_KEY,
          expectedDigest: authority.snapshot.indexDigest,
        },
        targetIndex: {
          key: WORKSPACE_INDEX_KEY,
          serializedValue: targetIndex.serialized,
          targetDigest,
        },
        legacyExpectedDigests: {
          ...authority.snapshot.index.legacyFingerprints,
        },
        projectMutations: [],
        cleanup: [...ownedProjects.entries, ...legacyCleanup],
      };
      const prepared = await preparedOrFailure(storage, journal, true, {});
      if (!prepared.ok) return prepared;
      const postPreparationFailure = currentIntentFailure(request);
      if (postPreparationFailure) {
        const cancelled = await cancelPreparedJournal(storage, prepared.cursor, true);
        return {
          ok: false,
          reason:
            cancelled === "cancelled"
              ? postPreparationFailure
              : cancelled === "degraded"
                ? "reserve-degraded"
                : "commit-incomplete",
        };
      }
      return executeCleanupLifecycle(
        storage,
        prepared.cursor,
        commitAuthorization(request),
        () =>
          bestEffortRemovePreference(storage, authority.snapshot.index, null),
      );
    });
  } catch {
    return { ok: false, reason: "lock-failed" };
  }
}

function validateStoredTargetProject(
  raw: string,
  journal: WorkspaceOperationJournalV1,
): boolean {
  const mutation = journal.projectMutations[0];
  if (!mutation) return false;
  const record = parseWorkspaceProjectRecord(raw);
  if (
    !record.ok ||
    !workspaceProjectRecordMatchesKey(mutation.targetRecord.key, record.value) ||
    record.value.projectId !== mutation.projectId
  ) {
    return false;
  }
  return journal.kind === "delete-project"
    ? record.value.value.kind === "tombstone"
    : record.value.value.kind === "project";
}

async function reconstructDeleteTarget(
  rawSource: string,
  journal: WorkspaceOperationJournalV1,
): Promise<string | null> {
  const mutation = journal.projectMutations[0];
  if (!mutation) return null;
  const source = parseWorkspaceProjectRecord(rawSource);
  if (
    !source.ok ||
    !workspaceProjectRecordMatchesKey(mutation.targetRecord.key, source.value) ||
    source.value.projectId !== mutation.projectId ||
    source.value.value.kind !== "project" ||
    source.value.revision >= Number.MAX_SAFE_INTEGER
  ) {
    return null;
  }
  const tombstone = serializeWorkspaceProjectRecord({
    ...source.value,
    revision: source.value.revision + 1,
    value: { kind: "tombstone" },
  });
  if (!tombstone.ok) return null;
  const digest = await digestRaw(tombstone.serialized);
  return digest === mutation.targetRecord.targetDigest
    ? tombstone.serialized
    : null;
}

async function resumeProjectLifecycle(
  storage: WorkspaceStorageAdapter,
  cursor: JournalCursor,
): Promise<WorkspaceLifecycleResult> {
  const mutation = cursor.value.projectMutations[0];
  if (!mutation) return { ok: false, reason: "recovery-required" };
  const observed = await digestAtKey(storage, mutation.targetRecord.key);
  if (!observed.ok) return observed;

  if (
    cursor.value.kind === "replace-project" &&
    observed.digest === mutation.targetRecord.expectedBeforeDigest &&
    cursor.value.legacyResolution === undefined
  ) {
    const cancelled = await cancelPreparedJournal(
      storage,
      cursor,
      true,
    );
    if (cancelled !== "cancelled") {
      return {
        ok: false,
        reason: cancelled === "degraded" ? "reserve-degraded" : "commit-incomplete",
      };
    }
    const authority = await readWorkspaceAuthority(storage);
    return authority.ok
      ? {
          ok: true,
          snapshot: authority.snapshot,
          storageProtection: "healthy",
          preferenceCleaned: true,
          changed: false,
        }
      : { ok: false, reason: authorityFailureReason(authority.reason) };
  }

  let serializedTarget: string;
  if (observed.digest === mutation.targetRecord.targetDigest && observed.raw !== null) {
    if (!validateStoredTargetProject(observed.raw, cursor.value)) {
      return { ok: false, reason: "recovery-required" };
    }
    serializedTarget = observed.raw;
  } else if (
    cursor.value.kind === "replace-project" &&
    cursor.value.legacyResolution !== undefined &&
    observed.digest === mutation.targetRecord.expectedBeforeDigest
  ) {
    const reconstructed =
      await reconstructWorkspaceLegacyResolutionTargetRecord(
        storage,
        cursor.value,
      );
    if (!reconstructed.ok) {
      return { ok: false, reason: "recovery-required" };
    }
    serializedTarget = reconstructed.serialized;
  } else if (
    cursor.value.kind === "delete-project" &&
    observed.digest === mutation.targetRecord.expectedBeforeDigest &&
    observed.raw !== null
  ) {
    const reconstructed = await reconstructDeleteTarget(observed.raw, cursor.value);
    if (reconstructed === null) {
      return { ok: false, reason: "recovery-required" };
    }
    serializedTarget = reconstructed;
  } else {
    return { ok: false, reason: "recovery-required" };
  }

  let current = cursor;
  const recordsWriting = await ensureJournalPhase(
    storage,
    current,
    "records-writing",
  );
  if (!recordsWriting) return { ok: false, reason: "commit-incomplete" };
  current = recordsWriting;
  const written = await writeWorkspaceProjectTarget(
    storage,
    mutation.targetRecord.key,
    serializedTarget,
    {
      expectedBeforeDigest: mutation.targetRecord.expectedBeforeDigest,
      targetDigest: mutation.targetRecord.targetDigest,
    },
  );
  if (!written.ok) return { ok: false, reason: "commit-incomplete" };
  const recordsWritten = await ensureJournalPhase(
    storage,
    current,
    "records-written",
  );
  if (!recordsWritten) return { ok: false, reason: "commit-incomplete" };
  current = recordsWritten;

  if (
    cursor.value.kind === "delete-project" ||
    cursor.value.legacyResolution !== undefined
  ) {
    const index = await digestAtKey(storage, WORKSPACE_INDEX_KEY);
    if (!index.ok) return index;
    if (index.digest === current.value.baseIndex.expectedDigest) {
      const committed = await writeWorkspaceIndexTarget(
        storage,
        current.value.targetIndex.serializedValue,
        {
          expectedBeforeDigest: current.value.baseIndex.expectedDigest,
          targetDigest: current.value.targetIndex.targetDigest,
        },
      );
      if (!committed.ok) return { ok: false, reason: "commit-incomplete" };
    } else if (index.digest !== current.value.targetIndex.targetDigest) {
      return { ok: false, reason: "recovery-required" };
    }
  }
  const indexCommitted = await ensureJournalPhase(
    storage,
    current,
    "index-committed",
  );
  if (!indexCommitted) return { ok: false, reason: "commit-incomplete" };
  const targetIndex = parseWorkspaceIndex(indexCommitted.value.targetIndex.serializedValue);
  if (!targetIndex.ok) return { ok: false, reason: "recovery-required" };
  const preferenceCleaned =
    indexCommitted.value.kind === "delete-project"
      ? bestEffortRemovePreference(
          storage,
          targetIndex.value,
          mutation.projectId,
        )
      : true;
  return finishOperation(
    storage,
    indexCommitted,
    true,
    preferenceCleaned,
  );
}

async function resumeCleanupLifecycle(
  storage: WorkspaceStorageAdapter,
  cursor: JournalCursor,
): Promise<WorkspaceLifecycleResult> {
  let current = cursor;
  const index = await digestAtKey(storage, WORKSPACE_INDEX_KEY);
  if (!index.ok) return index;
  const recordsWriting = await ensureJournalPhase(
    storage,
    current,
    "records-writing",
  );
  if (!recordsWriting) return { ok: false, reason: "commit-incomplete" };
  const recordsWritten = await ensureJournalPhase(
    storage,
    recordsWriting,
    "records-written",
  );
  if (!recordsWritten) return { ok: false, reason: "commit-incomplete" };
  current = recordsWritten;
  if (index.digest === current.value.baseIndex.expectedDigest) {
    const written = await writeWorkspaceIndexTarget(
      storage,
      current.value.targetIndex.serializedValue,
      {
        expectedBeforeDigest: current.value.baseIndex.expectedDigest,
        targetDigest: current.value.targetIndex.targetDigest,
      },
    );
    if (!written.ok) return { ok: false, reason: "commit-incomplete" };
  } else if (index.digest !== current.value.targetIndex.targetDigest) {
    return { ok: false, reason: "recovery-required" };
  }
  const indexCommitted = await ensureJournalPhase(
    storage,
    current,
    "index-committed",
  );
  if (!indexCommitted) return { ok: false, reason: "commit-incomplete" };
  const cleanupPending = await ensureJournalPhase(
    storage,
    indexCommitted,
    "cleanup-pending",
  );
  if (!cleanupPending) return { ok: false, reason: "commit-incomplete" };
  current = cleanupPending;

  const cleanupByKey = new Map(
    current.value.cleanup.map((entry) => [entry.key, entry] as const),
  );
  const projects = current.value.cleanup
    .filter((entry) => parseWorkspaceProjectRecordKey(entry.key) !== null)
    .sort((left, right) => (left.key < right.key ? -1 : 1));
  if (!(await removeCleanupEntries(storage, projects))) {
    return { ok: false, reason: "commit-incomplete" };
  }
  const legacy = LEGACY_NAMES.flatMap((name) => {
    const entry = cleanupByKey.get(LEGACY_PROJECT_KEYS[name]);
    return entry ? [entry] : [];
  });
  if (!(await removeCleanupEntries(storage, legacy))) {
    return { ok: false, reason: "commit-incomplete" };
  }
  if (!cleanupCompletionIsExact(storage, current.value.kind as WorkspaceLifecycleKind)) {
    return { ok: false, reason: "commit-incomplete" };
  }
  const targetIndex = parseWorkspaceIndex(current.value.targetIndex.serializedValue);
  if (!targetIndex.ok) return { ok: false, reason: "recovery-required" };
  return finishOperation(
    storage,
    current,
    true,
    current.value.kind === "delete-workspace"
      ? bestEffortRemovePreference(storage, targetIndex.value, null)
      : true,
  );
}

/**
 * Completes only the four lifecycle operations owned by this module. It never
 * accepts replacement backup payload again: an unstarted replace is cancelled,
 * while a written target is accepted only at the exact journaled digest and
 * after strict envelope validation.
 */
export async function resumeWorkspaceLifecycleOperation(
  storage: WorkspaceStorageAdapter,
  locks: WorkspaceExclusiveLockRunner | null,
): Promise<WorkspaceLifecycleResult> {
  if (!locks) return { ok: false, reason: "lock-unavailable" };
  try {
    return await locks.runExclusive(WORKSPACE_LOCK_NAME, async () => {
      const rawJournal = readExact(storage, WORKSPACE_OPERATION_KEY);
      if (!rawJournal.ok) return { ok: false, reason: "storage-error" };
      if (rawJournal.value === null) {
        const authority = await readWorkspaceAuthority(storage);
        if (!authority.ok) {
          return { ok: false, reason: authorityFailureReason(authority.reason) };
        }
        const reserveHealthy = recreateWorkspaceReserve(
          storage,
          CANONICAL_WORKSPACE_RESERVE,
        ).ok;
        return {
          ok: true,
          snapshot: authority.snapshot,
          storageProtection: reserveHealthy ? "healthy" : "degraded",
          preferenceCleaned: true,
          changed: false,
        };
      }
      const parsed = parseWorkspaceJournal(rawJournal.value);
      if (!parsed.ok) return { ok: false, reason: "recovery-required" };
      if (!lifecycleKind(parsed.value.kind)) {
        return { ok: false, reason: "unsupported-operation" };
      }
      const recovery = await classifyWorkspaceRecovery(storage, rawJournal.value);
      if (recovery.status === "quarantine") {
        return { ok: false, reason: "recovery-required" };
      }
      const digest = await digestRaw(rawJournal.value);
      if (digest === null) return { ok: false, reason: "digest-unavailable" };
      const cursor: JournalCursor = {
        value: parsed.value,
        serialized: rawJournal.value,
        digest,
      };
      return parsed.value.kind === "replace-project" ||
        parsed.value.kind === "delete-project"
        ? resumeProjectLifecycle(storage, cursor)
        : resumeCleanupLifecycle(storage, cursor);
    });
  } catch {
    return { ok: false, reason: "lock-failed" };
  }
}
