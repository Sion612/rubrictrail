import {
  parseLegacyProjectStateValue,
  parsePersistedProjectStateValue,
  parsePreviousProjectStateValue,
  parseProjectStorageRecordValue,
} from "@/lib/local-state";
import type { PersistedProjectState } from "@/lib/ui-types";
import { digestOptionalStoredString } from "@/lib/workspace-storage/digest";
import {
  LEGACY_PROJECT_KEYS,
  parseWorkspaceProjectRecordKey,
  WORKSPACE_INDEX_KEY,
  WORKSPACE_OPERATION_KEY,
  WORKSPACE_RESERVE_KEY,
  workspaceProjectRecordKey,
} from "@/lib/workspace-storage/keys";
import {
  resolveSingleProjectMigrationSource,
  type SingleProjectMigrationSnapshot,
} from "@/lib/workspace-storage/legacy-migration";
import {
  parseWorkspaceIndex,
  parseWorkspaceJournal,
  parseWorkspaceProjectRecord,
  serializeWorkspaceJournal,
  serializeWorkspaceProjectRecord,
  validateWorkspaceJournalDigests,
  WORKSPACE_PROJECT_RECORD_LIMIT,
  workspaceProjectRecordMatchesKey,
} from "@/lib/workspace-storage/protocol";
import {
  CANONICAL_WORKSPACE_RESERVE,
  classifyWorkspaceReserve,
} from "@/lib/workspace-storage/reserve";
import {
  readExact,
  recreateWorkspaceReserve,
  removeWorkspaceReserve,
  writeWorkspaceJournalPhase,
  WorkspaceStorageFault,
  type WorkspaceStorageAdapter,
} from "@/lib/workspace-storage/storage-adapter";
import type {
  WorkspaceOperationJournalV1,
  WorkspaceOperationKind,
  WorkspaceIndexV1,
  WorkspaceProjectRecordV1,
} from "@/lib/workspace-storage/types";

export type WorkspaceObservedValueState =
  | "expected"
  | "target"
  | "unchanged"
  | "absent"
  | "third-value";

export interface WorkspaceRecoveryObservation {
  key: string;
  role: "index" | "target-record" | "source-record" | "cleanup" | "legacy";
  state: WorkspaceObservedValueState;
}

export type WorkspaceRecoveryPlan =
  | {
      status: "complete" | "roll-forward" | "cancel-or-roll-forward" | "finish-cleanup";
      kind: WorkspaceOperationKind;
      observations: WorkspaceRecoveryObservation[];
      nextActions: string[];
    }
  | {
      status: "quarantine";
      kind: WorkspaceOperationKind | null;
      observations: WorkspaceRecoveryObservation[];
      reason:
        | "invalid-journal"
        | "digest-unavailable"
        | "third-value"
        | "missing-required-target"
        | "invalid-owned-record";
      nextActions: [];
    };

interface ObservedStoredValue {
  raw: string | null;
  digest: string | null;
}

function isRecoveryPrivacyPurge(journal: WorkspaceOperationJournalV1): boolean {
  return journal.kind === "delete-workspace" && journal.sourceGeneration === null;
}

type ActiveWorkspaceProjectRecord = WorkspaceProjectRecordV1 & {
  value: Extract<WorkspaceProjectRecordV1["value"], { kind: "project" }>;
};

function isAuthoritativeActiveProjectRecord(
  record: WorkspaceProjectRecordV1,
): record is ActiveWorkspaceProjectRecord {
  return (
    record.value.kind === "project" &&
    record.value.state.projectKind !== "none"
  );
}

function parseLegacyResolutionCandidate(
  source: "record" | "v3" | "v2" | "v1",
  raw: string,
): PersistedProjectState | null {
  if (source === "record") {
    const parsed = parseProjectStorageRecordValue(raw);
    return parsed?.status === "active" &&
      parsed.state !== null &&
      parsed.state.projectKind !== "none"
      ? parsed.state
      : null;
  }
  if (source === "v3") {
    try {
      const value = JSON.parse(raw) as unknown;
      if (
        typeof value !== "object" ||
        value === null ||
        !("version" in value) ||
        value.version !== 3
      ) {
        return null;
      }
      const parsed = parsePersistedProjectStateValue(value);
      return parsed.ok && parsed.state.projectKind !== "none"
        ? parsed.state
        : null;
    } catch {
      return null;
    }
  }
  if (source === "v2") {
    const parsed = parsePreviousProjectStateValue(raw);
    return parsed.ok && parsed.state.projectKind !== "none"
      ? parsed.state
      : null;
  }
  const parsed = parseLegacyProjectStateValue(raw);
  return parsed?.projectKind === "none" ? null : parsed;
}

export type WorkspaceLegacyResolutionTargetResult =
  | { ok: true; serialized: string }
  | {
      ok: false;
      reason:
        | "unsupported"
        | "conflict"
        | "invalid"
        | "digest-unavailable"
        | "storage-error";
    };

/**
 * Rebuilds the one project target named by a confirmed legacy-resolution
 * journal. The journal never stores project content; the still-exact named
 * legacy source is parsed again and the resulting canonical record must match
 * the journaled target digest byte-for-byte.
 */
export async function reconstructWorkspaceLegacyResolutionTargetRecord(
  storage: WorkspaceStorageAdapter,
  journal: WorkspaceOperationJournalV1,
): Promise<WorkspaceLegacyResolutionTargetResult> {
  const marker = journal.legacyResolution;
  if (
    marker?.candidateSource === null ||
    marker === undefined ||
    !["restore-as-new", "replace-project"].includes(journal.kind) ||
    journal.projectMutations.length !== 1
  ) {
    return { ok: false, reason: "unsupported" };
  }
  const legacyKey = LEGACY_PROJECT_KEYS[marker.candidateSource];
  const legacy = readExact(storage, legacyKey);
  if (!legacy.ok) return { ok: false, reason: "storage-error" };
  if (legacy.value === null) return { ok: false, reason: "conflict" };
  const legacyDigest = await digestOptionalStoredString(legacy.value);
  if (!legacyDigest.ok) return { ok: false, reason: "digest-unavailable" };
  if (
    legacyDigest.digest !==
    journal.legacyExpectedDigests[marker.candidateSource]
  ) {
    return { ok: false, reason: "conflict" };
  }
  const state = parseLegacyResolutionCandidate(
    marker.candidateSource,
    legacy.value,
  );
  if (state === null) return { ok: false, reason: "invalid" };

  const mutation = journal.projectMutations[0];
  const identity = parseWorkspaceProjectRecordKey(mutation.targetRecord.key);
  if (
    identity === null ||
    identity.workspaceId !== journal.workspaceId ||
    identity.workspaceGeneration !== journal.targetGeneration ||
    identity.projectId !== mutation.projectId
  ) {
    return { ok: false, reason: "invalid" };
  }

  let revision = 1;
  if (journal.kind === "replace-project") {
    const before = readExact(storage, mutation.targetRecord.key);
    if (!before.ok) return { ok: false, reason: "storage-error" };
    if (before.value === null) return { ok: false, reason: "conflict" };
    const beforeDigest = await digestOptionalStoredString(before.value);
    if (!beforeDigest.ok) return { ok: false, reason: "digest-unavailable" };
    const parsedBefore = parseWorkspaceProjectRecord(before.value);
    if (
      beforeDigest.digest !== mutation.targetRecord.expectedBeforeDigest ||
      !parsedBefore.ok ||
      !workspaceProjectRecordMatchesKey(
        mutation.targetRecord.key,
        parsedBefore.value,
      ) ||
      !isAuthoritativeActiveProjectRecord(parsedBefore.value) ||
      parsedBefore.value.revision >= Number.MAX_SAFE_INTEGER
    ) {
      return { ok: false, reason: "conflict" };
    }
    revision = parsedBefore.value.revision + 1;
  } else if (mutation.targetRecord.expectedBeforeDigest !== null) {
    return { ok: false, reason: "invalid" };
  }

  const serialized = serializeWorkspaceProjectRecord({
    formatVersion: 1,
    workspaceId: journal.workspaceId,
    workspaceGeneration: journal.targetGeneration,
    projectId: mutation.projectId,
    revision,
    value: { kind: "project", state },
  });
  if (!serialized.ok) return { ok: false, reason: "invalid" };
  const targetDigest = await digestOptionalStoredString(serialized.serialized);
  if (!targetDigest.ok) return { ok: false, reason: "digest-unavailable" };
  return targetDigest.digest === mutation.targetRecord.targetDigest
    ? { ok: true, serialized: serialized.serialized }
    : { ok: false, reason: "conflict" };
}

