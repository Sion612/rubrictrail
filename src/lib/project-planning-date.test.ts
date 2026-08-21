import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDefaultProjectState,
  parsePersistedProjectStateValue,
} from "@/lib/local-state";
import { generateActionPlan } from "@/lib/plan";
import { SAMPLE_PLANNING_BASELINE_DATE } from "@/lib/sample-data";
import { projectPlanningBaselineDate } from "@/lib/project-planning-date";
import type { PersistedProjectState } from "@/lib/ui-types";

function uploadedProjectWithCreatedAt(createdAt: string): PersistedProjectState {
  const project = createDefaultProjectState();
  project.projectKind = "uploaded";
  project.uploadedProject = {
    id: "fictional-project",
    title: "Fictional report",
    course: "Planning Lab",
    dueDate: "2026-09-10",
    wordCount: 1000,
    citationStyle: "APA",
    fileNames: ["fictional-brief.txt"],
    extractedWordCount: 40,
    weightingStatus: "none",
    criteria: [{ id: "criterion-1", name: "Analysis", weight: null, evidence: null }],
    createdAt,
  };
  return project;
}

describe("projectPlanningBaselineDate", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the fictional sample on its stable planning baseline", () => {
    expect(
      projectPlanningBaselineDate(
        {
          ...createDefaultProjectState(),
          projectKind: "sample",
        },
        "2026-08-26",
      ),
    ).toBe(SAMPLE_PLANNING_BASELINE_DATE);
  });

  it.each([
    "2026-08-21T00:15:00.000Z",
    "2026-08-21T23:45:00.000Z",
  ])("uses the instant's UTC date for %s regardless of local date getters", (createdAt) => {
    const project = uploadedProjectWithCreatedAt(createdAt);
    const firstBaseline = projectPlanningBaselineDate(project, "2026-08-26");

    vi.spyOn(Date.prototype, "getFullYear").mockReturnValue(1999);
    vi.spyOn(Date.prototype, "getMonth").mockReturnValue(0);
    vi.spyOn(Date.prototype, "getDate").mockReturnValue(1);
    const secondBaseline = projectPlanningBaselineDate(project, "2026-08-27");

    expect(firstBaseline).toBe("2026-08-21");
    expect(secondBaseline).toBe(firstBaseline);

    const uploadedProject = project.uploadedProject;
    if (!uploadedProject) throw new Error("Expected the fictional uploaded project fixture.");
    const taskDates = (baseline: string) =>
      generateActionPlan({
        weeklyHours: project.weeklyHours,
        planningDepth: "standard",
        startDate: baseline,
        dueDate: uploadedProject.dueDate,
        asOfDate: baseline,
        completedTaskIds: [],
      }).tasks.map((task) => task.dueDate);
    expect(taskDates(secondBaseline)).toEqual(taskDates(firstBaseline));
  });

  it.each([
    "2026-08-21T23:45:00.000Z",
    "2026-08-22T07:45:00.000+08:00",
    "2026-08-21T18:45:00.000-05:00",
  ])("normalizes equivalent persisted instant %s to one UTC baseline", (createdAt) => {
    expect(
      projectPlanningBaselineDate(uploadedProjectWithCreatedAt(createdAt), "2026-08-26"),
    ).toBe("2026-08-21");
  });

  it.each([
    "2026-08-21T00:15:00Z",
    "2026-08-21T00:15:00.000+00:00",
  ])("accepts persisted schema-compatible timestamp representation %s", (createdAt) => {
    const fixture = uploadedProjectWithCreatedAt(createdAt);
    const persisted = parsePersistedProjectStateValue(fixture);

    expect(persisted.ok).toBe(true);
    expect(() => projectPlanningBaselineDate(fixture, "2026-08-26")).not.toThrow();
    expect(projectPlanningBaselineDate(fixture, "2026-08-26")).toBe("2026-08-21");
  });

  it.each([
    "not-a-timestamp",
    "2026-02-30T00:15:00.000Z",
    "2026-13-21T00:15:00.000Z",
    "2026-08-21T25:15:00.000Z",
  ])("rejects genuinely invalid persisted timestamp %s", (createdAt) => {
    expect(() =>
      projectPlanningBaselineDate(uploadedProjectWithCreatedAt(createdAt), "2026-08-26"),
    ).toThrow("valid ISO timestamp");
  });

  it("uses the supplied transient date only before a project exists", () => {
    expect(projectPlanningBaselineDate(createDefaultProjectState(), "2026-08-26")).toBe(
      "2026-08-26",
    );
  });
});
