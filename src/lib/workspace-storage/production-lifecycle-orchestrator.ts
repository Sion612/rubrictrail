import type { PersistedProjectState } from "@/lib/ui-types";
import {
  workspaceIndexBaseline,
  workspaceProjectBaseline,
  type WorkspaceAuthoritySnapshot,
  type WorkspaceExclusiveLockRunner,
  type WorkspaceIndexBaseline,
  type WorkspaceProjectBaseline,
} from "@/lib/workspace-storage/coordinator";
import {
  cleanupWorkspaceLegacyData,
  deleteEntireWorkspace,
  deleteWorkspaceProject,
  purgeWorkspaceRecoveryData,
  replaceWorkspaceProject,
  resumeWorkspaceLifecycleOperation,
  type WorkspaceLifecycleFailureReason,
  type WorkspaceLifecycleResult,
  type WorkspaceRecoveryPrivacyPurgeBaseline,
} from "@/lib/workspace-storage/lifecycle";
import { WORKSPACE_OPERATION_KEY, type SecureUuidSource } from "@/lib/workspace-storage/keys";
import { parseWorkspaceJournal } from "@/lib/workspace-storage/protocol";
import {
  recoverWorkspaceIndex,
  resumeWorkspaceGenerationOperation,
  rotateWorkspaceGeneration,
  type WorkspaceGenerationMutationFailureReason,
  type WorkspaceGenerationMutationResult,
  type WorkspaceIndexRecoverySelection,
} from "@/lib/workspace-storage/rotation-recovery";
import {
  readExact,
  type WorkspaceStorageAdapter,
} from "@/lib/workspace-storage/storage-adapter";
import {
  isClearedWorkspaceLegacyRepurgeJournal,
  resumeClearedWorkspaceLegacyRepurge,
} from "@/lib/workspace-storage/production-legacy-drift";

/**
 * A current-tab save freeze is deliberately separate from the global Web Lock.
 * `tryFreeze` must synchronously stop new saves from being queued. A successful
 * lease may be returned only after pending and in-flight saves are drained.
 */
export interface WorkspacePendingSaveFreezeLease {
  isHeld(): boolean;
  pendingSavesDrained(): boolean;
  /** Backward-compatible pre-commit cancellation; never used after success. */
  release(): void;
  /** Rebuilds every project baseline from the committed snapshot, then unfreezes. */
  adoptSnapshot?(snapshot: WorkspaceAuthoritySnapshot): boolean;
  /** Cancels only an operation that has not entered an authoritative core API. */
  cancel?(): boolean;
}

export interface WorkspacePendingSaveFreezeController {
  tryFreeze(): WorkspacePendingSaveFreezeLease | null;
}

export interface WorkspaceLiveIntentState {
  snapshot: WorkspaceAuthoritySnapshot | null;
  workspaceIntentToken: string | null;
  selectedProjectId: string | null;
  selectedProjectIntentToken: string | null;
  recoveryIntentToken: string | null;
}

/** Every call must return current-tab state, never a cached dialog snapshot. */
export interface WorkspaceLiveIntentReader {
  read(): WorkspaceLiveIntentState;
}

export interface WorkspaceIndexIntentSnapshot {
  readonly baseline: Readonly<WorkspaceIndexBaseline>;
  readonly workspaceIntentToken: string;
}

export interface WorkspaceSelectedProjectIntentSnapshot {
  readonly workspace: WorkspaceIndexIntentSnapshot;
  readonly baseline: Readonly<WorkspaceProjectBaseline>;
  readonly projectIntentToken: string;
}

export interface WorkspaceRecoverySelectionIntentSnapshot {
  readonly recoveryIntentToken: string;
  readonly selection: Readonly<WorkspaceIndexRecoverySelection>;
}

export interface WorkspaceRecoveryPurgeIntentSnapshot {
  readonly recoveryIntentToken: string;
  readonly baseline: Readonly<WorkspaceRecoveryPrivacyPurgeBaseline>;
}

function freezeIndexBaseline(
  baseline: WorkspaceIndexBaseline,
): Readonly<WorkspaceIndexBaseline> {
  return Object.freeze({ ...baseline });
}

function freezeProjectBaseline(
  baseline: WorkspaceProjectBaseline,
): Readonly<WorkspaceProjectBaseline> {
  return Object.freeze({
    ...baseline,
    index: freezeIndexBaseline(baseline.index),
  });
}