function storageValidationFailure(error: unknown): "storage-error" {
  if (error instanceof WorkspaceStorageFault && error.kind === "crash") throw error;
  return "storage-error";
}

async function observedStoredValue(
  storage: WorkspaceStorageAdapter,
  key: string,
): Promise<{ ok: true; value: ObservedStoredValue } | { ok: false }> {
  const read = readExact(storage, key);
  if (!read.ok) return { ok: false };
  const digest = await digestOptionalStoredString(read.value);
  return digest.ok
    ? { ok: true, value: { raw: read.value, digest: digest.digest } }
    : { ok: false };
}

function classifyBeforeAfter(
  actual: string | null,
  expected: string | null,
  target: string,
): WorkspaceObservedValueState {
  if (expected === target && actual === target) return "unchanged";
  if (actual === expected) return "expected";
  if (actual === target) return "target";
  if (actual === null) return "absent";
  return "third-value";
}

function classifyExpectedOrAbsent(
  actual: string | null,
  expected: string,
): WorkspaceObservedValueState {
  if (actual === expected) return "expected";
  if (actual === null) return "absent";
  return "third-value";
}

function sameIndexEntries(
  left: WorkspaceIndexV1["projects"],
  right: WorkspaceIndexV1["projects"],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameLegacyFingerprints(
  left: WorkspaceIndexV1["legacyFingerprints"],
  right: WorkspaceIndexV1["legacyFingerprints"],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function journalLegacyTransitionMatches(
  base: WorkspaceIndexV1,
  target: WorkspaceIndexV1,
  journal: WorkspaceOperationJournalV1,
): boolean {
  if (journal.legacyResolution === undefined) {
    return sameLegacyFingerprints(
      base.legacyFingerprints,
      journal.legacyExpectedDigests,
    );
  }
  if (
    !["restore-as-new", "replace-project", "legacy-cleanup"].includes(
      journal.kind,
    ) ||
    sameLegacyFingerprints(
      base.legacyFingerprints,
      journal.legacyExpectedDigests,
    )
  ) {
    return false;
  }
  return journal.kind === "legacy-cleanup"
    ? Object.values(target.legacyFingerprints).every((digest) => digest === null)
    : sameLegacyFingerprints(
        target.legacyFingerprints,
        journal.legacyExpectedDigests,
      );
}

function nextRevisionIs(base: WorkspaceIndexV1, target: WorkspaceIndexV1): boolean {
  return base.revision < Number.MAX_SAFE_INTEGER && target.revision === base.revision + 1;
}

function mutationProjectIds(journal: WorkspaceOperationJournalV1): string[] {
  return journal.projectMutations.map((mutation) => mutation.projectId);
}

function workspaceBaseIndexMatchesJournal(
  rawBaseIndex: string,
  journal: WorkspaceOperationJournalV1,
): boolean {
  const base = parseWorkspaceIndex(rawBaseIndex);
  const target = parseWorkspaceIndex(journal.targetIndex.serializedValue);
  if (
    !base.ok ||
    !target.ok ||
    base.value.workspaceId !== journal.workspaceId ||
    base.value.workspaceGeneration !== journal.sourceGeneration ||
    !journalLegacyTransitionMatches(base.value, target.value, journal)
  ) {
    return false;
  }

  const baseIndex = base.value;
  const targetIndex = target.value;
  const mutationIds = mutationProjectIds(journal);
  const unchangedIdentity =
    targetIndex.workspaceId === baseIndex.workspaceId &&
    targetIndex.workspaceGeneration === baseIndex.workspaceGeneration;

  if (journal.kind === "replace-project") {
    return journal.legacyResolution === undefined
      ? rawBaseIndex === journal.targetIndex.serializedValue
      : unchangedIdentity &&
          nextRevisionIs(baseIndex, targetIndex) &&
          baseIndex.status === "active" &&
          targetIndex.status === "active" &&
          sameIndexEntries(baseIndex.projects, targetIndex.projects);
  }

  if (journal.kind === "create-project" || journal.kind === "restore-as-new") {
    const createdId = mutationIds[0];
    const expectedProjects = [...baseIndex.projects, { projectId: createdId, kind: "active" as const }]
      .sort((left, right) =>
        left.projectId < right.projectId ? -1 : left.projectId > right.projectId ? 1 : 0,
      );
    return (
      unchangedIdentity &&
      nextRevisionIs(baseIndex, targetIndex) &&
      targetIndex.status === "active" &&
      !baseIndex.projects.some((entry) => entry.projectId === createdId) &&
      sameIndexEntries(targetIndex.projects, expectedProjects)
    );
  }

  if (journal.kind === "delete-project") {
    const deletedId = mutationIds[0];
    const deletedEntry = baseIndex.projects.find((entry) => entry.projectId === deletedId);
    const expectedProjects = baseIndex.projects.map((entry) =>
      entry.projectId === deletedId ? { ...entry, kind: "tombstone" as const } : entry,
    );
    return (
      unchangedIdentity &&
      nextRevisionIs(baseIndex, targetIndex) &&
      baseIndex.status === "active" &&
      targetIndex.status === "active" &&
      deletedEntry?.kind === "active" &&
      sameIndexEntries(targetIndex.projects, expectedProjects)
    );
  }

  if (journal.kind === "legacy-cleanup") {
    return (
      unchangedIdentity &&
      nextRevisionIs(baseIndex, targetIndex) &&
      baseIndex.status === targetIndex.status &&
      sameIndexEntries(baseIndex.projects, targetIndex.projects) &&
      Object.values(targetIndex.legacyFingerprints).every((value) => value === null)
    );
  }

  if (journal.kind === "delete-workspace") {
    const cleanupKeys = new Set(journal.cleanup.map((entry) => entry.key));
    return (
      targetIndex.workspaceGeneration === baseIndex.workspaceGeneration + 1 &&
      nextRevisionIs(baseIndex, targetIndex) &&
      targetIndex.status === "cleared" &&
      targetIndex.projects.length === 0 &&
      baseIndex.projects.every((entry) =>
        cleanupKeys.has(
          workspaceProjectRecordKey(
            journal.workspaceId,
            baseIndex.workspaceGeneration,
            entry.projectId,
          ),
        ),
      )
    );
  }

  if (journal.kind === "rotate-workspace-generation") {
    const expectedActive = baseIndex.projects.filter((entry) => entry.kind === "active");
    const expectedTombstoneKeys = baseIndex.projects
      .filter((entry) => entry.kind === "tombstone")
      .map((entry) =>
        workspaceProjectRecordKey(
          journal.workspaceId,
          baseIndex.workspaceGeneration,
          entry.projectId,
        ),
      );
    const projectCleanupKeys = journal.cleanup
      .map((entry) => entry.key)
      .filter((key) => parseWorkspaceProjectRecordKey(key) !== null);
    return (
      baseIndex.status === "active" &&
      targetIndex.status === "active" &&
      targetIndex.workspaceGeneration === baseIndex.workspaceGeneration + 1 &&
      nextRevisionIs(baseIndex, targetIndex) &&
      sameIndexEntries(targetIndex.projects, expectedActive) &&
      JSON.stringify(mutationIds) ===
        JSON.stringify(expectedActive.map((entry) => entry.projectId)) &&
      JSON.stringify(projectCleanupKeys) === JSON.stringify(expectedTombstoneKeys)
    );
  }

  return false;
}

function workspaceMutationRecordIsValid(
  raw: string,
  key: string,
  projectId: string,
  mode: "before" | "create" | "replace" | "delete" | "rewrite-generation",
): boolean {
  const parsed = parseWorkspaceProjectRecord(raw);
  if (
    !parsed.ok ||
    !workspaceProjectRecordMatchesKey(key, parsed.value) ||
    parsed.value.projectId !== projectId
  ) {
    return false;
  }
  return mode === "delete"
    ? parsed.value.value.kind === "tombstone"
    : isAuthoritativeActiveProjectRecord(parsed.value);
}

function validateBaseIndexReferencedRecords(
  storage: WorkspaceStorageAdapter,
  rawBaseIndex: string,
  journal: WorkspaceOperationJournalV1,
  phase: "preparation" | "recovery",
): "match" | "conflict" | "storage-error" {
  const parsedIndex = parseWorkspaceIndex(rawBaseIndex);
  if (!parsedIndex.ok) return "conflict";

  try {
    for (const entry of parsedIndex.value.projects) {
      const key = workspaceProjectRecordKey(
        parsedIndex.value.workspaceId,
        parsedIndex.value.workspaceGeneration,
        entry.projectId,
      );
      if (
        phase === "recovery" &&
        journal.projectMutations.some((mutation) => mutation.targetRecord.key === key)
      ) {
        // Target records have exact before/after digest and envelope checks in
        // the recovery observation loop. Validate only the index's otherwise
        // untouched authority here so the more precise target failure reason
        // is preserved.
        continue;
      }
      const raw = storage.getItem(key);
      if (raw === null) return "conflict";
      const parsedRecord = parseWorkspaceProjectRecord(raw);
      if (!parsedRecord.ok || !workspaceProjectRecordMatchesKey(key, parsedRecord.value)) {
        return "conflict";
      }

      const observedKind = parsedRecord.value.value.kind === "tombstone"
        ? "tombstone"
        : isAuthoritativeActiveProjectRecord(parsedRecord.value)
          ? "active"
          : null;
      if (observedKind === null) return "conflict";
      if (observedKind === entry.kind) continue;
      return "conflict";
    }
    return "match";
  } catch (error) {
    return storageValidationFailure(error);
  }
}

function operationAllowsCancellation(kind: WorkspaceOperationKind): boolean {
  return [
    "create-project",
    "restore-as-new",
    "replace-project",
    "delete-project",
    "legacy-cleanup",
    "delete-workspace",
  ].includes(kind);
}

function sortedStrings(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function sameStringSet(left: Iterable<string>, right: Iterable<string>): boolean {
  return JSON.stringify(sortedStrings(left)) === JSON.stringify(sortedStrings(right));
}

function validateSelectedRecoveryGroup(
  storage: WorkspaceStorageAdapter,
  journal: WorkspaceOperationJournalV1,
): "match" | "conflict" | "storage-error" {
  if (journal.kind !== "recover-index" || journal.sourceGeneration === null) {
    return "match";
  }

  try {
    const activeKeys = new Set<string>();
    const tombstoneKeys = new Set<string>();
    for (const key of storage.keys()) {
      const identity = parseWorkspaceProjectRecordKey(key);
      if (
        !identity ||
        identity.workspaceId !== journal.workspaceId ||
        identity.workspaceGeneration !== journal.sourceGeneration
      ) {
        continue;
      }
      const raw = storage.getItem(key);
      if (raw === null) return "conflict";
      const record = parseWorkspaceProjectRecord(raw);
      if (!record.ok || !workspaceProjectRecordMatchesKey(key, record.value)) {
        return "conflict";
      }
      if (record.value.value.kind === "tombstone") {
        tombstoneKeys.add(key);
      } else if (isAuthoritativeActiveProjectRecord(record.value)) {
        activeKeys.add(key);
      } else {
        return "conflict";
      }
    }

    if (activeKeys.size + tombstoneKeys.size > WORKSPACE_PROJECT_RECORD_LIMIT) {
      return "conflict";
    }

    const journalActiveKeys = journal.projectMutations.flatMap((mutation) =>
      mutation.sourceRecord ? [mutation.sourceRecord.key] : [],
    );
    const journalTombstoneKeys = journal.cleanup.flatMap((entry) =>
      parseWorkspaceProjectRecordKey(entry.key) ? [entry.key] : [],
    );
    return sameStringSet(activeKeys, journalActiveKeys) &&
      sameStringSet(tombstoneKeys, journalTombstoneKeys)
      ? "match"
      : "conflict";
  } catch (error) {
    return storageValidationFailure(error);
  }
}

function validateRotationOwnedRecords(
  storage: WorkspaceStorageAdapter,
  journal: WorkspaceOperationJournalV1,
): "match" | "conflict" | "storage-error" {
  if (journal.kind !== "rotate-workspace-generation") return "match";
  try {
    for (const key of storage.keys()) {
      const identity = parseWorkspaceProjectRecordKey(key);
      if (!identity) continue;
      const raw = storage.getItem(key);
      if (raw === null) return "conflict";
      const record = parseWorkspaceProjectRecord(raw);
      if (!record.ok || !workspaceProjectRecordMatchesKey(key, record.value)) {
        return "conflict";
      }
    }
    return "match";
  } catch (error) {
    return storageValidationFailure(error);
  }
}

function validateRecoveryObservedRecordRoles(
  storage: WorkspaceStorageAdapter,
  journal: WorkspaceOperationJournalV1,
): "match" | "conflict" | "storage-error" {
  if (
    (journal.kind !== "rotate-workspace-generation" && journal.kind !== "recover-index") ||
    journal.sourceGeneration === null
  ) {
    return "match";
  }

  const sourceActiveKeys = new Set(
    journal.projectMutations.flatMap((mutation) =>
      mutation.sourceRecord ? [mutation.sourceRecord.key] : [],
    ),
  );
  const targetKinds = new Map(
    journal.projectMutations.map((mutation) => [
      mutation.targetRecord.key,
      mutation.mode === "delete" ? "tombstone" : "project",
    ]),
  );
  const sourceTombstoneKeys = new Set(
    journal.cleanup.flatMap((entry) =>
      parseWorkspaceProjectRecordKey(entry.key) ? [entry.key] : [],
    ),
  );

  try {
    for (const key of storage.keys()) {
      const identity = parseWorkspaceProjectRecordKey(key);
      if (!identity || identity.workspaceId !== journal.workspaceId) continue;
      if (
        journal.kind === "recover-index" &&
        identity.workspaceGeneration !== journal.sourceGeneration &&
        identity.workspaceGeneration !== journal.targetGeneration
      ) {
        continue;
      }
      const raw = storage.getItem(key);
      if (raw === null) return "conflict";
      const record = parseWorkspaceProjectRecord(raw);
      if (!record.ok || !workspaceProjectRecordMatchesKey(key, record.value)) {
        return "conflict";
      }

      if (identity.workspaceGeneration === journal.sourceGeneration) {
        const allowed = record.value.value.kind === "tombstone"
          ? sourceTombstoneKeys.has(key)
          : isAuthoritativeActiveProjectRecord(record.value) &&
            sourceActiveKeys.has(key);
        if (!allowed) return "conflict";
        continue;
      }

      if (identity.workspaceGeneration === journal.targetGeneration) {
        const expectedKind = targetKinds.get(key);
        const validTargetKind = expectedKind === "tombstone"
          ? record.value.value.kind === "tombstone"
          : expectedKind === "project"
            ? isAuthoritativeActiveProjectRecord(record.value)
            : false;
        if (!validTargetKind) {
          return "conflict";
        }
        continue;
      }

      return "conflict";
    }
    return "match";
  } catch (error) {
    return storageValidationFailure(error);
  }
}

function validateDeleteWorkspaceCleanupCoverage(
  storage: WorkspaceStorageAdapter,
  journal: WorkspaceOperationJournalV1,
  phase: "preparation" | "recovery",
): "match" | "conflict" | "storage-error" {
  if (journal.kind !== "delete-workspace") return "match";
  const cleanupKeys = new Set(
    journal.cleanup.flatMap((entry) =>
      parseWorkspaceProjectRecordKey(entry.key) ? [entry.key] : [],
    ),
  );
  try {
    const discoveredKeys = storage.keys().filter((key) => {
      return parseWorkspaceProjectRecordKey(key) !== null;
    });
    const covered = discoveredKeys.every((key) => cleanupKeys.has(key));
    return covered &&
      (phase === "recovery" || sameStringSet(cleanupKeys, discoveredKeys))
      ? "match"
      : "conflict";
  } catch (error) {
    return storageValidationFailure(error);
  }
}

function validateMigrationNamespace(
  storage: WorkspaceStorageAdapter,
  journal: WorkspaceOperationJournalV1,
  phase: "preparation" | "recovery",
): "match" | "conflict" | "storage-error" {
  if (journal.kind !== "migrate-single-project") return "match";
  const allowedTargetKeys = new Set(
    journal.projectMutations.map((mutation) => mutation.targetRecord.key),
  );
  try {
    const discoveredKeys = storage.keys().filter(
      (key) => parseWorkspaceProjectRecordKey(key) !== null,
    );
    return discoveredKeys.every(
      (key) => phase === "recovery" && allowedTargetKeys.has(key),
    )
      ? "match"
      : "conflict";
  } catch (error) {
    return storageValidationFailure(error);
  }
}

async function validateMigrationJournalAuthority(
  storage: WorkspaceStorageAdapter,
  journal: WorkspaceOperationJournalV1,
): Promise<"match" | "invalid" | "storage-error" | "digest-unavailable"> {
  if (journal.kind !== "migrate-single-project") return "match";
  const record = readExact(storage, LEGACY_PROJECT_KEYS.record);
  const v3 = readExact(storage, LEGACY_PROJECT_KEYS.v3);
  const v2 = readExact(storage, LEGACY_PROJECT_KEYS.v2);
  const v1 = readExact(storage, LEGACY_PROJECT_KEYS.v1);
  if (!record.ok || !v3.ok || !v2.ok || !v1.ok) return "storage-error";

  const source = resolveSingleProjectMigrationSource({
    recordValue: record.value,
    legacyV3Value: v3.value,
    legacyV2Value: v2.value,
    legacyV1Value: v1.value,
  });
  const targetIndex = parseWorkspaceIndex(journal.targetIndex.serializedValue);
  if (!source.ok || !targetIndex.ok) return "invalid";
  if (source.kind === "cleared") {
    return journal.projectMutations.length === 0 && targetIndex.value.projects.length === 0
      ? "match"
      : "invalid";
  }

  const mutation = journal.projectMutations[0];
  if (
    journal.projectMutations.length !== 1 ||
    mutation.mode !== "create" ||
    targetIndex.value.projects.length !== 1 ||
    targetIndex.value.projects[0]?.projectId !== mutation.projectId ||
    targetIndex.value.projects[0]?.kind !== "active"
  ) {
    return "invalid";
  }
  const expectedTarget = serializeWorkspaceProjectRecord({
    formatVersion: 1,
    workspaceId: journal.workspaceId,
    workspaceGeneration: journal.targetGeneration,
    projectId: mutation.projectId,
    revision: 1,
    value: { kind: "project", state: source.state },
  });
  if (!expectedTarget.ok) return "invalid";
  const expectedDigest = await digestOptionalStoredString(expectedTarget.serialized);
  if (!expectedDigest.ok || expectedDigest.digest === null) return "digest-unavailable";
  return expectedDigest.digest === mutation.targetRecord.targetDigest ? "match" : "invalid";
}

async function validateRewriteJournalAuthority(
  storage: WorkspaceStorageAdapter,
  journal: WorkspaceOperationJournalV1,
): Promise<
  "match" | "invalid" | "baseline-mismatch" | "storage-error" | "digest-unavailable"
> {
  if (
    journal.kind !== "rotate-workspace-generation" &&
    journal.kind !== "recover-index"
  ) {
    return "match";
  }

  for (const mutation of journal.projectMutations) {
    if (!mutation.sourceRecord) return "invalid";
    const source = readExact(storage, mutation.sourceRecord.key);
    if (!source.ok) return "storage-error";
    // A verified partial rewrite may already have removed its source. In that
    // state the exact durable target digest is the remaining recovery proof.
    if (source.value === null) continue;
    const sourceDigest = await digestOptionalStoredString(source.value);
    if (!sourceDigest.ok || sourceDigest.digest === null) return "digest-unavailable";
    if (sourceDigest.digest !== mutation.sourceRecord.expectedDigest) {
      return "baseline-mismatch";
    }
    const parsedSource = parseWorkspaceProjectRecord(source.value);
    if (
      !parsedSource.ok ||
      !workspaceProjectRecordMatchesKey(mutation.sourceRecord.key, parsedSource.value) ||
      parsedSource.value.projectId !== mutation.projectId ||
      !isAuthoritativeActiveProjectRecord(parsedSource.value) ||
      parsedSource.value.revision >= Number.MAX_SAFE_INTEGER
    ) {
      return "invalid";
    }
    const expectedTarget = serializeWorkspaceProjectRecord({
      formatVersion: 1,
      workspaceId: journal.workspaceId,
      workspaceGeneration: journal.targetGeneration,
      projectId: mutation.projectId,
      revision: parsedSource.value.revision + 1,
      value: { kind: "project", state: parsedSource.value.value.state },
    });
    if (!expectedTarget.ok) return "invalid";
    const expectedDigest = await digestOptionalStoredString(expectedTarget.serialized);
    if (!expectedDigest.ok || expectedDigest.digest === null) return "digest-unavailable";
    if (expectedDigest.digest !== mutation.targetRecord.targetDigest) return "invalid";
  }
  return "match";
}

export async function classifyWorkspaceRecovery(
  storage: WorkspaceStorageAdapter,
  rawJournal: string,
): Promise<WorkspaceRecoveryPlan> {
  const parsed = parseWorkspaceJournal(rawJournal);
  if (!parsed.ok) {
    return {
      status: "quarantine",
      kind: null,
      observations: [],
      reason: "invalid-journal",
      nextActions: [],
    };
  }
  const journal = parsed.value;
  const validated = await validateWorkspaceJournalDigests(journal);
  if (!validated.ok) {
    return {
      status: "quarantine",
      kind: journal.kind,
      observations: [],
      reason:
        validated.reason === "digest-unavailable"
          ? "digest-unavailable"
          : "invalid-journal",
      nextActions: [],
    };
  }
  const durableJournal = readExact(storage, WORKSPACE_OPERATION_KEY);
  if (!durableJournal.ok) {
    return {
      status: "quarantine",
      kind: journal.kind,
      observations: [],
      reason: "digest-unavailable",
      nextActions: [],
    };
  }
  if (durableJournal.value !== rawJournal) {
    return {
      status: "quarantine",
      kind: journal.kind,
      observations: [],
      reason: "third-value",
      nextActions: [],
    };
  }

  const migrationAuthority = await validateMigrationJournalAuthority(storage, journal);
  if (migrationAuthority !== "match") {
    return {
      status: "quarantine",
      kind: journal.kind,
      observations: [],
      reason:
        migrationAuthority === "storage-error" || migrationAuthority === "digest-unavailable"
          ? "digest-unavailable"
          : "invalid-owned-record",
      nextActions: [],
    };
  }

  const migrationNamespace = validateMigrationNamespace(storage, journal, "recovery");
  if (migrationNamespace !== "match") {
    return {
      status: "quarantine",
      kind: journal.kind,
      observations: [],
      reason:
        migrationNamespace === "storage-error"
          ? "digest-unavailable"
          : "invalid-owned-record",
      nextActions: [],
    };
  }

  const rewriteAuthority = await validateRewriteJournalAuthority(storage, journal);
  if (rewriteAuthority !== "match") {
    return {
      status: "quarantine",
      kind: journal.kind,
      observations: [],
      reason:
        rewriteAuthority === "storage-error" || rewriteAuthority === "digest-unavailable"
          ? "digest-unavailable"
          : rewriteAuthority === "baseline-mismatch"
            ? "third-value"
          : "invalid-owned-record",
      nextActions: [],
    };
  }

  const rotationOwnedRecords = validateRotationOwnedRecords(storage, journal);
  if (rotationOwnedRecords !== "match") {
    return {
      status: "quarantine",
      kind: journal.kind,
      observations: [],
      reason:
        rotationOwnedRecords === "storage-error"
          ? "digest-unavailable"
          : "invalid-owned-record",
      nextActions: [],
    };
  }

  const observedRoles = validateRecoveryObservedRecordRoles(storage, journal);
  if (observedRoles !== "match") {
    return {
      status: "quarantine",
      kind: journal.kind,
      observations: [],
      reason:
        observedRoles === "storage-error" ? "digest-unavailable" : "invalid-owned-record",
      nextActions: [],
    };
  }
  const deleteCoverage = validateDeleteWorkspaceCleanupCoverage(storage, journal, "recovery");
  if (deleteCoverage !== "match") {
    return {
      status: "quarantine",
      kind: journal.kind,
      observations: [],
      reason:
        deleteCoverage === "storage-error" ? "digest-unavailable" : "invalid-owned-record",
      nextActions: [],
    };
  }

  const observations: WorkspaceRecoveryObservation[] = [];
  const valueCache = new Map<string, ObservedStoredValue>();
  const readValue = async (key: string): Promise<ObservedStoredValue | undefined> => {
    if (valueCache.has(key)) return valueCache.get(key);
    const observed = await observedStoredValue(storage, key);
    if (!observed.ok) return undefined;
    valueCache.set(key, observed.value);
    return observed.value;
  };

  const actualIndexValue = await readValue(WORKSPACE_INDEX_KEY);
  if (actualIndexValue === undefined) {
    return {
      status: "quarantine",
      kind: journal.kind,
      observations,
      reason: "digest-unavailable",
      nextActions: [],
    };
  }
  if (
    (journal.kind === "recover-index" || isRecoveryPrivacyPurge(journal)) &&
    actualIndexValue.raw !== null &&
    actualIndexValue.raw !== journal.targetIndex.serializedValue &&
    parseWorkspaceIndex(actualIndexValue.raw).ok
  ) {
    const existingAuthority = validateBaseIndexReferencedRecords(
      storage,
      actualIndexValue.raw,
      journal,
      "preparation",
    );
    if (existingAuthority === "storage-error") {
      return {
        status: "quarantine",
        kind: journal.kind,
        observations,
        reason: "digest-unavailable",
        nextActions: [],
      };
    }
    if (existingAuthority === "match") {
      return {
        status: "quarantine",
        kind: journal.kind,
        observations,
        reason: "invalid-owned-record",
        nextActions: [],
      };
    }
  }
  const indexState = classifyBeforeAfter(
    actualIndexValue.digest,
    journal.baseIndex.expectedDigest,
    journal.targetIndex.targetDigest,
  );
  observations.push({ key: WORKSPACE_INDEX_KEY, role: "index", state: indexState });
  if (
    (indexState === "target" &&
      actualIndexValue.raw !== journal.targetIndex.serializedValue) ||
    (indexState === "expected" &&
      journal.kind !== "recover-index" &&
      !isRecoveryPrivacyPurge(journal) &&
      actualIndexValue.raw !== null &&
      !workspaceBaseIndexMatchesJournal(actualIndexValue.raw, journal))
  ) {
    return {
      status: "quarantine",
      kind: journal.kind,
      observations,
      reason: "invalid-owned-record",
      nextActions: [],
    };
  }
  const currentIndexIsStrict =
    actualIndexValue.raw !== null && parseWorkspaceIndex(actualIndexValue.raw).ok;
  const shouldValidateReferencedRecords =
    currentIndexIsStrict &&
    (indexState === "target" ||
      indexState === "unchanged" ||
      (indexState === "expected" &&
        journal.kind !== "recover-index" &&
        journal.kind !== "migrate-single-project" &&
        !isRecoveryPrivacyPurge(journal) &&
        journal.kind !== "rotate-workspace-generation"));
  if (shouldValidateReferencedRecords && actualIndexValue.raw !== null) {
    const referencedRecords = validateBaseIndexReferencedRecords(
      storage,
      actualIndexValue.raw,
      journal,
      "recovery",
    );
    if (referencedRecords !== "match") {
      return {
        status: "quarantine",
        kind: journal.kind,
        observations,
        reason:
          referencedRecords === "storage-error"
            ? "digest-unavailable"
            : "invalid-owned-record",
        nextActions: [],
      };
    }
  }

  for (const mutation of journal.projectMutations) {
    const actualTarget = await readValue(mutation.targetRecord.key);
    if (actualTarget === undefined) {
      return {
        status: "quarantine",
        kind: journal.kind,
        observations,
        reason: "digest-unavailable",
        nextActions: [],
      };
    }
    const targetState = classifyBeforeAfter(
      actualTarget.digest,
      mutation.targetRecord.expectedBeforeDigest,
      mutation.targetRecord.targetDigest,
    );
    observations.push({
      key: mutation.targetRecord.key,
      role: "target-record",
      state: targetState,
    });
    if (
      actualTarget.raw !== null &&
      (targetState === "expected" ||
        targetState === "target" ||
        targetState === "unchanged") &&
      !workspaceMutationRecordIsValid(
        actualTarget.raw,
        mutation.targetRecord.key,
        mutation.projectId,
        targetState === "expected" ? "before" : mutation.mode,
      )
    ) {
      return {
        status: "quarantine",
        kind: journal.kind,
        observations,
        reason: "invalid-owned-record",
        nextActions: [],
      };
    }
    if (mutation.sourceRecord) {
      const actualSource = await readValue(mutation.sourceRecord.key);
      if (actualSource === undefined) {
        return {
          status: "quarantine",
          kind: journal.kind,
          observations,
          reason: "digest-unavailable",
          nextActions: [],
        };
      }
      const sourceState = classifyExpectedOrAbsent(
        actualSource.digest,
        mutation.sourceRecord.expectedDigest,
      );
      observations.push({
        key: mutation.sourceRecord.key,
        role: "source-record",
        state: sourceState,
      });
      if (
        actualSource.raw !== null &&
        sourceState === "expected" &&
        !workspaceMutationRecordIsValid(
          actualSource.raw,
          mutation.sourceRecord.key,
          mutation.projectId,
          "before",
        )
      ) {
        return {
          status: "quarantine",
          kind: journal.kind,
          observations,
          reason: "invalid-owned-record",
          nextActions: [],
        };
      }
    }
  }

  for (const cleanup of journal.cleanup) {
    const actual = await readValue(cleanup.key);
    if (actual === undefined) {
      return {
        status: "quarantine",
        kind: journal.kind,
        observations,
        reason: "digest-unavailable",
        nextActions: [],
      };
    }
    observations.push({
      key: cleanup.key,
      role: "cleanup",
      state: classifyExpectedOrAbsent(actual.digest, cleanup.expectedDigest),
    });
  }

  const cleanupKeys = new Set(journal.cleanup.map((entry) => entry.key));
  for (const name of ["record", "v3", "v2", "v1"] as const) {
    const key = LEGACY_PROJECT_KEYS[name];
    const actual = await readValue(key);
    if (actual === undefined) {
      return {
        status: "quarantine",
        kind: journal.kind,
        observations,
        reason: "digest-unavailable",
        nextActions: [],
      };
    }
    const expected = journal.legacyExpectedDigests[name];
    const allowsRemoved = cleanupKeys.has(key);
    const state =
      actual.digest === expected
        ? "expected"
        : allowsRemoved && actual.digest === null
          ? "absent"
          : "third-value";
    observations.push({ key, role: "legacy", state });
  }

  if (observations.some((observation) => observation.state === "third-value")) {
    return {
      status: "quarantine",
      kind: journal.kind,
      observations,
      reason: "third-value",
      nextActions: [],
    };
  }

  const targetObservations = observations.filter(
    (observation) => observation.role === "target-record",
  );
  const sourceObservations = observations.filter(
    (observation) => observation.role === "source-record",
  );
  const cleanupObservations = observations.filter(
    (observation) => observation.role === "cleanup" || observation.role === "legacy",
  );
  const indexDoesNotChange =
    journal.baseIndex.expectedDigest === journal.targetIndex.targetDigest;
  const targetAuthorityCommitted = indexState === "target" && !indexDoesNotChange;
  const allTargetsWritten = targetObservations.every(
    (observation) => observation.state === "target" || observation.state === "unchanged",
  );
  const everySourceSafe = sourceObservations.every(
    (observation) => observation.state === "expected" || observation.state === "absent",
  );
  const sourceCleanupComplete = sourceObservations.every(
    (observation) => observation.state === "absent",
  );
  const cleanupComplete = cleanupObservations.every((observation) => {
    if (observation.role === "legacy" && !cleanupKeys.has(observation.key)) {
      return observation.state === "expected";
    }
    return observation.state === "absent";
  });

  const missingTargetAfterSourceCleanup = journal.projectMutations.some((mutation) => {
    if (!mutation.sourceRecord) return false;
    const source = observations.find(
      (observation) =>
        observation.role === "source-record" &&
        observation.key === mutation.sourceRecord?.key,
    );
    const target = observations.find(
      (observation) =>
        observation.role === "target-record" &&
        observation.key === mutation.targetRecord.key,
    );
    return source?.state === "absent" && target?.state === "expected";
  });
  const missingExpectedTargetRecord = journal.projectMutations.some((mutation) => {
    if (mutation.targetRecord.expectedBeforeDigest === null) return false;
    return observations.some(
      (observation) =>
        observation.role === "target-record" &&
        observation.key === mutation.targetRecord.key &&
        observation.state === "absent",
    );
  });
  const missingExpectedIndex =
    journal.baseIndex.expectedDigest !== null && indexState === "absent";
  if (
    missingExpectedIndex ||
    missingExpectedTargetRecord ||
    missingTargetAfterSourceCleanup ||
    (targetAuthorityCommitted && !allTargetsWritten)
  ) {
    return {
      status: "quarantine",
      kind: journal.kind,
      observations,
      reason: "missing-required-target",
      nextActions: [],
    };
  }

  if (
    (targetAuthorityCommitted || indexDoesNotChange) &&
    allTargetsWritten &&
    everySourceSafe &&
    sourceCleanupComplete &&
    cleanupComplete
  ) {
    return {
      status: "complete",
      kind: journal.kind,
      observations,
      nextActions: ["remove-exact-journal", "recreate-and-verify-reserve"],
    };
  }
  if (targetAuthorityCommitted) {
    return {
      status: "finish-cleanup",
      kind: journal.kind,
      observations,
      nextActions: ["remove-only-exact-journaled-cleanup-values", "remove-exact-journal", "recreate-and-verify-reserve"],
    };
  }

  const allAtExpected = observations.every(
    (observation) => observation.state === "expected" || observation.state === "unchanged",
  );
  return {
    status:
      allAtExpected && operationAllowsCancellation(journal.kind)
        ? "cancel-or-roll-forward"
        : "roll-forward",
    kind: journal.kind,
    observations,
    nextActions: ["verify-or-write-target-records", "write-exact-target-index", "finish-exact-cleanup"],
  };
}

export type WorkspaceJournalPreparationResult =
  | { ok: true; status: "prepared"; serializedJournal: string }
  | {
      ok: false;
      status: "failed" | "degraded" | "quarantine";
      reason:
        | "invalid-journal"
        | "invalid-reserve"
        | "storage-error"
        | "readback-mismatch"
        | "baseline-conflict"
        | "reserve-policy"
        | "invalid-target-record"
        | "third-value-journal";
    };

export interface WorkspaceJournalPreparationOptions {
  releaseReserve: boolean;
  targetRecords: Readonly<Record<string, string>>;
}

async function validatePlannedTargetRecords(
  storage: WorkspaceStorageAdapter,
  journal: WorkspaceOperationJournalV1,
  targetRecords: Readonly<Record<string, string>>,
): Promise<"match" | "invalid" | "storage-error"> {
  const expectedKeys = journal.projectMutations.map((mutation) => mutation.targetRecord.key);
  if (!sameStringSet(Object.keys(targetRecords), expectedKeys)) return "invalid";

  const migrationAuthority = await validateMigrationJournalAuthority(storage, journal);
  if (migrationAuthority !== "match") {
    return migrationAuthority === "storage-error" || migrationAuthority === "digest-unavailable"
      ? "storage-error"
      : "invalid";
  }
  const targetIndex = parseWorkspaceIndex(journal.targetIndex.serializedValue);
  if (!targetIndex.ok) return "invalid";
  let migrationTargetState: unknown = null;

  for (const mutation of journal.projectMutations) {
    const raw = targetRecords[mutation.targetRecord.key];
    if (raw === undefined) return "invalid";
    const targetDigest = await digestOptionalStoredString(raw);
    if (!targetDigest.ok || targetDigest.digest !== mutation.targetRecord.targetDigest) {
      return "invalid";
    }
    const parsedTarget = parseWorkspaceProjectRecord(raw);
    if (
      !parsedTarget.ok ||
      !workspaceProjectRecordMatchesKey(mutation.targetRecord.key, parsedTarget.value) ||
      parsedTarget.value.projectId !== mutation.projectId ||
      (mutation.mode === "delete"
        ? parsedTarget.value.value.kind !== "tombstone"
        : !isAuthoritativeActiveProjectRecord(parsedTarget.value))
    ) {
      return "invalid";
    }

    if (mutation.mode === "create") {
      if (parsedTarget.value.revision !== 1) return "invalid";
      if (journal.kind === "migrate-single-project") {
        if (!isAuthoritativeActiveProjectRecord(parsedTarget.value)) return "invalid";
        migrationTargetState = parsedTarget.value.value.state;
      }
      continue;
    }

    const beforeKey = mutation.mode === "rewrite-generation"
      ? mutation.sourceRecord?.key
      : mutation.targetRecord.key;
    if (!beforeKey) return "invalid";
    const before = readExact(storage, beforeKey);
    if (!before.ok) return "storage-error";
    if (before.value === null) return "invalid";
    const parsedBefore = parseWorkspaceProjectRecord(before.value);
    if (
      !parsedBefore.ok ||
      !workspaceProjectRecordMatchesKey(beforeKey, parsedBefore.value) ||
      parsedBefore.value.projectId !== mutation.projectId ||
      !isAuthoritativeActiveProjectRecord(parsedBefore.value) ||
      parsedBefore.value.revision >= Number.MAX_SAFE_INTEGER ||
      parsedTarget.value.revision !== parsedBefore.value.revision + 1
    ) {
      return "invalid";
    }
    if (
      mutation.mode === "rewrite-generation" &&
      (!isAuthoritativeActiveProjectRecord(parsedTarget.value) ||
        JSON.stringify(parsedTarget.value.value.state) !==
          JSON.stringify(parsedBefore.value.value.state))
    ) {
      return "invalid";
    }
  }

  if (journal.kind === "migrate-single-project") {
    const record = readExact(storage, LEGACY_PROJECT_KEYS.record);
    const v3 = readExact(storage, LEGACY_PROJECT_KEYS.v3);
    const v2 = readExact(storage, LEGACY_PROJECT_KEYS.v2);
    const v1 = readExact(storage, LEGACY_PROJECT_KEYS.v1);
    if (!record.ok || !v3.ok || !v2.ok || !v1.ok) return "storage-error";
    const snapshot: SingleProjectMigrationSnapshot = {
      recordValue: record.value,
      legacyV3Value: v3.value,
      legacyV2Value: v2.value,
      legacyV1Value: v1.value,
    };
    const source = resolveSingleProjectMigrationSource(snapshot);
    if (!source.ok) return "invalid";
    if (source.kind === "cleared") {
      return journal.projectMutations.length === 0 && targetIndex.value.projects.length === 0
        ? "match"
        : "invalid";
    }
    if (
      journal.projectMutations.length !== 1 ||
      targetIndex.value.projects.length !== 1 ||
      migrationTargetState === null ||
      JSON.stringify(migrationTargetState) !== JSON.stringify(source.state)
    ) {
      return "invalid";
    }
  }

  return "match";
}

function reserveReleaseDecision(
  storage: WorkspaceStorageAdapter,
  journal: WorkspaceOperationJournalV1,
  targetRecords: Readonly<Record<string, string>>,
): "allowed" | "denied" | "storage-error" {
  if (
    [
      "delete-project",
      "legacy-cleanup",
      "recover-index",
      "delete-workspace",
      "rotate-workspace-generation",
    ].includes(journal.kind)
  ) {
    return "allowed";
  }
  if (journal.kind !== "replace-project") return "denied";
  const mutation = journal.projectMutations[0];
  const before = readExact(storage, mutation.targetRecord.key);
  const target = targetRecords[mutation.targetRecord.key];
  if (!before.ok) return "storage-error";
  return before.value !== null && target !== undefined && target.length <= before.value.length
    ? "allowed"
    : "denied";
}

async function journalPreparationBaselinesMatch(
  storage: WorkspaceStorageAdapter,
  journal: WorkspaceOperationJournalV1,
): Promise<"match" | "conflict" | "storage-error"> {
  const index = await observedStoredValue(storage, WORKSPACE_INDEX_KEY);
  if (!index.ok) return "storage-error";
  if (index.value.digest !== journal.baseIndex.expectedDigest) return "conflict";

  if (journal.kind === "migrate-single-project") {
    if (index.value.raw !== null) return "conflict";
  } else if (isRecoveryPrivacyPurge(journal)) {
    if (index.value.raw !== null && parseWorkspaceIndex(index.value.raw).ok) {
      const existingAuthority = validateBaseIndexReferencedRecords(
        storage,
        index.value.raw,
        journal,
        "preparation",
      );
      if (existingAuthority === "storage-error") return "storage-error";
      if (existingAuthority === "match") return "conflict";
    }
  } else if (journal.kind === "recover-index") {
    if (index.value.raw !== null && parseWorkspaceIndex(index.value.raw).ok) {
      const existingAuthority = validateBaseIndexReferencedRecords(
        storage,
        index.value.raw,
        journal,
        "preparation",
      );
      if (existingAuthority === "storage-error") return "storage-error";
      if (existingAuthority === "match") return "conflict";
    }
  } else {
    if (
      index.value.raw === null ||
      !workspaceBaseIndexMatchesJournal(index.value.raw, journal)
    ) {
      return "conflict";
    }
    const referencedRecords = validateBaseIndexReferencedRecords(
      storage,
      index.value.raw,
      journal,
      "preparation",
    );
    if (referencedRecords !== "match") return referencedRecords;
  }

  const selectedRecoveryGroup = validateSelectedRecoveryGroup(storage, journal);
  if (selectedRecoveryGroup !== "match") return selectedRecoveryGroup;
  const rotationOwnedRecords = validateRotationOwnedRecords(storage, journal);
  if (rotationOwnedRecords !== "match") return rotationOwnedRecords;
  const observedRoles = validateRecoveryObservedRecordRoles(storage, journal);
  if (observedRoles !== "match") return observedRoles;
  const migrationNamespace = validateMigrationNamespace(storage, journal, "preparation");
  if (migrationNamespace !== "match") return migrationNamespace;
  const deleteWorkspaceCoverage = validateDeleteWorkspaceCleanupCoverage(
    storage,
    journal,
    "preparation",
  );
  if (deleteWorkspaceCoverage !== "match") return deleteWorkspaceCoverage;

  for (const name of ["record", "v3", "v2", "v1"] as const) {
    const observed = await observedStoredValue(storage, LEGACY_PROJECT_KEYS[name]);
    if (!observed.ok) return "storage-error";
    if (observed.value.digest !== journal.legacyExpectedDigests[name]) return "conflict";
  }

  for (const mutation of journal.projectMutations) {
    const target = await observedStoredValue(storage, mutation.targetRecord.key);
    if (!target.ok) return "storage-error";
    if (target.value.digest !== mutation.targetRecord.expectedBeforeDigest) return "conflict";
    if (
      target.value.raw !== null &&
      !workspaceMutationRecordIsValid(
        target.value.raw,
        mutation.targetRecord.key,
        mutation.projectId,
        "before",
      )
    ) {
      return "conflict";
    }
    if (mutation.sourceRecord) {
      const source = await observedStoredValue(storage, mutation.sourceRecord.key);
      if (!source.ok) return "storage-error";
      if (
        source.value.digest !== mutation.sourceRecord.expectedDigest ||
        source.value.raw === null ||
        !workspaceMutationRecordIsValid(
          source.value.raw,
          mutation.sourceRecord.key,
          mutation.projectId,
          "before",
        )
      ) {
        return "conflict";
      }
    }
  }

  for (const cleanup of journal.cleanup) {
    const observed = await observedStoredValue(storage, cleanup.key);
    if (!observed.ok) return "storage-error";
    if (observed.value.digest !== cleanup.expectedDigest) return "conflict";
    const identity = parseWorkspaceProjectRecordKey(cleanup.key);
    if (
      identity &&
      (journal.kind === "rotate-workspace-generation" ||
        journal.kind === "recover-index") &&
      (observed.value.raw === null ||
        !workspaceMutationRecordIsValid(
          observed.value.raw,
          cleanup.key,
          identity.projectId,
          "delete",
        ))
    ) {
      return "conflict";
    }
  }

  return "match";
}

export async function prepareWorkspaceJournal(
  storage: WorkspaceStorageAdapter,
  journal: WorkspaceOperationJournalV1,
  options: WorkspaceJournalPreparationOptions,
): Promise<WorkspaceJournalPreparationResult> {
  const serialized = serializeWorkspaceJournal(journal);
  const canonical = serialized.ok ? serialized.serialized : null;
  if (canonical === null || !(await validateWorkspaceJournalDigests(journal)).ok) {
    return { ok: false, status: "failed", reason: "invalid-journal" };
  }
  const canonicalDigest = await digestOptionalStoredString(canonical);
  if (!canonicalDigest.ok || canonicalDigest.digest === null) {
    return { ok: false, status: "failed", reason: "storage-error" };
  }

  const existingJournal = readExact(storage, WORKSPACE_OPERATION_KEY);
  if (!existingJournal.ok) {
    return { ok: false, status: "failed", reason: "storage-error" };
  }
  if (existingJournal.value !== null) {
    return { ok: false, status: "quarantine", reason: "third-value-journal" };
  }
  const plannedTargets = await validatePlannedTargetRecords(
    storage,
    journal,
    options.targetRecords,
  );
  if (plannedTargets !== "match") {
    return {
      ok: false,
      status: "failed",
      reason: plannedTargets === "storage-error" ? "storage-error" : "invalid-target-record",
    };
  }
  if (options.releaseReserve) {
    const releaseDecision = reserveReleaseDecision(storage, journal, options.targetRecords);
    if (releaseDecision !== "allowed") {
      return {
        ok: false,
        status: "failed",
        reason: releaseDecision === "storage-error" ? "storage-error" : "reserve-policy",
      };
    }
  }

  const baselines = await journalPreparationBaselinesMatch(storage, journal);
  if (baselines !== "match") {
    return {
      ok: false,
      status: baselines === "storage-error" ? "failed" : "quarantine",
      reason: baselines === "storage-error" ? "storage-error" : "baseline-conflict",
    };
  }

  const reserve = readExact(storage, WORKSPACE_RESERVE_KEY);
  if (!reserve.ok) return { ok: false, status: "failed", reason: "storage-error" };
  if (classifyWorkspaceReserve(reserve.value) !== "valid") {
    return { ok: false, status: "degraded", reason: "invalid-reserve" };
  }

  if (options.releaseReserve) {
    const removed = removeWorkspaceReserve(storage);
    if (!removed.ok) {
      const observedReserve = readExact(storage, WORKSPACE_RESERVE_KEY);
      if (!observedReserve.ok) {
        return { ok: false, status: "degraded", reason: "storage-error" };
      }
      if (observedReserve.value === CANONICAL_WORKSPACE_RESERVE) {
        return { ok: false, status: "failed", reason: removed.reason };
      }
      if (observedReserve.value !== null) {
        return { ok: false, status: "degraded", reason: "invalid-reserve" };
      }
      const recreated = recreateWorkspaceReserve(storage, CANONICAL_WORKSPACE_RESERVE);
      return recreated.ok
        ? { ok: false, status: "failed", reason: removed.reason }
        : { ok: false, status: "degraded", reason: recreated.reason };
    }
  }

  const written = await writeWorkspaceJournalPhase(storage, canonical, {
    expectedBeforeDigest: null,
    targetDigest: canonicalDigest.digest,
  });
  if (written.ok) {
    return { ok: true, status: "prepared", serializedJournal: canonical };
  }

  const observedJournal = readExact(storage, WORKSPACE_OPERATION_KEY);
  if (!observedJournal.ok) {
    return { ok: false, status: "quarantine", reason: "storage-error" };
  }
  if (observedJournal.value === canonical) {
    return { ok: true, status: "prepared", serializedJournal: canonical };
  }
  if (observedJournal.value !== null) {
    return { ok: false, status: "quarantine", reason: "third-value-journal" };
  }
  if (!options.releaseReserve) {
    return {
      ok: false,
      status: "failed",
      reason: written.reason === "readback-mismatch" ? "readback-mismatch" : "storage-error",
    };
  }

  const recreated = recreateWorkspaceReserve(storage, CANONICAL_WORKSPACE_RESERVE);
  if (recreated.ok) {
    return {
      ok: false,
      status: "failed",
      reason: written.reason === "readback-mismatch" ? "readback-mismatch" : "storage-error",
    };
  }
  return { ok: false, status: "degraded", reason: recreated.reason };
}

export function classifyPreJournalReserveFailure(
  storage: WorkspaceStorageAdapter,
): "healthy" | "recreate-reserve" | "degraded" | "journal-present" {
  const journal = readExact(storage, WORKSPACE_OPERATION_KEY);
  if (!journal.ok) return "degraded";
  if (journal.value !== null) return "journal-present";
  const reserve = readExact(storage, WORKSPACE_RESERVE_KEY);
  if (!reserve.ok) return "degraded";
  return classifyWorkspaceReserve(reserve.value) === "valid"
    ? "healthy"
    : "recreate-reserve";
}
