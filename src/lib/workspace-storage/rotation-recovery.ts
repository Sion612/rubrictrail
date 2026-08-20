import {
  readWorkspaceAuthority,
  readWorkspacePreferenceBestEffort,
  workspaceIndexBaseline,
  type WorkspaceAuthorityReadFailureReason,
  type WorkspaceAuthoritySnapshot,
  type WorkspaceExclusiveLockRunner,
  type WorkspaceIndexBaseline,
} from "@/lib/workspace-storage/coordinator";
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
  parseWorkspaceIndex,
  parseWorkspaceJournal,
  parseWorkspaceProjectRecord,
  serializeWorkspaceIndex,
  serializeWorkspaceJournal,
  serializeWorkspaceProjectRecord,
  workspaceProjectRecordMatchesKey,
  WORKSPACE_PHYSICAL_RECORD_LIMIT,
  WORKSPACE_PROJECT_RECORD_LIMIT,
  WORKSPACE_RECORD_GROWTH_BLOCK,
  WORKSPACE_RECORD_WARNING,
  WORKSPACE_TOMBSTONE_WARNING,
} from "@/lib/workspace-storage/protocol";
import {
  classifyWorkspaceRecovery,
  prepareWorkspaceJournal,
} from "@/lib/workspace-storage/recovery";
import {
  CANONICAL_WORKSPACE_RESERVE,
  classifyWorkspaceReserve,
} from "@/lib/workspace-storage/reserve";
import {
  readExact,
  recreateWorkspaceReserve,
  removeWorkspaceCleanupSource,
  removeWorkspaceJournal,
  writeWorkspaceIndexTarget,
  writeWorkspaceJournalPhase,
  writeWorkspaceProjectTarget,
  type WorkspaceStorageAdapter,
} from "@/lib/workspace-storage/storage-adapter";
import type {
  WorkspaceJournalProjectMutationV1,
  WorkspaceLegacyFingerprints,
  WorkspaceOperationJournalV1,
  WorkspaceOperationPhase,
  WorkspaceProjectRecordV1,
} from "@/lib/workspace-storage/types";

export type WorkspaceRotationPolicyStatus =
  | "normal"
  | "compaction-recommended"
  | "storage-warning"
  | "growth-blocked"
  | "hard-limit"
  | "recovery-only";

export interface WorkspaceRotationPolicyReadModel {
  activeCount: number;
  tombstoneCount: number;
  totalRecordCount: number;
  physicalRecordCount: number;
  status: WorkspaceRotationPolicyStatus;
  compactionRecommended: boolean;
  storageWarning: boolean;
  growthBlocked: boolean;
  hardLimitReached: boolean;
  recoveryOnly: boolean;
  rotationWouldReduceLogicalRecords: boolean;
}

/**
 * Product policy only. These thresholds are not a browser quota estimate or
 * storage-capacity guarantee.
 */
export function workspaceRotationPolicyForCounts(
  activeCount: number,
  tombstoneCount: number,
  physicalRecordCount = activeCount + tombstoneCount,
): WorkspaceRotationPolicyReadModel {
  for (const count of [activeCount, tombstoneCount, physicalRecordCount]) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError("Workspace record counts must be non-negative safe integers");
    }
  }
  const totalRecordCount = activeCount + tombstoneCount;
  if (!Number.isSafeInteger(totalRecordCount)) {
    throw new TypeError("Workspace logical record count is unsafe");
  }
  const compactionRecommended = tombstoneCount >= WORKSPACE_TOMBSTONE_WARNING;
  const storageWarning = totalRecordCount >= WORKSPACE_RECORD_WARNING;
  const growthBlocked = totalRecordCount >= WORKSPACE_RECORD_GROWTH_BLOCK;
  const hardLimitReached = totalRecordCount >= WORKSPACE_PROJECT_RECORD_LIMIT;
  const recoveryOnly =
    totalRecordCount > WORKSPACE_PROJECT_RECORD_LIMIT ||
    physicalRecordCount > WORKSPACE_PROJECT_RECORD_LIMIT;
  const status: WorkspaceRotationPolicyStatus = recoveryOnly
    ? "recovery-only"
    : hardLimitReached
      ? "hard-limit"
      : growthBlocked
        ? "growth-blocked"
        : storageWarning
          ? "storage-warning"
          : compactionRecommended
            ? "compaction-recommended"
            : "normal";
  return {
    activeCount,
    tombstoneCount,
    totalRecordCount,
    physicalRecordCount,
    status,
    compactionRecommended,
    storageWarning,
    growthBlocked,
    hardLimitReached,
    recoveryOnly,
    rotationWouldReduceLogicalRecords: tombstoneCount > 0,
  };
}

interface StrictOwnedProjectRecord {
  key: string;
  raw: string;
  digest: string;
  record: WorkspaceProjectRecordV1;
  kind: "active" | "tombstone";
}

type StrictOwnedProjectScan =
  | { ok: true; records: readonly StrictOwnedProjectRecord[] }
  | { ok: false; reason: "invalid-owned-record" | "storage-error" | "digest-unavailable" };

async function digestRaw(raw: string): Promise<string | null> {
  const digest = await sha256StoredString(raw);
  return digest.ok ? digest.digest : null;
}

async function scanStrictOwnedProjectRecords(
  storage: WorkspaceStorageAdapter,
): Promise<StrictOwnedProjectScan> {
  let keys: string[];
  try {
    keys = storage.keys();
  } catch {
    return { ok: false, reason: "storage-error" };
  }
  const records: StrictOwnedProjectRecord[] = [];
  for (const key of keys) {
    const identity = parseWorkspaceProjectRecordKey(key);
    if (!identity) continue;
    const read = readExact(storage, key);
    if (!read.ok) return { ok: false, reason: "storage-error" };
    if (read.value === null) return { ok: false, reason: "invalid-owned-record" };
    const parsed = parseWorkspaceProjectRecord(read.value);
    if (
      !parsed.ok ||
      !workspaceProjectRecordMatchesKey(key, parsed.value) ||
      (parsed.value.value.kind === "project" &&
        parsed.value.value.state.projectKind === "none")
    ) {
      return { ok: false, reason: "invalid-owned-record" };
    }
    const digest = await digestRaw(read.value);
    if (digest === null) return { ok: false, reason: "digest-unavailable" };
    records.push({
      key,
      raw: read.value,
      digest,
      record: parsed.value,
      kind: parsed.value.value.kind === "project" ? "active" : "tombstone",
    });
  }
  records.sort((left, right) =>
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
  );
  return { ok: true, records };
}

