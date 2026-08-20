import type { PersistedProjectState } from "@/lib/ui-types";
import {
  digestOptionalStoredString,
  sha256StoredString,
} from "@/lib/workspace-storage/digest";
import {
  generateSecureWorkspaceUuid,
  LEGACY_PROJECT_KEYS,
  type SecureUuidSource,
  WORKSPACE_INDEX_KEY,
  WORKSPACE_LOCK_NAME,
  WORKSPACE_OPERATION_KEY,
  WORKSPACE_PREFERENCES_KEY,
  WORKSPACE_RESERVE_KEY,
  workspaceProjectRecordKey,
} from "@/lib/workspace-storage/keys";
import {
  generateWorkspaceProjectId,
  scanWorkspaceNamespace,
} from "@/lib/workspace-storage/namespace-scan";
import {
  parseWorkspaceIndex,
  parseWorkspaceJournal,
  parseWorkspacePreferences,
  parseWorkspaceProjectRecord,
  serializeWorkspaceIndex,
  serializeWorkspaceJournal,
  serializeWorkspacePreferences,
  serializeWorkspaceProjectRecord,
  validateWorkspaceJournalDigests,
  workspacePreferenceApplies,
  workspaceProjectRecordMatchesKey,
  WORKSPACE_RECORD_GROWTH_BLOCK,
} from "@/lib/workspace-storage/protocol";
import { prepareWorkspaceJournal } from "@/lib/workspace-storage/recovery";
import { classifyWorkspaceReserve } from "@/lib/workspace-storage/reserve";
import {
  readExact,
  removeWorkspaceJournal,
  writeExact,
  writeWorkspaceIndexTarget,
  writeWorkspaceProjectTarget,
  type WorkspaceStorageAdapter,
} from "@/lib/workspace-storage/storage-adapter";
import type {
  WorkspaceIndexV1,
  WorkspaceOperationJournalV1,
  WorkspaceProjectRecordV1,
} from "@/lib/workspace-storage/types";

export interface WorkspaceProjectSnapshot {
  key: string;
  raw: string;
  digest: string;
  record: WorkspaceProjectRecordV1;
}

export interface WorkspaceAuthoritySnapshot {
  index: WorkspaceIndexV1;
  indexRaw: string;
  indexDigest: string;
  projects: readonly WorkspaceProjectSnapshot[];
}

export type WorkspaceAuthorityReadFailureReason =
  | "missing-index"
  | "invalid-index"
  | "invalid-project-record"
  | "invalid-operation-journal"
  | "operation-recovery-required"
  | "legacy-conflict"
  | "concurrent-change"
  | "digest-unavailable"
  | "storage-error";

export type WorkspaceAuthorityReadResult =
  | { ok: true; snapshot: WorkspaceAuthoritySnapshot }
  | { ok: false; reason: WorkspaceAuthorityReadFailureReason };

export interface WorkspaceIndexBaseline {
  workspaceId: string;
  workspaceGeneration: number;
  revision: number;
  raw: string;
  digest: string;
}

export interface WorkspaceProjectBaseline {
  index: WorkspaceIndexBaseline;
  projectId: string;
  projectRevision: number;
  raw: string;
  digest: string;
}

export interface WorkspaceExclusiveLockRunner {
  runExclusive<T>(name: string, operation: () => Promise<T>): Promise<T>;
}

/**
 * Narrow browser adapter for the dormant coordinator. Callers must pass null
 * when Web Locks are unavailable; mutation APIs then fail closed.
 */
export class BrowserWorkspaceExclusiveLockRunner
  implements WorkspaceExclusiveLockRunner
{
  constructor(private readonly locks: LockManager) {}

  runExclusive<T>(name: string, operation: () => Promise<T>): Promise<T> {
    return this.locks.request(name, { mode: "exclusive" }, async (lock) => {
      if (lock === null) {
        throw new Error("The workspace Web Lock was not acquired");
      }
      return operation();
    });
  }
}

export function createBrowserWorkspaceLockRunner(
  locks: LockManager | null | undefined,
): WorkspaceExclusiveLockRunner | null {
  return locks ? new BrowserWorkspaceExclusiveLockRunner(locks) : null;
}

