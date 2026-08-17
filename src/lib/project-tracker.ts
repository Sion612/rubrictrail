import type { ActionPlan, PlanTask } from "@/lib/domain";
import { compareDateOnly } from "@/lib/date-only";

export interface ProjectTrackerSummary {
  nextTask: PlanTask | null;
  incompleteCount: number;
  blockedCount: number;
  overdueCount: number;
  deadline: string;
  allComplete: boolean;
}

function isBlocked(task: PlanTask, plan: ActionPlan): boolean {
  return !task.completed && task.dependencies.some(
    (dependencyId) => !plan.tasks.find((candidate) => candidate.id === dependencyId)?.completed,
  );
}

export function deriveProjectTrackerSummary(
  plan: ActionPlan,
  assignmentDeadline: string,
): ProjectTrackerSummary {
  const incomplete = plan.tasks.filter((task) => !task.completed);
  const nextTask = [...incomplete].sort((left, right) => {
    const dateOrder = compareDateOnly(left.dueDate, right.dueDate);
    return dateOrder || plan.tasks.indexOf(left) - plan.tasks.indexOf(right);
  })[0] ?? null;

  return {
    nextTask,
    incompleteCount: incomplete.length,
    blockedCount: incomplete.filter((task) => isBlocked(task, plan)).length,
    overdueCount: incomplete.filter(
      (task) => compareDateOnly(task.dueDate, plan.profile.asOfDate) < 0,
    ).length,
    deadline: assignmentDeadline,
    allComplete: incomplete.length === 0,
  };
}