function baselineMatches(
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

function callbackIsTrue(callback: () => boolean): boolean {
  try {
    return callback();
  } catch {
    return false;
  }
}

type WorkspaceGenerationIntentFailure = "pending-save" | "intent-stale";

function currentGenerationIntentFailure(
  request: Pick<
    WorkspaceRotateGenerationRequest,
    "pendingSavesDrained" | "intentStillCurrent"
  >,
): WorkspaceGenerationIntentFailure | null {
  if (!callbackIsTrue(request.pendingSavesDrained)) return "pending-save";
  return callbackIsTrue(request.intentStillCurrent) ? null : "intent-stale";
}

interface WorkspaceGenerationCommitAuthorization {
  check: () => boolean;
  rejectedReason: () => WorkspaceGenerationIntentFailure | null;
}

function generationCommitAuthorization(
  request: Pick<
    WorkspaceRotateGenerationRequest,
    "pendingSavesDrained" | "intentStillCurrent"
  >,
): WorkspaceGenerationCommitAuthorization {
  let rejection: WorkspaceGenerationIntentFailure | null = null;
  return {
    check: () => {
      const reason = currentGenerationIntentFailure(request);
      if (reason !== null) rejection ??= reason;
      return reason === null;
    },
    rejectedReason: () => rejection,
  };
}

export type WorkspaceRotationPreflightResult =
  | {
      ok: true;
      snapshot: WorkspaceAuthoritySnapshot;
      baseline: WorkspaceIndexBaseline;
      policy: WorkspaceRotationPolicyReadModel;
    }
  | {
      ok: false;
      reason:
        | "invalid-authority"
        | "workspace-conflict"
        | "recovery-required"
        | "legacy-conflict"
        | "invalid-owned-record"
        | "storage-error"
        | "digest-unavailable";
    };

function authorityPreflightFailure(
  reason: WorkspaceAuthorityReadFailureReason,
): Exclude<WorkspaceRotationPreflightResult, { ok: true }> {
  if (
    reason === "operation-recovery-required" ||
    reason === "invalid-operation-journal"
  ) {
    return { ok: false, reason: "recovery-required" };
  }
  if (reason === "legacy-conflict") {
    return { ok: false, reason: "legacy-conflict" };
  }
  if (reason === "concurrent-change") {
    return { ok: false, reason: "workspace-conflict" };
  }
  if (reason === "storage-error") return { ok: false, reason: "storage-error" };
  if (reason === "digest-unavailable") {
    return { ok: false, reason: "digest-unavailable" };
  }
  return { ok: false, reason: "invalid-authority" };
}

/** Display-only preflight. rotateWorkspaceGeneration repeats it under lock. */
export async function readWorkspaceRotationPreflight(
  storage: WorkspaceStorageAdapter,
): Promise<WorkspaceRotationPreflightResult> {
  const authority = await readWorkspaceAuthority(storage);
  if (!authority.ok) return authorityPreflightFailure(authority.reason);
  const owned = await scanStrictOwnedProjectRecords(storage);
  if (!owned.ok) return owned;
  const activeCount = authority.snapshot.index.projects.filter(
    (entry) => entry.kind === "active",
  ).length;
  const tombstoneCount = authority.snapshot.index.projects.length - activeCount;
  return {
    ok: true,
    snapshot: authority.snapshot,
    baseline: workspaceIndexBaseline(authority.snapshot),
    policy: workspaceRotationPolicyForCounts(
      activeCount,
      tombstoneCount,
      owned.records.length,
    ),
  };
}

export interface WorkspaceIndexRecoveryRecordSelection {
  key: string;
  raw: string;
  digest: string;
  projectId: string;
  revision: number;
  kind: "active" | "tombstone";
}

export interface WorkspaceIndexRecoverySelection {
  workspaceId: string;
  sourceGeneration: number;
  observedIndexRaw: string | null;
  observedIndexDigest: string | null;
  legacyExpectedDigests: WorkspaceLegacyFingerprints;
  records: readonly WorkspaceIndexRecoveryRecordSelection[];
}

export interface WorkspaceIndexRecoveryCandidate {
  workspaceId: string;
  sourceGeneration: number;
  activeCount: number;
  tombstoneCount: number;
  selection: WorkspaceIndexRecoverySelection;
}

export interface WorkspaceIndexRecoveryIncoherentGroup {
  workspaceId: string;
  sourceGeneration: number;
  recordCount: number;
}

export type WorkspaceIndexRecoveryInspectionResult =
  | {
      ok: true;
      authority: "none";
      requiresExplicitSelection: true;
      indexState: "missing" | "corrupt" | "incomplete";
      physicalRecordCount: number;
      recoveryOnly: boolean;
      candidates: readonly WorkspaceIndexRecoveryCandidate[];
      incoherentGroups: readonly WorkspaceIndexRecoveryIncoherentGroup[];
    }
  | {
      ok: false;
      reason:
        | "existing-authority"
        | "journal-present"
        | "invalid-journal"
        | "storage-error"
        | "digest-unavailable";
    };

async function readLegacyDigests(
  storage: WorkspaceStorageAdapter,
): Promise<
  | { ok: true; fingerprints: WorkspaceLegacyFingerprints }
  | { ok: false; reason: "storage-error" | "digest-unavailable" }
> {
  const fingerprints: WorkspaceLegacyFingerprints = {
    record: null,
    v3: null,
    v2: null,
    v1: null,
  };
  for (const name of ["record", "v3", "v2", "v1"] as const) {
    const read = readExact(storage, LEGACY_PROJECT_KEYS[name]);
    if (!read.ok) return { ok: false, reason: "storage-error" };
    const digest = await digestOptionalStoredString(read.value);
    if (!digest.ok) return { ok: false, reason: "digest-unavailable" };
    fingerprints[name] = digest.digest;
  }
  return { ok: true, fingerprints };
}

function indexHasStrictReferencedAuthority(
  rawIndex: string,
  records: readonly StrictOwnedProjectRecord[],
): boolean {
  const index = parseWorkspaceIndex(rawIndex);
  if (!index.ok) return false;
  return index.value.projects.every((entry) => {
    const key = workspaceProjectRecordKey(
      index.value.workspaceId,
      index.value.workspaceGeneration,
      entry.projectId,
    );
    const record = records.find((candidate) => candidate.key === key);
    return record !== undefined && record.kind === entry.kind;
  });
}

function compareRecoveryRecords(
  left: readonly WorkspaceIndexRecoveryRecordSelection[],
  right: readonly WorkspaceIndexRecoveryRecordSelection[],
): boolean {
  return (
    left.length === right.length &&
    left.every((record, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        record.key === other.key &&
        record.raw === other.raw &&
        record.digest === other.digest &&
        record.projectId === other.projectId &&
        record.revision === other.revision &&
        record.kind === other.kind
      );
    })
  );
}

function recoverySelectionMatches(
  left: WorkspaceIndexRecoverySelection,
  right: WorkspaceIndexRecoverySelection,
): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    left.sourceGeneration === right.sourceGeneration &&
    left.observedIndexRaw === right.observedIndexRaw &&
    left.observedIndexDigest === right.observedIndexDigest &&
    left.legacyExpectedDigests.record === right.legacyExpectedDigests.record &&
    left.legacyExpectedDigests.v3 === right.legacyExpectedDigests.v3 &&
    left.legacyExpectedDigests.v2 === right.legacyExpectedDigests.v2 &&
    left.legacyExpectedDigests.v1 === right.legacyExpectedDigests.v1 &&
    compareRecoveryRecords(left.records, right.records)
  );
}

