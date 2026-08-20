"use client";

import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useLocalizedMessages } from "@/components/locale-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
  MultiAssignmentDashboard,
  type NewAssignmentMethod,
} from "@/components/multi-assignment-workspace/multi-assignment-dashboard";
import {
  deriveWorkspaceDashboardModel,
  type WorkspaceDashboardProject,
} from "@/components/multi-assignment-workspace/dashboard-model";

import styles from "./multi-assignment-workspace-shell.module.css";

const shellEn = {
  navigation: "Workspace navigation",
  allAssignments: "All assignments",
  newAssignment: "New assignment",
  assignmentWorkspace: "Assignment workspace",
  pendingBlocked:
    "Finish or resolve the pending save before opening another assignment.",
  preferenceFailed:
    "This tab switched assignments, but the last-opened preference could not be saved.",
} as const;

const shellZhCN = {
  navigation: "作业空间导航",
  allAssignments: "全部作业",
  newAssignment: "新建作业",
  assignmentWorkspace: "作业工作区",
  pendingBlocked: "请先完成或处理当前作业的待保存内容，再打开另一份作业。",
  preferenceFailed: "本标签页已切换作业，但无法保存上次打开的作业偏好。",
} satisfies { [Key in keyof typeof shellEn]: string };

export interface MultiAssignmentWorkspaceShellProps {
  projects: readonly WorkspaceDashboardProject[];
  asOfDate: string;
  initialSelectedProjectId?: string | null;
  selectedProjectId?: string | null;
  creationMethod?: NewAssignmentMethod | null;
  pendingProjectIds?: readonly string[];
  onNewAssignment: (method: NewAssignmentMethod) => void;
  onSelectionRequested?: (
    projectId: string,
  ) => boolean | Promise<boolean>;
  onSelectionApplied?: (projectId: string) => boolean | Promise<boolean>;
  onDashboardShown?: () => void;
  renderAssignment: (project: WorkspaceDashboardProject) => ReactNode;
  renderNewAssignment?: (method: NewAssignmentMethod) => ReactNode;
}

export function MultiAssignmentWorkspaceShell({
  projects,
  asOfDate,
  initialSelectedProjectId = null,
  selectedProjectId: controlledSelectedProjectId,
  creationMethod = null,
  pendingProjectIds = [],
  onNewAssignment,
  onSelectionRequested,
  onSelectionApplied,
  onDashboardShown,
  renderAssignment,
  renderNewAssignment,
}: MultiAssignmentWorkspaceShellProps) {
  const messages = useLocalizedMessages(shellEn, shellZhCN);
  const [internalSelectedProjectId, setInternalSelectedProjectId] = useState<string | null>(
    initialSelectedProjectId,
  );
  const selectedProjectId =
    controlledSelectedProjectId === undefined
      ? internalSelectedProjectId
      : controlledSelectedProjectId;
  const [lastAssignmentId, setLastAssignmentId] = useState<string | null>(
    initialSelectedProjectId,
  );
  const [statusKind, setStatusKind] = useState<
    "pending-save" | "preference-failed" | null
  >(null);
  const pendingPreferenceRef = useRef<string | null>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousDetailRef = useRef<string | null>(initialSelectedProjectId);
  const activeProjects = useMemo(
    () => projects.filter((project) => project.state.projectKind !== "none"),
    [projects],
  );
  const selectedProject =
    activeProjects.find((project) => project.projectId === selectedProjectId) ??
    null;
  const effectiveSelectedProjectId = selectedProject?.projectId ?? null;
  const activeDetailKey = creationMethod
    ? `new:${creationMethod}`
    : effectiveSelectedProjectId;
  const selectedSummary = selectedProject
    ? deriveWorkspaceDashboardModel([selectedProject], {
        asOfDate,
        upNextLimit: 0,
      }).assignments[0] ?? null
    : null;

  useEffect(() => {
    const previous = previousDetailRef.current;
    previousDetailRef.current = activeDetailKey;
    if (activeDetailKey !== null) {
      detailHeadingRef.current?.focus({ preventScroll: true });
    } else if (previous !== null) {
      const heading = document.querySelector<HTMLElement>(
        "[data-workspace-dashboard-heading]",
      );
      heading?.focus({ preventScroll: true });
    }
  }, [activeDetailKey]);

  useEffect(() => {
    const projectId = pendingPreferenceRef.current;
    if (projectId === null || projectId !== effectiveSelectedProjectId) return;
    pendingPreferenceRef.current = null;
    let active = true;
    Promise.resolve(onSelectionApplied?.(projectId) ?? true)
      .then((persisted) => {
        if (active && !persisted) setStatusKind("preference-failed");
      })
      .catch(() => {
        if (active) setStatusKind("preference-failed");
      });
    return () => {
      active = false;
    };
  }, [effectiveSelectedProjectId, onSelectionApplied]);

  async function openAssignment(projectId: string) {
    const target = activeProjects.find((project) => project.projectId === projectId);
    if (!target) return;
    const priorProjectId = activeProjects.some(
      (project) => project.projectId === lastAssignmentId,
    )
      ? lastAssignmentId
      : null;
    if (
      priorProjectId !== null &&
      priorProjectId !== projectId &&
      pendingProjectIds.includes(priorProjectId)
    ) {
      setStatusKind("pending-save");
      return;
    }
    let allowed = true;
    try {
      allowed = await Promise.resolve(onSelectionRequested?.(projectId) ?? true);
    } catch {
      allowed = false;
    }
    if (!allowed) {
      setStatusKind("pending-save");
      return;
    }
    setStatusKind(null);
    setLastAssignmentId(projectId);
    pendingPreferenceRef.current = projectId;
    if (controlledSelectedProjectId === undefined) {
      setInternalSelectedProjectId(projectId);
    }
  }

  function showDashboard() {
    pendingPreferenceRef.current = null;
    setStatusKind(null);
    if (controlledSelectedProjectId === undefined) {
      setInternalSelectedProjectId(null);
    }
    onDashboardShown?.();
  }

  return (
    <div className={styles.shell}>
      <nav className={styles.topbar} aria-label={messages.navigation}>
        <button type="button" className={styles.brand} onClick={showDashboard}>
          RubricTrail
        </button>
        <div className={styles.topbarActions}>
          <LanguageSwitcher compact />
          {selectedProject || creationMethod ? (
            <button
              type="button"
              className={styles.allAssignments}
              onClick={showDashboard}
            >
              {messages.allAssignments}
            </button>
          ) : null}
        </div>
      </nav>

      {statusKind ? (
        <p className={styles.status} role="status">
          {statusKind === "pending-save"
            ? messages.pendingBlocked
            : messages.preferenceFailed}
        </p>
      ) : null}

      {selectedProject || creationMethod ? (
        <section className={styles.detail}>
          <header className={styles.detailHeader}>
            <p>{messages.assignmentWorkspace}</p>
            <h1 ref={detailHeadingRef} tabIndex={-1}>
              {creationMethod ? messages.newAssignment : selectedSummary?.title ?? "RubricTrail"}
            </h1>
          </header>
          <div className={styles.detailContent}>
            {creationMethod
              ? renderNewAssignment?.(creationMethod)
              : selectedProject
                ? renderAssignment(selectedProject)
                : null}
          </div>
        </section>
      ) : (
        <MultiAssignmentDashboard
          projects={activeProjects}
          asOfDate={asOfDate}
          onOpenAssignment={openAssignment}
          onNewAssignment={onNewAssignment}
        />
      )}
    </div>
  );
}
