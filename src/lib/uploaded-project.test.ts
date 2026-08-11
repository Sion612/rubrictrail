import { describe, expect, it } from "vitest";
import { buildUploadedAssignmentSummary } from "@/lib/files/parse-assignment-files";
import { generateActionPlan } from "@/lib/plan";
import {
  buildUploadedPlanTemplates,
  createUploadedProject,
  draftFromUpload,
  normalizeDateForInput,
  validateUploadedProjectDraft,
} from "@/lib/uploaded-project";
import type { UploadFlowResult } from "@/lib/ui-types";

function completeUpload(): UploadFlowResult {
  const text = [
    "Assignment title: Strategy Report",
    "Deadline: 24 September 2026",
    "Word count: 2500 words",
    "Use APA 7 referencing.",
    "Rubric",
    "Strategic analysis | 40%",
    "Recommendations | 35%",
    "Communication | 25%",
  ].join("\n");
  return {
    fileNames: ["brief.txt", "rubric.txt"],
    totalWords: 24,
    summary: buildUploadedAssignmentSummary(text),
  };
}

describe("uploaded project workflow", () => {
  it("normalizes safe date formats and leaves ambiguous numeric dates blank", () => {
    expect(normalizeDateForInput("24 September 2026")).toBe("2026-09-24");
    expect(normalizeDateForInput("2026/9/24")).toBe("2026-09-24");
    expect(normalizeDateForInput("09/10/2026")).toBe("");
  });

  it("requires user-confirmed fields and weights totalling 100", () => {
    const draft = draftFromUpload(completeUpload());
    expect(validateUploadedProjectDraft(draft)).toEqual([]);
    draft.criteria[0].weight = "39";
    expect(validateUploadedProjectDraft(draft)).toContain(
      "Rubric weights must total 100%; they currently total 99%.",
    );
  });

  it("creates a compact project without retaining full uploaded text", () => {
    const upload = completeUpload();
    const project = createUploadedProject(upload, draftFromUpload(upload));

    expect(project.title).toBe("Strategy Report");
    expect(project.criteria.map((criterion) => criterion.weight)).toEqual([40, 35, 25]);
    expect(project.fileNames).toEqual(["brief.txt", "rubric.txt"]);
    expect(JSON.stringify(project)).not.toContain("Use APA 7 referencing");
  });

  it("builds a valid generic plan linked only to uploaded criterion ids", () => {
    const upload = completeUpload();
    const project = createUploadedProject(upload, draftFromUpload(upload));
    const templates = buildUploadedPlanTemplates(project);
    const plan = generateActionPlan(
      {
        weeklyHours: 10,
        targetGrade: 70,
        startDate: "2026-08-11",
        dueDate: project.dueDate,
        asOfDate: "2026-08-11",
        completedTaskIds: [],
      },
      templates,
    );
    const criterionIds = new Set(project.criteria.map((criterion) => criterion.id));

    expect(plan.tasks.at(-1)?.id).toBe("submission-qa");
    expect(plan.tasks.flatMap((task) => task.rubricLinks).every((link) => criterionIds.has(link.criterionId))).toBe(true);
    expect(plan.rubricProgress).toHaveLength(3);
  });
});