function projectSnapshot(
  snapshot: WorkspaceAuthoritySnapshot,
  projectId: string,
): WorkspaceProjectSnapshot | null {
  return (
    snapshot.projects.find((project) => project.record.projectId === projectId) ??
    null
  );
}

export function workspaceIndexBaseline(
  snapshot: WorkspaceAuthoritySnapshot,
): WorkspaceIndexBaseline {
  return {
    workspaceId: snapshot.index.workspaceId,
    workspaceGeneration: snapshot.index.workspaceGeneration,
    revision: snapshot.index.revision,
    raw: snapshot.indexRaw,
    digest: snapshot.indexDigest,
  };
}

export function workspaceProjectBaseline(
  snapshot: WorkspaceAuthoritySnapshot,
  projectId: string,
): WorkspaceProjectBaseline | null {
  const project = projectSnapshot(snapshot, projectId);
  if (!project || project.record.value.kind !== "project") return null;
  return {
    index: workspaceIndexBaseline(snapshot),
    projectId,
    projectRevision: project.record.revision,
    raw: project.raw,
    digest: project.digest,
  };
}

async function digestRaw(
  raw: string,
): Promise<{ ok: true; digest: string } | { ok: false }> {
  const digest = await sha256StoredString(raw);
  return digest.ok ? { ok: true, digest: digest.digest } : { ok: false };
}

async function validateLegacyFingerprints(
  storage: WorkspaceStorageAdapter,
  index: WorkspaceIndexV1,
): Promise<"match" | "conflict" | "digest-unavailable" | "storage-error"> {
  for (const name of ["record", "v3", "v2", "v1"] as const) {
    const read = readExact(storage, LEGACY_PROJECT_KEYS[name]);
    if (!read.ok) return "storage-error";
    const digest = await digestOptionalStoredString(read.value);
    if (!digest.ok) return "digest-unavailable";
    if (digest.digest !== index.legacyFingerprints[name]) return "conflict";
  }
  return "match";
}

/**
 * Reads a strict display/baseline snapshot. It never selects a namespace-scan
 * candidate. A valid journal is returned as recovery-required and an invalid
 * journal is quarantined. Because this display read is intentionally unlocked,
 * every mutation invokes it again after acquiring the global lock and compares
 * the caller's exact baseline.
 */
