"use client";

import { useMemo, useState } from "react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { LocaleProvider, useLocalizedMessages } from "@/components/locale-provider";
import {
  MultiAssignmentWorkspaceShell,
  WorkspaceLifecyclePanel,
  type WorkspaceLifecycleActionRequest,
  type NewAssignmentMethod,
  type WorkspaceDashboardProject,
} from "@/components/multi-assignment-workspace";
import { buildDashboardProjectFixture } from "@/components/multi-assignment-workspace/multi-assignment-dashboard.test-fixtures";

const PROJECT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const baseProjectA = buildDashboardProjectFixture({
  projectId: PROJECT_A,
  title: "Fictional market entry analysis",
  course: "International Strategy Lab",
  dueDate: "2026-09-20",
});
const baseProjectB = buildDashboardProjectFixture({
  projectId: PROJECT_B,
  title: "Fictional language portfolio",
  course: "Language Studio",
  dueDate: "2026-10-03",
});
const restoredProject = buildDashboardProjectFixture({
  projectId: PROJECT_C,
  title: "Fictional restored assignment",
  course: "Research Methods Studio",
  dueDate: "2026-10-18",
});

const initialProjects: WorkspaceDashboardProject[] = [
  {
    ...baseProjectA,
    state: {
      ...baseProjectA.state,
      view: "progress",
      visitedViews: ["overview", "rubric", "plan", "draft", "progress"],
      draftText: "Fictional draft A remains isolated.",
      readinessChecks: ["sources", "integrity"],
    },
  },
  {
    ...baseProjectB,
    state: {
      ...baseProjectB.state,
      view: "draft",
      visitedViews: ["overview", "rubric", "plan", "draft"],
      draftText: "Fictional draft B remains independent.",
      readinessChecks: ["format"],
    },
  },
];

const harnessEn = {
  controls: "Dormant test controls",
  pending: "Mark this assignment save as pending",
  clearPending: "Finish pending save",
  workflow: "Assignment workflow",
  tracker: "Project Tracker",
  currentStage: "Current stage",
  visited: "Visited stages",
  draft: "Draft snapshot",
  checks: "Readiness checks",
  none: "None",
  method: "New assignment method: {method}",
  preference: "Last-opened preference recorded after selection",
  showRecovery: "Show recovery-only state",
  showWorkspace: "Show healthy workspace state",
  lifecycleAction: "Lifecycle action: {kind}",
} as const;

const harnessZhCN = {
  controls: "休眠测试控制",
  pending: "将此作业标记为待保存",
  clearPending: "完成待保存内容",
  workflow: "作业流程",
  tracker: "项目跟踪器",
  currentStage: "当前阶段",
  visited: "已访问阶段",
  draft: "草稿快照",
  checks: "就绪检查",
  none: "无",
  method: "新建作业方式：{method}",
  preference: "切换后已记录上次打开的作业偏好",
  showRecovery: "显示仅恢复状态",
  showWorkspace: "显示健康工作区状态",
  lifecycleAction: "生命周期操作：{kind}",
} satisfies { [Key in keyof typeof harnessEn]: string };

