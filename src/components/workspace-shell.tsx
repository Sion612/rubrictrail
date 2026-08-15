"use client";

import { useEffect, useRef, type ChangeEvent, type ReactNode } from "react";
import {
  ArchiveRestore,
  BookOpenCheck,
  Check,
  ClipboardCheck,
  Code2,
  Download,
  FileSearch,
  ListChecks,
  RotateCcw,
  Route,
  Upload,
  UploadCloud,
} from "lucide-react";
import { CommunityLinks } from "@/components/community-links";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n, useLocalizedMessages } from "@/components/locale-provider";
import { BRAND } from "@/lib/brand";
import { workspaceEn, workspaceZhCN } from "@/lib/i18n/messages/workspace";
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
  label: keyof typeof workspaceEn;
  helper: keyof typeof workspaceEn;
  icon: typeof FileSearch;
}> = [
  { id: "overview", label: "navOverview", helper: "navOverviewHelper", icon: FileSearch },
  { id: "rubric", label: "navRubric", helper: "navRubricHelper", icon: Route },
  { id: "plan", label: "navPlan", helper: "navPlanHelper", icon: ListChecks },
  { id: "draft", label: "navDraft", helper: "navDraftHelper", icon: ClipboardCheck },
  { id: "progress", label: "navProgress", helper: "navProgressHelper", icon: BookOpenCheck },
];

const STATE_LABEL: Record<WorkflowState, keyof typeof workspaceEn> = {
  complete: "stateComplete",
  in_progress: "stateInProgress",
  needs_review: "stateNeedsReview",
  not_started: "stateNotStarted",
};