export async function readWorkspaceAuthority(
  storage: WorkspaceStorageAdapter,
): Promise<WorkspaceAuthorityReadResult> {
  try {
    const journalAtStart = readExact(storage, WORKSPACE_OPERATION_KEY);
    if (!journalAtStart.ok) return { ok: false, reason: "storage-error" };
    if (journalAtStart.value !== null) {
      const parsedJournal = parseWorkspaceJournal(journalAtStart.value);
      if (!parsedJournal.ok) {
        return { ok: false, reason: "invalid-operation-journal" };
      }
      const journalDigests = await validateWorkspaceJournalDigests(
        parsedJournal.value,
      );
      return journalDigests.ok
        ? { ok: false, reason: "operation-recovery-required" }
        : {
            ok: false,
            reason:
              journalDigests.reason === "digest-unavailable"
                ? "digest-unavailable"
                : "invalid-operation-journal",
          };
    }

    const indexRead = readExact(storage, WORKSPACE_INDEX_KEY);
    if (!indexRead.ok) return { ok: false, reason: "storage-error" };
    if (indexRead.value === null) return { ok: false, reason: "missing-index" };
    const parsedIndex = parseWorkspaceIndex(indexRead.value);
    if (!parsedIndex.ok) return { ok: false, reason: "invalid-index" };
    const indexDigest = await digestRaw(indexRead.value);
    if (!indexDigest.ok) return { ok: false, reason: "digest-unavailable" };

    const projects: WorkspaceProjectSnapshot[] = [];
    for (const entry of parsedIndex.value.projects) {
      const key = workspaceProjectRecordKey(
        parsedIndex.value.workspaceId,
        parsedIndex.value.workspaceGeneration,
        entry.projectId,
      );
      const read = readExact(storage, key);
      if (!read.ok) return { ok: false, reason: "storage-error" };
      if (read.value === null) {
        return { ok: false, reason: "invalid-project-record" };
      }
      const parsedRecord = parseWorkspaceProjectRecord(read.value);
      if (
        !parsedRecord.ok ||
        !workspaceProjectRecordMatchesKey(key, parsedRecord.value) ||
        (entry.kind === "active") !==
          (parsedRecord.value.value.kind === "project") ||
        (entry.kind === "active" &&
          parsedRecord.value.value.kind === "project" &&
          parsedRecord.value.value.state.projectKind === "none")
      ) {
        return { ok: false, reason: "invalid-project-record" };
      }
      const recordDigest = await digestRaw(read.value);
      if (!recordDigest.ok) {
        return { ok: false, reason: "digest-unavailable" };
      }
      projects.push({
        key,
        raw: read.value,
        digest: recordDigest.digest,
        record: parsedRecord.value,
      });
    }

    const legacy = await validateLegacyFingerprints(storage, parsedIndex.value);
    if (legacy !== "match") {
      return {
        ok: false,
        reason:
          legacy === "conflict"
            ? "legacy-conflict"
            : legacy === "digest-unavailable"
              ? "digest-unavailable"
              : "storage-error",
      };
    }

    // A cross-key create/delete cannot be accepted from a torn read. Project
    // content may still change after this snapshot, so every save separately
    // compares its exact project baseline while holding the lock.
    const journalAtEnd = readExact(storage, WORKSPACE_OPERATION_KEY);
    const indexAtEnd = readExact(storage, WORKSPACE_INDEX_KEY);
    if (!journalAtEnd.ok || !indexAtEnd.ok) {
      return { ok: false, reason: "storage-error" };
    }
    if (journalAtEnd.value !== null || indexAtEnd.value !== indexRead.value) {
      return { ok: false, reason: "concurrent-change" };
    }

    return {
      ok: true,
      snapshot: {
        index: parsedIndex.value,
        indexRaw: indexRead.value,
        indexDigest: indexDigest.digest,
        projects,
      },
    };
  } catch {
    return { ok: false, reason: "storage-error" };
  }
}

function bestEffortRemovePreference(
  storage: WorkspaceStorageAdapter,
  expectedRaw: string,
): void {
  try {
    if (storage.getItem(WORKSPACE_PREFERENCES_KEY) !== expectedRaw) return;
    storage.removeItem(WORKSPACE_PREFERENCES_KEY);
  } catch {
    // Preference cleanup is deliberately non-authoritative.
  }
}

export function readWorkspacePreferenceBestEffort(
  storage: WorkspaceStorageAdapter,
  index: WorkspaceIndexV1,
): string | null {
  try {
    const raw = storage.getItem(WORKSPACE_PREFERENCES_KEY);
    if (raw === null) return null;
    const parsed = parseWorkspacePreferences(raw);
    if (!parsed.ok || !workspacePreferenceApplies(parsed.value, index)) {
      bestEffortRemovePreference(storage, raw);
      return null;
    }
    return parsed.value.lastOpenedProjectId;
  } catch {
    return null;
  }
}

export function writeWorkspacePreferenceBestEffort(
  storage: WorkspaceStorageAdapter,
  index: WorkspaceIndexV1,
  projectId: string | null,
): boolean {
  try {
    const serialized = serializeWorkspacePreferences({
      formatVersion: 1,
      workspaceId: index.workspaceId,
      workspaceGeneration: index.workspaceGeneration,
      lastOpenedProjectId: projectId,
    });
    if (
      !serialized.ok ||
      !workspacePreferenceApplies(serialized.value, index)
    ) {
      return false;
    }
    return writeExact(
      storage,
      WORKSPACE_PREFERENCES_KEY,
      serialized.serialized,
    ).ok;
  } catch {
    return false;
  }
}

export interface WorkspaceTabSelection {
  selectedProjectId: string | null;
  pendingProjectIds: readonly string[];
}

export type WorkspaceSwitchResult =
  | {
      ok: true;
      selection: WorkspaceTabSelection;
    }
  | {
      ok: false;
      reason: "target-not-active" | "pending-save";
      selection: WorkspaceTabSelection;
    };

/**
 * Switching is current-tab state, not authority. The caller must first apply
 * the returned selection and only then separately call the best-effort
 * preference writer. Keeping those steps separate makes the ADR ordering
 * explicit and prevents preference failure from reversing UI state.
 */
