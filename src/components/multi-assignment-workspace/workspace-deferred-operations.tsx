"use client";

import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useLocalizedMessages } from "@/components/locale-provider";
import { deriveWorkspaceDashboardModel } from "@/components/multi-assignment-workspace/dashboard-model";
import { dashboardProjectsFromWorkspaceSnapshot } from "@/components/multi-assignment-workspace/workspace-read-model";
import {
  workspaceActivationEn,
  workspaceActivationZhCN,
} from "@/components/multi-assignment-workspace/workspace-activation-messages";
import { WorkspaceLifecyclePanel } from "@/components/multi-assignment-workspace/workspace-lifecycle-panel";
import { WorkspaceRecoveryProjectExports } from "@/components/multi-assignment-workspace/workspace-recovery-project-exports";
import type {
  WorkspaceLifecycleActionRequest,
  WorkspaceLifecycleActionResult,
  WorkspaceLifecycleProjectScope,
  WorkspaceLifecycleWorkspaceScope,
  WorkspaceRecoveryState,
  WorkspaceReplacementPreview,
  WorkspaceRotationScope,
  WorkspaceStorageProtection,
} from "@/components/multi-assignment-workspace/workspace-lifecycle-panel";
import type { PersistedProjectState } from "@/lib/ui-types";
import type { WorkspaceExclusiveLockRunner } from "@/lib/workspace-storage/coordinator";
import type { WorkspaceProductionLifecycleDependencies } from "@/lib/workspace-storage/production-lifecycle-orchestrator";
import type { WorkspaceLegacyDriftInspectionResult } from "@/lib/workspace-storage/production-legacy-drift";
import type { WorkspaceIndexRecoverySelection } from "@/lib/workspace-storage/rotation-recovery";
import type { WorkspaceStorageAdapter } from "@/lib/workspace-storage/storage-adapter";

import type { ReadyWorkspace } from "./workspace-activation-root";
import styles from "./workspace-activation-root.module.css";

type DeferredMode =
  | "management"
  | "recovery"
  | "read-only-recovery"
  | "legacy-active"
  | "legacy-recovery";
type ReadableLegacyDrift = Extract<WorkspaceLegacyDriftInspectionResult, { ok: true }>;

export interface WorkspaceDeferredOperationsProps {
  mode: DeferredMode;
  storage: WorkspaceStorageAdapter;
  locks: WorkspaceExclusiveLockRunner | null;
  ready: ReadyWorkspace | null;
  selectedProjectId: string | null;
  onApplyReady(next: ReadyWorkspace): void;
  onAuthorityProjectReplaced(projectId: string): void;
  onSelectedProjectChange(projectId: string | null): void;
  onLegacyResolved(): void;
  onNotice(notice: string | null): void;
  onReopen(): Promise<void>;
}

interface WorkspaceRecoveryCandidateSelection {
  candidateId: string;
  selection: WorkspaceIndexRecoverySelection;
}

interface WorkspaceManagementData {
  workspace: WorkspaceLifecycleWorkspaceScope | null;
  storageProtection: WorkspaceStorageProtection;
  legacyCleanup: { available: boolean; intentToken: string } | null;
  rotation: WorkspaceRotationScope | null;
  recovery: WorkspaceRecoveryState;
  recoverySelections: readonly WorkspaceRecoveryCandidateSelection[];
  recoveryPurgeBaseline: import("@/lib/workspace-storage/lifecycle").WorkspaceRecoveryPrivacyPurgeBaseline | null;
}

interface ReplacementSelection {
  state: PersistedProjectState;
  preview: WorkspaceReplacementPreview;
}

