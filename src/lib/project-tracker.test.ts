import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN_INPUT, generateActionPlan } from "@/lib/plan";
import { deriveProjectTrackerSummary } from "@/lib/project-tracker";

describe("deriveProjectTrackerSummary", () => {
  it("selects the earliest incomplete task and counts blocked and overdue work", () => {
    const plan = generateActionPlan({
      ...DEFAULT_PLAN_INPUT,
      asOfDate: "2026-09-10",
      completedTaskIds: ["p1"],
    });
    const overduePlan = {
      ...plan,
      tasks: plan.tasks.map((task) =>
        task.id === "p2" ? { ...task, dueDate: "2026-09-01" } : task,
      ),
    };
    const summary = deriveProjectTrackerSummary(overduePlan, "2026-09-07");

    expect(summary.nextTask?.id).toBe("p2");
    expect(summary.incompleteCount).toBe(overduePlan.tasks.length - 1);
    expect(summary.blockedCount).toBeGreaterThan(0);
    expect(summary.overdueCount).toBeGreaterThan(0);
    expect(summary.deadline).toBe("2026-09-07");
    expect(summary.allComplete).toBe(false);
  });

  it("reports the stable all-complete state without inventing a task", () => {
    const seed = generateActionPlan(DEFAULT_PLAN_INPUT);
    const plan = generateActionPlan({
      ...DEFAULT_PLAN_INPUT,
      completedTaskIds: seed.tasks.map((task) => task.id),
    });
    const summary = deriveProjectTrackerSummary(plan, "2026-09-07");

    expect(summary.nextTask).toBeNull();
    expect(summary.incompleteCount).toBe(0);
    expect(summary.blockedCount).toBe(0);
    expect(summary.overdueCount).toBe(0);
    expect(summary.allComplete).toBe(true);
  });
});