export function captureWorkspaceIndexIntent(
  snapshot: WorkspaceAuthoritySnapshot,
  workspaceIntentToken: string,
): WorkspaceIndexIntentSnapshot | null {
  if (workspaceIntentToken.length === 0) return null;
  return Object.freeze({
    baseline: freezeIndexBaseline(workspaceIndexBaseline(snapshot)),
    workspaceIntentToken,
  });
}

export function captureWorkspaceSelectedProjectIntent(
  snapshot: WorkspaceAuthoritySnapshot,
  workspaceIntentToken: string,
  projectId: string,
  projectIntentToken: string,
): WorkspaceSelectedProjectIntentSnapshot | null {
  const workspace = captureWorkspaceIndexIntent(snapshot, workspaceIntentToken);
  const baseline = workspaceProjectBaseline(snapshot, projectId);
  if (!workspace || !baseline || projectIntentToken.length === 0) return null;
  return Object.freeze({
    workspace,
    baseline: freezeProjectBaseline(baseline),
    projectIntentToken,
  });
}

function freezeRecoverySelection(
  selection: WorkspaceIndexRecoverySelection,
): Readonly<WorkspaceIndexRecoverySelection> {
  return Object.freeze({
    ...selection,
    legacyExpectedDigests: Object.freeze({ ...selection.legacyExpectedDigests }),
    records: Object.freeze(
      selection.records.map((record) => Object.freeze({ ...record })),
    ),
  });
}

export function captureWorkspaceRecoverySelectionIntent(
  selection: WorkspaceIndexRecoverySelection,
  recoveryIntentToken: string,
): WorkspaceRecoverySelectionIntentSnapshot | null {
  if (recoveryIntentToken.length === 0) return null;
  return Object.freeze({
    recoveryIntentToken,
    selection: freezeRecoverySelection(selection),
  });
}

function freezeRecoveryPurgeBaseline(
  baseline: WorkspaceRecoveryPrivacyPurgeBaseline,
): Readonly<WorkspaceRecoveryPrivacyPurgeBaseline> {
  return Object.freeze({
    indexDigest: baseline.indexDigest,
    ownedProjectDigests: Object.freeze(
      baseline.ownedProjectDigests.map((entry) => Object.freeze({ ...entry })),
    ),
    legacyDigests: Object.freeze({ ...baseline.legacyDigests }),
  });
}

export function captureWorkspaceRecoveryPurgeIntent(
  baseline: WorkspaceRecoveryPrivacyPurgeBaseline,
  recoveryIntentToken: string,
): WorkspaceRecoveryPurgeIntentSnapshot | null {
  if (recoveryIntentToken.length === 0) return null;
  return Object.freeze({
    recoveryIntentToken,
    baseline: freezeRecoveryPurgeBaseline(baseline),
  });
}

export type WorkspaceProductionLifecycleCommand =
  | {
      kind: "replace-selected";
      intent: WorkspaceSelectedProjectIntentSnapshot;
      backup: Readonly<{ state: PersistedProjectState }>;
      uuidSource?: SecureUuidSource | null;
    }
  | {
      kind: "delete-selected";
      intent: WorkspaceSelectedProjectIntentSnapshot;
      uuidSource?: SecureUuidSource | null;
    }
  | {
      kind: "legacy-cleanup";
      intent: WorkspaceIndexIntentSnapshot;
      uuidSource?: SecureUuidSource | null;
    }
  | {
      kind: "delete-workspace";
      intent: WorkspaceIndexIntentSnapshot;
      uuidSource?: SecureUuidSource | null;
    }
  | {
      kind: "rotate-workspace-generation";
      intent: WorkspaceIndexIntentSnapshot;
      uuidSource?: SecureUuidSource | null;
    }
  | {
      kind: "recover-index";
      intent: WorkspaceRecoverySelectionIntentSnapshot;
      uuidSource?: SecureUuidSource | null;
    }
  | {
      kind: "delete-workspace-recovery";
      intent: WorkspaceRecoveryPurgeIntentSnapshot;
      uuidSource?: SecureUuidSource | null;
    };

export type WorkspaceProductionLifecycleFailureReason =
  | WorkspaceLifecycleFailureReason
  | WorkspaceGenerationMutationFailureReason
  | "invalid-intent-snapshot"
  | "pending-freeze-unavailable"
  | "orchestration-failed";

