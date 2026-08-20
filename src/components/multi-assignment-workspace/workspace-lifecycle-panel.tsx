"use client";

import {
  AlertTriangle,
  ArchiveRestore,
  Database,
  Download,
  FileSearch,
  HardDrive,
  RefreshCcw,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import {
  type FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { useI18n, useLocalizedMessages } from "@/components/locale-provider";
import {
  formatWorkspaceLifecycleMessage,
  workspaceLifecycleEn,
  workspaceLifecycleZhCN,
} from "@/components/multi-assignment-workspace/workspace-lifecycle-messages";

import styles from "./workspace-lifecycle-panel.module.css";

export type WorkspaceStorageMode = "normal" | "degraded" | "recovery-only";
export type WorkspaceReserveStatus = "ready" | "missing" | "invalid";

export interface WorkspaceLifecycleWorkspaceScope {
  workspaceId: string;
  workspaceGeneration: number;
  indexRevision: number;
  activeProjectCount: number;
  tombstoneCount: number;
  physicalProjectRecordCount: number;
  legacyValueCount: number;
  intentToken: string;
}

export interface WorkspaceLifecycleProjectScope {
  projectId: string;
  title: string;
  course: string;
  recordRevision: number;
  intentToken: string;
}

export interface WorkspaceReplacementPreview {
  targetProjectId: string;
  targetIntentToken: string;
  backupToken: string;
  backupTitle: string;
  backupCourse: string;
  backupDeadline: string;
  sourceName: string;
  sizeEffect: "non-growing" | "growing";
}

export interface WorkspaceStorageProtection {
  mode: WorkspaceStorageMode;
  reserveStatus: WorkspaceReserveStatus;
  destructiveJournalAvailable: boolean;
}

export interface WorkspaceLegacyCleanupScope {
  available: boolean;
  intentToken: string;
}

export interface WorkspaceRotationScope {
  eligible: boolean;
  targetGeneration: number;
  intentToken: string;
}

export interface WorkspaceRecoveryCandidate {
  candidateId: string;
  workspaceId: string;
  workspaceGeneration: number;
  activeProjectCount: number;
  tombstoneCount: number;
}

export interface WorkspaceRecoveryState {
  required: boolean;
  available: boolean;
  intentToken: string;
  invalidOwnedRecordCount: number;
  candidates: readonly WorkspaceRecoveryCandidate[];
}

interface WorkspaceActionBaseline {
  workspaceId: string;
  workspaceGeneration: number;
  indexRevision: number;
  workspaceIntentToken: string;
}

export type WorkspaceLifecycleActionRequest =
  | (WorkspaceActionBaseline & {
      kind: "replace-project";
      projectId: string;
      projectRevision: number;
      projectIntentToken: string;
      backupToken: string;
    })
  | (WorkspaceActionBaseline & {
      kind: "delete-project";
      projectId: string;
      projectRevision: number;
      projectIntentToken: string;
    })
  | (WorkspaceActionBaseline & {
      kind: "legacy-cleanup";
      cleanupIntentToken: string;
    })
  | (WorkspaceActionBaseline & {
      kind: "delete-workspace";
    })
  | (WorkspaceActionBaseline & {
      kind: "rotate-workspace-generation";
      targetGeneration: number;
      rotationIntentToken: string;
    })
  | {
      kind: "recover-index";
      recoveryIntentToken: string;
      candidateId: string;
      candidateWorkspaceId: string;
      candidateGeneration: number;
    }
  | {
      kind: "delete-workspace-recovery";
      recoveryIntentToken: string;
    };

export type WorkspaceLifecycleFailureReason =
  | "conflict"
  | "quota"
  | "journal-unavailable"
  | "stale-intent"
  | "invalid-owned-record"
  | "legacy-drift"
  | "recovery-changed"
  | "storage-unavailable"
  | "unknown";

export type WorkspaceLifecycleActionResult =
  | { ok: true }
  | { ok: false; reason: WorkspaceLifecycleFailureReason };

export interface WorkspaceLifecyclePanelProps {
  workspace: WorkspaceLifecycleWorkspaceScope | null;
  selectedProject: WorkspaceLifecycleProjectScope | null;
  replacementPreview: WorkspaceReplacementPreview | null;
  storageProtection: WorkspaceStorageProtection;
  legacyCleanup: WorkspaceLegacyCleanupScope | null;
  rotation: WorkspaceRotationScope | null;
  recovery: WorkspaceRecoveryState;
  onChooseReplacementBackup: (projectId: string) => void;
  onExportSelectedProject: (projectId: string) => void;
  onExportDiagnostics: () => void;
  onConfirmAction: (
    request: WorkspaceLifecycleActionRequest,
  ) => WorkspaceLifecycleActionResult | Promise<WorkspaceLifecycleActionResult>;
}

export type WorkspaceRecordPolicyLevel =
  | "normal"
  | "compaction-recommended"
  | "warning"
  | "growth-blocked"
  | "hard-limit"
  | "recovery-only";

export function deriveWorkspaceRecordPolicy(
  activeProjectCount: number,
  tombstoneCount: number,
): WorkspaceRecordPolicyLevel {
  const total = activeProjectCount + tombstoneCount;
  if (total > 100) return "recovery-only";
  if (total === 100) return "hard-limit";
  if (total >= 96) return "growth-blocked";
  if (total >= 80) return "warning";
  if (tombstoneCount >= 64) return "compaction-recommended";
  return "normal";
}

type DialogState =
  | {
      kind: "replace-project";
      workspace: WorkspaceLifecycleWorkspaceScope;
      project: WorkspaceLifecycleProjectScope;
      preview: WorkspaceReplacementPreview;
    }
  | {
      kind: "delete-project";
      workspace: WorkspaceLifecycleWorkspaceScope;
      project: WorkspaceLifecycleProjectScope;
    }
  | {
      kind: "legacy-cleanup";
      workspace: WorkspaceLifecycleWorkspaceScope;
      cleanup: WorkspaceLegacyCleanupScope;
    }
  | {
      kind: "delete-workspace";
      workspace: WorkspaceLifecycleWorkspaceScope;
    }
  | {
      kind: "rotate-workspace-generation";
      workspace: WorkspaceLifecycleWorkspaceScope;
      rotation: WorkspaceRotationScope;
    }
  | {
      kind: "recover-index";
      recovery: WorkspaceRecoveryState;
    }
  | {
      kind: "delete-workspace-recovery";
      recovery: WorkspaceRecoveryState;
    };

const FAILURE_MESSAGE_KEYS: Record<
  WorkspaceLifecycleFailureReason,
  keyof typeof workspaceLifecycleEn
> = {
  conflict: "failureConflict",
  quota: "failureQuota",
  "journal-unavailable": "failureJournal",
  "stale-intent": "failureStaleIntent",
  "invalid-owned-record": "failureInvalidOwned",
  "legacy-drift": "failureLegacyDrift",
  "recovery-changed": "failureRecoveryChanged",
  "storage-unavailable": "failureStorage",
  unknown: "failureUnknown",
};

function focusableIn(node: HTMLElement | null): HTMLElement[] {
  return node
    ? Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
    : [];
}

function sameWorkspace(
  left: WorkspaceLifecycleWorkspaceScope,
  right: WorkspaceLifecycleWorkspaceScope | null,
): boolean {
  return (
    right !== null &&
    left.workspaceId === right.workspaceId &&
    left.workspaceGeneration === right.workspaceGeneration &&
    left.indexRevision === right.indexRevision &&
    left.intentToken === right.intentToken
  );
}

function sameProject(
  left: WorkspaceLifecycleProjectScope,
  right: WorkspaceLifecycleProjectScope | null,
): boolean {
  return (
    right !== null &&
    left.projectId === right.projectId &&
    left.recordRevision === right.recordRevision &&
    left.intentToken === right.intentToken
  );
}

function workspaceBaseline(
  workspace: WorkspaceLifecycleWorkspaceScope,
): WorkspaceActionBaseline {
  return {
    workspaceId: workspace.workspaceId,
    workspaceGeneration: workspace.workspaceGeneration,
    indexRevision: workspace.indexRevision,
    workspaceIntentToken: workspace.intentToken,
  };
}

function sameRecoverySnapshot(
  left: WorkspaceRecoveryState,
  right: WorkspaceRecoveryState,
): boolean {
  if (
    !right.required ||
    left.intentToken !== right.intentToken ||
    left.invalidOwnedRecordCount !== right.invalidOwnedRecordCount ||
    left.candidates.length !== right.candidates.length
  ) {
    return false;
  }
  const currentById = new Map(
    right.candidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  return left.candidates.every((candidate) => {
    const current = currentById.get(candidate.candidateId);
    return (
      current !== undefined &&
      current.workspaceId === candidate.workspaceId &&
      current.workspaceGeneration === candidate.workspaceGeneration &&
      current.activeProjectCount === candidate.activeProjectCount &&
      current.tombstoneCount === candidate.tombstoneCount
    );
  });
}

function sameRecoveryState(
  left: WorkspaceRecoveryState,
  right: WorkspaceRecoveryState,
): boolean {
  return right.available && sameRecoverySnapshot(left, right);
}

export function WorkspaceLifecyclePanel({
  workspace,
  selectedProject,
  replacementPreview,
  storageProtection,
  legacyCleanup,
  rotation,
  recovery,
  onChooseReplacementBackup,
  onExportSelectedProject,
  onExportDiagnostics,
  onConfirmAction,
}: WorkspaceLifecyclePanelProps) {
  const messages = useLocalizedMessages(
    workspaceLifecycleEn,
    workspaceLifecycleZhCN,
  );
  const { formatDate, formatNumber } = useI18n();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [failure, setFailure] =
    useState<WorkspaceLifecycleFailureReason | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const failureRef = useRef<HTMLParagraphElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const pendingRef = useRef(false);
  const restoreFocusRef = useRef(true);
  const operationSequenceRef = useRef(0);
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const recoveryCandidatesId = useId();

  const count = (value: number) => formatNumber(value);
  const format = (
    template: string,
    values: Record<string, string | number>,
  ) => formatWorkspaceLifecycleMessage(template, values);
  const shortId = (value: string) => value.slice(0, 8);
  const dateLabel = (value: string) =>
    formatDate(new Date(`${value}T12:00:00`), { dateStyle: "medium" });
  const policy = workspace
    ? deriveWorkspaceRecordPolicy(
        workspace.activeProjectCount,
        workspace.tombstoneCount,
      )
    : "recovery-only";
  const policyMessage = {
    normal: messages.policyNormal,
    "compaction-recommended": messages.policyCompaction,
    warning: messages.policyWarning,
    "growth-blocked": messages.policyGrowthBlocked,
    "hard-limit": messages.policyHardLimit,
    "recovery-only": messages.policyRecoveryOnly,
  }[policy];
  const policyDetail = {
    normal: null,
    "compaction-recommended": messages.policyCompactionDetail,
    warning: messages.policyWarningDetail,
    "growth-blocked": messages.policyGrowthBlockedDetail,
    "hard-limit": messages.policyHardLimitDetail,
    "recovery-only": messages.policyRecoveryOnlyDetail,
  }[policy];
  const reserveMessage = {
    ready: messages.reserveReady,
    missing: messages.reserveMissing,
    invalid: messages.reserveInvalid,
  }[storageProtection.reserveStatus];
  const recoveryOnly = storageProtection.mode === "recovery-only";
  const destructiveAvailable =
    !recoveryOnly && storageProtection.destructiveJournalAvailable;
  const previewCurrent =
    selectedProject !== null &&
    replacementPreview !== null &&
    replacementPreview.targetProjectId === selectedProject.projectId &&
    replacementPreview.targetIntentToken === selectedProject.intentToken;
  const replacementAllowed =
    previewCurrent &&
    !recoveryOnly &&
    storageProtection.destructiveJournalAvailable &&
    !(
      storageProtection.mode === "degraded" &&
      replacementPreview?.sizeEffect !== "non-growing"
    );

  useEffect(() => {
    return () => {
      operationSequenceRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!dialog) return;
    const opener = openerRef.current;
    const frame = window.requestAnimationFrame(() => {
      const initial = dialogRef.current?.querySelector<HTMLElement>(
        "[data-dialog-initial-focus]",
      );
      (initial ?? dialogRef.current)?.focus({ preventScroll: true });
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!pendingRef.current) {
          event.preventDefault();
          restoreFocusRef.current = true;
          setDialog(null);
        }
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableIn(dialogRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
      if (restoreFocusRef.current) opener?.focus({ preventScroll: true });
      restoreFocusRef.current = true;
    };
  }, [dialog]);

  useEffect(() => {
    if (failure) failureRef.current?.focus({ preventScroll: true });
  }, [failure]);

  function openDialog(nextDialog: DialogState, opener: HTMLElement) {
    openerRef.current = opener;
    restoreFocusRef.current = true;
    setConfirmation("");
    setAcknowledged(false);
    setSelectedCandidateId(null);
    setFailure(null);
    setDialog(nextDialog);
  }

  function closeDialog() {
    if (pendingRef.current) return;
    restoreFocusRef.current = true;
    setDialog(null);
  }

  function dialogIntentIsCurrent(): boolean {
    if (!dialog) return false;
    switch (dialog.kind) {
      case "replace-project":
        return (
          replacementAllowed &&
          sameWorkspace(dialog.workspace, workspace) &&
          sameProject(dialog.project, selectedProject) &&
          replacementPreview !== null &&
          dialog.preview.backupToken === replacementPreview.backupToken &&
          dialog.preview.targetIntentToken ===
            replacementPreview.targetIntentToken
        );
      case "delete-project":
        return (
          destructiveAvailable &&
          sameWorkspace(dialog.workspace, workspace) &&
          sameProject(dialog.project, selectedProject)
        );
      case "legacy-cleanup":
        return (
          sameWorkspace(dialog.workspace, workspace) &&
          legacyCleanup !== null &&
          legacyCleanup.available &&
          destructiveAvailable &&
          dialog.cleanup.intentToken === legacyCleanup.intentToken
        );
      case "delete-workspace":
        return (
          destructiveAvailable && sameWorkspace(dialog.workspace, workspace)
        );
      case "rotate-workspace-generation":
        return (
          storageProtection.mode === "normal" &&
          destructiveAvailable &&
          sameWorkspace(dialog.workspace, workspace) &&
          rotation !== null &&
          rotation.eligible &&
          dialog.rotation.intentToken === rotation.intentToken &&
          dialog.rotation.targetGeneration === rotation.targetGeneration
        );
      case "recover-index":
        return sameRecoveryState(dialog.recovery, recovery);
      case "delete-workspace-recovery":
        return (
          storageProtection.destructiveJournalAvailable &&
          sameRecoverySnapshot(dialog.recovery, recovery)
        );
    }
  }

  function requiredConfirmationToken(): string | null {
    if (!dialog) return null;
    if (dialog.kind === "delete-project") {
      return format(messages.deleteProjectToken, {
        id: shortId(dialog.project.projectId),
      });
    }
    if (dialog.kind === "legacy-cleanup") return messages.legacyToken;
    if (dialog.kind === "delete-workspace") {
      return format(messages.workspaceDeleteToken, {
        id: shortId(dialog.workspace.workspaceId),
      });
    }
    if (dialog.kind === "delete-workspace-recovery") {
      return messages.recoveryPrivacyToken;
    }
    return null;
  }

  function confirmationIsValid(): boolean {
    if (!dialog || !dialogIntentIsCurrent()) return false;
    const token = requiredConfirmationToken();
    if (token !== null) {
      return (
        confirmation === token &&
        (dialog.kind !== "delete-workspace-recovery" || acknowledged)
      );
    }
    if (dialog.kind === "recover-index") {
      return acknowledged && selectedCandidateId !== null;
    }
    return acknowledged;
  }

  function buildRequest(): WorkspaceLifecycleActionRequest | null {
    if (!dialog || !confirmationIsValid()) return null;
    switch (dialog.kind) {
      case "replace-project":
        return {
          kind: "replace-project",
          ...workspaceBaseline(dialog.workspace),
          projectId: dialog.project.projectId,
          projectRevision: dialog.project.recordRevision,
          projectIntentToken: dialog.project.intentToken,
          backupToken: dialog.preview.backupToken,
        };
      case "delete-project":
        return {
          kind: "delete-project",
          ...workspaceBaseline(dialog.workspace),
          projectId: dialog.project.projectId,
          projectRevision: dialog.project.recordRevision,
          projectIntentToken: dialog.project.intentToken,
        };
      case "legacy-cleanup":
        return {
          kind: "legacy-cleanup",
          ...workspaceBaseline(dialog.workspace),
          cleanupIntentToken: dialog.cleanup.intentToken,
        };
      case "delete-workspace":
        return {
          kind: "delete-workspace",
          ...workspaceBaseline(dialog.workspace),
        };
      case "rotate-workspace-generation":
        return {
          kind: "rotate-workspace-generation",
          ...workspaceBaseline(dialog.workspace),
          targetGeneration: dialog.rotation.targetGeneration,
          rotationIntentToken: dialog.rotation.intentToken,
        };
      case "recover-index": {
        const candidate = dialog.recovery.candidates.find(
          (item) => item.candidateId === selectedCandidateId,
        );
        return candidate
          ? {
              kind: "recover-index",
              recoveryIntentToken: dialog.recovery.intentToken,
              candidateId: candidate.candidateId,
              candidateWorkspaceId: candidate.workspaceId,
              candidateGeneration: candidate.workspaceGeneration,
            }
          : null;
      }
      case "delete-workspace-recovery":
        return {
          kind: "delete-workspace-recovery",
          recoveryIntentToken: dialog.recovery.intentToken,
        };
    }
  }

  async function confirmAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    const request = buildRequest();
    if (!request) return;
    const sequence = operationSequenceRef.current + 1;
    operationSequenceRef.current = sequence;
    pendingRef.current = true;
    setPending(true);
    setFailure(null);
    let result: WorkspaceLifecycleActionResult;
    try {
      result = await onConfirmAction(request);
    } catch {
      result = { ok: false, reason: "unknown" };
    }
    if (operationSequenceRef.current !== sequence) return;
    pendingRef.current = false;
    setPending(false);
    if (result.ok) {
      const activeElement = document.activeElement;
      restoreFocusRef.current =
        activeElement === document.body ||
        activeElement === document.documentElement ||
        (dialogRef.current?.contains(activeElement) ?? true);
      setDialog(null);
    } else {
      setFailure(result.reason);
    }
  }

  const intentCurrent = dialogIntentIsCurrent();
  const confirmationToken = requiredConfirmationToken();

  return (
    <section className={styles.panel} aria-labelledby="workspace-lifecycle-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{messages.eyebrow}</p>
          <h2 id="workspace-lifecycle-title">{messages.heading}</h2>
          <p>{messages.description}</p>
        </div>
        <p className={styles.localOnly}>{messages.localOnly}</p>
      </header>

      {storageProtection.mode !== "normal" ? (
        <section
          className={styles.persistentWarning}
          role="status"
          aria-labelledby="workspace-storage-warning"
        >
          <ShieldAlert aria-hidden="true" />
          <div>
            <h3 id="workspace-storage-warning">
              {storageProtection.mode === "degraded"
                ? messages.degradedHeading
                : messages.recoveryOnlyHeading}
            </h3>
            <p>
              {storageProtection.mode === "degraded"
                ? messages.degradedDescription
                : messages.recoveryOnlyDescription}
            </p>
            <div className={styles.inlineActions}>
              <button
                type="button"
                disabled={!selectedProject}
                onClick={() => {
                  if (selectedProject) {
                    onExportSelectedProject(selectedProject.projectId);
                  }
                }}
              >
                <Download aria-hidden="true" />
                {messages.exportSelected}
              </button>
              <button type="button" onClick={onExportDiagnostics}>
                <FileSearch aria-hidden="true" />
                {messages.exportDiagnostics}
              </button>
            </div>
            {!selectedProject ? (
              <p className={styles.smallCopy}>{messages.noSelectedExport}</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {recovery.required ? (
        <section className={styles.recoveryCard} aria-labelledby="recovery-title">
          <div className={styles.sectionHeading}>
            <FileSearch aria-hidden="true" />
            <div>
              <h3 id="recovery-title">{messages.recoveryHeading}</h3>
              <p>{messages.recoveryDescription}</p>
            </div>
          </div>
          <p className={styles.statusLine}>
            {recovery.candidates.length === 1
              ? messages.recoveryCandidateCountOne
              : recovery.candidates.length > 1
              ? format(messages.recoveryCandidateCount, {
                  count: count(recovery.candidates.length),
                })
              : messages.recoveryNoCandidates}
          </p>
          {recovery.invalidOwnedRecordCount > 0 ? (
            <p className={styles.alertLine}>
              <AlertTriangle aria-hidden="true" />
              {format(messages.recoveryInvalidRecords, {
                count: count(recovery.invalidOwnedRecordCount),
              })}
            </p>
          ) : null}
          <div className={styles.inlineActions}>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={!recovery.available || recovery.candidates.length === 0}
              onClick={(event) =>
                openDialog(
                  { kind: "recover-index", recovery },
                  event.currentTarget,
                )
              }
            >
              <ArchiveRestore aria-hidden="true" />
              {messages.reviewRecovery}
            </button>
            <button type="button" onClick={onExportDiagnostics}>
              <Download aria-hidden="true" />
              {messages.exportDiagnostics}
            </button>
            <button
              type="button"
              className={styles.dangerButton}
              disabled={!storageProtection.destructiveJournalAvailable}
              onClick={(event) =>
                openDialog(
                  { kind: "delete-workspace-recovery", recovery },
                  event.currentTarget,
                )
              }
            >
              <ShieldAlert aria-hidden="true" />
              {messages.reviewRecoveryPrivacy}
            </button>
          </div>
          <p className={styles.smallCopy}>{messages.unselectedQuarantined}</p>
          <p className={styles.smallCopy}>{messages.recoveryPrivacyDescription}</p>
          {!storageProtection.destructiveJournalAvailable ? (
            <p className={styles.alertLine}>{messages.journalUnavailable}</p>
          ) : null}
        </section>
      ) : null}

      <div className={styles.grid}>
        <section className={styles.card} aria-labelledby="storage-management-title">
          <div className={styles.sectionHeading}>
            <HardDrive aria-hidden="true" />
            <div>
              <h3 id="storage-management-title">{messages.storageHeading}</h3>
              <p>{messages.storageDescription}</p>
            </div>
          </div>
          {workspace ? (
            <>
              <dl className={styles.metrics}>
                <div>
                  <dt>{messages.activeProjects}</dt>
                  <dd>{count(workspace.activeProjectCount)}</dd>
                </div>
                <div>
                  <dt>{messages.tombstones}</dt>
                  <dd>{count(workspace.tombstoneCount)}</dd>
                </div>
                <div>
                  <dt>{messages.physicalRecords}</dt>
                  <dd>{count(workspace.physicalProjectRecordCount)}</dd>
                </div>
                <div>
                  <dt>{messages.legacyValues}</dt>
                  <dd>{count(workspace.legacyValueCount)}</dd>
                </div>
              </dl>
              <p className={styles.identifiers}>
                <span>
                  {format(messages.generation, {
                    generation: count(workspace.workspaceGeneration),
                  })}
                </span>
                <span>
                  {format(messages.indexRevision, {
                    revision: count(workspace.indexRevision),
                  })}
                </span>
              </p>
              <div className={styles.policy} data-policy={policy}>
                <strong>{messages.policy}</strong>
                <span>{policyMessage}</span>
                {policyDetail ? <p>{policyDetail}</p> : null}
              </div>
              <p className={styles.reserveStatus}>
                <Database aria-hidden="true" />
                {reserveMessage}
              </p>
            </>
          ) : (
            <p className={styles.alertLine}>{messages.recoveryOnlyDescription}</p>
          )}
        </section>

        <section className={styles.card} aria-labelledby="selected-project-title">
          <div className={styles.sectionHeading}>
            <Download aria-hidden="true" />
            <div>
              <h3 id="selected-project-title">{messages.projectHeading}</h3>
              <p>{messages.backupDescription}</p>
            </div>
          </div>
          {selectedProject ? (
            <div className={styles.selectedProject}>
              <strong>{selectedProject.title}</strong>
              <span>{selectedProject.course}</span>
              <span>
                {format(messages.projectRevision, {
                  revision: count(selectedProject.recordRevision),
                })}
              </span>
              <code>
                {format(messages.exactProjectId, {
                  projectId: selectedProject.projectId,
                })}
              </code>
            </div>
          ) : (
            <p>{messages.noSelectedProject}</p>
          )}
          <div className={styles.stackActions}>
            <button
              type="button"
              disabled={!selectedProject}
              aria-label={
                selectedProject
                  ? format(messages.exportSelectedLabel, {
                      title: selectedProject.title,
                    })
                  : undefined
              }
              onClick={() => {
                if (selectedProject) {
                  onExportSelectedProject(selectedProject.projectId);
                }
              }}
            >
              <Download aria-hidden="true" />
              {messages.exportSelected}
            </button>
            <button
              type="button"
              disabled={!selectedProject || recoveryOnly}
              onClick={() => {
                if (selectedProject) {
                  onChooseReplacementBackup(selectedProject.projectId);
                }
              }}
            >
              <ArchiveRestore aria-hidden="true" />
              {messages.chooseBackup}
            </button>
          </div>

          {replacementPreview && selectedProject ? (
            <section
              className={styles.preview}
              aria-labelledby="replacement-preview-title"
            >
              <h4 id="replacement-preview-title">
                {messages.replacePreviewHeading}
              </h4>
              <dl>
                <div>
                  <dt>{messages.replaceTarget}</dt>
                  <dd>{selectedProject.title}</dd>
                </div>
                <div>
                  <dt>{messages.backupTitle}</dt>
                  <dd>{replacementPreview.backupTitle}</dd>
                </div>
                <div>
                  <dt>{messages.backupCourse}</dt>
                  <dd>{replacementPreview.backupCourse}</dd>
                </div>
                <div>
                  <dt>{messages.backupDeadline}</dt>
                  <dd>{dateLabel(replacementPreview.backupDeadline)}</dd>
                </div>
                <div>
                  <dt>{messages.backupSource}</dt>
                  <dd>{replacementPreview.sourceName}</dd>
                </div>
              </dl>
              {!previewCurrent ? (
                <p className={styles.alertLine}>{messages.previewExpired}</p>
              ) : storageProtection.mode === "degraded" &&
                replacementPreview.sizeEffect === "growing" ? (
                <p className={styles.alertLine}>
                  {messages.degradedReplacementBlocked}
                </p>
              ) : !storageProtection.destructiveJournalAvailable ? (
                <p className={styles.alertLine}>
                  {messages.journalUnavailable}
                </p>
              ) : null}
              <button
                type="button"
                className={styles.primaryButton}
                disabled={!replacementAllowed || !workspace}
                onClick={(event) => {
                  if (workspace && previewCurrent) {
                    openDialog(
                      {
                        kind: "replace-project",
                        workspace,
                        project: selectedProject,
                        preview: replacementPreview,
                      },
                      event.currentTarget,
                    );
                  }
                }}
              >
                <ArchiveRestore aria-hidden="true" />
                {messages.reviewReplacement}
              </button>
            </section>
          ) : null}
        </section>

        <section className={styles.card} aria-labelledby="maintenance-title">
          <div className={styles.sectionHeading}>
            <RefreshCcw aria-hidden="true" />
            <div>
              <h3 id="maintenance-title">{messages.rotationHeading}</h3>
              <p>
                {format(messages.rotationDescription, {
                  generation: count(
                    rotation?.targetGeneration ??
                      (workspace?.workspaceGeneration ?? 0) + 1,
                  ),
                })}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={
              !workspace ||
              !rotation?.eligible ||
              !destructiveAvailable ||
              storageProtection.mode === "degraded"
            }
            onClick={(event) => {
              if (workspace && rotation?.eligible) {
                openDialog(
                  { kind: "rotate-workspace-generation", workspace, rotation },
                  event.currentTarget,
                );
              }
            }}
          >
            <RefreshCcw aria-hidden="true" />
            {messages.reviewRotation}
          </button>
          {!rotation || workspace?.tombstoneCount === 0 ? (
            <p className={styles.smallCopy}>{messages.rotationNotNeeded}</p>
          ) : !rotation.eligible ? (
            <p className={styles.alertLine}>{messages.rotationUnavailable}</p>
          ) : !storageProtection.destructiveJournalAvailable ? (
            <p className={styles.alertLine}>{messages.journalUnavailable}</p>
          ) : null}
        </section>

        <section className={styles.card} aria-labelledby="legacy-cleanup-title">
          <div className={styles.sectionHeading}>
            <Database aria-hidden="true" />
            <div>
              <h3 id="legacy-cleanup-title">{messages.legacyHeading}</h3>
              <p>{messages.legacyDescription}</p>
            </div>
          </div>
          <button
            type="button"
            disabled={
              !workspace ||
              workspace.legacyValueCount === 0 ||
              !legacyCleanup?.available ||
              !destructiveAvailable
            }
            onClick={(event) => {
              if (workspace && legacyCleanup?.available) {
                openDialog(
                  { kind: "legacy-cleanup", workspace, cleanup: legacyCleanup },
                  event.currentTarget,
                );
              }
            }}
          >
            <Trash2 aria-hidden="true" />
            {messages.reviewLegacyCleanup}
          </button>
          {workspace?.legacyValueCount === 0 ? (
            <p className={styles.smallCopy}>{messages.noLegacyValues}</p>
          ) : !legacyCleanup?.available ? (
            <p className={styles.alertLine}>{messages.legacyUnavailable}</p>
          ) : !storageProtection.destructiveJournalAvailable ? (
            <p className={styles.alertLine}>{messages.journalUnavailable}</p>
          ) : null}
        </section>
      </div>

      <section className={styles.dangerZone} aria-labelledby="danger-zone-title">
        <div className={styles.dangerItem}>
          <div>
            <h3>{messages.deleteProjectHeading}</h3>
            <p>{messages.deleteProjectDescription}</p>
          </div>
          <button
            type="button"
            className={styles.dangerButton}
            disabled={!workspace || !selectedProject || !destructiveAvailable}
            onClick={(event) => {
              if (workspace && selectedProject) {
                openDialog(
                  { kind: "delete-project", workspace, project: selectedProject },
                  event.currentTarget,
                );
              }
            }}
          >
            <Trash2 aria-hidden="true" />
            {messages.reviewDeleteProject}
          </button>
        </div>
        <div className={styles.dangerItem}>
          <div>
            <h3 id="danger-zone-title">{messages.dangerHeading}</h3>
            <p>{messages.dangerDescription}</p>
          </div>
          <button
            type="button"
            className={styles.dangerButton}
            disabled={!workspace || !destructiveAvailable}
            onClick={(event) => {
              if (workspace) {
                openDialog(
                  { kind: "delete-workspace", workspace },
                  event.currentTarget,
                );
              }
            }}
          >
            <ShieldAlert aria-hidden="true" />
            {messages.reviewWorkspaceDelete}
          </button>
        </div>
        {!storageProtection.destructiveJournalAvailable ? (
          <p className={styles.alertLine}>{messages.journalUnavailable}</p>
        ) : null}
      </section>

      {dialog ? (
        <div className={styles.dialogShell} data-testid="lifecycle-dialog-shell">
          <button
            type="button"
            className={styles.backdrop}
            aria-label={messages.dialogClose}
            disabled={pending}
            onClick={closeDialog}
          />
          <section
            ref={dialogRef}
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            aria-describedby={dialogDescriptionId}
            aria-busy={pending || undefined}
            tabIndex={-1}
          >
            <header className={styles.dialogHeader}>
              <div>
                <p className={styles.eyebrow}>{messages.eyebrow}</p>
                <h3 id={dialogTitleId}>
                  {dialog.kind === "replace-project"
                    ? messages.replaceDialogHeading
                    : dialog.kind === "delete-project"
                      ? messages.deleteProjectDialogHeading
                      : dialog.kind === "legacy-cleanup"
                        ? messages.legacyDialogHeading
                        : dialog.kind === "delete-workspace"
                          ? messages.workspaceDeleteDialogHeading
                          : dialog.kind === "delete-workspace-recovery"
                            ? messages.recoveryPrivacyDialogHeading
                          : dialog.kind === "rotate-workspace-generation"
                            ? messages.rotationDialogHeading
                            : messages.recoveryDialogHeading}
                </h3>
              </div>
              <button
                type="button"
                className={styles.closeButton}
                aria-label={messages.dialogClose}
                disabled={pending}
                data-dialog-initial-focus
                onClick={closeDialog}
              >
                <X aria-hidden="true" />
              </button>
            </header>

            <p id={dialogDescriptionId} className={styles.dialogDescription}>
              {dialog.kind === "replace-project"
                ? messages.replaceDialogDescription
                : dialog.kind === "delete-project"
                  ? messages.deleteProjectDialogDescription
                  : dialog.kind === "legacy-cleanup"
                    ? messages.legacyDialogDescription
                    : dialog.kind === "delete-workspace"
                      ? messages.workspaceDeleteDialogDescription
                      : dialog.kind === "delete-workspace-recovery"
                        ? messages.recoveryPrivacyDialogDescription
                      : dialog.kind === "rotate-workspace-generation"
                        ? format(messages.rotationDialogDescription, {
                            source: count(dialog.workspace.workspaceGeneration),
                            target: count(dialog.rotation.targetGeneration),
                          })
                        : messages.recoveryDialogDescription}
            </p>

            {dialog.kind !== "recover-index" &&
            dialog.kind !== "delete-workspace-recovery" ? (
              <div className={styles.exactScope}>
                <code>
                  {format(messages.exactWorkspaceId, {
                    workspaceId: dialog.workspace.workspaceId,
                  })}
                </code>
                {dialog.kind === "replace-project" ||
                dialog.kind === "delete-project" ? (
                  <>
                    <strong>{dialog.project.title}</strong>
                    <code>
                      {format(messages.exactProjectId, {
                        projectId: dialog.project.projectId,
                      })}
                    </code>
                  </>
                ) : null}
                {dialog.kind === "replace-project" ? (
                  <>
                    <span>{dialog.preview.backupTitle}</span>
                    <span>{dialog.preview.backupCourse}</span>
                    <code>
                      {format(messages.exactBackupToken, {
                        token: dialog.preview.backupToken,
                      })}
                    </code>
                  </>
                ) : null}
              </div>
            ) : null}

            {dialog.kind === "delete-workspace-recovery" ? (
              <div className={styles.exactScope}>
                <strong>
                  {dialog.recovery.candidates.length === 1
                    ? messages.recoveryCandidateCountOne
                    : format(messages.recoveryCandidateCount, {
                        count: count(dialog.recovery.candidates.length),
                      })}
                </strong>
                <span>
                  {format(messages.recoveryInvalidRecords, {
                    count: count(dialog.recovery.invalidOwnedRecordCount),
                  })}
                </span>
                {dialog.recovery.candidates.map((candidate) => (
                  <code key={candidate.candidateId}>
                    {format(messages.candidateWorkspace, {
                      workspaceId: candidate.workspaceId,
                    })}
                    {" · "}
                    {format(messages.candidateGeneration, {
                      generation: count(candidate.workspaceGeneration),
                    })}
                  </code>
                ))}
              </div>
            ) : null}

            {!intentCurrent ? (
              <p className={styles.dialogAlert} role="alert">
                <AlertTriangle aria-hidden="true" />
                {messages.staleIntent}
              </p>
            ) : null}

            <form onSubmit={confirmAction}>
              {dialog.kind === "recover-index" ? (
                <fieldset
                  id={recoveryCandidatesId}
                  className={styles.candidates}
                  disabled={pending}
                >
                  <legend>{messages.candidateNotSelected}</legend>
                  {dialog.recovery.candidates.map((candidate) => (
                    <label key={candidate.candidateId}>
                      <input
                        type="radio"
                        name="recovery-candidate"
                        value={candidate.candidateId}
                        checked={selectedCandidateId === candidate.candidateId}
                        onChange={() =>
                          setSelectedCandidateId(candidate.candidateId)
                        }
                      />
                      <span>
                        <strong>
                          {format(messages.candidateWorkspace, {
                            workspaceId: candidate.workspaceId,
                          })}
                        </strong>
                        <span>
                          {format(messages.candidateGeneration, {
                            generation: count(candidate.workspaceGeneration),
                          })}
                        </span>
                        <span>
                          {format(messages.candidateCounts, {
                            active: count(candidate.activeProjectCount),
                            tombstones: count(candidate.tombstoneCount),
                          })}
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              ) : null}

              {confirmationToken ? (
                <label className={styles.confirmationField}>
                  <span>
                    {format(messages.typeExact, { token: confirmationToken })}
                  </span>
                  <input
                    type="text"
                    value={confirmation}
                    disabled={pending}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </label>
              ) : null}

              {!confirmationToken ||
              dialog.kind === "delete-workspace-recovery" ? (
                <label className={styles.acknowledgement}>
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    disabled={pending}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                  <span>
                    {dialog.kind === "replace-project"
                      ? messages.replaceAcknowledge
                      : dialog.kind === "rotate-workspace-generation"
                        ? messages.rotationAcknowledge
                        : dialog.kind === "delete-workspace-recovery"
                          ? messages.recoveryPrivacyAcknowledge
                        : messages.recoveryAcknowledge}
                  </span>
                </label>
              ) : null}

              {failure ? (
                <p
                  ref={failureRef}
                  className={styles.dialogAlert}
                  role="alert"
                  tabIndex={-1}
                >
                  <AlertTriangle aria-hidden="true" />
                  {messages[FAILURE_MESSAGE_KEYS[failure]]}
                </p>
              ) : null}

              <div className={styles.dialogActions}>
                <button type="button" disabled={pending} onClick={closeDialog}>
                  {messages.cancel}
                </button>
                <button
                  type="submit"
                  className={styles.confirmButton}
                  disabled={pending || !confirmationIsValid()}
                >
                  {pending
                    ? messages.working
                    : dialog.kind === "replace-project"
                      ? messages.confirmReplace
                      : dialog.kind === "delete-project"
                        ? messages.confirmDeleteProject
                        : dialog.kind === "legacy-cleanup"
                          ? messages.confirmLegacyCleanup
                          : dialog.kind === "delete-workspace"
                            ? messages.confirmWorkspaceDelete
                            : dialog.kind === "rotate-workspace-generation"
                              ? messages.confirmRotation
                              : dialog.kind === "delete-workspace-recovery"
                                ? messages.confirmRecoveryPrivacy
                              : messages.confirmRecovery}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}
