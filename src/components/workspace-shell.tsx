"use client";

import type { ReactNode } from "react";
import {
  BookOpenCheck,
  Check,
  ClipboardCheck,
  FileSearch,
  ListChecks,
  RotateCcw,
  Route,
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

export function WorkspaceShell({
  view,
  onNavigate,
  onReset,
  progress,
  stepStates,
  project,
  children,
  evidencePanel,
}: WorkspaceShellProps) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-main">Skip to main content</a>
      <header className="app-header">
        <button className="brand-lockup brand-button" type="button" onClick={() => onNavigate("overview")}>
          <span className="brand-mark" aria-hidden="true"><Route /></span>
          <span>{BRAND.name}</span>
        </button>
        <div className="project-identity">
          <span>{project.course}</span>
          <strong>{project.title}</strong>
        </div>
        <div className="header-actions">
          <span className="due-label"><span>Due</span> {dateLabel(project.dueDate)}</span>
          <div className="mode-indicator" title={project.mode === "sample" ? BRAND.demoDescription : "Confirmed fields are saved only in this browser."}>
            <span aria-hidden="true" />{project.mode === "sample" ? "Sample demo" : "Local-only"}
          </div>
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
          <small>{project.mode === "sample" ? "sample project" : "uploaded project"}</small>
        </div>
        {children}
      </main>
      {evidencePanel}
    </div>
  );
}