type WorkspaceProductionLifecycleCoreResult =
  | {
      ok: true;
      kind: WorkspaceProductionLifecycleCommand["kind"];
      snapshot: WorkspaceAuthoritySnapshot;
      changed: boolean;
      storageProtection: "healthy" | "degraded";
    }
  | { ok: false; reason: WorkspaceProductionLifecycleFailureReason };

export type WorkspaceProductionLifecycleResult =
  | (Extract<WorkspaceProductionLifecycleCoreResult, { ok: true }> & {
      pendingState: "synchronized" | "rebuild-required";
    })
  | (Extract<WorkspaceProductionLifecycleCoreResult, { ok: false }> & {
      pendingFreezeRetained: boolean;
    });

export interface WorkspaceProductionLifecycleDependencies {
  storage: WorkspaceStorageAdapter;
  locks: WorkspaceExclusiveLockRunner | null;
  intents: WorkspaceLiveIntentReader;
  pendingSaves: WorkspacePendingSaveFreezeController;
}

function sameIndexBaseline(
  snapshot: WorkspaceAuthoritySnapshot,
  baseline: Readonly<WorkspaceIndexBaseline>,
): boolean {
  return (
    snapshot.index.workspaceId === baseline.workspaceId &&
    snapshot.index.workspaceGeneration === baseline.workspaceGeneration &&
    snapshot.index.revision === baseline.revision &&
    snapshot.indexRaw === baseline.raw &&
    snapshot.indexDigest === baseline.digest
  );
}

function sameProjectBaseline(
  snapshot: WorkspaceAuthoritySnapshot,
  baseline: Readonly<WorkspaceProjectBaseline>,
): boolean {
  const current = workspaceProjectBaseline(snapshot, baseline.projectId);
  return (
    current !== null &&
    sameIndexBaseline(snapshot, baseline.index) &&
    current.projectRevision === baseline.projectRevision &&
    current.raw === baseline.raw &&
    current.digest === baseline.digest
  );
}

function safeReadIntent(
  reader: WorkspaceLiveIntentReader,
): WorkspaceLiveIntentState | null {
  try {
    return reader.read();
  } catch {
    return null;
  }
}

function workspaceIntentIsCurrent(
  reader: WorkspaceLiveIntentReader,
  intent: WorkspaceIndexIntentSnapshot,
): boolean {
  const live = safeReadIntent(reader);
  return (
    live !== null &&
    live.snapshot !== null &&
    live.workspaceIntentToken === intent.workspaceIntentToken &&
    sameIndexBaseline(live.snapshot, intent.baseline)
  );
}

function selectedIntentIsCurrent(
  reader: WorkspaceLiveIntentReader,
  intent: WorkspaceSelectedProjectIntentSnapshot,
): boolean {
  const live = safeReadIntent(reader);
  return (
    live !== null &&
    live.snapshot !== null &&
    live.workspaceIntentToken === intent.workspace.workspaceIntentToken &&
    live.selectedProjectId === intent.baseline.projectId &&
    live.selectedProjectIntentToken === intent.projectIntentToken &&
    sameProjectBaseline(live.snapshot, intent.baseline)
  );
}

function recoveryIntentIsCurrent(
  reader: WorkspaceLiveIntentReader,
  recoveryIntentToken: string,
): boolean {
  const live = safeReadIntent(reader);
  return live !== null && live.recoveryIntentToken === recoveryIntentToken;
}

function leaseIsDrained(lease: WorkspacePendingSaveFreezeLease): boolean {
  try {
    return lease.isHeld() && lease.pendingSavesDrained();
  } catch {
    return false;
  }
}

function leaseIsHeld(lease: WorkspacePendingSaveFreezeLease): boolean {
  try {
    return lease.isHeld();
  } catch {
    return true;
  }
}

function cancelUnstartedLease(
  lease: WorkspacePendingSaveFreezeLease,
): boolean {
  try {
    if (lease.cancel?.()) return false;
    if (!lease.cancel) {
      lease.release();
      return leaseIsHeld(lease);
    }
  } catch {
    // Fall through to the observable held state.
  }
  return leaseIsHeld(lease);
}

function adoptCommittedSnapshot(
  lease: WorkspacePendingSaveFreezeLease,
  snapshot: WorkspaceAuthoritySnapshot,
): "synchronized" | "rebuild-required" {
  try {
    return lease.adoptSnapshot?.(snapshot)
      ? "synchronized"
      : "rebuild-required";
  } catch {
    return "rebuild-required";
  }
}

