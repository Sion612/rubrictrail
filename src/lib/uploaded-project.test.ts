import { describe, expect, it } from "vitest";
import { buildUploadedAssignmentSummary } from "@/lib/files/parse-assignment-files";
import { generateActionPlan } from "@/lib/plan";
import {
  buildUploadedPlanTemplates,
  createUploadedProject,
  draftFromUpload,
  isConfirmedUploadedReview,
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
    intakeMethod: "files",
    fileNames: ["brief.txt", "rubric.txt"],
    skippedFiles: [],
    totalWords: 24,
    summary: buildUploadedAssignmentSummary(text),
  };
}

function incompleteWeightUpload(): UploadFlowResult {
  const text = [
    "Assignment title: Retail Operations Analysis",
    "Deadline: 24 September 2026",
    "Word count: 2500 words",
    "Use APA 7 referencing.",
    "Rubric",
    "- Problem diagnosis",
    "- Recommendations — 40%",
  ].join("\n");
  return {
    intakeMethod: "files",
    fileNames: ["brief.txt"],
    skippedFiles: [],
    totalWords: 20,
    summary: buildUploadedAssignmentSummary(text),
  };
}

function noWeightUpload(): UploadFlowResult {
  const text = [
    "Assignment title: Retail Operations Analysis",
    "Deadline: 24 September 2026",
    "Word count: 2500 words",
    "Use APA 7 referencing.",
    "Rubric",
    "- Problem diagnosis",
    "- Recommendations",
  ].join("\n");
  return {
    intakeMethod: "files",
    fileNames: ["brief.txt"],
    skippedFiles: [],
    totalWords: 18,
    summary: buildUploadedAssignmentSummary(text),
  };
}

describe("uploaded project workflow", () => {
  it("normalizes safe date formats and leaves ambiguous numeric dates blank", () => {
    expect(normalizeDateForInput("24 September 2026")).toBe("2026-09-24");
    expect(normalizeDateForInput("September 24th, 2026")).toBe("2026-09-24");
    expect(normalizeDateForInput("2026/9/24")).toBe("2026-09-24");
    expect(normalizeDateForInput("2026-02-31")).toBe("");
    expect(normalizeDateForInput("09/10/2026")).toBe("");
  });

  it("requires user-confirmed fields and weights totalling 100", () => {
    const draft = draftFromUpload(completeUpload());
    expect(validateUploadedProjectDraft(draft)).toEqual([]);
    draft.criteria[0].weight = "39";
    expect(validateUploadedProjectDraft(draft)).toContain(
      "Published rubric weights must total 100%; they currently total 99%. Check for a missing criterion or a mistyped percentage.",
    );
  });

  it("requires an explicit choice when published weights are incomplete", () => {
    const draft = draftFromUpload(incompleteWeightUpload());

    expect(draft.weightingMode).toBeNull();
    expect(validateUploadedProjectDraft(draft)).toContain(
      "Choose whether the official rubric provides a complete percentage breakdown.",
    );
  });

  it("retains partial official weights while keeping planning neutral", () => {
    const upload = incompleteWeightUpload();
    const draft = draftFromUpload(upload);
    draft.weightingMode = "not_complete";

    expect(validateUploadedProjectDraft(draft)).toEqual([]);
    const project = createUploadedProject(upload, draft);
    expect(project.weightingStatus).toBe("incomplete");
    expect(project.criteria.map((criterion) => criterion.weight)).toEqual([
      null,
      40,
    ]);

    const criterionTasks = buildUploadedPlanTemplates(project).filter((task) =>
      task.id.startsWith("criterion-"),
    );
    expect(new Set(criterionTasks.map((task) => task.baseMinutes))).toHaveLength(1);
    expect(new Set(criterionTasks.map((task) => task.priority))).toEqual(
      new Set(["high"]),
    );
    expect(
      criterionTasks.every(
        (task) => Number.isFinite(task.baseMinutes) && task.baseMinutes > 0,
      ),
    ).toBe(true);
    expect(
      buildUploadedPlanTemplates(project).find(
        (task) => task.id === "rubric-outline",
      )?.description,
    ).not.toContain("higher-weight");
  });

  it("stores no weights when none are published without synthesising equal percentages", () => {
    const upload = noWeightUpload();
    const draft = draftFromUpload(upload);
    draft.weightingMode = "not_complete";

    expect(validateUploadedProjectDraft(draft)).toEqual([]);
    const project = createUploadedProject(upload, draft);
    expect(project.weightingStatus).toBe("none");
    expect(project.criteria.map((criterion) => criterion.weight)).toEqual([
      null,
      null,
    ]);
  });

  it("validates an optional partial percentage without requiring missing values", () => {
    const draft = draftFromUpload(incompleteWeightUpload());
    draft.weightingMode = "not_complete";
    draft.criteria[0].weight = "not-a-number";

    expect(validateUploadedProjectDraft(draft)).toContain(
      "Criterion 1: use an official percentage greater than 0 and no more than 100, or leave it blank if none is published.",
    );
    draft.criteria[0].weight = "";
    expect(validateUploadedProjectDraft(draft)).toEqual([]);
  });

  it("rejects calendar-invalid and resource-exhausting project inputs", () => {
    const upload = completeUpload();
    const invalidDate = draftFromUpload(upload);
    invalidDate.dueDate = "2026-02-31";
    expect(validateUploadedProjectDraft(invalidDate)).toContain(
      "Add a real calendar deadline.",
    );

    const hugeProject = draftFromUpload(upload);
    hugeProject.wordCount = "50001";
    expect(validateUploadedProjectDraft(hugeProject)).toContain(
      "Keep the word count at or below 50,000 words.",
    );

    const farFuture = draftFromUpload(upload);
    farFuture.dueDate = `${Number(new Date().getFullYear()) + 5}-09-24`;
    expect(validateUploadedProjectDraft(farFuture)).toContain(
      "Choose a deadline within the next four years.",
    );
  });

  it("counts a criterion review only after a meaningful confirmed save", () => {
    const review = {
      criterionId: "analysis-1",
      draftText: "A traceable paragraph with enough detail.",
      evidenceVisible: true,
      linkExplained: true,
      sourceTraceable: true,
      updatedAt: null,
    };
    expect(isConfirmedUploadedReview(review)).toBe(false);
    expect(
      isConfirmedUploadedReview({
        ...review,
        updatedAt: "2026-08-12T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      isConfirmedUploadedReview({
        ...review,
        draftText: "Too short",
        updatedAt: "2026-08-12T00:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("creates a compact project without retaining full uploaded text", () => {
    const upload = completeUpload();
    const project = createUploadedProject(upload, draftFromUpload(upload));

    expect(project.title).toBe("Strategy Report");
    expect(project.weightingStatus).toBe("complete");
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