function HarnessContent() {
  const messages = useLocalizedMessages(harnessEn, harnessZhCN);
  const [projects, setProjects] = useState(initialProjects);
  const [pendingProjectIds, setPendingProjectIds] = useState<string[]>([]);
  const [recoveryOnly, setRecoveryOnly] = useState(false);
  const [eventMessage, setEventMessage] = useState<string | null>(null);
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.projectId, project])),
    [projects],
  );

  function handleNewAssignment(method: NewAssignmentMethod) {
    setEventMessage(messages.method.replace("{method}", method));
    if (method === "restore" && !projectsById.has(PROJECT_C)) {
      setProjects((current) => [...current, restoredProject]);
    }
  }

  function handleLifecycleAction(request: WorkspaceLifecycleActionRequest) {
    setEventMessage(
      messages.lifecycleAction.replace("{kind}", request.kind),
    );
    return { ok: true as const };
  }

  return (
    <>
      <div aria-label={messages.controls} style={{ padding: "0.5rem 1rem" }}>
        <LanguageSwitcher compact />
        <button type="button" onClick={() => setRecoveryOnly((current) => !current)}>
          {recoveryOnly ? messages.showWorkspace : messages.showRecovery}
        </button>
      </div>
      {eventMessage ? <p role="status">{eventMessage}</p> : null}
      <MultiAssignmentWorkspaceShell
        projects={projects}
        asOfDate="2026-08-20"
        pendingProjectIds={pendingProjectIds}
        onNewAssignment={handleNewAssignment}
        onSelectionApplied={() => {
          setEventMessage(messages.preference);
          return true;
        }}
        renderAssignment={(project) => (
          <section aria-label={messages.workflow}>
            <nav aria-label={messages.workflow}>
              Brief · Rubric · Plan · Check · Progress
            </nav>
            <h2>{messages.tracker}</h2>
            <dl>
              <dt>{messages.currentStage}</dt>
              <dd>{project.state.view}</dd>
              <dt>{messages.visited}</dt>
              <dd>{project.state.visitedViews.join(", ")}</dd>
              <dt>{messages.draft}</dt>
              <dd>{project.state.draftText}</dd>
              <dt>{messages.checks}</dt>
              <dd>{project.state.readinessChecks.join(", ") || messages.none}</dd>
            </dl>
            <button
              type="button"
              onClick={() =>
                setPendingProjectIds((current) =>
                  current.includes(project.projectId)
                    ? current.filter((id) => id !== project.projectId)
                    : [...current, project.projectId],
                )
              }
            >
              {pendingProjectIds.includes(project.projectId)
                ? messages.clearPending
                : messages.pending}
            </button>
          </section>
        )}
      />
      <WorkspaceLifecyclePanel
        workspace={
          recoveryOnly
            ? null
            : {
                workspaceId: "11111111-1111-4111-8111-111111111111",
                workspaceGeneration: 4,
                indexRevision: 12,
                activeProjectCount: projects.length,
                tombstoneCount: 65,
                physicalProjectRecordCount: projects.length + 65,
                legacyValueCount: 1,
                intentToken: "fictional-workspace-intent-12",
              }
        }
        selectedProject={
          recoveryOnly
            ? null
            : {
                projectId: PROJECT_A,
                title: "Fictional market entry analysis",
                course: "International Strategy Lab",
                recordRevision: 7,
                intentToken: "fictional-project-intent-7",
              }
        }
        replacementPreview={
          recoveryOnly
            ? null
            : {
                targetProjectId: PROJECT_A,
                targetIntentToken: "fictional-project-intent-7",
                backupToken: "fictional-backup-token",
                backupTitle: "Fictional replacement assignment",
                backupCourse: "International Strategy Lab",
                backupDeadline: "2026-10-24",
                sourceName: "fictional-project-backup.json",
                sizeEffect: "non-growing",
              }
        }
        storageProtection={{
          mode: recoveryOnly ? "recovery-only" : "normal",
          reserveStatus: "ready",
          destructiveJournalAvailable: true,
        }}
        legacyCleanup={
          recoveryOnly
            ? null
            : { available: true, intentToken: "fictional-legacy-intent" }
        }
        rotation={
          recoveryOnly
            ? null
            : {
                eligible: true,
                targetGeneration: 5,
                intentToken: "fictional-rotation-intent",
              }
        }
        recovery={{
          required: recoveryOnly,
          available: false,
          intentToken: recoveryOnly
            ? "fictional-recovery-intent"
            : "fictional-no-recovery",
          invalidOwnedRecordCount: recoveryOnly ? 3 : 0,
          candidates: [],
        }}
        onChooseReplacementBackup={() =>
          setEventMessage("Fictional replacement backup selected")
        }
        onExportSelectedProject={() =>
          setEventMessage("Fictional selected-project export")
        }
        onExportDiagnostics={() =>
          setEventMessage("Fictional diagnostics export")
        }
        onConfirmAction={handleLifecycleAction}
      />
    </>
  );
}

export function WorkspaceDashboardHarness() {
  return (
    <LocaleProvider>
      <HarnessContent />
    </LocaleProvider>
  );
}