export function switchWorkspaceProject(
  snapshot: WorkspaceAuthoritySnapshot,
  selection: WorkspaceTabSelection,
  targetProjectId: string,
): WorkspaceSwitchResult {
  const target = snapshot.index.projects.find(
    (entry) =>
      entry.projectId === targetProjectId && entry.kind === "active",
  );
  if (!target) {
    return { ok: false, reason: "target-not-active", selection };
  }
  if (
    selection.selectedProjectId !== targetProjectId &&
    selection.selectedProjectId !== null &&
    selection.pendingProjectIds.includes(selection.selectedProjectId)
  ) {
    return { ok: false, reason: "pending-save", selection };
  }

  const nextSelection: WorkspaceTabSelection = {
    selectedProjectId: targetProjectId,
    pendingProjectIds: [...selection.pendingProjectIds],
  };
  return { ok: true, selection: nextSelection };
}

export type WorkspaceCoordinatorMutationFailureReason =
  | "lock-unavailable"
  | "lock-failed"
  | "workspace-conflict"
  | "project-conflict"
  | "pending-save"
  | "intent-stale"
  | "workspace-not-active"
  | "growth-blocked-logical"
  | "growth-blocked-physical"
  | "id-unavailable-or-collided"
  | "invalid-state"
  | "invalid-request"
  | "reserve-degraded"
  | "recovery-required"
  | "legacy-conflict"
  | "digest-unavailable"
  | "storage-error"
  | "commit-incomplete";

export interface WorkspaceProjectSaveRequest {
  baseline: WorkspaceProjectBaseline;
  nextState: PersistedProjectState;
  intentStillCurrent: () => boolean;
}

export type WorkspaceProjectSaveResult =
  | {
      ok: true;
      snapshot: WorkspaceAuthoritySnapshot;
      project: WorkspaceProjectSnapshot;
      /** A newer save was queued while this exact revision was being written. */
      superseded: boolean;
    }
  | { ok: false; reason: WorkspaceCoordinatorMutationFailureReason };

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

function intentIsCurrent(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

function snapshotWithProject(
  authority: WorkspaceAuthoritySnapshot,
  project: WorkspaceProjectSnapshot,
): WorkspaceAuthoritySnapshot {
  return {
    ...authority,
    projects: authority.projects.map((current) =>
      current.record.projectId === project.record.projectId ? project : current,
    ),
  };
}

export async function saveWorkspaceProject(
  storage: WorkspaceStorageAdapter,
  locks: WorkspaceExclusiveLockRunner | null,
  request: WorkspaceProjectSaveRequest,
): Promise<WorkspaceProjectSaveResult> {
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
      const current = projectSnapshot(
        authority.snapshot,
        request.baseline.projectId,
      );
      if (
        !current ||
        current.record.value.kind !== "project" ||
        current.record.revision !== request.baseline.projectRevision ||
        current.raw !== request.baseline.raw ||
        current.digest !== request.baseline.digest
      ) {
        return { ok: false, reason: "project-conflict" };
      }
      if (current.record.revision >= Number.MAX_SAFE_INTEGER) {
        return { ok: false, reason: "invalid-request" };
      }
      if (request.nextState.projectKind === "none") {
        // Reset/delete is a destructive lifecycle operation in PR 3. A normal
        // content save must not turn an indexed assignment into a hidden
        // no-project value.
        return { ok: false, reason: "invalid-state" };
      }

      const serializedTarget = serializeWorkspaceProjectRecord({
        formatVersion: 1,
        workspaceId: authority.snapshot.index.workspaceId,
        workspaceGeneration: authority.snapshot.index.workspaceGeneration,
        projectId: current.record.projectId,
        revision: current.record.revision + 1,
        value: { kind: "project", state: request.nextState },
      });
      if (!serializedTarget.ok) return { ok: false, reason: "invalid-state" };
      const targetDigest = await digestRaw(serializedTarget.serialized);
      if (!targetDigest.ok) {
        return { ok: false, reason: "digest-unavailable" };
      }

      const reserve = readExact(storage, WORKSPACE_RESERVE_KEY);
      if (!reserve.ok) return { ok: false, reason: "storage-error" };
      if (
        classifyWorkspaceReserve(reserve.value) !== "valid" &&
        serializedTarget.serialized.length > current.raw.length
      ) {
        return { ok: false, reason: "reserve-degraded" };
      }
      if (!intentIsCurrent(request.intentStillCurrent)) {
        return { ok: false, reason: "intent-stale" };
      }

      const written = await writeWorkspaceProjectTarget(
        storage,
        current.key,
        serializedTarget.serialized,
        {
          expectedBeforeDigest: current.digest,
          targetDigest: targetDigest.digest,
        },
      );
      if (!written.ok) {
        return {
          ok: false,
          reason:
            written.reason === "baseline-mismatch"
              ? "project-conflict"
              : written.reason === "digest-unavailable"
                ? "digest-unavailable"
                : "storage-error",
        };
      }

      const project: WorkspaceProjectSnapshot = {
        key: current.key,
        raw: serializedTarget.serialized,
        digest: targetDigest.digest,
        record: serializedTarget.value,
      };
      return {
        ok: true,
        snapshot: snapshotWithProject(authority.snapshot, project),
        project,
        superseded: !intentIsCurrent(request.intentStillCurrent),
      };
    });
  } catch {
    return { ok: false, reason: "lock-failed" };
  }
}

