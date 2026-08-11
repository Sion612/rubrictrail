"use client";

import { useEffect, useRef, type ChangeEvent, type ReactNode } from "react";
import {
  ArchiveRestore,
  BookOpenCheck,
  Check,
  ClipboardCheck,
  Download,
  FileSearch,
  ListChecks,
  RotateCcw,
  Route,
  Upload,
  UploadCloud,
} from "lucide-react";
import { BRAND } from "@/lib/brand";
import type { WorkflowState, WorkspaceView } from "@/lib/ui-types";

export interface WorkspaceProjectMeta {
  course: string;
  title: string;
  dueDate: string;
  wordCount: number;
  mode: "sample" | "uploaded";
}

interface WorkspaceShellProps {
  view: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
  onReset: () => void;
  onStartOwnProject: () => void;
  onExportBackup: () => void;
  onImportBackup: (file: File) => void;
  isImportingBackup: boolean;
  progress: number;
  stepStates: Record<WorkspaceView, WorkflowState>;
  project: WorkspaceProjectMeta;
  children: ReactNode;
  evidencePanel: ReactNode;
}

const NAV_ITEMS: Array<{
  id: WorkspaceView;
  label: string;
  helper: string;
  icon: typeof FileSearch;
}> = [
  { id: "overview", label: "Brief", helper: "Understand", icon: FileSearch },
  { id: "rubric", label: "Rubric", helper: "Confirm", icon: Route },
  { id: "plan", label: "Plan", helper: "Build", icon: ListChecks },
  { id: "draft", label: "Check", helper: "Review", icon: ClipboardCheck },
  { id: "progress", label: "Progress", helper: "Finish", icon: BookOpenCheck },
];

const STATE_LABEL: Record<WorkflowState, string> = {
  complete: "Confirmed",
  in_progress: "In progress",
  needs_review: "Needs review",
  not_started: "Not started",
};

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function closeBackupMenu(
  menu: HTMLDetailsElement | null,
  restoreFocus = false,
) {
  menu?.removeAttribute("open");
  if (restoreFocus) {
    menu
      ?.querySelector<HTMLElement>("summary")
      ?.focus({ preventScroll: true });
  }
}