/**
 * Discovers exact candidate groups but deliberately returns authority:none.
 * Even a single candidate must be passed back explicitly to recoverWorkspaceIndex.
 */
export async function inspectWorkspaceIndexRecovery(
  storage: WorkspaceStorageAdapter,
): Promise<WorkspaceIndexRecoveryInspectionResult> {
  const journal = readExact(storage, WORKSPACE_OPERATION_KEY);
  if (!journal.ok) return { ok: false, reason: "storage-error" };
  if (journal.value !== null) {
    return {
      ok: false,
      reason: parseWorkspaceJournal(journal.value).ok
        ? "journal-present"
        : "invalid-journal",
    };
  }
  const index = readExact(storage, WORKSPACE_INDEX_KEY);
  if (!index.ok) return { ok: false, reason: "storage-error" };
  const indexDigest = await digestOptionalStoredString(index.value);
  if (!indexDigest.ok) return { ok: false, reason: "digest-unavailable" };
  let keys: string[];
  try {
    keys = storage.keys();
  } catch {
    return { ok: false, reason: "storage-error" };
  }
  const groupedKeys = new Map<string, string[]>();
  const invalidGroups = new Set<string>();
  const strictRecords: StrictOwnedProjectRecord[] = [];
  for (const key of keys) {
    const identity = parseWorkspaceProjectRecordKey(key);
    if (!identity) continue;
    const group = `${identity.workspaceId}:${identity.workspaceGeneration}`;
    const values = groupedKeys.get(group) ?? [];
    values.push(key);
    groupedKeys.set(group, values);

    const read = readExact(storage, key);
    if (!read.ok) return { ok: false, reason: "storage-error" };
    if (read.value === null) {
      invalidGroups.add(group);
      continue;
    }
    const parsed = parseWorkspaceProjectRecord(read.value);
    if (
      !parsed.ok ||
      !workspaceProjectRecordMatchesKey(key, parsed.value) ||
      (parsed.value.value.kind === "project" &&
        parsed.value.value.state.projectKind === "none")
    ) {
      invalidGroups.add(group);
      continue;
    }
    const digest = await digestRaw(read.value);
    if (digest === null) return { ok: false, reason: "digest-unavailable" };
    strictRecords.push({
      key,
      raw: read.value,
      digest,
      record: parsed.value,
      kind: parsed.value.value.kind === "project" ? "active" : "tombstone",
    });
  }
  if (
    index.value !== null &&
    indexHasStrictReferencedAuthority(index.value, strictRecords)
  ) {
    return { ok: false, reason: "existing-authority" };
  }
  const legacy = await readLegacyDigests(storage);
  if (!legacy.ok) return legacy;

  const candidates: WorkspaceIndexRecoveryCandidate[] = [];
  const incoherentGroups: WorkspaceIndexRecoveryIncoherentGroup[] = [];
  for (const [group, groupKeys] of [...groupedKeys.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    const separator = group.lastIndexOf(":");
    const workspaceId = group.slice(0, separator);
    const sourceGeneration = Number(group.slice(separator + 1));
    const records = strictRecords
      .filter(
        (record) =>
          record.record.workspaceId === workspaceId &&
          record.record.workspaceGeneration === sourceGeneration,
      )
      .map<WorkspaceIndexRecoveryRecordSelection>((record) => ({
        key: record.key,
        raw: record.raw,
        digest: record.digest,
        projectId: record.record.projectId,
        revision: record.record.revision,
        kind: record.kind,
      }));
    records.sort((left, right) =>
      left.projectId < right.projectId ? -1 : left.projectId > right.projectId ? 1 : 0,
    );
    if (
      invalidGroups.has(group) ||
      records.length !== groupKeys.length ||
      records.length === 0 ||
      records.length > WORKSPACE_PROJECT_RECORD_LIMIT
    ) {
      incoherentGroups.push({
        workspaceId,
        sourceGeneration,
        recordCount: groupKeys.length,
      });
      continue;
    }
    const selection: WorkspaceIndexRecoverySelection = {
      workspaceId,
      sourceGeneration,
      observedIndexRaw: index.value,
      observedIndexDigest: indexDigest.digest,
      legacyExpectedDigests: { ...legacy.fingerprints },
      records,
    };
    candidates.push({
      workspaceId,
      sourceGeneration,
      activeCount: records.filter((record) => record.kind === "active").length,
      tombstoneCount: records.filter((record) => record.kind === "tombstone").length,
      selection,
    });
  }

  return {
    ok: true,
    authority: "none",
    requiresExplicitSelection: true,
    indexState:
      index.value === null
        ? "missing"
        : parseWorkspaceIndex(index.value).ok
          ? "incomplete"
          : "corrupt",
    physicalRecordCount: [...groupedKeys.values()].reduce(
      (total, groupKeys) => total + groupKeys.length,
      0,
    ),
    recoveryOnly:
      [...groupedKeys.values()].reduce(
        (total, groupKeys) => total + groupKeys.length,
        0,
      ) > WORKSPACE_PROJECT_RECORD_LIMIT || invalidGroups.size > 0,
    candidates,
    incoherentGroups,
  };
}

export type WorkspaceGenerationMutationFailureReason =
  | "lock-unavailable"
  | "lock-failed"
  | "workspace-conflict"
  | "recovery-required"
  | "invalid-authority"
  | "legacy-conflict"
  | "invalid-owned-record"
  | "physical-recovery-only"
  | "physical-hard-limit"
  | "no-compaction-benefit"
  | "workspace-not-active"
  | "generation-exhausted"
  | "revision-exhausted"
  | "target-generation-occupied"
  | "selection-stale"
  | "pending-save"
  | "intent-stale"
  | "id-unavailable"
  | "reserve-degraded"
  | "invalid-operation"
  | "digest-unavailable"
  | "storage-error"
  | "commit-incomplete"
  | "quarantine";

export type WorkspaceGenerationMutationResult =
  | {
      ok: true;
      status: "committed" | "committed-degraded";
      kind: "rotate-workspace-generation" | "recover-index";
      snapshot: WorkspaceAuthoritySnapshot;
    }
  | {
      ok: false;
      reason: WorkspaceGenerationMutationFailureReason;
      recoveryStatus?: Awaited<ReturnType<typeof classifyWorkspaceRecovery>>["status"];
    };

export interface WorkspaceRotateGenerationRequest {
  baseline: WorkspaceIndexBaseline;
  pendingSavesDrained: () => boolean;
  intentStillCurrent: () => boolean;
  uuidSource?: SecureUuidSource | null;
}

export interface WorkspaceRecoverIndexRequest {
  selection: WorkspaceIndexRecoverySelection;
  pendingSavesDrained: () => boolean;
  intentStillCurrent: () => boolean;
  uuidSource?: SecureUuidSource | null;
}

interface PreparedGenerationOperation {
  journal: WorkspaceOperationJournalV1;
  serializedJournal: string;
}

async function storedDigestAtKey(
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

interface GenerationCancellationRawSnapshot {
  entries: ReadonlyArray<{ key: string; raw: string | null }>;
}

async function captureGenerationCancellationSnapshot(
  storage: WorkspaceStorageAdapter,
  prepared: PreparedGenerationOperation,
): Promise<GenerationCancellationRawSnapshot | null> {
  const captured = new Map<string, string | null>();
  const capture = (key: string, raw: string | null): boolean => {
    const previous = captured.get(key);
    if (captured.has(key) && previous !== raw) return false;
    captured.set(key, raw);
    return true;
  };
  const durableJournal = readExact(storage, WORKSPACE_OPERATION_KEY);
  if (
    !durableJournal.ok ||
    durableJournal.value !== prepared.serializedJournal
  ) {
    return null;
  }
  capture(WORKSPACE_OPERATION_KEY, durableJournal.value);
  const index = await storedDigestAtKey(storage, WORKSPACE_INDEX_KEY);
  if (!index.ok || index.digest !== prepared.journal.baseIndex.expectedDigest) {
    return null;
  }
  capture(WORKSPACE_INDEX_KEY, index.raw);
  for (const mutation of prepared.journal.projectMutations) {
    if (
      !mutation.sourceRecord ||
      mutation.targetRecord.expectedBeforeDigest !== null
    ) {
      return null;
    }
    const source = await storedDigestAtKey(storage, mutation.sourceRecord.key);
    if (!source.ok || source.digest !== mutation.sourceRecord.expectedDigest) {
      return null;
    }
    if (!capture(mutation.sourceRecord.key, source.raw)) return null;
    const target = await storedDigestAtKey(storage, mutation.targetRecord.key);
    if (
      !target.ok ||
      (target.digest !== mutation.targetRecord.expectedBeforeDigest &&
        target.digest !== mutation.targetRecord.targetDigest)
    ) {
      return null;
    }
    if (!capture(mutation.targetRecord.key, target.raw)) return null;
  }
  for (const cleanup of prepared.journal.cleanup) {
    const observed = await storedDigestAtKey(storage, cleanup.key);
    if (!observed.ok || observed.digest !== cleanup.expectedDigest) return null;
    if (!capture(cleanup.key, observed.raw)) return null;
  }
  for (const name of ["record", "v3", "v2", "v1"] as const) {
    const observed = await storedDigestAtKey(storage, LEGACY_PROJECT_KEYS[name]);
    if (
      !observed.ok ||
      observed.digest !== prepared.journal.legacyExpectedDigests[name]
    ) {
      return null;
    }
    if (!capture(LEGACY_PROJECT_KEYS[name], observed.raw)) return null;
  }
  return {
    entries: [...captured.entries()]
      .map(([key, raw]) => ({ key, raw }))
      .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)),
  };
}

