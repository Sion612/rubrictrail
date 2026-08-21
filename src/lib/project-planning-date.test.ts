import { describe, expect, it } from "vitest";

import { createDefaultProjectState } from "@/lib/local-state";
import { SAMPLE_PLANNING_BASELINE_DATE } from "@/lib/sample-data";
import { projectPlanningBaselineDate } from "@/lib/project-planning-date";

describe("projectPlanningBaselineDate", () => {
  it("keeps the fictional sample on its stable planning baseline", () => {
    expect(
      projectPlanningBaselineDate({
        ...createDefaultProjectState(),
        projectKind: "sample",
      }),
    ).toBe(SAMPLE_PLANNING_BASELINE_DATE);
  });

  it("derives an uploaded project's baseline from its existing creation instant", () => {
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
      createdAt: "2026-08-21T12:00:00.000Z",
    };

    expect(projectPlanningBaselineDate(project, "2026-08-26")).toBe("2026-08-21");
  });

  it("uses the supplied transient date only before a project exists", () => {
    expect(projectPlanningBaselineDate(createDefaultProjectState(), "2026-08-26")).toBe(
      "2026-08-26",
    );
  });
});