function normalizeLifecycleResult(
  kind: WorkspaceProductionLifecycleCommand["kind"],
  result: WorkspaceLifecycleResult,
): WorkspaceProductionLifecycleCoreResult {
  return result.ok
    ? {
        ok: true,
        kind,
        snapshot: result.snapshot,
        changed: result.changed,
        storageProtection: result.storageProtection,
      }
    : result;
}

function normalizeGenerationResult(
  kind: WorkspaceProductionLifecycleCommand["kind"],
  result: WorkspaceGenerationMutationResult,
): WorkspaceProductionLifecycleCoreResult {
  return result.ok
    ? {
        ok: true,
        kind,
        snapshot: result.snapshot,
        changed: true,
        storageProtection:
          result.status === "committed-degraded" ? "degraded" : "healthy",
      }
    : result;
}

function commandIntentIsCurrent(
  reader: WorkspaceLiveIntentReader,
  command: WorkspaceProductionLifecycleCommand,
): boolean {
  if (command.kind === "replace-selected" || command.kind === "delete-selected") {
    return selectedIntentIsCurrent(reader, command.intent);
  }
  if (command.kind === "recover-index") {
    return recoveryIntentIsCurrent(
      reader,
      command.intent.recoveryIntentToken,
    );
  }
  if (command.kind === "delete-workspace-recovery") {
    return recoveryIntentIsCurrent(
      reader,
      command.intent.recoveryIntentToken,
    );
  }
  return workspaceIntentIsCurrent(reader, command.intent);
}

async function dispatchProductionLifecycleCommand(
  dependencies: WorkspaceProductionLifecycleDependencies,
  command: WorkspaceProductionLifecycleCommand,
  lease: WorkspacePendingSaveFreezeLease,
): Promise<WorkspaceProductionLifecycleCoreResult> {
  const pendingSavesDrained = (): boolean => leaseIsDrained(lease);
  const intentStillCurrent = (): boolean =>
    commandIntentIsCurrent(dependencies.intents, command);

  switch (command.kind) {
    case "replace-selected":
      return normalizeLifecycleResult(
        command.kind,
        await replaceWorkspaceProject(dependencies.storage, dependencies.locks, {
          baseline: command.intent.baseline,
          backup: command.backup,
          pendingSavesDrained,
          intentStillCurrent,
          uuidSource: command.uuidSource,
        }),
      );
    case "delete-selected":
      return normalizeLifecycleResult(
        command.kind,
        await deleteWorkspaceProject(dependencies.storage, dependencies.locks, {
          baseline: command.intent.baseline,
          pendingSavesDrained,
          intentStillCurrent,
          uuidSource: command.uuidSource,
        }),
      );
    case "legacy-cleanup":
      return normalizeLifecycleResult(
        command.kind,
        await cleanupWorkspaceLegacyData(dependencies.storage, dependencies.locks, {
          baseline: command.intent.baseline,
          pendingSavesDrained,
          intentStillCurrent,
          uuidSource: command.uuidSource,
        }),
      );
    case "delete-workspace":
      return normalizeLifecycleResult(
        command.kind,
        await deleteEntireWorkspace(dependencies.storage, dependencies.locks, {
          baseline: command.intent.baseline,
          pendingSavesDrained,
          intentStillCurrent,
          uuidSource: command.uuidSource,
        }),
      );
    case "rotate-workspace-generation":
      return normalizeGenerationResult(
        command.kind,
        await rotateWorkspaceGeneration(dependencies.storage, dependencies.locks, {
          baseline: command.intent.baseline,
          pendingSavesDrained,
          intentStillCurrent,
          uuidSource: command.uuidSource,
        }),
      );
    case "recover-index":
      return normalizeGenerationResult(
        command.kind,
        await recoverWorkspaceIndex(dependencies.storage, dependencies.locks, {
          selection: command.intent.selection,
          pendingSavesDrained,
          intentStillCurrent,
          uuidSource: command.uuidSource,
        }),
      );
    case "delete-workspace-recovery":
      return normalizeLifecycleResult(
        command.kind,
        await purgeWorkspaceRecoveryData(dependencies.storage, dependencies.locks, {
          baseline: command.intent.baseline,
          pendingSavesDrained,
          intentStillCurrent,
          uuidSource: command.uuidSource,
        }),
      );
  }
}