function generationCancellationSnapshotStillExact(
  storage: WorkspaceStorageAdapter,
  snapshot: GenerationCancellationRawSnapshot,
): boolean {
  try {
    return snapshot.entries.every(
      (entry) => storage.getItem(entry.key) === entry.raw,
    );
  } catch {
    return false;
  }
}

async function cancelPreparedGenerationOperation(
  storage: WorkspaceStorageAdapter,
  prepared: PreparedGenerationOperation,
): Promise<"cancelled" | "degraded" | "incomplete"> {
  const snapshot = await captureGenerationCancellationSnapshot(storage, prepared);
  if (snapshot === null) return "incomplete";
  const journalDigest = await digestRaw(prepared.serializedJournal);
  if (journalDigest === null) return "incomplete";
  // Remove publication authority first. Any exact target left by a crash after
  // this point is an unindexed orphan and cannot publish the stale intent.
  const removedJournal = await removeWorkspaceJournal(storage, {
    expectedBeforeDigest: journalDigest,
    commitStillAuthorized: () =>
      generationCancellationSnapshotStillExact(storage, snapshot),
  });
  if (!removedJournal.ok) return "incomplete";

  let targetCleanupExact = true;
  for (const mutation of prepared.journal.projectMutations) {
    const removed = await removeWorkspaceCleanupSource(
      storage,
      mutation.targetRecord.key,
      { expectedBeforeDigest: mutation.targetRecord.targetDigest },
    );
    if (!removed.ok) targetCleanupExact = false;
  }
  const reserve = recreateWorkspaceReserve(storage, CANONICAL_WORKSPACE_RESERVE);
  if (!targetCleanupExact) return "incomplete";
  return reserve.ok ? "cancelled" : "degraded";
}