export interface WorkspaceCreateProjectRequest {
  baseline: WorkspaceIndexBaseline;
  state: PersistedProjectState;
  intentStillCurrent: () => boolean;
  /** Must stay true through journal preparation; callers drain autosaves first. */
  pendingSavesDrained: () => boolean;
  uuidSource?: SecureUuidSource | null;
}

export interface WorkspaceRestoreAsNewRequest {
  baseline: WorkspaceIndexBaseline;
  backup: Readonly<{ state: PersistedProjectState }>;
  intentStillCurrent: () => boolean;
  pendingSavesDrained: () => boolean;
  uuidSource?: SecureUuidSource | null;
}

export type WorkspaceCreateProjectResult =
  | {
      ok: true;
      projectId: string;
      snapshot: WorkspaceAuthoritySnapshot;
      project: WorkspaceProjectSnapshot;
    }
  | { ok: false; reason: WorkspaceCoordinatorMutationFailureReason };

function preparationFailureReason(
  result: Exclude<
    Awaited<ReturnType<typeof prepareWorkspaceJournal>>,
    { ok: true }
  >,
): WorkspaceCoordinatorMutationFailureReason {
  if (result.reason === "invalid-reserve") return "reserve-degraded";
  if (
    result.reason === "baseline-conflict" ||
    result.reason === "third-value-journal"
  ) {
    return result.reason === "third-value-journal"
      ? "recovery-required"
      : "workspace-conflict";
  }
  if (
    result.reason === "invalid-journal" ||
    result.reason === "invalid-target-record" ||
    result.reason === "reserve-policy"
  ) {
    return "invalid-request";
  }
  return "storage-error";
}

function snapshotAfterCreate(
  authority: WorkspaceAuthoritySnapshot,
  index: WorkspaceIndexV1,
  indexRaw: string,
  indexDigest: string,
  project: WorkspaceProjectSnapshot,
): WorkspaceAuthoritySnapshot {
  const projects = [...authority.projects, project].sort((left, right) =>
    left.record.projectId < right.record.projectId
      ? -1
      : left.record.projectId > right.record.projectId
        ? 1
        : 0,
  );
  return { index, indexRaw, indexDigest, projects };
}