/**
 * Freezes this tab before handing off to a core API. Core APIs still acquire
 * the global Web Lock and repeat exact authority/digest checks. This adapter
 * never treats its in-memory snapshot as storage authority.
 */
export async function executeWorkspaceProductionLifecycleCommand(
  dependencies: WorkspaceProductionLifecycleDependencies,
  command: WorkspaceProductionLifecycleCommand,
): Promise<WorkspaceProductionLifecycleResult> {
  let lease: WorkspacePendingSaveFreezeLease | null;
  try {
    lease = dependencies.pendingSaves.tryFreeze();
  } catch {
    return {
      ok: false,
      reason: "pending-freeze-unavailable",
      pendingFreezeRetained: false,
    };
  }
  if (!lease) {
    return { ok: false, reason: "pending-save", pendingFreezeRetained: false };
  }

  try {
    if (!leaseIsDrained(lease)) {
      return {
        ok: false,
        reason: "pending-save",
        pendingFreezeRetained: cancelUnstartedLease(lease),
      };
    }
    if (!commandIntentIsCurrent(dependencies.intents, command)) {
      return {
        ok: false,
        reason: "intent-stale",
        pendingFreezeRetained: cancelUnstartedLease(lease),
      };
    }
    const result = await dispatchProductionLifecycleCommand(
      dependencies,
      command,
      lease,
    );
    return result.ok
      ? {
          ...result,
          pendingState: adoptCommittedSnapshot(lease, result.snapshot),
        }
      : { ...result, pendingFreezeRetained: leaseIsHeld(lease) };
  } catch {
    return {
      ok: false,
      reason: "orchestration-failed",
      pendingFreezeRetained: leaseIsHeld(lease),
    };
  }
}

export type WorkspaceProductionRecoveryResult =
  | WorkspaceProductionLifecycleResult
  | {
      ok: true;
      kind: "none";
      authority: "none";
      changed: false;
      pendingState: "rebuild-required";
    }
  | {
      ok: false;
      reason:
        | WorkspaceProductionLifecycleFailureReason
        | "unsupported-operation";
      pendingFreezeRetained: boolean;
    };

/**
 * Routes only journals whose payload-free resume implementation already exists.
 * Migration/create/restore journals remain untouched for their owning startup
 * orchestrator; this function never guesses a target record from UI payload.
 */