function closeDetailsMenu(
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
  const messages = useLocalizedMessages(workspaceEn, workspaceZhCN);
  const { formatDate, formatNumber } = useI18n();
  const backupInputRef = useRef<HTMLInputElement>(null);
  const backupMenuRef = useRef<HTMLDetailsElement>(null);
  const communityMenuRef = useRef<HTMLDetailsElement>(null);
  const dueDate = formatDate(new Date(`${project.dueDate}T12:00:00`), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  useEffect(() => {
    function handleDetailsMenuDismiss(event: PointerEvent | KeyboardEvent) {
      const menus = [backupMenuRef.current, communityMenuRef.current];
      if (event.type === "keydown") {
        if ((event as KeyboardEvent).key !== "Escape") return;
        for (const menu of menus) {
          if (menu?.open) closeDetailsMenu(menu, true);
        }
        return;
      }
      for (const menu of menus) {
        if (menu?.open && !menu.contains(event.target as Node)) {
          closeDetailsMenu(menu);
        }
      }
    }

    document.addEventListener("pointerdown", handleDetailsMenuDismiss);
    document.addEventListener("keydown", handleDetailsMenuDismiss);
    return () => {
      document.removeEventListener("pointerdown", handleDetailsMenuDismiss);
      document.removeEventListener("keydown", handleDetailsMenuDismiss);
    };
  }, []);

  function handleBackupInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    closeDetailsMenu(backupMenuRef.current, true);
    onImportBackup(file);
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-main">{messages.skipToMain}</a>
      <header className="app-header">
        <button
          className="brand-lockup brand-button"
          type="button"
          aria-label={messages.openProjectBrief.replace("{brand}", BRAND.name)}
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
          <LanguageSwitcher compact />
          <span className="due-label"><span>{messages.due}</span> {dueDate}</span>
          {project.mode === "sample" ? (
            <button
              className="start-own-project-button"
              type="button"
              aria-label={messages.useMyAssignment}
              onClick={onStartOwnProject}
              title={messages.leaveSample}
            >
              <UploadCloud aria-hidden="true" />
              <span>{messages.useMyAssignment}</span>
            </button>
          ) : (
            <div className="mode-indicator" title={messages.localOnlyTitle}>
              <span aria-hidden="true" />{messages.localOnly}
            </div>
          )}
          <details className="project-backup-menu" ref={backupMenuRef}>
            <summary
              className="icon-button"
              aria-label={messages.backupOptions}
              title={messages.backupOptions}
              onClick={() => {
                if (!backupMenuRef.current?.open) {
                  closeDetailsMenu(communityMenuRef.current);
                }
              }}
            >
              <ArchiveRestore aria-hidden="true" />
            </summary>
            <div className="project-backup-popover">
              <strong>{messages.projectBackup}</strong>
              <p>{messages.backupDescription}</p>
              <button
                className="backup-menu-action"
                type="button"
                onClick={() => {
                  closeDetailsMenu(backupMenuRef.current, true);
                  onExportBackup();
                }}
              >
                <Download aria-hidden="true" />
                <span><strong>{messages.downloadBackup}</strong><small>{messages.downloadBackupDetail}</small></span>
              </button>
              <button
                className="backup-menu-action"
                type="button"
                disabled={isImportingBackup}
                onClick={() => backupInputRef.current?.click()}
              >
                <Upload aria-hidden="true" />
                <span><strong>{isImportingBackup ? messages.readingBackup : messages.restoreBackup}</strong><small>{messages.restoreBackupDetail}</small></span>
              </button>
              <input
                ref={backupInputRef}
                className="visually-hidden"
                type="file"
                accept=".rubrictrail.json,.json,application/json"
                aria-label={messages.chooseBackup}
                disabled={isImportingBackup}
                onChange={handleBackupInput}
                data-testid="workspace-backup-file-input"
              />
            </div>
          </details>
          <button className="icon-button" type="button" onClick={onReset} aria-label={messages.resetProject} title={messages.resetProject}>
            <RotateCcw aria-hidden="true" />
          </button>
        </div>
      </header>

      <nav className="mobile-workflow" aria-label={messages.workflowLabel}>
        {NAV_ITEMS.map((item, index) => (
          <button
            type="button"
            key={item.id}
            className={`${view === item.id ? "is-active " : ""}state-${stepStates[item.id]}`}
            aria-current={view === item.id ? "step" : undefined}
            onClick={() => onNavigate(item.id)}
          >
            <span>{stepStates[item.id] === "complete" ? <Check aria-hidden="true" /> : index + 1}</span>
            <b>{messages[item.label]}</b>
            <small>{messages[STATE_LABEL[stepStates[item.id]]]}</small>
          </button>
        ))}
      </nav>

      <aside className="workflow-rail">
        <p className="rail-label">{messages.workflow}</p>
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
                    <small>{messages[item.helper]}</small>
                    <strong>{messages[item.label]}</strong>
                    <em>{messages[STATE_LABEL[state]]}</em>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="rail-progress">
          <div><span>{messages.taskProgress}</span><strong>{Math.round(progress)}%</strong></div>
          <div
            className="progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
            aria-label={messages.progressAria}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <p>{messages.progressExplanation}</p>
        </div>
        <div className="integrity-note rail-integrity">
          <BookOpenCheck aria-hidden="true" />
          <p><strong>{messages.learningYours}</strong> {messages.integrityLine}</p>
        </div>
      </aside>

      <main className="workspace-main" id="workspace-main" tabIndex={-1}>
        <div className="workspace-context-line">
          <FileSearch aria-hidden="true" />
          <strong>{project.title}</strong>
          <span>·</span>
          <span>{messages.due} {dueDate}</span>
          <span>·</span>
          <span>{messages.wordCount.replace("{count}", formatNumber(project.wordCount))}</span>
          <details className="workspace-community-menu" ref={communityMenuRef}>
            <summary
              aria-label={messages.openSourceLinks}
              onClick={() => {
                if (!communityMenuRef.current?.open) {
                  closeDetailsMenu(backupMenuRef.current);
                }
              }}
            >
              <Code2 aria-hidden="true" />
              <span>{messages.openSource}</span>
            </summary>
            <div className="workspace-community-popover">
              <strong>{messages.openSourceHeading}</strong>
              <p>{messages.openSourceDescription}</p>
              <CommunityLinks />
            </div>
          </details>
          <small>{project.mode === "sample" ? messages.sampleProject : messages.localProject}</small>
        </div>
        {children}
      </main>
      {evidencePanel}
    </div>
  );
}