async function cancelUnauthorizedGenerationCommit(
  storage: WorkspaceStorageAdapter,
  prepared: PreparedGenerationOperation,
  authorization: WorkspaceGenerationCommitAuthorization,
): Promise<WorkspaceGenerationMutationResult> {
  const reason = authorization.rejectedReason();
  if (reason === null) return { ok: false, reason: "commit-incomplete" };
  const cancelled = await cancelPreparedGenerationOperation(storage, prepared);
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

function preparationFailure(
  reason: Exclude<
    Awaited<ReturnType<typeof prepareWorkspaceJournal>>,
    { ok: true }
  >["reason"],
): WorkspaceGenerationMutationFailureReason {
  if (reason === "invalid-reserve") return "reserve-degraded";
  if (reason === "baseline-conflict") return "workspace-conflict";
  if (reason === "third-value-journal") return "recovery-required";
  if (reason === "storage-error" || reason === "readback-mismatch") {
    return "storage-error";
  }
  return "invalid-operation";
}

const PHASE_ORDER: readonly WorkspaceOperationPhase[] = [
  "prepared",
  "records-writing",
  "records-written",
  "index-committed",
  "cleanup-pending",
];

async function advanceJournalPhase(
  storage: WorkspaceStorageAdapter,
  prepared: PreparedGenerationOperation,
  phase: WorkspaceOperationPhase,
): Promise<PreparedGenerationOperation | null> {
  if (
    PHASE_ORDER.indexOf(prepared.journal.phase) >= PHASE_ORDER.indexOf(phase)
  ) {
    return prepared;
  }
  const next = serializeWorkspaceJournal({ ...prepared.journal, phase });
  if (!next.ok) return null;
  const beforeDigest = await digestRaw(prepared.serializedJournal);
  const targetDigest = await digestRaw(next.serialized);
  if (beforeDigest === null || targetDigest === null) return null;
  const written = await writeWorkspaceJournalPhase(storage, next.serialized, {
    expectedBeforeDigest: beforeDigest,
    targetDigest,
  });
  return written.ok
    ? { journal: next.value, serializedJournal: next.serialized }
    : null;
}

async function exactTargetRecordForMutation(
  storage: WorkspaceStorageAdapter,
  mutation: WorkspaceJournalProjectMutationV1,
  journal: WorkspaceOperationJournalV1,
): Promise<string | null> {
  if (!mutation.sourceRecord) return null;
  const source = readExact(storage, mutation.sourceRecord.key);
  if (!source.ok) return null;
  if (source.value === null) {
    const target = readExact(storage, mutation.targetRecord.key);
    if (!target.ok || target.value === null) return null;
    const digest = await digestRaw(target.value);
    const parsed = parseWorkspaceProjectRecord(target.value);
    return digest === mutation.targetRecord.targetDigest &&
      parsed.ok &&
      workspaceProjectRecordMatchesKey(mutation.targetRecord.key, parsed.value) &&
      parsed.value.projectId === mutation.projectId &&
      parsed.value.workspaceGeneration === journal.targetGeneration &&
      parsed.value.value.kind === "project" &&
      parsed.value.value.state.projectKind !== "none"
      ? target.value
      : null;
  }
  const sourceDigest = await digestRaw(source.value);
  const parsedSource = parseWorkspaceProjectRecord(source.value);
  if (
    sourceDigest !== mutation.sourceRecord.expectedDigest ||
    !parsedSource.ok ||
    !workspaceProjectRecordMatchesKey(mutation.sourceRecord.key, parsedSource.value) ||
    parsedSource.value.projectId !== mutation.projectId ||
    parsedSource.value.value.kind !== "project" ||
    parsedSource.value.value.state.projectKind === "none" ||
    parsedSource.value.revision >= Number.MAX_SAFE_INTEGER
  ) {
    return null;
  }
  const target = serializeWorkspaceProjectRecord({
    formatVersion: 1,
    workspaceId: journal.workspaceId,
    workspaceGeneration: journal.targetGeneration,
    projectId: mutation.projectId,
    revision: parsedSource.value.revision + 1,
    value: { kind: "project", state: parsedSource.value.value.state },
  });
  if (!target.ok) return null;
  const targetDigest = await digestRaw(target.serialized);
  return targetDigest === mutation.targetRecord.targetDigest
    ? target.serialized
    : null;
}

async function classifyExecutionFailure(
  storage: WorkspaceStorageAdapter,
  expectedJournal: WorkspaceOperationJournalV1,
): Promise<WorkspaceGenerationMutationResult> {
  const currentJournal = readExact(storage, WORKSPACE_OPERATION_KEY);
  if (!currentJournal.ok || currentJournal.value === null) {
    return { ok: false, reason: "commit-incomplete" };
  }
  const parsed = parseWorkspaceJournal(currentJournal.value);
  if (
    !parsed.ok ||
    parsed.value.operationId !== expectedJournal.operationId ||
    parsed.value.kind !== expectedJournal.kind ||
    parsed.value.workspaceId !== expectedJournal.workspaceId ||
    parsed.value.sourceGeneration !== expectedJournal.sourceGeneration ||
    parsed.value.targetGeneration !== expectedJournal.targetGeneration
  ) {
    return { ok: false, reason: "quarantine" };
  }
  const recovery = await classifyWorkspaceRecovery(
    storage,
    currentJournal.value,
  );
  return recovery.status === "quarantine"
    ? {
        ok: false,
        reason: "quarantine",
        recoveryStatus: recovery.status,
      }
    : {
        ok: false,
        reason: "commit-incomplete",
        recoveryStatus: recovery.status,
      };
}

async function executePreparedGenerationOperation(
  storage: WorkspaceStorageAdapter,
  rawJournal: string,
  authorization?: WorkspaceGenerationCommitAuthorization,
): Promise<WorkspaceGenerationMutationResult> {
  const parsed = parseWorkspaceJournal(rawJournal);
  if (!parsed.ok) {
    return { ok: false, reason: "quarantine" };
  }
  if (
    parsed.value.kind !== "rotate-workspace-generation" &&
    parsed.value.kind !== "recover-index"
  ) {
    return { ok: false, reason: "invalid-operation" };
  }
  const operationKind = parsed.value.kind;
  const initialPlan = await classifyWorkspaceRecovery(storage, rawJournal);
  if (initialPlan.status === "quarantine") {
    return {
      ok: false,
      reason: "quarantine",
      recoveryStatus: initialPlan.status,
    };
  }

  let prepared: PreparedGenerationOperation = {
    journal: parsed.value,
    serializedJournal: rawJournal,
  };
  let irreversibleSourceRemovalStarted = false;
  const writing = await advanceJournalPhase(storage, prepared, "records-writing");
  if (!writing) return classifyExecutionFailure(storage, prepared.journal);
  prepared = writing;

  for (const mutation of prepared.journal.projectMutations) {
    const targetRaw = await exactTargetRecordForMutation(
      storage,
      mutation,
      prepared.journal,
    );
    if (targetRaw === null || !mutation.sourceRecord) {
      return classifyExecutionFailure(storage, prepared.journal);
    }
    const targetWritten = await writeWorkspaceProjectTarget(
      storage,
      mutation.targetRecord.key,
      targetRaw,
      {
        expectedBeforeDigest: mutation.targetRecord.expectedBeforeDigest,
        targetDigest: mutation.targetRecord.targetDigest,
      },
    );
    if (!targetWritten.ok) {
      return classifyExecutionFailure(storage, prepared.journal);
    }
    const sourceRemoved = await removeWorkspaceCleanupSource(
      storage,
      mutation.sourceRecord.key,
      {
        expectedBeforeDigest: mutation.sourceRecord.expectedDigest,
        commitStillAuthorized:
          authorization && !irreversibleSourceRemovalStarted
            ? authorization.check
            : undefined,
      },
    );
    if (!sourceRemoved.ok) {
      if (
        sourceRemoved.reason === "commit-cancelled" &&
        authorization &&
        !irreversibleSourceRemovalStarted
      ) {
        return cancelUnauthorizedGenerationCommit(
          storage,
          prepared,
          authorization,
        );
      }
      return classifyExecutionFailure(storage, prepared.journal);
    }
    irreversibleSourceRemovalStarted = true;
  }

  for (const cleanup of prepared.journal.cleanup) {
    const removed = await removeWorkspaceCleanupSource(
      storage,
      cleanup.key,
      {
        expectedBeforeDigest: cleanup.expectedDigest,
        commitStillAuthorized:
          authorization && !irreversibleSourceRemovalStarted
            ? authorization.check
            : undefined,
      },
    );
    if (!removed.ok) {
      if (
        removed.reason === "commit-cancelled" &&
        authorization &&
        !irreversibleSourceRemovalStarted
      ) {
        return cancelUnauthorizedGenerationCommit(
          storage,
          prepared,
          authorization,
        );
      }
      return classifyExecutionFailure(storage, prepared.journal);
    }
    irreversibleSourceRemovalStarted = true;
  }
  const recordsWritten = await advanceJournalPhase(
    storage,
    prepared,
    "records-written",
  );
  if (!recordsWritten) return classifyExecutionFailure(storage, prepared.journal);
  prepared = recordsWritten;

  const indexWritten = await writeWorkspaceIndexTarget(
    storage,
    prepared.journal.targetIndex.serializedValue,
    {
      expectedBeforeDigest: prepared.journal.baseIndex.expectedDigest,
      targetDigest: prepared.journal.targetIndex.targetDigest,
    },
  );
  if (!indexWritten.ok) return classifyExecutionFailure(storage, prepared.journal);
  const indexCommitted = await advanceJournalPhase(
    storage,
    prepared,
    "index-committed",
  );
  if (!indexCommitted) return classifyExecutionFailure(storage, prepared.journal);
  prepared = indexCommitted;

  // A resumed operation may reach target authority with exact old records still
  // present. Re-run every guarded cleanup idempotently before journal removal.
  for (const mutation of prepared.journal.projectMutations) {
    if (!mutation.sourceRecord) return { ok: false, reason: "quarantine" };
    const removed = await removeWorkspaceCleanupSource(
      storage,
      mutation.sourceRecord.key,
      { expectedBeforeDigest: mutation.sourceRecord.expectedDigest },
    );
    if (!removed.ok) return classifyExecutionFailure(storage, prepared.journal);
  }
  for (const cleanup of prepared.journal.cleanup) {
    const removed = await removeWorkspaceCleanupSource(storage, cleanup.key, {
      expectedBeforeDigest: cleanup.expectedDigest,
    });
    if (!removed.ok) return classifyExecutionFailure(storage, prepared.journal);
  }
  const cleanupPending = await advanceJournalPhase(
    storage,
    prepared,
    "cleanup-pending",
  );
  if (!cleanupPending) return classifyExecutionFailure(storage, prepared.journal);
  prepared = cleanupPending;

  const finalPlan = await classifyWorkspaceRecovery(
    storage,
    prepared.serializedJournal,
  );
  if (finalPlan.status === "quarantine") {
    return {
      ok: false,
      reason: "quarantine",
      recoveryStatus: finalPlan.status,
    };
  }
  if (finalPlan.status !== "complete") {
    return {
      ok: false,
      reason: "commit-incomplete",
      recoveryStatus: finalPlan.status,
    };
  }

  const targetIndex = parseWorkspaceIndex(
    prepared.journal.targetIndex.serializedValue,
  );
  if (!targetIndex.ok) return { ok: false, reason: "quarantine" };
  readWorkspacePreferenceBestEffort(storage, targetIndex.value);

  const journalDigest = await digestRaw(prepared.serializedJournal);
  if (journalDigest === null) return { ok: false, reason: "digest-unavailable" };
  const removedJournal = await removeWorkspaceJournal(storage, {
    expectedBeforeDigest: journalDigest,
  });
  if (!removedJournal.ok) return classifyExecutionFailure(storage, prepared.journal);

  const reserve = recreateWorkspaceReserve(storage, CANONICAL_WORKSPACE_RESERVE);
  const authority = await readWorkspaceAuthority(storage);
  if (!authority.ok) return { ok: false, reason: "commit-incomplete" };
  return {
    ok: true,
    status: reserve.ok ? "committed" : "committed-degraded",
    kind: operationKind,
    snapshot: authority.snapshot,
  };
}

async function targetRecordsForAuthority(
  snapshot: WorkspaceAuthoritySnapshot,
  targetGeneration: number,
): Promise<
  | {
      ok: true;
      mutations: WorkspaceJournalProjectMutationV1[];
      cleanup: WorkspaceOperationJournalV1["cleanup"];
      targetRecords: Readonly<Record<string, string>>;
    }
  | { ok: false; reason: "revision-exhausted" | "invalid-authority" | "digest-unavailable" }
> {
  const mutations: WorkspaceJournalProjectMutationV1[] = [];
  const cleanup: WorkspaceOperationJournalV1["cleanup"] = [];
  const targetRecords: Record<string, string> = {};
  for (const project of snapshot.projects) {
    if (project.record.value.kind === "tombstone") {
      cleanup.push({ key: project.key, expectedDigest: project.digest });
      continue;
    }
    if (
      project.record.value.state.projectKind === "none" ||
      project.record.revision >= Number.MAX_SAFE_INTEGER
    ) {
      return {
        ok: false,
        reason:
          project.record.revision >= Number.MAX_SAFE_INTEGER
            ? "revision-exhausted"
            : "invalid-authority",
      };
    }
    const targetKey = workspaceProjectRecordKey(
      snapshot.index.workspaceId,
      targetGeneration,
      project.record.projectId,
    );
    const target = serializeWorkspaceProjectRecord({
      ...project.record,
      workspaceGeneration: targetGeneration,
      revision: project.record.revision + 1,
    });
    if (!target.ok) return { ok: false, reason: "invalid-authority" };
    const targetDigest = await digestRaw(target.serialized);
    if (targetDigest === null) {
      return { ok: false, reason: "digest-unavailable" };
    }
    mutations.push({
      mode: "rewrite-generation",
      projectId: project.record.projectId,
      sourceRecord: { key: project.key, expectedDigest: project.digest },
      targetRecord: {
        key: targetKey,
        expectedBeforeDigest: null,
        targetDigest,
      },
      sourceCleanup: { key: project.key, expectedDigest: project.digest },
    });
    targetRecords[targetKey] = target.serialized;
  }
  mutations.sort((left, right) =>
    left.projectId < right.projectId ? -1 : left.projectId > right.projectId ? 1 : 0,
  );
  cleanup.sort((left, right) =>
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
  );
  return { ok: true, mutations, cleanup, targetRecords };
}

async function prepareRotationJournal(
  storage: WorkspaceStorageAdapter,
  snapshot: WorkspaceAuthoritySnapshot,
  uuidSource?: SecureUuidSource | null,
): Promise<
  | { ok: true; prepared: PreparedGenerationOperation }
  | { ok: false; reason: WorkspaceGenerationMutationFailureReason }
> {
  if (
    snapshot.index.workspaceGeneration >= Number.MAX_SAFE_INTEGER ||
    snapshot.index.revision >= Number.MAX_SAFE_INTEGER
  ) {
    return {
      ok: false,
      reason:
        snapshot.index.workspaceGeneration >= Number.MAX_SAFE_INTEGER
          ? "generation-exhausted"
          : "revision-exhausted",
    };
  }
  const targetGeneration = snapshot.index.workspaceGeneration + 1;
  const targets = await targetRecordsForAuthority(snapshot, targetGeneration);
  if (!targets.ok) return targets;
  const targetIndex = serializeWorkspaceIndex({
    ...snapshot.index,
    workspaceGeneration: targetGeneration,
    revision: snapshot.index.revision + 1,
    projects: snapshot.index.projects.filter((entry) => entry.kind === "active"),
  });
  if (!targetIndex.ok) return { ok: false, reason: "invalid-operation" };
  const targetIndexDigest = await digestRaw(targetIndex.serialized);
  if (targetIndexDigest === null) {
    return { ok: false, reason: "digest-unavailable" };
  }
  const operationId = generateSecureWorkspaceUuid(uuidSource);
  if (operationId === null) return { ok: false, reason: "id-unavailable" };
  const journal: WorkspaceOperationJournalV1 = {
    formatVersion: 1,
    operationId,
    kind: "rotate-workspace-generation",
    workspaceId: snapshot.index.workspaceId,
    sourceGeneration: snapshot.index.workspaceGeneration,
    targetGeneration,
    phase: "prepared",
    baseIndex: { key: WORKSPACE_INDEX_KEY, expectedDigest: snapshot.indexDigest },
    targetIndex: {
      key: WORKSPACE_INDEX_KEY,
      serializedValue: targetIndex.serialized,
      targetDigest: targetIndexDigest,
    },
    legacyExpectedDigests: { ...snapshot.index.legacyFingerprints },
    projectMutations: targets.mutations,
    cleanup: targets.cleanup,
  };
  const prepared = await prepareWorkspaceJournal(storage, journal, {
    releaseReserve: true,
    targetRecords: targets.targetRecords,
  });
  return prepared.ok
    ? {
        ok: true,
        prepared: { journal, serializedJournal: prepared.serializedJournal },
      }
    : { ok: false, reason: preparationFailure(prepared.reason) };
}

export async function rotateWorkspaceGeneration(
  storage: WorkspaceStorageAdapter,
  locks: WorkspaceExclusiveLockRunner | null,
  request: WorkspaceRotateGenerationRequest,
): Promise<WorkspaceGenerationMutationResult> {
  if (!locks) return { ok: false, reason: "lock-unavailable" };
  try {
    return await locks.runExclusive(WORKSPACE_LOCK_NAME, async () => {
      const preflight = await readWorkspaceRotationPreflight(storage);
      if (!preflight.ok) return preflight;
      if (!baselineMatches(preflight.snapshot, request.baseline)) {
        return { ok: false, reason: "workspace-conflict" };
      }
      if (preflight.snapshot.index.status !== "active") {
        return { ok: false, reason: "workspace-not-active" };
      }
      if (preflight.policy.recoveryOnly) {
        return { ok: false, reason: "physical-recovery-only" };
      }
      if (!preflight.policy.rotationWouldReduceLogicalRecords) {
        return { ok: false, reason: "no-compaction-benefit" };
      }
      const targetGeneration = preflight.snapshot.index.workspaceGeneration + 1;
      const owned = await scanStrictOwnedProjectRecords(storage);
      if (!owned.ok) return owned;
      if (
        owned.records.some(
          (record) =>
            record.record.workspaceId === preflight.snapshot.index.workspaceId &&
            record.record.workspaceGeneration === targetGeneration,
        )
      ) {
        return { ok: false, reason: "target-generation-occupied" };
      }
      const initialIntentFailure = currentGenerationIntentFailure(request);
      if (initialIntentFailure) return { ok: false, reason: initialIntentFailure };
      const prepared = await prepareRotationJournal(
        storage,
        preflight.snapshot,
        request.uuidSource,
      );
      if (!prepared.ok) return prepared;
      const authorization = generationCommitAuthorization(request);
      if (!authorization.check()) {
        return cancelUnauthorizedGenerationCommit(
          storage,
          prepared.prepared,
          authorization,
        );
      }
      return executePreparedGenerationOperation(
        storage,
        prepared.prepared.serializedJournal,
        authorization,
      );
    });
  } catch {
    return { ok: false, reason: "lock-failed" };
  }
}

async function targetRecordsForRecoverySelection(
  selection: WorkspaceIndexRecoverySelection,
  targetGeneration: number,
): Promise<
  | {
      ok: true;
      mutations: WorkspaceJournalProjectMutationV1[];
      cleanup: WorkspaceOperationJournalV1["cleanup"];
      targetRecords: Readonly<Record<string, string>>;
    }
  | { ok: false; reason: "revision-exhausted" | "selection-stale" | "digest-unavailable" }
> {
  const mutations: WorkspaceJournalProjectMutationV1[] = [];
  const cleanup: WorkspaceOperationJournalV1["cleanup"] = [];
  const targetRecords: Record<string, string> = {};
  for (const selected of selection.records) {
    const parsed = parseWorkspaceProjectRecord(selected.raw);
    if (
      !parsed.ok ||
      !workspaceProjectRecordMatchesKey(selected.key, parsed.value) ||
      parsed.value.projectId !== selected.projectId ||
      parsed.value.revision !== selected.revision ||
      (parsed.value.value.kind === "project" ? "active" : "tombstone") !==
        selected.kind
    ) {
      return { ok: false, reason: "selection-stale" };
    }
    if (selected.kind === "tombstone") {
      cleanup.push({ key: selected.key, expectedDigest: selected.digest });
      continue;
    }
    if (
      parsed.value.value.kind !== "project" ||
      parsed.value.value.state.projectKind === "none"
    ) {
      return { ok: false, reason: "selection-stale" };
    }
    if (parsed.value.revision >= Number.MAX_SAFE_INTEGER) {
      return { ok: false, reason: "revision-exhausted" };
    }
    const targetKey = workspaceProjectRecordKey(
      selection.workspaceId,
      targetGeneration,
      selected.projectId,
    );
    const target = serializeWorkspaceProjectRecord({
      ...parsed.value,
      workspaceGeneration: targetGeneration,
      revision: parsed.value.revision + 1,
    });
    if (!target.ok) return { ok: false, reason: "selection-stale" };
    const targetDigest = await digestRaw(target.serialized);
    if (targetDigest === null) {
      return { ok: false, reason: "digest-unavailable" };
    }
    mutations.push({
      mode: "rewrite-generation",
      projectId: selected.projectId,
      sourceRecord: { key: selected.key, expectedDigest: selected.digest },
      targetRecord: {
        key: targetKey,
        expectedBeforeDigest: null,
        targetDigest,
      },
      sourceCleanup: { key: selected.key, expectedDigest: selected.digest },
    });
    targetRecords[targetKey] = target.serialized;
  }
  mutations.sort((left, right) =>
    left.projectId < right.projectId ? -1 : left.projectId > right.projectId ? 1 : 0,
  );
  cleanup.sort((left, right) =>
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
  );
  return { ok: true, mutations, cleanup, targetRecords };
}

export async function recoverWorkspaceIndex(
  storage: WorkspaceStorageAdapter,
  locks: WorkspaceExclusiveLockRunner | null,
  request: WorkspaceRecoverIndexRequest,
): Promise<WorkspaceGenerationMutationResult> {
  if (!locks) return { ok: false, reason: "lock-unavailable" };
  try {
    return await locks.runExclusive(WORKSPACE_LOCK_NAME, async () => {
      const inspection = await inspectWorkspaceIndexRecovery(storage);
      if (!inspection.ok) {
        return {
          ok: false,
          reason:
            inspection.reason === "journal-present" ||
            inspection.reason === "invalid-journal"
              ? "recovery-required"
              : inspection.reason === "existing-authority"
                ? "selection-stale"
                : inspection.reason,
        };
      }
      if (inspection.physicalRecordCount > WORKSPACE_PHYSICAL_RECORD_LIMIT) {
        return { ok: false, reason: "physical-hard-limit" };
      }
      const current = inspection.candidates.find(
        (candidate) =>
          candidate.workspaceId === request.selection.workspaceId &&
          candidate.sourceGeneration === request.selection.sourceGeneration,
      );
      if (!current || !recoverySelectionMatches(current.selection, request.selection)) {
        return { ok: false, reason: "selection-stale" };
      }
      if (request.selection.sourceGeneration >= Number.MAX_SAFE_INTEGER) {
        return { ok: false, reason: "generation-exhausted" };
      }
      const targetGeneration = request.selection.sourceGeneration + 1;
      const occupiedTarget = [...inspection.candidates, ...inspection.incoherentGroups].some(
        (group) =>
          group.workspaceId === request.selection.workspaceId &&
          group.sourceGeneration === targetGeneration,
      );
      if (occupiedTarget) {
        return { ok: false, reason: "target-generation-occupied" };
      }
      const initialIntentFailure = currentGenerationIntentFailure(request);
      if (initialIntentFailure) return { ok: false, reason: initialIntentFailure };
      const targets = await targetRecordsForRecoverySelection(
        request.selection,
        targetGeneration,
      );
      if (!targets.ok) return targets;
      const targetIndex = serializeWorkspaceIndex({
        formatVersion: 1,
        workspaceId: request.selection.workspaceId,
        workspaceGeneration: targetGeneration,
        revision: 1,
        status: "active",
        projects: request.selection.records
          .filter((record) => record.kind === "active")
          .map((record) => ({ projectId: record.projectId, kind: "active" as const })),
        legacyFingerprints: { ...request.selection.legacyExpectedDigests },
      });
      if (!targetIndex.ok) return { ok: false, reason: "invalid-operation" };
      const targetIndexDigest = await digestRaw(targetIndex.serialized);
      if (targetIndexDigest === null) {
        return { ok: false, reason: "digest-unavailable" };
      }
      const operationId = generateSecureWorkspaceUuid(request.uuidSource);
      if (operationId === null) return { ok: false, reason: "id-unavailable" };
      const journal: WorkspaceOperationJournalV1 = {
        formatVersion: 1,
        operationId,
        kind: "recover-index",
        workspaceId: request.selection.workspaceId,
        sourceGeneration: request.selection.sourceGeneration,
        targetGeneration,
        phase: "prepared",
        baseIndex: {
          key: WORKSPACE_INDEX_KEY,
          expectedDigest: request.selection.observedIndexDigest,
        },
        targetIndex: {
          key: WORKSPACE_INDEX_KEY,
          serializedValue: targetIndex.serialized,
          targetDigest: targetIndexDigest,
        },
        legacyExpectedDigests: { ...request.selection.legacyExpectedDigests },
        projectMutations: targets.mutations,
        cleanup: targets.cleanup,
      };
      const prepared = await prepareWorkspaceJournal(storage, journal, {
        releaseReserve: true,
        targetRecords: targets.targetRecords,
      });
      if (!prepared.ok) {
        const reason = preparationFailure(prepared.reason);
        return {
          ok: false,
          reason: reason === "workspace-conflict" ? "selection-stale" : reason,
        };
      }
      const authorization = generationCommitAuthorization(request);
      if (!authorization.check()) {
        return cancelUnauthorizedGenerationCommit(
          storage,
          { journal, serializedJournal: prepared.serializedJournal },
          authorization,
        );
      }
      return executePreparedGenerationOperation(
        storage,
        prepared.serializedJournal,
        authorization,
      );
    });
  } catch {
    return { ok: false, reason: "lock-failed" };
  }
}

export type WorkspaceGenerationRecoveryResult =
  | WorkspaceGenerationMutationResult
  | {
      ok: true;
      status: "no-operation" | "reserve-recreated";
      snapshot: WorkspaceAuthoritySnapshot;
    }
  | {
      ok: true;
      status: "no-operation-no-authority" | "reserve-recreated-no-authority";
      authority: "none";
    };

/** Resumes only a strict recover-index/rotation journal; never another kind. */
export async function resumeWorkspaceGenerationOperation(
  storage: WorkspaceStorageAdapter,
  locks: WorkspaceExclusiveLockRunner | null,
): Promise<WorkspaceGenerationRecoveryResult> {
  if (!locks) return { ok: false, reason: "lock-unavailable" };
  try {
    return await locks.runExclusive(WORKSPACE_LOCK_NAME, async () => {
      const journal = readExact(storage, WORKSPACE_OPERATION_KEY);
      if (!journal.ok) return { ok: false, reason: "storage-error" };
      if (journal.value !== null) {
        return executePreparedGenerationOperation(storage, journal.value);
      }
      const authority = await readWorkspaceAuthority(storage);
      if (!authority.ok) {
        const inspection = await inspectWorkspaceIndexRecovery(storage);
        if (!inspection.ok) {
          return { ok: false, reason: "invalid-authority" };
        }
        const reserve = readExact(storage, WORKSPACE_RESERVE_KEY);
        if (!reserve.ok) return { ok: false, reason: "storage-error" };
        if (classifyWorkspaceReserve(reserve.value) === "valid") {
          return {
            ok: true,
            status: "no-operation-no-authority",
            authority: "none",
          };
        }
        const recreated = recreateWorkspaceReserve(
          storage,
          CANONICAL_WORKSPACE_RESERVE,
        );
        return recreated.ok
          ? {
              ok: true,
              status: "reserve-recreated-no-authority",
              authority: "none",
            }
          : { ok: false, reason: "reserve-degraded" };
      }
      const reserve = readExact(storage, WORKSPACE_RESERVE_KEY);
      if (!reserve.ok) return { ok: false, reason: "storage-error" };
      if (classifyWorkspaceReserve(reserve.value) === "valid") {
        return {
          ok: true,
          status: "no-operation",
          snapshot: authority.snapshot,
        };
      }
      const recreated = recreateWorkspaceReserve(
        storage,
        CANONICAL_WORKSPACE_RESERVE,
      );
      return recreated.ok
        ? {
            ok: true,
            status: "reserve-recreated",
            snapshot: authority.snapshot,
          }
        : { ok: false, reason: "reserve-degraded" };
    });
  } catch {
    return { ok: false, reason: "lock-failed" };
  }
}
