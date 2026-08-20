import type { PersistedProjectState } from "@/lib/ui-types";
import {
  digestOptionalStoredString,
  sha256StoredString,
} from "@/lib/workspace-storage/digest";
import {
  LEGACY_PROJECT_KEYS,
  parseWorkspaceProjectRecordKey,
  type SecureUuidSource,
  WORKSPACE_INDEX_KEY,
  WORKSPACE_LOCK_NAME,
  WORKSPACE_OPERATION_KEY,
  WORKSPACE_RESERVE_KEY,
} from "@/lib/workspace-storage/keys";
import {
  createWorkspaceProject,
  readWorkspaceAuthority,
  readWorkspacePreferenceBestEffort,
  restoreWorkspaceProjectAsNew,
  switchWorkspaceProject,
  workspaceIndexBaseline,
  writeWorkspacePreferenceBestEffort,
  type WorkspaceAuthoritySnapshot,
  type WorkspaceAuthorityReadFailureReason,
  type WorkspaceCoordinatorMutationFailureReason,
  type WorkspaceCreateProjectResult,
  type WorkspaceExclusiveLockRunner,
  type WorkspaceSwitchResult,
} from "@/lib/workspace-storage/coordinator";
import {
  WorkspacePendingSaveManager,
  type WorkspaceMembershipChangeFreezeResult,
  type WorkspaceMembershipChangeLease,
  type WorkspaceMembershipChangeRebuildResult,
  type WorkspacePendingSaveFlushResult,
  type WorkspacePendingSaveQueueResult,
} from "@/lib/workspace-storage/coordinator-pending";
import {
  parseWorkspaceIndex,
  parseWorkspaceJournal,
  parseWorkspaceProjectRecord,
  validateWorkspaceJournalDigests,
  workspaceProjectRecordMatchesKey,
} from "@/lib/workspace-storage/protocol";
import {
  classifyWorkspaceRecovery,
  reconstructWorkspaceLegacyResolutionTargetRecord,
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
import type { WorkspaceOperationKind } from "@/lib/workspace-storage/types";
import {
  openOrMigrateWorkspace,
  type WorkspaceMigrationFailureReason,
  type WorkspaceMigrationOrigin,
  type WorkspaceMigrationRequest,
} from "@/lib/workspace-storage/workspace-migration";

export type WorkspaceRuntimeBootstrapResult =
  | {
      ok: true;
      controller: WorkspaceRuntimeController;
      origin: WorkspaceRuntimeOrigin;
      storageProtection: "healthy" | "degraded";
    }
  | { ok: false; reason: WorkspaceMigrationFailureReason };

export type WorkspaceRuntimeOrigin =
  | WorkspaceMigrationOrigin
  | "recovered-create"
  | "recovered-restore";

export type WorkspaceCreationRecoveryResult =
  | {
      ok: true;
      snapshot: WorkspaceAuthoritySnapshot;
      storageProtection: "healthy" | "degraded";
      origin: "recovered-create" | "recovered-restore";
      disposition: "cancelled" | "committed";
    }
  | { ok: false; reason: WorkspaceMigrationFailureReason };

export type WorkspaceRuntimeSwitchResult =
  | {
      ok: true;
      selectedProjectId: string;
      preferenceStored: boolean;
    }
  | {
      ok: false;
      reason: Extract<WorkspaceSwitchResult, { ok: false }> ["reason"];
      selectedProjectId: string | null;
    };

export type WorkspaceRuntimeMembershipResult =
  | {
      ok: true;
      projectId: string;
      snapshot: WorkspaceAuthoritySnapshot;
      preferenceStored: boolean;
    }
  | {
      ok: false;
      reason:
        | WorkspaceCoordinatorMutationFailureReason
        | "membership-change-already-frozen"
        | "manager-rebuild-failed";
    };

interface ExactCreationRecoveryRawState {
  journal: string;
  index: string | null;
  reserve: string | null;
  legacy: Readonly<Record<keyof typeof LEGACY_PROJECT_KEYS, string | null>>;
  projects: readonly (readonly [key: string, raw: string])[];
}

function creationRecoveryKind(
  kind: WorkspaceOperationKind,
): kind is "create-project" | "restore-as-new" {
  return kind === "create-project" || kind === "restore-as-new";
}

function captureCreationRecoveryRawState(
  storage: WorkspaceStorageAdapter,
  journal: string,
): ExactCreationRecoveryRawState | null {
  try {
    const projects = storage
      .keys()
      .filter((key) => parseWorkspaceProjectRecordKey(key) !== null)
      .sort()
      .map((key) => {
        const raw = storage.getItem(key);
        if (raw === null) throw new Error("Project key disappeared");
        return [key, raw] as const;
      });
    return {
      journal,
      index: storage.getItem(WORKSPACE_INDEX_KEY),
      reserve: storage.getItem(WORKSPACE_RESERVE_KEY),
      legacy: {
        record: storage.getItem(LEGACY_PROJECT_KEYS.record),
        v3: storage.getItem(LEGACY_PROJECT_KEYS.v3),
        v2: storage.getItem(LEGACY_PROJECT_KEYS.v2),
        v1: storage.getItem(LEGACY_PROJECT_KEYS.v1),
      },
      projects,
    };
  } catch {
    return null;
  }
}

function creationRecoveryRawStateMatches(
  storage: WorkspaceStorageAdapter,
  expected: ExactCreationRecoveryRawState,
): boolean {
  try {
    const observed = captureCreationRecoveryRawState(storage, expected.journal);
    return (
      observed !== null &&
      storage.getItem(WORKSPACE_OPERATION_KEY) === expected.journal &&
      JSON.stringify(observed) === JSON.stringify(expected)
    );
  } catch {
    return false;
  }
}

function immutableCreationRecoveryStorage(
  snapshot: ExactCreationRecoveryRawState,
): WorkspaceStorageAdapter {
  const values = new Map<string, string>();
  values.set(WORKSPACE_OPERATION_KEY, snapshot.journal);
  if (snapshot.index !== null) values.set(WORKSPACE_INDEX_KEY, snapshot.index);
  if (snapshot.reserve !== null) {
    values.set(WORKSPACE_RESERVE_KEY, snapshot.reserve);
  }
  for (const name of Object.keys(LEGACY_PROJECT_KEYS) as Array<
    keyof typeof LEGACY_PROJECT_KEYS
  >) {
    const raw = snapshot.legacy[name];
    if (raw !== null) values.set(LEGACY_PROJECT_KEYS[name], raw);
  }
  for (const [key, raw] of snapshot.projects) values.set(key, raw);
  return {
    getItem: (key) => values.get(key) ?? null,
    keys: () => [...values.keys()].sort(),
    setItem: () => {
      throw new Error("Immutable recovery snapshot");
    },
    removeItem: () => {
      throw new Error("Immutable recovery snapshot");
    },
  };
}

async function classifyExactCreationRecoveryState(
  snapshot: ExactCreationRecoveryRawState,
): Promise<Awaited<ReturnType<typeof classifyWorkspaceRecovery>>> {
  return classifyWorkspaceRecovery(
    immutableCreationRecoveryStorage(snapshot),
    snapshot.journal,
  );
}

function recoveryFailureFromAuthority(
  reason: WorkspaceAuthorityReadFailureReason,
): WorkspaceMigrationFailureReason {
  if (reason === "digest-unavailable") return "digest-unavailable";
  if (reason === "storage-error") return "storage-error";
  if (reason === "legacy-conflict") return "legacy-conflict";
  if (
    reason === "operation-recovery-required" ||
    reason === "invalid-operation-journal"
  ) {
    return "recovery-required";
  }
  return "invalid-workspace";
}

async function finishCreationRecovery(
  storage: WorkspaceStorageAdapter,
  kind: "create-project" | "restore-as-new",
  disposition: "cancelled" | "committed",
): Promise<WorkspaceCreationRecoveryResult> {
  const storageProtection = recreateWorkspaceReserve(
    storage,
    CANONICAL_WORKSPACE_RESERVE,
  ).ok
    ? "healthy"
    : "degraded";
  const authority = await readWorkspaceAuthority(storage);
  if (!authority.ok) {
    return { ok: false, reason: recoveryFailureFromAuthority(authority.reason) };
  }
  return {
    ok: true,
    snapshot: authority.snapshot,
    storageProtection,
    origin: kind === "create-project" ? "recovered-create" : "recovered-restore",
    disposition,
  };
}

function activeProjectIds(snapshot: WorkspaceAuthoritySnapshot): string[] {
  return snapshot.index.projects
    .filter((entry) => entry.kind === "active")
    .map((entry) => entry.projectId);
}

function selectedProjectState(
  snapshot: WorkspaceAuthoritySnapshot,
  projectId: string | null,
): PersistedProjectState | null {
  if (projectId === null) return null;
  const project = snapshot.projects.find(
    (candidate) => candidate.record.projectId === projectId,
  );
  return project?.record.value.kind === "project"
    ? project.record.value.state
    : null;
}

async function resumeWorkspaceCreationWithinLock(
  storage: WorkspaceStorageAdapter,
): Promise<WorkspaceCreationRecoveryResult> {
  const rawJournal = readExact(storage, WORKSPACE_OPERATION_KEY);
  if (!rawJournal.ok) return { ok: false, reason: "storage-error" };
  if (rawJournal.value === null) {
    return { ok: false, reason: "recovery-required" };
  }
  const parsedJournal = parseWorkspaceJournal(rawJournal.value);
  if (
    !parsedJournal.ok ||
    !creationRecoveryKind(parsedJournal.value.kind) ||
    parsedJournal.value.projectMutations.length !== 1 ||
    parsedJournal.value.cleanup.length !== 0
  ) {
    return { ok: false, reason: "recovery-required" };
  }
  const validated = await validateWorkspaceJournalDigests(parsedJournal.value);
  if (!validated.ok) {
    return {
      ok: false,
      reason:
        validated.reason === "digest-unavailable"
          ? "digest-unavailable"
          : "recovery-required",
    };
  }
  const mutation = parsedJournal.value.projectMutations[0];
  if (
    mutation.mode !== "create" ||
    mutation.sourceRecord !== null ||
    mutation.sourceCleanup !== null ||
    mutation.targetRecord.expectedBeforeDigest !== null
  ) {
    return { ok: false, reason: "recovery-required" };
  }
  const targetIdentity = parseWorkspaceProjectRecordKey(
    mutation.targetRecord.key,
  );
  if (
    targetIdentity === null ||
    targetIdentity.workspaceId !== parsedJournal.value.workspaceId ||
    targetIdentity.workspaceGeneration !== parsedJournal.value.targetGeneration ||
    targetIdentity.projectId !== mutation.projectId ||
    parsedJournal.value.sourceGeneration !== parsedJournal.value.targetGeneration
  ) {
    return { ok: false, reason: "recovery-required" };
  }

  const reserve = readExact(storage, WORKSPACE_RESERVE_KEY);
  if (!reserve.ok) return { ok: false, reason: "storage-error" };
  if (
    reserve.value !== CANONICAL_WORKSPACE_RESERVE &&
    !recreateWorkspaceReserve(storage, CANONICAL_WORKSPACE_RESERVE).ok
  ) {
    return { ok: false, reason: "reserve-degraded" };
  }

  let exactState = captureCreationRecoveryRawState(storage, rawJournal.value);
  if (exactState === null) return { ok: false, reason: "storage-error" };
  let recovery = await classifyExactCreationRecoveryState(exactState);
  if (recovery.status === "quarantine") {
    return { ok: false, reason: "recovery-required" };
  }
  const targetRaw =
    exactState.projects.find(([key]) => key === mutation.targetRecord.key)?.[1] ??
    null;
  const indexDigest = await digestOptionalStoredString(exactState.index);
  const targetDigest = await digestOptionalStoredString(targetRaw);
  if (!indexDigest.ok || !targetDigest.ok) {
    return { ok: false, reason: "digest-unavailable" };
  }
  const indexIsBase =
    indexDigest.digest === parsedJournal.value.baseIndex.expectedDigest;
  const indexIsTarget =
    exactState.index === parsedJournal.value.targetIndex.serializedValue &&
    indexDigest.digest === parsedJournal.value.targetIndex.targetDigest;
  const targetIsAbsent = targetRaw === null && targetDigest.digest === null;
  const targetIsExact =
    targetRaw !== null &&
    targetDigest.digest === mutation.targetRecord.targetDigest;
  if ((!indexIsBase && !indexIsTarget) || (!targetIsAbsent && !targetIsExact)) {
    return { ok: false, reason: "recovery-required" };
  }
  if (targetRaw !== null && targetIsExact) {
    const parsedTarget = parseWorkspaceProjectRecord(targetRaw);
    if (
      !parsedTarget.ok ||
      !workspaceProjectRecordMatchesKey(
        mutation.targetRecord.key,
        parsedTarget.value,
      ) ||
      parsedTarget.value.value.kind !== "project" ||
      parsedTarget.value.value.state.projectKind === "none" ||
      parsedTarget.value.revision !== 1
    ) {
      return { ok: false, reason: "recovery-required" };
    }
  }

  const rawJournalDigest = await sha256StoredString(rawJournal.value);
  if (!rawJournalDigest.ok) {
    return { ok: false, reason: "digest-unavailable" };
  }

  if (targetIsAbsent && parsedJournal.value.legacyResolution !== undefined) {
    if (!indexIsBase || recovery.status !== "cancel-or-roll-forward") {
      return { ok: false, reason: "recovery-required" };
    }
    const reconstructed =
      await reconstructWorkspaceLegacyResolutionTargetRecord(
        storage,
        parsedJournal.value,
      );
    if (!reconstructed.ok) {
      return {
        ok: false,
        reason:
          reconstructed.reason === "digest-unavailable"
            ? "digest-unavailable"
            : reconstructed.reason === "storage-error"
              ? "storage-error"
              : "recovery-required",
      };
    }
    const targetWriteState = exactState;
    const targetWritten = await writeWorkspaceProjectTarget(
      storage,
      mutation.targetRecord.key,
      reconstructed.serialized,
      {
        expectedBeforeDigest: null,
        targetDigest: mutation.targetRecord.targetDigest,
        commitStillAuthorized: () =>
          creationRecoveryRawStateMatches(storage, targetWriteState),
      },
    );
    if (!targetWritten.ok) {
      return { ok: false, reason: "commit-incomplete" };
    }
    exactState = captureCreationRecoveryRawState(storage, rawJournal.value);
    if (exactState === null) return { ok: false, reason: "storage-error" };
    recovery = await classifyExactCreationRecoveryState(exactState);
    if (recovery.status === "quarantine") {
      return { ok: false, reason: "recovery-required" };
    }
  } else if (targetIsAbsent) {
    if (!indexIsBase || recovery.status !== "cancel-or-roll-forward") {
      return { ok: false, reason: "recovery-required" };
    }
    const cancellationState = exactState;
    const cancelled = await removeWorkspaceJournal(storage, {
      expectedBeforeDigest: rawJournalDigest.digest,
      commitStillAuthorized: () =>
        creationRecoveryRawStateMatches(storage, cancellationState),
    });
    if (!cancelled.ok) return { ok: false, reason: "commit-incomplete" };
    return finishCreationRecovery(storage, parsedJournal.value.kind, "cancelled");
  }

  if (indexIsBase) {
    const indexTarget = parseWorkspaceIndex(
      parsedJournal.value.targetIndex.serializedValue,
    );
    if (!indexTarget.ok) return { ok: false, reason: "recovery-required" };
    const indexCommitState = exactState;
    const written = await writeWorkspaceIndexTarget(
      storage,
      parsedJournal.value.targetIndex.serializedValue,
      {
        expectedBeforeDigest: parsedJournal.value.baseIndex.expectedDigest,
        targetDigest: parsedJournal.value.targetIndex.targetDigest,
        commitStillAuthorized: () =>
          creationRecoveryRawStateMatches(storage, indexCommitState),
      },
    );
    if (!written.ok) return { ok: false, reason: "commit-incomplete" };
    exactState = captureCreationRecoveryRawState(storage, rawJournal.value);
    if (exactState === null) return { ok: false, reason: "storage-error" };
    recovery = await classifyExactCreationRecoveryState(exactState);
    if (recovery.status !== "complete") {
      return { ok: false, reason: "commit-incomplete" };
    }
  } else if (recovery.status !== "complete") {
    return { ok: false, reason: "recovery-required" };
  }

  const journalRemovalState = exactState;
  const removed = await removeWorkspaceJournal(storage, {
    expectedBeforeDigest: rawJournalDigest.digest,
    commitStillAuthorized: () =>
      creationRecoveryRawStateMatches(storage, journalRemovalState),
  });
  if (!removed.ok) return { ok: false, reason: "commit-incomplete" };
  return finishCreationRecovery(storage, parsedJournal.value.kind, "committed");
}

/**
 * Resumes only create-project and restore-as-new journals. Ordinary journals
 * still cancel when the target record is absent. A marked legacy-drift
 * resolution instead reconstructs that target from the still-exact legacy
 * source; no project payload is stored in the journal.
 */
export async function resumeWorkspaceCreationOperation(
  storage: WorkspaceStorageAdapter,
  locks: WorkspaceExclusiveLockRunner | null,
): Promise<WorkspaceCreationRecoveryResult> {
  if (!locks) return { ok: false, reason: "lock-unavailable" };
  try {
    return await locks.runExclusive(WORKSPACE_LOCK_NAME, () =>
      resumeWorkspaceCreationWithinLock(storage),
    );
  } catch {
    return { ok: false, reason: "lock-failed" };
  }
}

/**
 * Mutable current-tab coordination only. Authority remains in the strict
 * storage snapshots returned by the coordinator; this controller never turns
 * selection or best-effort preference into persistence authority.
 */
export class WorkspaceRuntimeController {
  private authority: WorkspaceAuthoritySnapshot;
  private selectedId: string | null;
  private readonly pendingSaves: WorkspacePendingSaveManager;

  constructor(
    private readonly storage: WorkspaceStorageAdapter,
    private readonly locks: WorkspaceExclusiveLockRunner,
    snapshot: WorkspaceAuthoritySnapshot,
    selectedProjectId: string | null,
  ) {
    this.authority = snapshot;
    this.selectedId = activeProjectIds(snapshot).includes(selectedProjectId ?? "")
      ? selectedProjectId
      : null;
    this.pendingSaves = new WorkspacePendingSaveManager(snapshot);
  }

  authoritySnapshot(): WorkspaceAuthoritySnapshot {
    return this.authority;
  }

  selectedProjectId(): string | null {
    return this.selectedId;
  }

  selectedState(): PersistedProjectState | null {
    return selectedProjectState(this.authority, this.selectedId);
  }

  pendingProjectIds(): string[] {
    return this.pendingSaves.pendingProjectIds();
  }

  queueProjectSave(
    projectId: string,
    state: PersistedProjectState,
  ): WorkspacePendingSaveQueueResult {
    return this.pendingSaves.queue(projectId, state);
  }

  async flushProject(
    projectId: string,
  ): Promise<WorkspacePendingSaveFlushResult> {
    const result = await this.pendingSaves.flushProject(
      this.storage,
      this.locks,
      projectId,
    );
    if (result.ok) this.authority = result.snapshot;
    return result;
  }

  private async addProject(
    kind: "create-project" | "restore-as-new",
    state: PersistedProjectState,
    uuidSource?: SecureUuidSource | null,
  ): Promise<WorkspaceRuntimeMembershipResult> {
    const frozen = this.pendingSaves.freezeForMembershipChange();
    if (!frozen.ok) {
      return {
        ok: false,
        reason:
          frozen.reason === "token-exhausted"
            ? "invalid-request"
            : frozen.reason === "already-frozen"
              ? "membership-change-already-frozen"
              : "pending-save",
      };
    }
    const lease = frozen.lease;
    const request = {
      baseline: workspaceIndexBaseline(this.authority),
      intentStillCurrent: () =>
        this.pendingSaves.membershipChangeLeaseIsActive(lease),
      pendingSavesDrained: () =>
        this.pendingSaves.membershipChangeLeaseIsActive(lease),
      uuidSource,
    };
    let result: WorkspaceCreateProjectResult;
    if (kind === "create-project") {
      result = await createWorkspaceProject(this.storage, this.locks, {
        ...request,
        state,
      });
    } else {
      result = await restoreWorkspaceProjectAsNew(this.storage, this.locks, {
        ...request,
        backup: { state },
      });
    }
    if (!result.ok) {
      this.pendingSaves.cancelMembershipChange(lease);
      return result;
    }
    const rebuilt = this.pendingSaves.rebuildAfterMembershipChange(
      lease,
      result.snapshot,
    );
    if (!rebuilt.ok) {
      this.pendingSaves.cancelMembershipChange(lease);
      return { ok: false, reason: "manager-rebuild-failed" };
    }
    this.authority = result.snapshot;
    this.selectedId = result.projectId;
    return {
      ok: true,
      projectId: result.projectId,
      snapshot: result.snapshot,
      preferenceStored: writeWorkspacePreferenceBestEffort(
        this.storage,
        result.snapshot.index,
        result.projectId,
      ),
    };
  }

  createProject(
    state: PersistedProjectState,
    uuidSource?: SecureUuidSource | null,
  ): Promise<WorkspaceRuntimeMembershipResult> {
    return this.addProject("create-project", state, uuidSource);
  }

  restoreAsNew(
    state: PersistedProjectState,
    uuidSource?: SecureUuidSource | null,
  ): Promise<WorkspaceRuntimeMembershipResult> {
    return this.addProject("restore-as-new", state, uuidSource);
  }

  switchProject(targetProjectId: string): WorkspaceRuntimeSwitchResult {
    const switched = switchWorkspaceProject(
      this.authority,
      {
        selectedProjectId: this.selectedId,
        pendingProjectIds: this.pendingSaves.pendingProjectIds(),
      },
      targetProjectId,
    );
    if (!switched.ok) {
      return {
        ok: false,
        reason: switched.reason,
        selectedProjectId: this.selectedId,
      };
    }

    // ADR ordering: current-tab selection changes before the preference write.
    this.selectedId = switched.selection.selectedProjectId;
    return {
      ok: true,
      selectedProjectId: targetProjectId,
      preferenceStored: writeWorkspacePreferenceBestEffort(
        this.storage,
        this.authority.index,
        targetProjectId,
      ),
    };
  }

  freezeForMembershipChange(): WorkspaceMembershipChangeFreezeResult {
    return this.pendingSaves.freezeForMembershipChange();
  }

  membershipChangeLeaseIsActive(
    lease: WorkspaceMembershipChangeLease,
  ): boolean {
    return this.pendingSaves.membershipChangeLeaseIsActive(lease);
  }

  cancelMembershipChange(lease: WorkspaceMembershipChangeLease): boolean {
    return this.pendingSaves.cancelMembershipChange(lease);
  }

  adoptMembershipSnapshot(
    lease: WorkspaceMembershipChangeLease,
    snapshot: WorkspaceAuthoritySnapshot,
  ): WorkspaceMembershipChangeRebuildResult {
    const rebuilt = this.pendingSaves.rebuildAfterMembershipChange(
      lease,
      snapshot,
    );
    if (!rebuilt.ok) return rebuilt;
    this.authority = snapshot;
    if (!activeProjectIds(snapshot).includes(this.selectedId ?? "")) {
      this.selectedId = readWorkspacePreferenceBestEffort(
        this.storage,
        snapshot.index,
      );
      if (!activeProjectIds(snapshot).includes(this.selectedId ?? "")) {
        this.selectedId = activeProjectIds(snapshot)[0] ?? null;
      }
    }
    return rebuilt;
  }
}

export async function bootstrapWorkspaceRuntime(
  storage: WorkspaceStorageAdapter,
  locks: WorkspaceExclusiveLockRunner | null,
  request: WorkspaceMigrationRequest = {},
): Promise<WorkspaceRuntimeBootstrapResult> {
  if (!locks) return { ok: false, reason: "lock-unavailable" };
  const durableJournal = readExact(storage, WORKSPACE_OPERATION_KEY);
  if (!durableJournal.ok) return { ok: false, reason: "storage-error" };
  let opened: WorkspaceMigrationResultForRuntime;
  if (durableJournal.value !== null) {
    const parsed = parseWorkspaceJournal(durableJournal.value);
    if (!parsed.ok) return { ok: false, reason: "recovery-required" };
    if (creationRecoveryKind(parsed.value.kind)) {
      opened = await resumeWorkspaceCreationOperation(storage, locks);
    } else if (parsed.value.kind === "migrate-single-project") {
      opened = await openOrMigrateWorkspace(storage, locks, request);
    } else {
      return { ok: false, reason: "recovery-required" };
    }
  } else {
    opened = await openOrMigrateWorkspace(storage, locks, request);
  }
  if (!opened.ok) return opened;
  const activeIds = activeProjectIds(opened.snapshot);
  const preferred = readWorkspacePreferenceBestEffort(
    storage,
    opened.snapshot.index,
  );
  const selectedProjectId =
    preferred !== null && activeIds.includes(preferred)
      ? preferred
      : (activeIds[0] ?? null);
  return {
    ok: true,
    controller: new WorkspaceRuntimeController(
      storage,
      locks,
      opened.snapshot,
      selectedProjectId,
    ),
    origin: opened.origin,
    storageProtection: opened.storageProtection,
  };
}

type WorkspaceMigrationResultForRuntime =
  | Awaited<ReturnType<typeof openOrMigrateWorkspace>>
  | WorkspaceCreationRecoveryResult;
