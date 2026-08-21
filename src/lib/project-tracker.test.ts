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
    const summary = deriveProjectTrackerSummary(overduePlan, "2026-09-07", "2026-09-10");

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
    const summary = deriveProjectTrackerSummary(plan, "2026-09-07", "2026-09-10");

    expect(summary.nextTask).toBeNull();
    expect(summary.incompleteCount).toBe(0);
    expect(summary.blockedCount).toBe(0);
    expect(summary.overdueCount).toBe(0);
    expect(summary.allComplete).toBe(true);
  });

  it("resolves same-dueDate ties by plan.tasks index, not alphabetical id", () => {
    // Generate a plan with p1 completed so p2 and p3 are the first
    // incomplete tasks, then force them to share the same dueDate.
    const plan = generateActionPlan({
      ...DEFAULT_PLAN_INPUT,
      completedTaskIds: ["p1"],
    });
    const sharedDate = plan.profile.asOfDate;
    const patchedPlan = {
      ...plan,
      tasks: plan.tasks.map((task) =>
        task.id === "p2" || task.id === "p3"
          ? { ...task, dueDate: sharedDate, completed: false }
          : task,
      ),
    };
    // p2 appears before p3 in plan.tasks (topological order).
    const p2Index = patchedPlan.tasks.findIndex((task) => task.id === "p2");
    const p3Index = patchedPlan.tasks.findIndex((task) => task.id === "p3");
    expect(p2Index).toBeLessThan(p3Index);

    const summary = deriveProjectTrackerSummary(patchedPlan, "2026-09-07", "2026-09-10");
    expect(summary.nextTask?.id).toBe("p2");

    // Swap plan.tasks order so p3 appears before p2.
    // If the comparator used localeCompare, nextTask would still be p2.
    // With plan.tasks index ordering, nextTask should now be p3.
    const swappedTasks = [...patchedPlan.tasks];
    const temp = swappedTasks[p2Index];
    swappedTasks[p2Index] = swappedTasks[p3Index];
    swappedTasks[p3Index] = temp;
    const swappedSummary = deriveProjectTrackerSummary(
      { ...patchedPlan, tasks: swappedTasks },
      "2026-09-07",
      "2026-09-10",
    );
    // After swap, p3 is at the lower index → p3 should be nextTask.
    expect(swappedSummary.nextTask?.id).toBe("p3");
  });

  it("uses actual today for overdue status without changing task dates", () => {
    const plan = generateActionPlan({
      ...DEFAULT_PLAN_INPUT,
      asOfDate: "2026-08-21",
      startDate: "2026-08-21",
      dueDate: "2026-09-07",
    });
    const taskDate = "2026-08-24";
    const patchedPlan = {
      ...plan,
      tasks: plan.tasks.map((task) => ({
        ...task,
        dueDate: taskDate,
        completed: false,
      })),
    };

    expect(deriveProjectTrackerSummary(patchedPlan, "2026-09-07", "2026-08-22").overdueCount).toBe(0);
    expect(deriveProjectTrackerSummary(patchedPlan, "2026-09-07", taskDate).overdueCount).toBe(0);
    expect(deriveProjectTrackerSummary(patchedPlan, "2026-09-07", "2026-08-26").overdueCount).toBeGreaterThan(0);
    expect(patchedPlan.profile.asOfDate).toBe("2026-08-21");
    expect(patchedPlan.tasks[0]?.dueDate).toBe(taskDate);

    const overdueCount = deriveProjectTrackerSummary(
      patchedPlan,
      "2026-09-07",
      "2026-08-26",
    ).overdueCount;
    const completedPast = {
      ...patchedPlan,
      tasks: patchedPlan.tasks.map((task, index) =>
        index === 0 ? { ...task, completed: true } : task,
      ),
    };
    expect(
      deriveProjectTrackerSummary(completedPast, "2026-09-07", "2026-08-26")
        .overdueCount,
    ).toBe(overdueCount - 1);
  });
});