export function WorkspaceShell({
  view,
  onNavigate,
  onReset,
  onStartOwnProject,
  onExportBackup,
  onImportBackup,
  isImportingBackup,
  progress,
  stepStates,
  project,
  children,
  evidencePanel,
}: WorkspaceShellProps) {
  const backupInputRef = useRef<HTMLInputElement>(null);
  const backupMenuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function handleBackupMenuDismiss(event: PointerEvent | KeyboardEvent) {
      const menu = backupMenuRef.current;
      if (!menu?.open) return;
      if (event.type === "keydown") {
        if ((event as KeyboardEvent).key !== "Escape") return;
        closeBackupMenu(menu, true);
        return;
      }
      if (!menu.contains(event.target as Node)) {
        closeBackupMenu(menu);
      }
    }

    document.addEventListener("pointerdown", handleBackupMenuDismiss);
    document.addEventListener("keydown", handleBackupMenuDismiss);
    return () => {
      document.removeEventListener("pointerdown", handleBackupMenuDismiss);
      document.removeEventListener("keydown", handleBackupMenuDismiss);
    };
  }, []);

  function handleBackupInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    closeBackupMenu(backupMenuRef.current, true);
    onImportBackup(file);
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-main">Skip to main content</a>
      <header className="app-header">
        <button
          className="brand-lockup brand-button"
          type="button"
          aria-label={`${BRAND.name}: open project brief`}
          onClick={() => onNavigate("overview")}
        >
          <span className="brand-mark" aria-hidden="true"><Route /></span>
          <span>{BRAND.name}</span>
        </button>
        <div className="project-identity">
          <span>{project.course}</span>
          <strong>{project.title}</strong>
        </div>
        <div className="header-actions">
          <span className="due-label"><span>Due</span> {dateLabel(project.dueDate)}</span>
          {project.mode === "sample" ? (
            <button
              className="start-own-project-button"
              type="button"
              onClick={onStartOwnProject}
            title="Leave the sample demo and use your own assignment"
            >
              <UploadCloud aria-hidden="true" />
            <span>Use my assignment</span>
            </button>
          ) : (
            <div className="mode-indicator" title="Confirmed fields are saved only in this browser.">
              <span aria-hidden="true" />Local-only
            </div>
          )}
          <details className="project-backup-menu" ref={backupMenuRef}>
            <summary className="icon-button" aria-label="Project backup options" title="Project backup options">
              <ArchiveRestore aria-hidden="true" />
            </summary>
            <div className="project-backup-popover">
              <strong>Project backup</strong>
            <p>Contains saved project details, excerpts, draft text, self-checks and progress — never original files or full intake text.</p>
              <button
                className="backup-menu-action"
                type="button"
                onClick={() => {
                  closeBackupMenu(backupMenuRef.current, true);
                  onExportBackup();
                }}
              >
                <Download aria-hidden="true" />
                <span><strong>Download backup</strong><small>Keep the JSON file private.</small></span>
              </button>
              <button
                className="backup-menu-action"
                type="button"
                disabled={isImportingBackup}
                onClick={() => backupInputRef.current?.click()}
              >
                <Upload aria-hidden="true" />
                <span><strong>{isImportingBackup ? "Reading backup…" : "Restore backup"}</strong><small>Confirm before replacing this project.</small></span>
              </button>
              <input
                ref={backupInputRef}
                className="visually-hidden"
                type="file"
                accept=".rubrictrail.json,.json,application/json"
                aria-label="Choose a RubricTrail project backup"
                disabled={isImportingBackup}
                onChange={handleBackupInput}
                data-testid="workspace-backup-file-input"
              />
            </div>
          </details>
          <button className="icon-button" type="button" onClick={onReset} aria-label="Reset local project" title="Reset local project">
            <RotateCcw aria-hidden="true" />
          </button>
        </div>
      </header>

      <nav className="mobile-workflow" aria-label="Project workflow">
        {NAV_ITEMS.map((item, index) => (
          <button
            type="button"
            key={item.id}
            className={`${view === item.id ? "is-active " : ""}state-${stepStates[item.id]}`}
            aria-current={view === item.id ? "step" : undefined}
            onClick={() => onNavigate(item.id)}
          >
            <span>{stepStates[item.id] === "complete" ? <Check aria-hidden="true" /> : index + 1}</span>
            <b>{item.label}</b>
            <small>{STATE_LABEL[stepStates[item.id]]}</small>
          </button>
        ))}
      </nav>

      <aside className="workflow-rail">
        <p className="rail-label">Workflow</p>
        <ol>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const state = stepStates[item.id];
            return (
              <li
                key={item.id}
                className={`${view === item.id ? "is-active " : ""}${state === "complete" ? "is-complete " : ""}state-${state}`}
              >
                <button
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  aria-current={view === item.id ? "step" : undefined}
                >
                  <span className="rail-step" aria-hidden="true">{state === "complete" ? <Check /> : <Icon />}</span>
                  <span>
                    <small>{item.helper}</small>
                    <strong>{item.label}</strong>
                    <em>{STATE_LABEL[state]}</em>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="rail-progress">
          <div><span>Task progress</span><strong>{Math.round(progress)}%</strong></div>
          <div
            className="progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
            aria-label="Action-plan work complete"
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <p>Progress reflects completed work, not a predicted grade.</p>
        </div>
        <div className="integrity-note rail-integrity">
          <BookOpenCheck aria-hidden="true" />
          <p><strong>Learning stays yours.</strong> Plan, check, improve — never invent.</p>
        </div>
      </aside>

      <main className="workspace-main" id="workspace-main" tabIndex={-1}>
        <div className="workspace-context-line">
          <FileSearch aria-hidden="true" />
          <strong>{project.title}</strong>
          <span>·</span>
          <span>Due {dateLabel(project.dueDate)}</span>
          <span>·</span>
          <span>{project.wordCount.toLocaleString()} words</span>
          <small>{project.mode === "sample" ? "sample project" : "local project"}</small>
        </div>
        {children}
      </main>
      {evidencePanel}
    </div>
  );
}
