import { compareDateOnly } from "@/lib/date-only";
import type { ActionPlan, PlanTask } from "@/lib/domain";
import {
  generateActionPlan,
  planningDepthFromLegacyTargetGrade,
} from "@/lib/plan";
import { SAMPLE_ASSIGNMENT } from "@/lib/sample-data";
import type { PersistedProjectState } from "@/lib/ui-types";
import { buildUploadedPlanTemplates } from "@/lib/uploaded-project";
import { projectPlanningBaselineDate } from "@/lib/project-planning-date";

export interface WorkspaceDashboardProject {
  projectId: string;
  state: PersistedProjectState;
}

export interface WorkspaceDashboardDerivationOptions {
  currentDate: string;
  upNextLimit?: number;
}

export interface DashboardTaskSummary {
  taskId: string;
  title: string;
  dueDate: string;
  blocked: boolean;
  overdue: boolean;
}

export interface DashboardAssignmentSummary {
  projectId: string;
  course: string;
  title: string;
  deadline: string;
  progress: number;
  nextTarget: DashboardTaskSummary | null;
  blockedCount: number;
  overdueCount: number;
}

export interface DashboardUpNextItem extends DashboardTaskSummary {
  projectId: string;
  assignmentTitle: string;
  workspaceOrder: number;
  taskOrder: number;
}

export interface WorkspaceDashboardModel {
  assignments: DashboardAssignmentSummary[];
  upNext: DashboardUpNextItem[];
}

function taskIsBlocked(
  task: PlanTask,
  completedTaskIds: ReadonlySet<string>,
): boolean {
  if (task.completed) return false;
  return task.dependencies.some((dependencyId) => !completedTaskIds.has(dependencyId));
}

function planStartFor(deadline: string, planningBaselineDate: string): string {
  return deadline < planningBaselineDate ? deadline : planningBaselineDate;
}

function deriveProject(
  project: WorkspaceDashboardProject,
  currentDate: string,
): {
  title: string;
  course: string;
  deadline: string;
  plan: ActionPlan;
} | null {
  if (project.state.projectKind === "none") return null;

  const uploaded =
    project.state.projectKind === "uploaded"
      ? project.state.uploadedProject
      : null;
  if (project.state.projectKind === "uploaded" && uploaded === null) {
    throw new Error("Validated uploaded project state is missing its project payload.");
  }

  const title = uploaded?.title ?? SAMPLE_ASSIGNMENT.title;
  const course = uploaded?.course ?? SAMPLE_ASSIGNMENT.course;
  const deadline = uploaded?.dueDate ?? SAMPLE_ASSIGNMENT.dueAt.slice(0, 10);
  const planningBaselineDate = projectPlanningBaselineDate(project.state, currentDate);
  const plan = generateActionPlan(
    {
      weeklyHours: project.state.weeklyHours,
      planningDepth: planningDepthFromLegacyTargetGrade(project.state.targetGrade),
      startDate: planStartFor(deadline, planningBaselineDate),
      dueDate: deadline,
      asOfDate: planningBaselineDate,
      completedTaskIds: project.state.completedTaskIds,
    },
    uploaded ? buildUploadedPlanTemplates(uploaded) : undefined,
  );

  return { title, course, deadline, plan };
}

function dashboardTask(
  task: PlanTask,
  completedTaskIds: ReadonlySet<string>,
  currentDate: string,
): DashboardTaskSummary {
  return {
    taskId: task.id,
    title: task.title,
    dueDate: task.dueDate,
    blocked: taskIsBlocked(task, completedTaskIds),
    overdue: compareDateOnly(task.dueDate, currentDate) < 0,
  };
}

function compareUpNext(
  left: DashboardUpNextItem,
  right: DashboardUpNextItem,
): number {
  const leftActionableOverdue = left.overdue && !left.blocked;
  const rightActionableOverdue = right.overdue && !right.blocked;
  if (leftActionableOverdue !== rightActionableOverdue) {
    return leftActionableOverdue ? -1 : 1;
  }

  const dateOrder = compareDateOnly(left.dueDate, right.dueDate);
  if (dateOrder !== 0) return dateOrder;
  if (left.workspaceOrder !== right.workspaceOrder) {
    return left.workspaceOrder - right.workspaceOrder;
  }
  return left.taskOrder - right.taskOrder;
}

export function orderDashboardUpNext(
  items: readonly DashboardUpNextItem[],
  limit: number,
): DashboardUpNextItem[] {
  const boundedLimit = Math.max(0, Math.floor(limit));
  return [...items].sort(compareUpNext).slice(0, boundedLimit);
}

/**
 * Builds the dashboard read model from validated in-memory project records.
 * No dashboard field is a second persistence authority.
 */
export function deriveWorkspaceDashboardModel(
  projects: readonly WorkspaceDashboardProject[],
  options: WorkspaceDashboardDerivationOptions,
): WorkspaceDashboardModel {
  const assignments: DashboardAssignmentSummary[] = [];
  const upNext: DashboardUpNextItem[] = [];

  projects.forEach((project, workspaceOrder) => {
    const derived = deriveProject(project, options.currentDate);
    if (!derived) return;
    const completedTaskIds = new Set(
      derived.plan.tasks
        .filter((task) => task.completed)
        .map((task) => task.id),
    );
    const incompleteTasks = derived.plan.tasks.filter((task) => !task.completed);
    const orderedIncomplete = incompleteTasks
      .map((task, taskOrder) => ({ task, taskOrder }))
      .sort((left, right) => {
        const dateOrder = compareDateOnly(left.task.dueDate, right.task.dueDate);
        return dateOrder || left.taskOrder - right.taskOrder;
      });
    const tasks = incompleteTasks.map((task) =>
      dashboardTask(task, completedTaskIds, options.currentDate),
    );
    const nextTarget = orderedIncomplete[0]
      ? dashboardTask(orderedIncomplete[0].task, completedTaskIds, options.currentDate)
      : null;

    assignments.push({
      projectId: project.projectId,
      title: derived.title,
      course: derived.course,
      deadline: derived.deadline,
      progress: Math.min(100, Math.max(0, Math.round(derived.plan.completionPercent))),
      nextTarget,
      blockedCount: tasks.filter((task) => task.blocked).length,
      overdueCount: tasks.filter((task) => task.overdue).length,
    });

    derived.plan.tasks.forEach((task, taskOrder) => {
      if (task.completed) return;
      upNext.push({
        ...dashboardTask(task, completedTaskIds, options.currentDate),
        projectId: project.projectId,
        assignmentTitle: derived.title,
        workspaceOrder,
        taskOrder,
      });
    });
  });

  return {
    assignments,
    upNext: orderDashboardUpNext(upNext, options.upNextLimit ?? 5),
  };
}
