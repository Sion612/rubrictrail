import {
  dateOnlySchema,
  planTaskTemplateSchema,
  type PlanTaskTemplate,
} from "@/lib/domain";
import type {
  ManualSourceLocator,
  UploadFlowResult,
  UploadedCriterionReview,
  UploadedProject,
  UploadedProjectCriterion,
  UploadedProjectDraft,
  UploadedProjectSource,
  RubricWeightingStatus,
} from "@/lib/ui-types";

export const UPLOADED_REVIEW_MAX_CHARACTERS = 40_000;

/**
 * Source IDs preserve original file indices, so gaps are valid. The upper
 * bound is the intake limit rather than the current registry length because a
 * partially recovered project may legitimately contain only source-10.
 */
export function isCanonicalSourceId(sourceId: string): boolean {
  return /^source-([1-9]|10)$/u.test(sourceId);
}

const UNSAFE_SINGLE_LINE_PROJECT_METADATA_CHARACTER =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u;

export function isSafeSingleLineProjectMetadata(value: string): boolean {
  return !UNSAFE_SINGLE_LINE_PROJECT_METADATA_CHARACTER.test(value);
}

export interface UploadedProjectDraftIssue {
  targetId: string;
  message: string;
}

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

export function maximumSupportedDueDate(baseDate = todayIso()): string {
  return `${Number(baseDate.slice(0, 4)) + 4}${baseDate.slice(4)}`;
}

export function isConfirmedUploadedReview(
  review: UploadedCriterionReview,
): boolean {
  return Boolean(
    review.updatedAt &&
      review.draftText.trim().length >= 20 &&
      review.evidenceVisible &&
      review.linkExplained &&
      review.sourceTraceable,
  );
}

