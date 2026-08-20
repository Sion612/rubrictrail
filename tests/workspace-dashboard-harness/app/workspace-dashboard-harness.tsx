"use client";

import { useMemo, useState } from "react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { LocaleProvider, useLocalizedMessages } from "@/components/locale-provider";
import {
  MultiAssignmentWorkspaceShell,
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
} satisfies { [Key in keyof typeof harnessEn]: string };

function HarnessContent() {
  const messages = useLocalizedMessages(harnessEn, harnessZhCN);
  const [projects, setProjects] = useState(initialProjects);
  const [pendingProjectIds, setPendingProjectIds] = useState<string[]>([]);
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

  return (
    <>
      <div aria-label={messages.controls} style={{ padding: "0.5rem 1rem" }}>
        <LanguageSwitcher compact />
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