function todayDateOnly(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function selectedProjectDigest(
  ready: ReadyWorkspace | null,
  projectId: string | null,
): string | null {
  if (!ready || !projectId) return null;
  return ready.controller.authoritySnapshot().projects.find(
    (candidate) => candidate.record.projectId === projectId,
  )?.digest ?? null;
}

function downloadText(fileName: string, contents: string): void {
  const url = URL.createObjectURL(
    new Blob([contents], { type: "application/json;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function pendingFreezeAdapter(
  ready: ReadyWorkspace,
): WorkspaceProductionLifecycleDependencies["pendingSaves"] {
  return {
    tryFreeze() {
      const controller = ready.controller;
      const frozen = controller.freezeForMembershipChange();
      if (!frozen.ok) return null;
      const lease = frozen.lease;
      let held = true;
      const isHeld = () => held && controller.membershipChangeLeaseIsActive(lease);
      return {
        isHeld,
        pendingSavesDrained: isHeld,
        adoptSnapshot(snapshot) {
          if (!held) return false;
          const adopted = controller.adoptMembershipSnapshot(lease, snapshot);
          if (!adopted.ok) return false;
          held = false;
          return true;
        },
        cancel() {
          if (!held) return false;
          const cancelled = controller.cancelMembershipChange(lease);
          if (cancelled) held = false;
          return cancelled;
        },
        release() {
          if (!held) return;
          const cancelled = controller.cancelMembershipChange(lease);
          if (cancelled) held = false;
        },
      };
    },
  };
}

export function detachedPendingFreeze(): WorkspaceProductionLifecycleDependencies["pendingSaves"] {
  return {
    tryFreeze() {
      let held = true;
      return {
        isHeld: () => held,
        pendingSavesDrained: () => held,
        adoptSnapshot: () => {
          if (!held) return false;
          held = false;
          return true;
        },
        cancel: () => {
          if (!held) return false;
          held = false;
          return true;
        },
        release: () => { held = false; },
      };
    },
  };
}

export async function executeSelectedWorkspaceLifecycle(input: {
  kind: "replace-selected" | "delete-selected";
  backup?: PersistedProjectState;
  ready: ReadyWorkspace;
  selectedProjectId: string;
  storage: WorkspaceStorageAdapter;
  locks: WorkspaceExclusiveLockRunner;
  readReady(): ReadyWorkspace | null;
  readSelectedProjectId(): string | null;
}): Promise<
  | { ok: true; ready: ReadyWorkspace; selectedProjectId: string | null }
  | { ok: false }
> {
  const lifecycle = await import("@/lib/workspace-storage/production-lifecycle-orchestrator");
  const snapshot = input.ready.controller.authoritySnapshot();
  const intent = lifecycle.captureWorkspaceSelectedProjectIntent(
    snapshot,
    snapshot.indexDigest,
    input.selectedProjectId,
    selectedProjectDigest(input.ready, input.selectedProjectId) ?? "",
  );
  if (!intent) return { ok: false };
  const command = input.kind === "replace-selected"
    ? { kind: input.kind, intent, backup: { state: input.backup! } } as const
    : { kind: input.kind, intent } as const;
  const result = await lifecycle.executeWorkspaceProductionLifecycleCommand(
    {
      storage: input.storage,
      locks: input.locks,
      pendingSaves: pendingFreezeAdapter(input.ready),
      intents: {
        read: () => {
          const liveReady = input.readReady();
          const liveSelected = input.readSelectedProjectId();
          return {
            snapshot: liveReady?.controller.authoritySnapshot() ?? null,
            workspaceIntentToken:
              liveReady?.controller.authoritySnapshot().indexDigest ?? null,
            selectedProjectId: liveSelected,
            selectedProjectIntentToken: selectedProjectDigest(liveReady, liveSelected),
            recoveryIntentToken: null,
          };
        },
      },
    },
    command,
  );
  if (!result.ok) return { ok: false };
  const runtime = await import("@/lib/workspace-storage/runtime-controller");
  const selectedProjectId = input.kind === "delete-selected"
    ? null
    : input.selectedProjectId;
  return {
    ok: true,
    selectedProjectId,
    ready: {
      controller: new runtime.WorkspaceRuntimeController(
        input.storage,
        input.locks,
        result.snapshot,
        selectedProjectId,
      ),
      snapshot: result.snapshot,
      storageProtection: result.storageProtection,
    },
  };
}

function emptyRecoveryState(): WorkspaceRecoveryState {
  return {
    required: false,
    available: false,
    intentToken: "",
    invalidOwnedRecordCount: 0,
    candidates: [],
  };
}

async function readReserveStatus(
  storage: WorkspaceStorageAdapter,
): Promise<"ready" | "missing" | "invalid"> {
  const [{ WORKSPACE_RESERVE_KEY }, { classifyWorkspaceReserve }, { readExact }] =
    await Promise.all([
      import("@/lib/workspace-storage/keys"),
      import("@/lib/workspace-storage/reserve"),
      import("@/lib/workspace-storage/storage-adapter"),
    ]);
  const reserve = readExact(storage, WORKSPACE_RESERVE_KEY);
  if (!reserve.ok) return "invalid";
  const state = classifyWorkspaceReserve(reserve.value);
  return state === "valid" ? "ready" : state;
}

async function inspectReadyWorkspaceManagement(
  storage: WorkspaceStorageAdapter,
  ready: ReadyWorkspace,
): Promise<WorkspaceManagementData> {
  const snapshot = ready.controller.authoritySnapshot();
  const [namespaceModule, rotationModule, reserveStatus] = await Promise.all([
    import("@/lib/workspace-storage/namespace-scan"),
    import("@/lib/workspace-storage/rotation-recovery"),
    readReserveStatus(storage),
  ]);
  const namespace = namespaceModule.scanWorkspaceNamespace(storage);
  const rotation = await rotationModule.readWorkspaceRotationPreflight(storage);
  const activeProjectCount = snapshot.index.projects.filter(
    (project) => project.kind === "active",
  ).length;
  const tombstoneCount = snapshot.index.projects.length - activeProjectCount;
  const physicalProjectRecordCount = namespace.ok
    ? namespace.result.physicalProjectRecordCount
    : snapshot.projects.length;
  const legacyValueCount = Object.values(snapshot.index.legacyFingerprints).filter(
    (value) => value !== null,
  ).length;
  return {
    workspace: {
      workspaceId: snapshot.index.workspaceId,
      workspaceGeneration: snapshot.index.workspaceGeneration,
      indexRevision: snapshot.index.revision,
      activeProjectCount,
      tombstoneCount,
      physicalProjectRecordCount,
      legacyValueCount,
      intentToken: snapshot.indexDigest,
    },
    storageProtection: {
      mode: reserveStatus === "ready" ? "normal" : "degraded",
      reserveStatus,
      destructiveJournalAvailable: reserveStatus === "ready",
    },
    legacyCleanup: legacyValueCount > 0
      ? { available: true, intentToken: snapshot.indexDigest }
      : null,
    rotation:
      rotation.ok &&
      rotation.policy.rotationWouldReduceLogicalRecords &&
      !rotation.policy.recoveryOnly
        ? {
            eligible: true,
            targetGeneration: snapshot.index.workspaceGeneration + 1,
            intentToken: snapshot.indexDigest,
          }
        : null,
    recovery: emptyRecoveryState(),
    recoverySelections: [],
    recoveryPurgeBaseline: null,
  };
}

async function inspectRecoveryWorkspaceManagement(
  storage: WorkspaceStorageAdapter,
): Promise<WorkspaceManagementData | null> {
  const [rotationModule, lifecycleModule, digestModule, reserveStatus] = await Promise.all([
    import("@/lib/workspace-storage/rotation-recovery"),
    import("@/lib/workspace-storage/lifecycle"),
    import("@/lib/workspace-storage/digest"),
    readReserveStatus(storage),
  ]);
  const [indexRecovery, privacyPurge] = await Promise.all([
    rotationModule.inspectWorkspaceIndexRecovery(storage),
    lifecycleModule.inspectWorkspaceRecoveryPrivacyPurge(storage),
  ]);
  if (!indexRecovery.ok && !privacyPurge.ok) return null;
  const candidates = indexRecovery.ok ? indexRecovery.candidates : [];
  const token = await digestModule.sha256StoredString(JSON.stringify({
    indexState: indexRecovery.ok ? indexRecovery.indexState : "unavailable",
    candidates: candidates.map((candidate) => ({
      workspaceId: candidate.workspaceId,
      generation: candidate.sourceGeneration,
      records: candidate.selection.records.map((record) => ({
        key: record.key,
        digest: record.digest,
      })),
    })),
    purge: privacyPurge.ok ? privacyPurge.baseline : null,
  }));
  const recoverySelections = candidates.map((candidate, index) => ({
    candidateId: `${index + 1}:${candidate.workspaceId}:${candidate.sourceGeneration}`,
    selection: candidate.selection,
  }));
  return {
    workspace: null,
    storageProtection: {
      mode: "recovery-only",
      reserveStatus,
      destructiveJournalAvailable: reserveStatus !== "invalid" && privacyPurge.ok,
    },
    legacyCleanup: null,
    rotation: null,
    recovery: {
      required: true,
      available: indexRecovery.ok && token.ok && candidates.length > 0,
      intentToken: token.ok ? token.digest : "",
      invalidOwnedRecordCount: indexRecovery.ok
        ? indexRecovery.incoherentGroups.reduce((total, group) => total + group.recordCount, 0)
        : 0,
      candidates: recoverySelections.map((candidate) => ({
        candidateId: candidate.candidateId,
        workspaceId: candidate.selection.workspaceId,
        workspaceGeneration: candidate.selection.sourceGeneration,
        activeProjectCount: candidate.selection.records.filter(
          (record) => record.kind === "active",
        ).length,
        tombstoneCount: candidate.selection.records.filter(
          (record) => record.kind === "tombstone",
        ).length,
      })),
    },
    recoverySelections,
    recoveryPurgeBaseline: privacyPurge.ok ? privacyPurge.baseline : null,
  };
}

async function displayIdentityForState(state: PersistedProjectState): Promise<{
  title: string;
  course: string;
  deadline: string;
}> {
  if (state.projectKind === "uploaded" && state.uploadedProject) {
    return {
      title: state.uploadedProject.title,
      course: state.uploadedProject.course,
      deadline: state.uploadedProject.dueDate,
    };
  }
  const { SAMPLE_ASSIGNMENT } = await import("@/lib/sample-data");
  return {
    title: SAMPLE_ASSIGNMENT.title,
    course: SAMPLE_ASSIGNMENT.course,
    deadline: SAMPLE_ASSIGNMENT.dueAt,
  };
}

function lifecyclePanelFailure(reason: string): WorkspaceLifecycleActionResult {
  if (reason === "intent-stale" || reason === "selection-stale") {
    return { ok: false, reason: "stale-intent" };
  }
  if (reason === "workspace-conflict" || reason === "project-conflict") {
    return { ok: false, reason: "conflict" };
  }
  if (reason === "invalid-owned-record" || reason === "invalid-authority") {
    return { ok: false, reason: "invalid-owned-record" };
  }
  if (reason === "legacy-conflict") return { ok: false, reason: "legacy-drift" };
  if (reason === "reserve-degraded" || reason === "commit-incomplete") {
    return { ok: false, reason: "journal-unavailable" };
  }
  if (reason === "storage-error" || reason === "lock-unavailable") {
    return { ok: false, reason: "storage-unavailable" };
  }
  if (reason.includes("quota")) return { ok: false, reason: "quota" };
  if (reason === "recovery-required" || reason === "quarantine") {
    return { ok: false, reason: "recovery-changed" };
  }
  return { ok: false, reason: "unknown" };
}

export function WorkspaceDeferredOperations({
  mode,
  storage,
  locks,
  ready,
  selectedProjectId,
  onApplyReady,
  onAuthorityProjectReplaced,
  onSelectedProjectChange,
  onLegacyResolved,
  onNotice,
  onReopen,
}: WorkspaceDeferredOperationsProps) {
  const messages = useLocalizedMessages(workspaceActivationEn, workspaceActivationZhCN);
  const [managementData, setManagementData] = useState<WorkspaceManagementData | null>(null);
  const [replacementSelection, setReplacementSelection] = useState<ReplacementSelection | null>(null);
  const [legacyDrift, setLegacyDrift] = useState<ReadableLegacyDrift | null>(null);
  const [legacyCandidateId, setLegacyCandidateId] = useState("");
  const [legacyCleanupConfirmed, setLegacyCleanupConfirmed] = useState(false);
  const [legacyActionPending, setLegacyActionPending] = useState(false);
  const replacementInputRef = useRef<HTMLInputElement>(null);
  const replacementTargetRef = useRef<string | null>(null);
  const legacyDriftRef = useRef<ReadableLegacyDrift | null>(null);
  const liveReadyRef = useRef(ready);
  const liveSelectedRef = useRef(selectedProjectId);

  useEffect(() => { liveReadyRef.current = ready; }, [ready]);
  useEffect(() => { liveSelectedRef.current = selectedProjectId; }, [selectedProjectId]);

  const refreshManagement = useCallback(async () => {
    const data = ready
      ? await inspectReadyWorkspaceManagement(storage, ready)
      : await inspectRecoveryWorkspaceManagement(storage);
    setManagementData(data);
    setReplacementSelection((current) => {
      if (!current || !ready) return ready ? current : null;
      return selectedProjectDigest(ready, current.preview.targetProjectId) ===
        current.preview.targetIntentToken
        ? current
        : null;
    });
  }, [ready, storage]);

  useEffect(() => {
    if (mode === "management" || mode === "recovery") {
      const timer = window.setTimeout(() => void refreshManagement(), 0);
      return () => window.clearTimeout(timer);
    }
    if (mode === "read-only-recovery") return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const driftModule = await import("@/lib/workspace-storage/production-legacy-drift");
        const drift = await driftModule.inspectWorkspaceLegacyDrift(storage);
        if (!drift.ok) {
          onNotice(messages.legacyChoiceFailed);
          return;
        }
        legacyDriftRef.current = drift;
        setLegacyDrift(drift);
        setLegacyCandidateId(drift.candidates[0]?.candidateId ?? "");
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [messages.legacyChoiceFailed, mode, onNotice, refreshManagement, storage]);

  const selectedLifecycleProject = useMemo<WorkspaceLifecycleProjectScope | null>(() => {
    if (!ready || !selectedProjectId) return null;
    const model = deriveWorkspaceDashboardModel(
      dashboardProjectsFromWorkspaceSnapshot(ready.controller.authoritySnapshot()),
      { asOfDate: todayDateOnly() },
    );
    const summary = model.assignments.find(
      (assignment) => assignment.projectId === selectedProjectId,
    );
    const record = ready.controller.authoritySnapshot().projects.find(
      (project) => project.record.projectId === selectedProjectId,
    );
    return summary && record
      ? {
          projectId: selectedProjectId,
          title: summary.title,
          course: summary.course,
          recordRevision: record.record.revision,
          intentToken: record.digest,
        }
      : null;
  }, [ready, selectedProjectId]);

  const exportWorkspaceProject = useCallback(async (projectId: string) => {
    const project = ready?.controller.authoritySnapshot().projects.find(
      (candidate) => candidate.record.projectId === projectId,
    );
    if (!project || project.record.value.kind !== "project") {
      onNotice(messages.exportFailed);
      return;
    }
    try {
      const backup = await import("@/lib/project-backup");
      const exportedAt = new Date().toISOString();
      downloadText(
        backup.projectBackupFileName(project.record.value.state, exportedAt),
        backup.serializeProjectBackup(project.record.value.state, exportedAt),
      );
    } catch {
      onNotice(messages.exportFailed);
    }
  }, [messages.exportFailed, onNotice, ready]);

  const readReplacementBackup = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    const targetProjectId = replacementTargetRef.current;
    const current = liveReadyRef.current;
    if (!file || !targetProjectId || !current) return;
    try {
      const [backup, protocol, digest] = await Promise.all([
        import("@/lib/project-backup"),
        import("@/lib/workspace-storage/protocol"),
        import("@/lib/workspace-storage/digest"),
      ]);
      const parsed = await backup.readProjectBackupFile(file);
      if (parsed.state.projectKind === "none") throw new Error("empty backup");
      const target = current.controller.authoritySnapshot().projects.find(
        (project) => project.record.projectId === targetProjectId,
      );
      if (!target || target.record.value.kind !== "project") throw new Error("missing target");
      const serialized = protocol.serializeWorkspaceProjectRecord({
        ...target.record,
        revision: target.record.revision + 1,
        value: { kind: "project", state: parsed.state },
      });
      if (!serialized.ok) throw new Error("invalid backup target");
      const token = await digest.sha256StoredString(
        backup.serializeProjectBackup(parsed.state, parsed.exportedAt),
      );
      if (!token.ok) throw new Error("digest unavailable");
      const identity = await displayIdentityForState(parsed.state);
      setReplacementSelection({
        state: parsed.state,
        preview: {
          targetProjectId,
          targetIntentToken: target.digest,
          backupToken: token.digest,
          backupTitle: identity.title,
          backupCourse: identity.course,
          backupDeadline: identity.deadline,
          sourceName: file.name,
          sizeEffect: serialized.serialized.length <= target.raw.length ? "non-growing" : "growing",
        },
      });
      onNotice(messages.backupReady);
    } catch {
      setReplacementSelection(null);
      onNotice(messages.backupInvalid);
    }
  }, [messages.backupInvalid, messages.backupReady, onNotice]);

  const exportWorkspaceDiagnostics = useCallback(() => {
    const current = managementData;
    downloadText(
      `rubrictrail-workspace-diagnostics-${todayDateOnly()}.json`,
      JSON.stringify({
        format: "rubrictrail-workspace-diagnostics",
        version: 1,
        generatedAt: new Date().toISOString(),
        workspace: current?.workspace
          ? {
              generation: current.workspace.workspaceGeneration,
              revision: current.workspace.indexRevision,
              activeProjects: current.workspace.activeProjectCount,
              tombstones: current.workspace.tombstoneCount,
              physicalRecords: current.workspace.physicalProjectRecordCount,
              legacyValues: current.workspace.legacyValueCount,
            }
          : null,
        storage: current?.storageProtection ?? null,
        recovery: current
          ? {
              required: current.recovery.required,
              candidateCount: current.recovery.candidates.length,
              invalidOwnedRecordCount: current.recovery.invalidOwnedRecordCount,
            }
          : null,
      }, null, 2),
    );
    onNotice(messages.diagnosticsDownloaded);
  }, [managementData, messages.diagnosticsDownloaded, onNotice]);

  const confirmManagementAction = useCallback(async (
    request: WorkspaceLifecycleActionRequest,
  ): Promise<WorkspaceLifecycleActionResult> => {
    const current = liveReadyRef.current;
    if (!locks || !managementData) return { ok: false, reason: "storage-unavailable" };
    const lifecycle = await import("@/lib/workspace-storage/production-lifecycle-orchestrator");
    let command: import("@/lib/workspace-storage/production-lifecycle-orchestrator").WorkspaceProductionLifecycleCommand | null = null;
    if (request.kind === "recover-index") {
      const candidate = managementData.recoverySelections.find(
        (item) => item.candidateId === request.candidateId,
      );
      const intent = candidate
        ? lifecycle.captureWorkspaceRecoverySelectionIntent(
            candidate.selection,
            request.recoveryIntentToken,
          )
        : null;
      if (intent) command = { kind: "recover-index", intent };
    } else if (request.kind === "delete-workspace-recovery") {
      const intent = managementData.recoveryPurgeBaseline
        ? lifecycle.captureWorkspaceRecoveryPurgeIntent(
            managementData.recoveryPurgeBaseline,
            request.recoveryIntentToken,
          )
        : null;
      if (intent) command = { kind: "delete-workspace-recovery", intent };
    } else if (current) {
      const snapshot = current.controller.authoritySnapshot();
      if (request.kind === "replace-project" || request.kind === "delete-project") {
        const intent = lifecycle.captureWorkspaceSelectedProjectIntent(
          snapshot,
          request.workspaceIntentToken,
          request.projectId,
          request.projectIntentToken,
        );
        if (intent && request.kind === "delete-project") {
          command = { kind: "delete-selected", intent };
        } else if (
          intent &&
          request.kind === "replace-project" &&
          replacementSelection?.preview.backupToken === request.backupToken &&
          replacementSelection.preview.targetProjectId === request.projectId
        ) {
          command = { kind: "replace-selected", intent, backup: { state: replacementSelection.state } };
        }
      } else {
        const intent = lifecycle.captureWorkspaceIndexIntent(snapshot, request.workspaceIntentToken);
        if (intent) {
          if (request.kind === "legacy-cleanup") command = { kind: "legacy-cleanup", intent };
          if (request.kind === "delete-workspace") command = { kind: "delete-workspace", intent };
          if (request.kind === "rotate-workspace-generation") {
            command = { kind: "rotate-workspace-generation", intent };
          }
        }
      }
    }
    if (!command) return { ok: false, reason: "stale-intent" };
    const result = await lifecycle.executeWorkspaceProductionLifecycleCommand(
      {
        storage,
        locks,
        pendingSaves: current ? pendingFreezeAdapter(current) : detachedPendingFreeze(),
        intents: {
          read: () => ({
            snapshot: liveReadyRef.current?.controller.authoritySnapshot() ?? null,
            workspaceIntentToken:
              liveReadyRef.current?.controller.authoritySnapshot().indexDigest ?? null,
            selectedProjectId: liveSelectedRef.current,
            selectedProjectIntentToken: selectedProjectDigest(
              liveReadyRef.current,
              liveSelectedRef.current,
            ),
            recoveryIntentToken: managementData.recovery.intentToken || null,
          }),
        },
      },
      command,
    );
    if (!result.ok) return lifecyclePanelFailure(result.reason);
    setReplacementSelection(null);
    if (!current || result.pendingState !== "synchronized") {
      await onReopen();
      return { ok: true };
    }
    const nextSelected =
      request.kind === "delete-project" || request.kind === "delete-workspace"
        ? null
        : liveSelectedRef.current;
    onApplyReady({
      controller: current.controller,
      snapshot: result.snapshot,
      storageProtection: result.storageProtection,
    });
    if (request.kind === "replace-project") {
      onAuthorityProjectReplaced(request.projectId);
    }
    onSelectedProjectChange(nextSelected);
    setManagementData(await inspectReadyWorkspaceManagement(storage, {
      ...current,
      snapshot: result.snapshot,
      storageProtection: result.storageProtection,
    }));
    return { ok: true };
  }, [
    locks,
    managementData,
    onApplyReady,
    onAuthorityProjectReplaced,
    onReopen,
    onSelectedProjectChange,
    replacementSelection,
    storage,
  ]);

  const resolveLegacyDrift = useCallback(async (
    choice: "accept-current-baseline" | "import-as-new" | "replace-selected" | "privacy-cleanup",
  ) => {
    const drift = legacyDriftRef.current;
    const current = liveReadyRef.current;
    if (!drift || !locks || legacyActionPending) return;
    const candidate = drift.candidates.find((item) => item.candidateId === legacyCandidateId);
    if ((choice === "import-as-new" || choice === "replace-selected") && !candidate) {
      onNotice(messages.legacyChoiceFailed);
      return;
    }
    if (choice === "privacy-cleanup" && !legacyCleanupConfirmed) return;
    setLegacyActionPending(true);
    onNotice(messages.legacyChoiceWorking);
    try {
      const [driftModule, lifecycle] = await Promise.all([
        import("@/lib/workspace-storage/production-legacy-drift"),
        import("@/lib/workspace-storage/production-lifecycle-orchestrator"),
      ]);
      let action: import("@/lib/workspace-storage/production-legacy-drift").WorkspaceLegacyDriftResolutionAction;
      if (choice === "accept-current-baseline" || choice === "privacy-cleanup") {
        action = { kind: choice };
      } else if (choice === "import-as-new") {
        action = { kind: choice, candidateId: candidate!.candidateId };
      } else {
        const selected = liveSelectedRef.current;
        const snapshot = current?.controller.authoritySnapshot() ?? null;
        const selectedIntent = selected && snapshot
          ? lifecycle.captureWorkspaceSelectedProjectIntent(
              snapshot,
              snapshot.indexDigest,
              selected,
              selectedProjectDigest(current, selected) ?? "",
            )
          : null;
        if (!selectedIntent) {
          onNotice(messages.legacyChoiceFailed);
          return;
        }
        action = {
          kind: choice,
          candidateId: candidate!.candidateId,
          selectedIntent,
          selectedIntentStillCurrent: () => {
            const live = liveReadyRef.current;
            const liveSnapshot = live?.controller.authoritySnapshot() ?? null;
            return (
              liveSnapshot !== null &&
              liveSelectedRef.current === selected &&
              liveSnapshot.indexDigest === snapshot?.indexDigest &&
              selectedProjectDigest(live, selected) === selectedProjectDigest(current, selected)
            );
          },
        };
      }
      const result = await driftModule.resolveWorkspaceLegacyDrift(
        {
          storage,
          locks,
          pendingSaves: current ? pendingFreezeAdapter(current) : detachedPendingFreeze(),
        },
        {
          confirmationToken: drift.confirmationToken,
          action,
          confirmationStillCurrent: () =>
            legacyDriftRef.current?.confirmationToken === drift.confirmationToken,
        },
      );
      if (!result.ok) {
        onNotice(messages.legacyChoiceFailed);
        return;
      }
      legacyDriftRef.current = null;
      setLegacyDrift(null);
      setLegacyCleanupConfirmed(false);
      onLegacyResolved();
      onNotice(null);
      if (!current || result.pendingState !== "synchronized") {
        await onReopen();
        return;
      }
      onApplyReady({
        controller: current.controller,
        snapshot: result.snapshot,
        storageProtection: result.storageProtection,
      });
      if (result.action === "replace-selected" && liveSelectedRef.current) {
        onAuthorityProjectReplaced(liveSelectedRef.current);
      }
      if (result.action === "import-as-new" && result.projectId) {
        onSelectedProjectChange(result.projectId);
      }
    } catch {
      onNotice(messages.legacyChoiceFailed);
    } finally {
      setLegacyActionPending(false);
    }
  }, [
    legacyActionPending,
    legacyCandidateId,
    legacyCleanupConfirmed,
    locks,
    messages.legacyChoiceFailed,
    messages.legacyChoiceWorking,
    onApplyReady,
    onAuthorityProjectReplaced,
    onLegacyResolved,
    onNotice,
    onReopen,
    onSelectedProjectChange,
    storage,
  ]);

  if (mode === "read-only-recovery") {
    return <WorkspaceRecoveryProjectExports storage={storage} onNotice={onNotice} />;
  }

  if (mode === "legacy-active" || mode === "legacy-recovery") {
    if (!legacyDrift) {
      return <p className={styles.managementLoading} role="status">{messages.managementLoading}</p>;
    }
    const active = mode === "legacy-active";
    return (
      <>
        {!active ? (
          <WorkspaceRecoveryProjectExports storage={storage} onNotice={onNotice} />
        ) : null}
        <section
          className={active ? styles.legacyBanner : styles.legacyDrift}
          aria-labelledby={active ? "active-legacy-drift-title" : "legacy-drift-title"}
        >
        <div>
          <p className={styles.eyebrow}>RubricTrail</p>
          <h2 id={active ? "active-legacy-drift-title" : "legacy-drift-title"}>
            {messages.legacyDriftHeading}
          </h2>
          <p>{messages.legacyDriftDescription}</p>
        </div>
        {legacyDrift.candidates.length > 0 ? (
          <label className={styles.legacyChoice}>
            <span>{messages.legacyCandidate}</span>
            <select
              value={legacyCandidateId}
              disabled={legacyActionPending}
              onChange={(event) => setLegacyCandidateId(event.target.value)}
            >
              {legacyDrift.candidates.map((candidate) => (
                <option key={candidate.candidateId} value={candidate.candidateId}>
                  {candidate.state.projectKind === "uploaded"
                    ? candidate.state.uploadedProject?.title
                    : "LumaLane sample"}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className={styles.legacyActions}>
          <button
            type="button"
            disabled={legacyActionPending}
            onClick={() => void resolveLegacyDrift("accept-current-baseline")}
          >
            {messages.acceptLegacyBaseline}
          </button>
          <button
            type="button"
            disabled={legacyActionPending || legacyDrift.candidates.length === 0}
            onClick={() => void resolveLegacyDrift("import-as-new")}
          >
            {messages.importLegacyAsNew}
          </button>
          {active ? (
            <button
              type="button"
              disabled={legacyActionPending || legacyDrift.candidates.length === 0 || !selectedProjectId}
              onClick={() => void resolveLegacyDrift("replace-selected")}
            >
              {messages.replaceSelectedFromLegacy}
            </button>
          ) : null}
        </div>
        <label className={styles.legacyConfirm}>
          <input
            type="checkbox"
            checked={legacyCleanupConfirmed}
            disabled={legacyActionPending}
            onChange={(event) => setLegacyCleanupConfirmed(event.target.checked)}
          />
          <span>{messages.cleanupChangedLegacyConfirm}</span>
        </label>
        <button
          type="button"
          className={styles.dangerAction}
          disabled={legacyActionPending || !legacyCleanupConfirmed}
          onClick={() => void resolveLegacyDrift("privacy-cleanup")}
        >
          {messages.cleanupChangedLegacy}
        </button>
        {legacyActionPending ? <p role="status">{messages.legacyChoiceWorking}</p> : null}
        </section>
      </>
    );
  }

  return (
    <section
      className={mode === "management" ? styles.management : styles.recoveryManagement}
      aria-label={messages.manageWorkspace}
    >
      {mode === "recovery" ? (
        <WorkspaceRecoveryProjectExports storage={storage} onNotice={onNotice} />
      ) : null}
      {managementData ? (
        <WorkspaceLifecyclePanel
          workspace={managementData.workspace}
          selectedProject={mode === "management" ? selectedLifecycleProject : null}
          replacementPreview={replacementSelection?.preview ?? null}
          storageProtection={managementData.storageProtection}
          legacyCleanup={managementData.legacyCleanup}
          rotation={managementData.rotation}
          recovery={managementData.recovery}
          onChooseReplacementBackup={(projectId) => {
            replacementTargetRef.current = projectId;
            replacementInputRef.current?.click();
          }}
          onExportSelectedProject={(projectId) => void exportWorkspaceProject(projectId)}
          onExportDiagnostics={exportWorkspaceDiagnostics}
          onConfirmAction={confirmManagementAction}
        />
      ) : (
        <p className={styles.managementLoading} role="status">{messages.managementLoading}</p>
      )}
      <input
        ref={replacementInputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => void readReplacementBackup(event)}
      />
    </section>
  );
}