export function normalizeDateForInput(value: string | null): string {
  if (!value) return "";
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (iso) {
    const normalized = `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
    return dateOnlySchema.safeParse(normalized).success ? normalized : "";
  }
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(trimmed)) return "";

  const months: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };
  const dayFirst = trimmed.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(\d{4})$/i);
  const monthFirst = trimmed.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i);
  const match = dayFirst
    ? { day: dayFirst[1], month: months[dayFirst[2].toLowerCase()], year: dayFirst[3] }
    : monthFirst
      ? { day: monthFirst[2], month: months[monthFirst[1].toLowerCase()], year: monthFirst[3] }
      : null;
  if (!match?.month) return "";
  const normalized = `${match.year}-${String(match.month).padStart(2, "0")}-${match.day.padStart(2, "0")}`;
  return dateOnlySchema.safeParse(normalized).success ? normalized : "";
}

export function draftFromUpload(result: UploadFlowResult): UploadedProjectDraft {
  const { summary } = result;
  const hasCompletePublishedWeights =
    summary.rubric.criteria.length > 0 &&
    summary.rubric.criteria.every((criterion) => criterion.weight !== null) &&
    summary.rubric.totalWeight !== null &&
    Math.abs(summary.rubric.totalWeight - 100) < 0.01;
  return {
    title: summary.title.value ?? "",
    course: "",
    dueDate: normalizeDateForInput(summary.dueDate.value),
    wordCount: summary.wordCount.value ? String(summary.wordCount.value) : "",
    citationStyle: summary.citationStyle.value ?? "",
    weightingMode: hasCompletePublishedWeights ? "complete" : null,
    criteria: summary.rubric.criteria.map((criterion) => ({
      name: criterion.name,
      weight: criterion.weight === null ? "" : String(criterion.weight),
      evidence: criterion.evidence,
      manualSourceLocator: null,
    })),
  };
}

export function validateUploadedProjectDraftIssues(
  draft: UploadedProjectDraft,
  sources: UploadedProjectSource[],
): UploadedProjectDraftIssue[] {
  const issues: UploadedProjectDraftIssue[] = [];
  const addIssue = (targetId: string, message: string) => {
    issues.push({ targetId, message });
  };
  const wordCount = Number(draft.wordCount);
  const maximumDueDate = maximumSupportedDueDate();
  const title = draft.title.trim();
  const course = draft.course.trim();
  const totalWeight = draft.criteria.reduce(
    (total, criterion) => total + (Number(criterion.weight) || 0),
    0,
  );
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  if (!title) addIssue("confirm-title", "Add an assignment title.");
  else if (title.length > 300) addIssue("confirm-title", "Keep the assignment title under 300 characters.");
  else if (!isSafeSingleLineProjectMetadata(title)) {
    addIssue(
      "confirm-title",
      "Use a single-line assignment title without control or bidirectional formatting characters.",
    );
  }
  if (course.length > 200) addIssue("confirm-course", "Keep the course or module under 200 characters.");
  else if (course && !isSafeSingleLineProjectMetadata(course)) {
    addIssue(
      "confirm-course",
      "Use a single-line course or module name without control or bidirectional formatting characters.",
    );
  }
  if (!dateOnlySchema.safeParse(draft.dueDate).success) addIssue("confirm-deadline", "Add a real calendar deadline.");
  else if (draft.dueDate > maximumDueDate) addIssue("confirm-deadline", "Choose a deadline within the next four years.");
  if (!Number.isInteger(wordCount) || wordCount <= 0) addIssue("confirm-word-count", "Add a positive whole-number word count.");
  else if (wordCount > 50_000) addIssue("confirm-word-count", "Keep the word count at or below 50,000 words.");
  if (!draft.citationStyle.trim()) addIssue("confirm-citation-style", "Add a citation style, or enter “Not specified”.");
  else if (draft.citationStyle.trim().length > 160) addIssue("confirm-citation-style", "Keep the citation style under 160 characters.");
  if (draft.criteria.length === 0) addIssue("add-criterion", "Add at least one rubric criterion.");
  else if (draft.criteria.length > 50) addIssue("rubric-detection-title", "Keep the rubric to 50 criteria or fewer.");
  if (draft.weightingMode === null) {
    addIssue(
      "rubric-weighting-published",
      "Choose whether the official rubric provides a complete percentage breakdown.",
    );
  }
  draft.criteria.forEach((criterion, index) => {
    if (!criterion.name.trim()) {
      addIssue(`criterion-name-${index}`, `Criterion ${index + 1}: add a name.`);
    } else if (criterion.name.trim().length > 300) {
      addIssue(
        `criterion-name-${index}`,
        `Criterion ${index + 1}: keep the name under 300 characters.`,
      );
    }
    if (draft.weightingMode !== null) {
      const weight = Number(criterion.weight);
      if (draft.weightingMode === "complete" && !criterion.weight.trim()) {
        addIssue(
          `criterion-weight-${index}`,
          `Criterion ${index + 1}: enter the published percentage shown in the official rubric.`,
        );
      } else if (
        criterion.weight.trim() &&
        (!Number.isFinite(weight) || weight <= 0 || weight > 100)
      ) {
        addIssue(
          `criterion-weight-${index}`,
          `Criterion ${index + 1}: use an official percentage greater than 0 and no more than 100, or leave it blank if none is published.`,
        );
      }
    }
    if (criterion.evidence !== null && criterion.manualSourceLocator !== null) {
      addIssue(
        `criterion-source-${index}`,
        `Criterion ${index + 1}: retained evidence cannot also have a manual source locator.`,
      );
    }
    if (criterion.evidence !== null && sources.length > 0) {
      const evidence = criterion.evidence;
      const source = evidence.sourceId ? sourcesById.get(evidence.sourceId) : undefined;
      if (
        !source ||
        evidence.fileName !== source.fileName ||
        evidence.origin !== source.origin ||
        (source.kind === "pdf"
          ? evidence.page === null || evidence.page > (source.pageCount ?? 0)
          : evidence.page !== null)
      ) {
        addIssue(
          `criterion-source-${index}`,
          `Criterion ${index + 1}: retained evidence no longer matches an included source.`,
        );
      }
    }
    if (criterion.manualSourceLocator !== null) {
      const source = sourcesById.get(criterion.manualSourceLocator.sourceId);
      if (!source) {
        addIssue(
          `criterion-source-${index}`,
          `Criterion ${index + 1}: choose an included source, or leave the source blank.`,
        );
      } else {
        const manualPage = criterion.manualSourceLocator.page;
        if (
          manualPage !== null &&
          (!Number.isInteger(manualPage) ||
            manualPage <= 0 ||
            source.kind !== "pdf" ||
            source.pageCount === null ||
            manualPage > source.pageCount)
        ) {
          addIssue(
            `criterion-source-page-${index}`,
            source.kind === "pdf" && source.pageCount !== null
              ? `Criterion ${index + 1}: enter a whole PDF page from 1 to ${source.pageCount}, or leave it blank.`
              : `Criterion ${index + 1}: only PDF sources may have a page number.`,
          );
        }
      }
    }
  });
  if (
    draft.weightingMode === "complete" &&
    Math.abs(totalWeight - 100) > 0.01
  ) {
    addIssue(
      "rubric-weight-total",
      `Published rubric weights must total 100%; they currently total ${totalWeight || 0}%. Check for a missing criterion or a mistyped percentage.`,
    );
  }
  return issues;
}

export function validateUploadedProjectDraft(
  draft: UploadedProjectDraft,
  sources: UploadedProjectSource[],
): string[] {
  return validateUploadedProjectDraftIssues(draft, sources).map((issue) => issue.message);
}

export function validateUploadedProjectDraftFields(
  draft: UploadedProjectDraft,
): string[] {
  const fieldOnlyDraft: UploadedProjectDraft = {
    ...draft,
    criteria: draft.criteria.map((criterion) => ({
      ...criterion,
      evidence: null,
      manualSourceLocator: null,
    })),
  };
  return validateUploadedProjectDraft(fieldOnlyDraft, []);
}

export function manualSourceLocatorsEqual(
  left: ManualSourceLocator | null | undefined,
  right: ManualSourceLocator | null | undefined,
): boolean {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return left.sourceId === right.sourceId && left.page === right.page;
}

export function invalidateUploadedReviewAfterLocatorChange(
  review: UploadedCriterionReview | undefined,
): UploadedCriterionReview | undefined {
  if (!review) return undefined;
  return {
    ...review,
    sourceTraceable: false,
    updatedAt: null,
  };
}

export function applyManualSourceLocator(
  project: UploadedProject,
  criterionId: string,
  locator: ManualSourceLocator | null,
): UploadedProject {
  if (!project.sources?.length) {
    throw new Error("This older project does not contain a verifiable source registry.");
  }
  const criterion = project.criteria.find((item) => item.id === criterionId);
  if (!criterion) {
    throw new Error("The selected criterion is not part of this project.");
  }
  if (criterion.evidence !== null) {
    throw new Error("Retained source evidence cannot be overwritten from this panel.");
  }
  if (locator !== null) {
    const source = project.sources.find((item) => item.id === locator.sourceId);
    if (!source) {
      throw new Error("Choose an included source.");
    }
    if (source.kind === "pdf") {
      const page = locator.page;
      if (
        page !== null &&
        (!Number.isInteger(page) ||
          page <= 0 ||
          source.pageCount === null ||
          page > source.pageCount)
      ) {
        throw new Error(
          source.pageCount
            ? `Enter a whole PDF page from 1 to ${source.pageCount}, or leave it blank.`
            : "Only PDF sources may have a page number.",
        );
      }
    } else if (locator.page !== null) {
      throw new Error("Only PDF sources may have a page number.");
    }
  }
  return {
    ...project,
    criteria: project.criteria.map((item) =>
      item.id === criterionId
        ? { ...item, manualSourceLocator: locator }
        : item,
    ),
  };
}

export function resolveUploadedProjectSource(
  project: UploadedProject,
  sourceId: string | null | undefined,
): UploadedProjectSource | null {
  if (!sourceId) return null;
  return project.sources?.find((source) => source.id === sourceId) ?? null;
}

export type UploadedCriterionSourceState =
  | {
      kind: "retained";
      source: UploadedProjectSource | null;
    }
  | {
      kind: "manual";
      source: UploadedProjectSource;
    }
  | {
      kind: "none";
      source: null;
    };

export function uploadedCriterionSourceState(
  project: UploadedProject,
  criterion: UploadedProjectCriterion,
): UploadedCriterionSourceState {
  if (criterion.evidence) {
    return {
      kind: "retained",
      source: resolveUploadedProjectSource(project, criterion.evidence.sourceId),
    };
  }
  const manualSource = resolveUploadedProjectSource(
    project,
    criterion.manualSourceLocator?.sourceId,
  );
  return manualSource
    ? { kind: "manual", source: manualSource }
    : { kind: "none", source: null };
}

function validateNewSourceRegistry(result: UploadFlowResult): void {
  if (result.sources.length === 0) {
    throw new Error("A new uploaded project requires at least one parsed source.");
  }
  if (
    result.fileNames.length !== result.sources.length ||
    result.fileNames.some(
      (fileName, index) => fileName !== result.sources[index]?.fileName,
    )
  ) {
    throw new Error("Included filenames must match the parsed source registry in source order.");
  }

  const sourceIds = new Set<string>();
  for (const source of result.sources) {
    if (!isCanonicalSourceId(source.id) || sourceIds.has(source.id)) {
      throw new Error("Parsed sources must have unique canonical source ids.");
    }
    sourceIds.add(source.id);
    const isImage = ["png", "jpeg", "webp"].includes(source.kind);
    const valid =
      source.intakeMethod === result.intakeMethod &&
      (source.intakeMethod === "paste"
        ? source.kind === "txt" &&
          source.origin === "extracted" &&
          source.pageCount === null
        : source.kind === "pdf"
          ? source.origin === "extracted" &&
            Number.isInteger(source.pageCount) &&
            (source.pageCount ?? 0) > 0
          : isImage
            ? source.origin === "ocr" && source.pageCount === null
            : source.origin === "extracted" && source.pageCount === null);
    if (!valid) {
      throw new Error("Parsed source metadata does not match its intake and pagination model.");
    }
  }
}

export function createUploadedProject(
  result: UploadFlowResult,
  draft: UploadedProjectDraft,
): UploadedProject {
  validateNewSourceRegistry(result);
  const errors = validateUploadedProjectDraft(draft, result.sources);
  if (errors.length) throw new Error(errors.join(" "));
  const sources = new Map(result.sources.map((source) => [source.id, source]));
  const createdAt = new Date().toISOString();
  const retainedWeights = draft.criteria.map((criterion) => {
    const value = criterion.weight.trim();
    return value ? Number(value) : null;
  });
  const weightingStatus: RubricWeightingStatus =
    draft.weightingMode === "complete"
      ? "complete"
      : retainedWeights.some((weight) => weight !== null)
        ? "incomplete"
        : "none";
  return {
    id: `uploaded-${Date.now()}`,
    title: draft.title.trim(),
    course: draft.course.trim() || "Course not set",
    dueDate: draft.dueDate,
    wordCount: Number(draft.wordCount),
    citationStyle: draft.citationStyle.trim(),
    fileNames: result.sources.map((source) => source.fileName),
    sources: result.sources.map((source) => ({
      id: source.id,
      fileName: source.fileName,
      kind: source.kind,
      origin: source.origin,
      intakeMethod: source.intakeMethod,
      pageCount: source.pageCount,
    })),
    extractedWordCount: result.totalWords,
    weightingStatus,
    criteria: draft.criteria.map((criterion, index) => ({
      id: `${slug(criterion.name)}-${index + 1}`,
      name: criterion.name.trim(),
      weight: retainedWeights[index],
      evidence:
        criterion.evidence !== null &&
        criterion.evidence.sourceId !== null &&
        criterion.evidence.fileName !== null &&
        sources.get(criterion.evidence.sourceId)?.fileName ===
          criterion.evidence.fileName &&
        sources.get(criterion.evidence.sourceId)?.origin ===
          criterion.evidence.origin
          ? criterion.evidence
          : null,
      manualSourceLocator:
        criterion.evidence === null &&
        criterion.manualSourceLocator !== null &&
        sources.has(criterion.manualSourceLocator.sourceId)
          ? criterion.manualSourceLocator
          : null,
    })),
    createdAt,
  };
}

export function hasPublishedRubricWeights(
  project: UploadedProject,
): boolean {
  return (
    project.weightingStatus === "complete" &&
    project.criteria.length > 0 &&
    project.criteria.every((criterion) => criterion.weight !== null)
  );
}

function links(project: UploadedProject, contribution = 1) {
  return project.criteria.map((criterion) => ({
    criterionId: criterion.id,
    contribution,
  }));
}

export function buildUploadedPlanTemplates(project: UploadedProject): PlanTaskTemplate[] {
  const hasPublishedWeights = hasPublishedRubricWeights(project);
  const neutralCriterionMinutes = Math.max(
    45,
    Math.round((45 + 200 / project.criteria.length) / 15) * 15,
  );
  const criterionTasks = project.criteria.map((criterion, index) => ({
    id: `criterion-${index + 1}`,
    phase: "Build evidence",
    title: `Build evidence for ${criterion.name}`,
    description: `Collect, analyse and explain the material that lets a reviewer see how you meet “${criterion.name}”.`,
    priority:
      hasPublishedWeights && criterion.weight !== null
        ? criterion.weight >= 25
          ? "high"
          : criterion.weight >= 15
            ? "medium"
            : "low"
        : "high",
    baseMinutes:
      hasPublishedWeights && criterion.weight !== null
        ? Math.max(45, Math.round((45 + criterion.weight * 2) / 15) * 15)
        : neutralCriterionMinutes,
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
      description: "Check the deadline, word count, citation style and rubric against the authoritative source before planning the submission.",
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
      description: hasPublishedWeights
        ? "Give higher-weight criteria enough space and make every section’s purpose explicit."
        : "Give every criterion the same planning baseline and make every section’s purpose explicit. This baseline is not a grade weighting.",
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