export async function resumeWorkspaceProductionLifecycle(
  dependencies: Omit<WorkspaceProductionLifecycleDependencies, "intents">,
): Promise<WorkspaceProductionRecoveryResult> {
  let lease: WorkspacePendingSaveFreezeLease | null;
  try {
    lease = dependencies.pendingSaves.tryFreeze();
  } catch {
    return {
      ok: false,
      reason: "pending-freeze-unavailable",
      pendingFreezeRetained: false,
    };
  }
  if (!lease) {
    return { ok: false, reason: "pending-save", pendingFreezeRetained: false };
  }

  try {
    if (!leaseIsDrained(lease)) {
      return {
        ok: false,
        reason: "pending-save",
        pendingFreezeRetained: cancelUnstartedLease(lease),
      };
    }
    const journal = readExact(dependencies.storage, WORKSPACE_OPERATION_KEY);
    if (!journal.ok) {
      return {
        ok: false,
        reason: "storage-error",
        pendingFreezeRetained: leaseIsHeld(lease),
      };
    }

    if (journal.value === null) {
      const result = await resumeWorkspaceLifecycleOperation(
        dependencies.storage,
        dependencies.locks,
      );
      const normalized = normalizeLifecycleResult("legacy-cleanup", result);
      return normalized.ok
        ? {
            ...normalized,
            pendingState: adoptCommittedSnapshot(lease, normalized.snapshot),
          }
        : { ...normalized, pendingFreezeRetained: leaseIsHeld(lease) };
    }

    const parsed = parseWorkspaceJournal(journal.value);
    if (!parsed.ok) {
      return {
        ok: false,
        reason: "recovery-required",
        pendingFreezeRetained: leaseIsHeld(lease),
      };
    }
    if (
      parsed.value.kind === "replace-project" ||
      parsed.value.kind === "delete-project" ||
      parsed.value.kind === "legacy-cleanup" ||
      parsed.value.kind === "delete-workspace"
    ) {
      const result = isClearedWorkspaceLegacyRepurgeJournal(parsed.value)
        ? await resumeClearedWorkspaceLegacyRepurge(
            dependencies.storage,
            dependencies.locks,
          )
        : await resumeWorkspaceLifecycleOperation(
            dependencies.storage,
            dependencies.locks,
          );
      const normalized = result.ok
        ? normalizeLifecycleResult(
            parsed.value.kind === "replace-project"
              ? "replace-selected"
              : parsed.value.kind === "delete-project"
                ? "delete-selected"
                : parsed.value.kind,
            result,
          )
        : result;
      return normalized.ok
        ? {
            ...normalized,
            pendingState: adoptCommittedSnapshot(lease, normalized.snapshot),
          }
        : { ...normalized, pendingFreezeRetained: leaseIsHeld(lease) };
    }
    if (
      parsed.value.kind === "rotate-workspace-generation" ||
      parsed.value.kind === "recover-index"
    ) {
      const result = await resumeWorkspaceGenerationOperation(
        dependencies.storage,
        dependencies.locks,
      );
      if (!result.ok) {
        return { ...result, pendingFreezeRetained: leaseIsHeld(lease) };
      }
      if ("authority" in result) {
        return {
          ok: true,
          kind: "none",
          authority: "none",
          changed: false,
          pendingState: "rebuild-required",
        };
      }
      return {
        ok: true,
        kind:
          parsed.value.kind === "recover-index"
            ? "recover-index"
            : "rotate-workspace-generation",
        snapshot: result.snapshot,
        changed:
          result.status === "committed" ||
          result.status === "committed-degraded",
        storageProtection:
          result.status === "committed-degraded" ? "degraded" : "healthy",
        pendingState: adoptCommittedSnapshot(lease, result.snapshot),
      };
    }
    return {
      ok: false,
      reason: "unsupported-operation",
      pendingFreezeRetained: cancelUnstartedLease(lease),
    };
  } catch {
    return {
      ok: false,
      reason: "orchestration-failed",
      pendingFreezeRetained: leaseIsHeld(lease),
    };
  }
}

export type WorkspaceLegacyDriftChoiceKind =
  | "import-as-new"
  | "replace-selected"
  | "accept-new-baseline"
  | "privacy-cleanup";

export interface WorkspaceLegacyDriftChoice {
  kind: WorkspaceLegacyDriftChoiceKind;
  available: boolean;
  unavailableReason:
    | "candidate-unavailable"
    | "selected-project-required"
    | "workspace-not-active"
    | null;
}

export interface WorkspaceLegacyDriftChoiceContext {
  /** True only for a strictly parsed, non-empty legacy project candidate. */
  projectCandidateAvailable: boolean;
  selectedProjectId: string | null;
  workspaceStatus?: "active" | "cleared";
}

/**
 * Produces explicit UI choices without adopting legacy bytes. Execution of
 * import/accept belongs to the migration-lineage module; privacy cleanup still
 * requires a fresh exact inspection and destructive confirmation.
 */
export function deriveWorkspaceLegacyDriftChoices(
  context: WorkspaceLegacyDriftChoiceContext,
): readonly WorkspaceLegacyDriftChoice[] {
  const workspaceActive = (context.workspaceStatus ?? "active") === "active";
  return Object.freeze([
    Object.freeze({
      kind: "import-as-new" as const,
      available: workspaceActive && context.projectCandidateAvailable,
      unavailableReason: !workspaceActive
        ? ("workspace-not-active" as const)
        : context.projectCandidateAvailable
          ? null
          : ("candidate-unavailable" as const),
    }),
    Object.freeze({
      kind: "replace-selected" as const,
      available:
        workspaceActive &&
        context.projectCandidateAvailable &&
        context.selectedProjectId !== null,
      unavailableReason: !workspaceActive
        ? ("workspace-not-active" as const)
        : !context.projectCandidateAvailable
        ? ("candidate-unavailable" as const)
        : context.selectedProjectId === null
          ? ("selected-project-required" as const)
          : null,
    }),
    Object.freeze({
      kind: "accept-new-baseline" as const,
      available: workspaceActive,
      unavailableReason: workspaceActive ? null : ("workspace-not-active" as const),
    }),
    Object.freeze({
      kind: "privacy-cleanup" as const,
      available: true,
      unavailableReason: null,
    }),
  ]);
}
