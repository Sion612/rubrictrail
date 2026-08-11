import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAN_INPUT,
  DEFAULT_PLAN_TASK_TEMPLATES,
  PLANNING_DEPTH_OPTIONS,
  calculateAvailableMinutes,
  generateActionPlan,
  getPlanningDepthEffortFactor,
  legacyTargetGradeForPlanningDepth,
  planningDepthFromLegacyTargetGrade,
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

  it("adds quality gates at deeper review levels before final submission QA", () => {
    const focusedPlan = generateActionPlan({
      ...DEFAULT_PLAN_INPUT,
      planningDepth: "focused",
    });
    const extendedPlan = generateActionPlan({
      ...DEFAULT_PLAN_INPUT,
      planningDepth: "extended",
    });
    const finalQa = extendedPlan.tasks.find((task) => task.id === "p13");
    const activeGateIds = extendedPlan.tasks
      .filter((task) => task.id.startsWith("s"))
      .map((task) => task.id);
    const finalQaIndex = extendedPlan.tasks.findIndex((task) => task.id === "p13");

    expect(extendedPlan.tasks.length).toBeGreaterThan(focusedPlan.tasks.length);
    expect(extendedPlan.totalMinutes).toBeGreaterThan(focusedPlan.totalMinutes);
    expect(activeGateIds).toEqual(["s1", "s2", "s3"]);
    expect(finalQa?.dependencies).toEqual(expect.arrayContaining(activeGateIds));
    expect(
      activeGateIds.every(
        (id) => extendedPlan.tasks.findIndex((task) => task.id === id) < finalQaIndex,
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

  it("rejects invalid inputs and ignores task ids from older plan versions", () => {
    expect(() => generateActionPlan({ ...DEFAULT_PLAN_INPUT, weeklyHours: 0 })).toThrow();
    const recovered = generateActionPlan({
      ...DEFAULT_PLAN_INPUT,
      completedTaskIds: ["missing"],
    });
    expect(recovered.tasks.every((task) => !task.completed)).toBe(true);
  });

  it("does not restore completed tasks whose active dependencies are incomplete", () => {
    const recovered = generateActionPlan({
      ...DEFAULT_PLAN_INPUT,
      completedTaskIds: ["p2", "p3"],
    });
    expect(recovered.tasks.find((task) => task.id === "p2")?.completed).toBe(false);
    expect(recovered.tasks.find((task) => task.id === "p3")?.completed).toBe(false);
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
  it("applies stable planning-depth factors without exposing grade semantics", () => {
    expect(getPlanningDepthEffortFactor("focused")).toBeLessThan(
      getPlanningDepthEffortFactor("extended"),
    );
    expect(PLANNING_DEPTH_OPTIONS.map((option) => option.value)).toEqual([
      "focused",
      "standard",
      "thorough",
      "extended",
    ]);
    expect(
      PLANNING_DEPTH_OPTIONS.map((option) =>
        getPlanningDepthEffortFactor(option.value),
      ),
    ).toEqual([0.85, 1, 1.2, 1.2]);
    expect(DEFAULT_PLAN_TASK_TEMPLATES.length).toBeGreaterThan(10);
  });

  it("maps legacy stored numbers to planning depth and back", () => {
    expect(planningDepthFromLegacyTargetGrade(60)).toBe("focused");
    expect(planningDepthFromLegacyTargetGrade(70)).toBe("standard");
    expect(planningDepthFromLegacyTargetGrade(75)).toBe("thorough");
    expect(planningDepthFromLegacyTargetGrade(80)).toBe("extended");
    expect(legacyTargetGradeForPlanningDepth("extended")).toBe(80);
  });

  it("preserves the operational profiles of the four values exposed by v0.3.4", () => {
    const expected = [
      { legacy: 60, depth: "focused", totalGates: 0 },
      { legacy: 70, depth: "standard", totalGates: 1 },
      { legacy: 75, depth: "thorough", totalGates: 2 },
      { legacy: 80, depth: "extended", totalGates: 3 },
    ] as const;

    for (const profile of expected) {
      const depth = planningDepthFromLegacyTargetGrade(profile.legacy);
      const plan = generateActionPlan({
        ...DEFAULT_PLAN_INPUT,
        planningDepth: depth,
      });
      expect(depth).toBe(profile.depth);
      expect(legacyTargetGradeForPlanningDepth(depth)).toBe(profile.legacy);
      expect(plan.tasks.filter((task) => task.id.startsWith("s"))).toHaveLength(
        profile.totalGates,
      );
    }
  });

  it("uses weekdays, half Saturday, and zero Sunday capacity", () => {
    expect(calculateAvailableMinutes(5.5, "2026-07-20", "2026-07-24")).toBe(300);
    expect(calculateAvailableMinutes(5.5, "2026-07-25", "2026-07-26")).toBe(30);
  });
});
