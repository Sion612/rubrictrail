import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAN_INPUT,
  DEFAULT_PLAN_TASK_TEMPLATES,
  calculateAvailableMinutes,
  generateActionPlan,
  getTargetEffortFactor,
  rebalanceActionPlan,
} from "@/lib/plan";

describe("generateActionPlan", () => {
  it("is deterministic and preserves dependency order", () => {
    const first = generateActionPlan(DEFAULT_PLAN_INPUT);
    const second = generateActionPlan(DEFAULT_PLAN_INPUT);
    expect(first).toEqual(second);
    const tasks = new Map(first.tasks.map((task) => [task.id, task]));
    for (const task of first.tasks) {
      for (const dependencyId of task.dependencies) {
        const dependency = tasks.get(dependencyId);
        expect(dependency).toBeDefined();
        expect(task.dueDate >= (dependency?.dueDate ?? "")).toBe(true);
      }
    }
  });

  it("adds quality gates at higher targets before final submission QA", () => {
    const passPlan = generateActionPlan({ ...DEFAULT_PLAN_INPUT, targetGrade: 60 });
    const distinctionPlan = generateActionPlan({ ...DEFAULT_PLAN_INPUT, targetGrade: 80 });
    const finalQa = distinctionPlan.tasks.find((task) => task.id === "p13");
    const activeGateIds = distinctionPlan.tasks
      .filter((task) => task.id.startsWith("s"))
      .map((task) => task.id);
    const finalQaIndex = distinctionPlan.tasks.findIndex((task) => task.id === "p13");

    expect(distinctionPlan.tasks.length).toBeGreaterThan(passPlan.tasks.length);
    expect(distinctionPlan.totalMinutes).toBeGreaterThan(passPlan.totalMinutes);
    expect(activeGateIds).toEqual(["s1", "s2", "s3"]);
    expect(finalQa?.dependencies).toEqual(expect.arrayContaining(activeGateIds));
    expect(
      activeGateIds.every(
        (id) => distinctionPlan.tasks.findIndex((task) => task.id === id) < finalQaIndex,
      ),
    ).toBe(true);
  });

  it("reports a capacity risk when weekly time is constrained", () => {
    const spacious = generateActionPlan({ ...DEFAULT_PLAN_INPUT, weeklyHours: 12 });
    const constrained = generateActionPlan({ ...DEFAULT_PLAN_INPUT, weeklyHours: 2 });
    expect(constrained.projectedFinishDate >= spacious.projectedFinishDate).toBe(true);
    expect(constrained.status).toBe("at_risk");
    expect(constrained.capacityRisk?.shortfallMinutes).toBeGreaterThan(0);
    expect(constrained.tasks.some((task) => task.late)).toBe(true);
  });

  it("preserves completed state and derives rubric progress", () => {
    const plan = generateActionPlan({ ...DEFAULT_PLAN_INPUT, completedTaskIds: ["p1", "p2"] });
    expect(plan.tasks.find((task) => task.id === "p1")?.completed).toBe(true);
    expect(plan.completionPercent).toBeGreaterThan(0);
    expect(plan.remainingMinutes).toBeLessThan(plan.totalMinutes);
    expect(plan.rubricProgress.every((item) => item.percent > 0)).toBe(true);
  });

  it("rejects invalid inputs and unknown task ids", () => {
    expect(() => generateActionPlan({ ...DEFAULT_PLAN_INPUT, weeklyHours: 0 })).toThrow();
    expect(() => generateActionPlan({ ...DEFAULT_PLAN_INPUT, completedTaskIds: ["missing"] })).toThrow("Unknown completed plan task");
  });
});

describe("rebalanceActionPlan", () => {
  it("changes dates while preserving completed tasks", () => {
    const original = generateActionPlan({ ...DEFAULT_PLAN_INPUT, completedTaskIds: ["p1", "p2", "p3"] });
    const rebalanced = rebalanceActionPlan(original, { weeklyHours: 5 });
    expect(rebalanced.profile.weeklyHours).toBe(5);
    expect(rebalanced.tasks.filter((task) => task.completed).map((task) => task.id)).toEqual(["p1", "p2", "p3"]);
    expect(rebalanced.projectedFinishDate >= original.projectedFinishDate).toBe(true);
  });
});

describe("plan helpers", () => {
  it("applies stable effort factors", () => {
    expect(getTargetEffortFactor(60)).toBeLessThan(getTargetEffortFactor(80));
    expect(DEFAULT_PLAN_TASK_TEMPLATES.length).toBeGreaterThan(10);
  });

  it("uses weekdays, half Saturday, and zero Sunday capacity", () => {
    expect(calculateAvailableMinutes(5.5, "2026-07-20", "2026-07-24")).toBe(300);
    expect(calculateAvailableMinutes(5.5, "2026-07-25", "2026-07-26")).toBe(30);
  });
});

