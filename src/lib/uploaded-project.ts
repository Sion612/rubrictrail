import { planTaskTemplateSchema, type PlanTaskTemplate } from "@/lib/domain";
import type {
  UploadFlowResult,
  UploadedProject,
  UploadedProjectDraft,
} from "@/lib/ui-types";

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "criterion";
}

export function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function normalizeDateForInput(value: string | null): string {
  if (!value) return "";
  const iso = value.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(value.trim())) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

export function draftFromUpload(result: UploadFlowResult): UploadedProjectDraft {
  const { summary } = result;
  return {
    title: summary.title.value ?? "",
    course: "",
    dueDate: normalizeDateForInput(summary.dueDate.value),
    wordCount: summary.wordCount.value ? String(summary.wordCount.value) : "",
    citationStyle: summary.citationStyle.value ?? "",
    criteria: summary.rubric.criteria.map((criterion) => ({
      name: criterion.name,
      weight: criterion.weight === null ? "" : String(criterion.weight),
      evidence: criterion.evidence,
    })),
  };
}

export function validateUploadedProjectDraft(draft: UploadedProjectDraft): string[] {
  const errors: string[] = [];
  const wordCount = Number(draft.wordCount);
  const totalWeight = draft.criteria.reduce(
    (total, criterion) => total + (Number(criterion.weight) || 0),
    0,
  );
  if (!draft.title.trim()) errors.push("Add an assignment title.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate)) errors.push("Add a valid deadline.");
  if (!Number.isInteger(wordCount) || wordCount <= 0) errors.push("Add a positive whole-number word count.");
  if (!draft.citationStyle.trim()) errors.push("Add a citation style, or enter “Not specified”.");
  if (draft.criteria.length === 0) errors.push("Add at least one rubric criterion.");
  if (draft.criteria.some((criterion) => !criterion.name.trim())) errors.push("Name every rubric criterion.");
  if (draft.criteria.some((criterion) => !(Number(criterion.weight) > 0))) {
    errors.push("Give every criterion a positive weight.");
  }
  if (Math.abs(totalWeight - 100) > 0.01) {
    errors.push(`Rubric weights must total 100%; they currently total ${totalWeight || 0}%.`);
  }
  return errors;
}

export function createUploadedProject(
  result: UploadFlowResult,
  draft: UploadedProjectDraft,
): UploadedProject {
  const errors = validateUploadedProjectDraft(draft);
  if (errors.length) throw new Error(errors.join(" "));
  const createdAt = new Date().toISOString();
  return {
    id: `uploaded-${Date.now()}`,
    title: draft.title.trim(),
    course: draft.course.trim() || "Course not set",
    dueDate: draft.dueDate,
    wordCount: Number(draft.wordCount),
    citationStyle: draft.citationStyle.trim(),
    fileNames: result.fileNames,
    extractedWordCount: result.totalWords,
    criteria: draft.criteria.map((criterion, index) => ({
      id: `${slug(criterion.name)}-${index + 1}`,
      name: criterion.name.trim(),
      weight: Number(criterion.weight),
      evidence: criterion.evidence,
    })),
    createdAt,
  };
}

function links(project: UploadedProject, contribution = 1) {
  return project.criteria.map((criterion) => ({
    criterionId: criterion.id,
    contribution,
  }));
}

export function buildUploadedPlanTemplates(project: UploadedProject): PlanTaskTemplate[] {
  const criterionTasks = project.criteria.map((criterion, index) => ({
    id: `criterion-${index + 1}`,
    phase: "Build evidence",
    title: `Build evidence for ${criterion.name}`,
    description: `Collect, analyse and explain the material that lets a reviewer see how you meet “${criterion.name}”.`,
    priority: criterion.weight >= 25 ? "high" : criterion.weight >= 15 ? "medium" : "low",
    baseMinutes: Math.max(45, Math.round((45 + criterion.weight * 2) / 15) * 15),
    dependencies: ["confirm-brief"],
    doneDefinition: [
      "At least one traceable source or worked example is recorded",
      "A note explains how the evidence answers this criterion",
    ],
    rubricLinks: [{ criterionId: criterion.id, contribution: 1 }],
  })) satisfies PlanTaskTemplate[];

  const criterionTaskIds = criterionTasks.map((task) => task.id);
  const templates: PlanTaskTemplate[] = [
    {
      id: "confirm-brief",
      phase: "Confirm",
      title: "Confirm the brief and log open questions",
      description: "Check the deadline, word count, citation style and rubric against the original files before planning the submission.",
      priority: "high",
      baseMinutes: 30,
      dependencies: [],
      doneDefinition: [
        "Every confirmed field matches the original brief",
        "Unknown or ambiguous instructions are recorded as questions",
      ],
      rubricLinks: links(project, 0.2),
    },
    ...criterionTasks,
    {
      id: "rubric-outline",
      phase: "Structure",
      title: "Create a rubric-led outline and word budget",
      description: "Give higher-weight criteria enough space and make every section’s purpose explicit.",
      priority: "high",
      baseMinutes: 45,
      dependencies: ["confirm-brief"],
      doneDefinition: [
        `The outline fits the ${project.wordCount.toLocaleString()}-word limit`,
        "Every criterion points to at least one planned section",
      ],
      rubricLinks: links(project, 0.5),
    },
    {
      id: "draft",
      phase: "Draft",
      title: "Draft in your own words with source markers",
      description: "Write the submission section by section and keep each material claim traceable to a source or calculation.",
      priority: "high",
      baseMinutes: Math.max(180, Math.round(project.wordCount * 0.12 / 15) * 15),
      dependencies: ["rubric-outline", ...criterionTaskIds],
      doneDefinition: [
        "Every planned section has a complete first draft",
        "Claims, data and quotations have source markers",
      ],
      rubricLinks: links(project, 1),
    },
    {
      id: "rubric-audit",
      phase: "Review",
      title: "Run a criterion-by-criterion evidence audit",
      description: "Use the local self-check to verify that evidence is visible, explained and traceable for every criterion.",
      priority: "high",
      baseMinutes: 60,
      dependencies: ["draft"],
      doneDefinition: [
        "Every criterion has been self-checked against actual draft text",
        "Unresolved evidence gaps are back in the plan",
      ],
      rubricLinks: links(project, 1),
    },
    {
      id: "submission-qa",
      phase: "Review",
      title: "Complete final submission QA",
      description: "Check structure, word count, citations, file format and academic-integrity declarations before submitting.",
      priority: "high",
      baseMinutes: 45,
      dependencies: ["rubric-audit"],
      doneDefinition: [
        "The final file opens correctly and meets the required format",
        `Citation formatting follows ${project.citationStyle}`,
      ],
      rubricLinks: links(project, 0.4),
    },
  ];

  return templates.map((template) => planTaskTemplateSchema.parse(template));
}