async function createWorkspaceProjectWithKind(
  kind: "create-project" | "restore-as-new",
  storage: WorkspaceStorageAdapter,
  locks: WorkspaceExclusiveLockRunner | null,
  request: WorkspaceCreateProjectRequest,
): Promise<WorkspaceCreateProjectResult> {
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
      if (authority.snapshot.index.status !== "active") {
        return { ok: false, reason: "workspace-not-active" };
      }
      if (request.state.projectKind === "none") {
        return { ok: false, reason: "invalid-state" };
      }
      if (!intentIsCurrent(request.pendingSavesDrained)) {
        return { ok: false, reason: "pending-save" };
      }
      if (
        authority.snapshot.index.revision >= Number.MAX_SAFE_INTEGER ||
        authority.snapshot.index.projects.length >= WORKSPACE_RECORD_GROWTH_BLOCK
      ) {
        return {
          ok: false,
          reason:
            authority.snapshot.index.projects.length >=
            WORKSPACE_RECORD_GROWTH_BLOCK
              ? "growth-blocked-logical"
              : "invalid-request",
        };
      }

      // These scans occur after lock acquisition. A caller's pre-lock count or
      // project ID can never authorize growth.
      const namespace = scanWorkspaceNamespace(storage);
      if (!namespace.ok) return { ok: false, reason: "storage-error" };
      if (namespace.result.journalState !== "absent") {
        return { ok: false, reason: "recovery-required" };
      }
      if (namespace.result.growthBlocked) {
        return { ok: false, reason: "growth-blocked-physical" };
      }
      const generated = await generateWorkspaceProjectId(
        storage,
        request.uuidSource,
      );
      if (!generated.ok) {
        return {
          ok: false,
          reason:
            generated.reason === "uuid-unavailable-or-collided"
              ? "id-unavailable-or-collided"
              : generated.reason === "digest-unavailable"
                ? "digest-unavailable"
                : generated.reason === "invalid-journal"
                  ? "recovery-required"
                  : generated.reason === "storage-error"
                    ? "storage-error"
                    : "workspace-conflict",
        };
      }
      const operationId = generateSecureWorkspaceUuid(request.uuidSource);
      if (operationId === null) {
        return { ok: false, reason: "id-unavailable-or-collided" };
      }

      const projectKey = workspaceProjectRecordKey(
        authority.snapshot.index.workspaceId,
        authority.snapshot.index.workspaceGeneration,
        generated.projectId,
      );
      const serializedProject = serializeWorkspaceProjectRecord({
        formatVersion: 1,
        workspaceId: authority.snapshot.index.workspaceId,
        workspaceGeneration: authority.snapshot.index.workspaceGeneration,
        projectId: generated.projectId,
        revision: 1,
        value: { kind: "project", state: request.state },
      });
      if (!serializedProject.ok) {
        return { ok: false, reason: "invalid-state" };
      }
      const projectDigest = await digestRaw(serializedProject.serialized);
      if (!projectDigest.ok) {
        return { ok: false, reason: "digest-unavailable" };
      }

      const serializedIndex = serializeWorkspaceIndex({
        ...authority.snapshot.index,
        revision: authority.snapshot.index.revision + 1,
        projects: [
          ...authority.snapshot.index.projects,
          { projectId: generated.projectId, kind: "active" as const },
        ],
      });
      if (!serializedIndex.ok) {
        return { ok: false, reason: "invalid-request" };
      }
      const indexDigest = await digestRaw(serializedIndex.serialized);
      if (!indexDigest.ok) {
        return { ok: false, reason: "digest-unavailable" };
      }

      const journal: WorkspaceOperationJournalV1 = {
        formatVersion: 1,
        operationId,
        kind,
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
          serializedValue: serializedIndex.serialized,
          targetDigest: indexDigest.digest,
        },
        legacyExpectedDigests: {
          ...authority.snapshot.index.legacyFingerprints,
        },
        projectMutations: [
          {
            mode: "create",
            projectId: generated.projectId,
            sourceRecord: null,
            targetRecord: {
              key: projectKey,
              expectedBeforeDigest: null,
              targetDigest: projectDigest.digest,
            },
            sourceCleanup: null,
          },
        ],
        cleanup: [],
      };
      const serializedJournal = serializeWorkspaceJournal(journal);
      if (!serializedJournal.ok) {
        return { ok: false, reason: "invalid-request" };
      }
      const journalDigest = await digestRaw(serializedJournal.serialized);
      if (!journalDigest.ok) {
        return { ok: false, reason: "digest-unavailable" };
      }
      if (!intentIsCurrent(request.pendingSavesDrained)) {
        return { ok: false, reason: "pending-save" };
      }
      if (!intentIsCurrent(request.intentStillCurrent)) {
        return { ok: false, reason: "intent-stale" };
      }

      const prepared = await prepareWorkspaceJournal(storage, journal, {
        releaseReserve: false,
        targetRecords: { [projectKey]: serializedProject.serialized },
      });
      if (!prepared.ok) {
        return { ok: false, reason: preparationFailureReason(prepared) };
      }

      // Preparation validates through asynchronous digest reads before it
      // durably writes the journal. Revalidate the caller's intent after that
      // wait. No project/index target exists yet, so an exact journal removal
      // safely cancels a now-stale request; an uncertain removal is left for
      // recovery and never permits the stale target write.
      const cancellationReason = !intentIsCurrent(request.pendingSavesDrained)
        ? "pending-save"
        : !intentIsCurrent(request.intentStillCurrent)
          ? "intent-stale"
          : null;
      if (cancellationReason !== null) {
        const observedJournal = readExact(storage, WORKSPACE_OPERATION_KEY);
        const observedIndex = readExact(storage, WORKSPACE_INDEX_KEY);
        const observedProject = readExact(storage, projectKey);
        const legacy = await validateLegacyFingerprints(
          storage,
          authority.snapshot.index,
        );
        const stillCancelable =
          observedJournal.ok &&
          observedJournal.value === prepared.serializedJournal &&
          observedIndex.ok &&
          observedIndex.value === authority.snapshot.indexRaw &&
          observedProject.ok &&
          observedProject.value === null &&
          legacy === "match";
        const cancelled = stillCancelable
          ? await removeWorkspaceJournal(storage, {
              expectedBeforeDigest: journalDigest.digest,
            })
          : null;
        return cancelled?.ok
          ? { ok: false, reason: cancellationReason }
          : { ok: false, reason: "commit-incomplete" };
      }

      const projectWritten = await writeWorkspaceProjectTarget(
        storage,
        projectKey,
        serializedProject.serialized,
        {
          expectedBeforeDigest: null,
          targetDigest: projectDigest.digest,
        },
      );
      if (!projectWritten.ok) {
        return { ok: false, reason: "commit-incomplete" };
      }
      const indexWritten = await writeWorkspaceIndexTarget(
        storage,
        serializedIndex.serialized,
        {
          expectedBeforeDigest: authority.snapshot.indexDigest,
          targetDigest: indexDigest.digest,
        },
      );
      if (!indexWritten.ok) {
        return { ok: false, reason: "commit-incomplete" };
      }
      const journalRemoved = await removeWorkspaceJournal(storage, {
        expectedBeforeDigest: journalDigest.digest,
      });
      if (!journalRemoved.ok) {
        return { ok: false, reason: "commit-incomplete" };
      }

      const project: WorkspaceProjectSnapshot = {
        key: projectKey,
        raw: serializedProject.serialized,
        digest: projectDigest.digest,
        record: serializedProject.value,
      };
      return {
        ok: true,
        projectId: generated.projectId,
        project,
        snapshot: snapshotAfterCreate(
          authority.snapshot,
          serializedIndex.value,
          serializedIndex.serialized,
          indexDigest.digest,
          project,
        ),
      };
    });
  } catch {
    return { ok: false, reason: "lock-failed" };
  }
}

export function createWorkspaceProject(
  storage: WorkspaceStorageAdapter,
  locks: WorkspaceExclusiveLockRunner | null,
  request: WorkspaceCreateProjectRequest,
): Promise<WorkspaceCreateProjectResult> {
  return createWorkspaceProjectWithKind(
    "create-project",
    storage,
    locks,
    request,
  );
}

/**
 * Only the validated project state crosses this boundary. Backup timestamps,
 * workspace/project IDs, generations, revisions, journals and preferences are
 * deliberately ignored; this operation always allocates a fresh project ID.
 */
export function restoreWorkspaceProjectAsNew(
  storage: WorkspaceStorageAdapter,
  locks: WorkspaceExclusiveLockRunner | null,
  request: WorkspaceRestoreAsNewRequest,
): Promise<WorkspaceCreateProjectResult> {
  return createWorkspaceProjectWithKind(
    "restore-as-new",
    storage,
    locks,
    {
      baseline: request.baseline,
      state: request.backup.state,
      intentStillCurrent: request.intentStillCurrent,
      pendingSavesDrained: request.pendingSavesDrained,
      uuidSource: request.uuidSource,
    },
  );
}
