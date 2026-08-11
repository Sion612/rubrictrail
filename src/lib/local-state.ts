import { z } from "zod";
import { dateOnlySchema, draftCheckResultSchema } from "@/lib/domain";
import type { UploadedSourceEvidence } from "@/lib/files/parse-assignment-files";
import { DEFAULT_PLAN_TASK_TEMPLATES } from "@/lib/plan";
import { SAMPLE_READINESS, UPLOADED_READINESS } from "@/lib/readiness";
import { SAMPLE_DRAFT_TEXT } from "@/lib/sample-data";
import {
  maximumSupportedDueDate,
  UPLOADED_REVIEW_MAX_CHARACTERS,
} from "@/lib/uploaded-project";
import type {
  PersistedProjectState,
  UploadedCriterionReview,
  UploadedProject,
  UploadedProjectCriterion,
} from "@/lib/ui-types";

export const STORAGE_KEY = "rubrictrail.project.v2";
const LEGACY_STORAGE_KEY = "proofline.project.v1";

export const MAX_STORED_CHARACTERS = 2_500_000;
const MAX_ID_LENGTH = 160;
export const PROJECT_DRAFT_MAX_CHARACTERS = 100_000;
const MAX_CRITERIA = 50;
const MAX_FILES = 25;
const MAX_TASK_IDS = 200;
const MAX_READINESS_IDS = 32;

const VIEWS = ["overview", "rubric", "plan", "draft", "progress"] as const;
const viewSchema = z.enum(VIEWS);

const nonBlankString = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0, "Expected a non-blank string");

const idSchema = nonBlankString(MAX_ID_LENGTH);

const uploadedSourceEvidenceSchema: z.ZodType<UploadedSourceEvidence> = z
  .object({
    sourceId: idSchema.nullable(),
    fileName: nonBlankString(255).nullable(),
    page: z.number().int().positive().max(1_000_000).nullable(),
    excerpt: nonBlankString(4_096),
    startOffset: z.number().int().nonnegative().max(20_000_000),
    endOffset: z.number().int().nonnegative().max(20_000_000),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.endOffset < evidence.startOffset) {
      context.addIssue({
        code: "custom",
        message: "Evidence end offset cannot precede its start offset",
        path: ["endOffset"],
      });
    }
  });

const uploadedProjectCriterionSchema: z.ZodType<UploadedProjectCriterion> = z
  .object({
    id: idSchema,
    name: nonBlankString(300),
    weight: z.number().finite().positive().max(100),
    evidence: uploadedSourceEvidenceSchema.nullable(),
  })
  .strict();

const uploadedProjectSchema: z.ZodType<UploadedProject> = z
  .object({
    id: idSchema,
    title: nonBlankString(300),
    course: nonBlankString(200),
    dueDate: dateOnlySchema,
    wordCount: z.number().int().positive().max(50_000),
    citationStyle: nonBlankString(160),
    fileNames: z.array(nonBlankString(255)).min(1).max(MAX_FILES),
    extractedWordCount: z.number().int().nonnegative().max(5_000_000),
    criteria: z.array(uploadedProjectCriterionSchema).min(1).max(MAX_CRITERIA),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((project, context) => {
    const criterionIds = new Set<string>();
    project.criteria.forEach((criterion, index) => {
      if (criterionIds.has(criterion.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate uploaded criterion id: ${criterion.id}`,
          path: ["criteria", index, "id"],
        });
      }
      criterionIds.add(criterion.id);
    });

    const totalWeight = project.criteria.reduce(
      (total, criterion) => total + criterion.weight,
      0,
    );
    if (Math.abs(totalWeight - 100) > 0.01) {
      context.addIssue({
        code: "custom",
        message: "Uploaded criterion weights must total 100",
        path: ["criteria"],
      });
    }

    if (project.dueDate > maximumSupportedDueDate()) {
      context.addIssue({
        code: "custom",
        message: "Uploaded project due date is outside the supported planning window",
        path: ["dueDate"],
      });
    }
    if (new Date(project.createdAt).getTime() > Date.now() + 86_400_000) {
      context.addIssue({
        code: "custom",
        message: "Uploaded project creation time cannot be in the future",
        path: ["createdAt"],
      });
    }
  });

const uploadedCriterionReviewSchema: z.ZodType<UploadedCriterionReview> = z
  .object({
    criterionId: idSchema,
    draftText: z.string().max(UPLOADED_REVIEW_MAX_CHARACTERS),
    evidenceVisible: z.boolean(),
    linkExplained: z.boolean(),
    sourceTraceable: z.boolean(),
    updatedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

const persistedProjectStateSchema: z.ZodType<PersistedProjectState> = z
  .object({
    version: z.literal(2),
    projectKind: z.enum(["none", "sample", "uploaded"]),
    uploadedProject: uploadedProjectSchema.nullable(),
    view: viewSchema,
    visitedViews: z.array(viewSchema).max(VIEWS.length),
    completedTaskIds: z.array(idSchema).max(MAX_TASK_IDS),
    weeklyHours: z.number().finite().min(1).max(40),
    targetGrade: z.number().finite().min(40).max(95),
    draftText: z.string().max(PROJECT_DRAFT_MAX_CHARACTERS),
    selectedSectionId: idSchema,
    draftResult: draftCheckResultSchema.nullable(),
    checkedDraftText: z.string().max(PROJECT_DRAFT_MAX_CHARACTERS).nullable(),
    uploadedCriterionReviews: z
      .array(uploadedCriterionReviewSchema)
      .max(MAX_CRITERIA),
    readinessChecks: z.array(idSchema).max(MAX_READINESS_IDS),
  })
  .strict()
  .superRefine((state, context) => {
    if (state.projectKind === "uploaded" && state.uploadedProject === null) {
      context.addIssue({
        code: "custom",
        message: "Uploaded project state requires uploaded project data",
        path: ["uploadedProject"],
      });
    }
    if (state.projectKind !== "uploaded" && state.uploadedProject !== null) {
      context.addIssue({
        code: "custom",
        message: "Only uploaded project state may contain uploaded project data",
        path: ["uploadedProject"],
      });
    }
  });

export type ProjectStateReadSource = "v2" | "legacy" | "default";

export interface ProjectStateReadResult {
  state: PersistedProjectState;
  source: ProjectStateReadSource;
  recovered: boolean;
}

export type ProjectStateWriteResult =
  | { ok: true }
  | {
      ok: false;
      reason: "unavailable" | "invalid-state" | "storage-error";
    };

export type ProjectStateParseResult =
  | {
      ok: true;
      state: PersistedProjectState;
      recovered: boolean;
    }
  | {
      ok: false;
      reason: "unsupported-version" | "invalid-state";
    };

export type ProjectStateSerializationResult =
  | {
      ok: true;
      state: PersistedProjectState;
      recovered: boolean;
      serialized: string;
    }
  | {
      ok: false;
      reason: "unsupported-version" | "invalid-state";
    };

export function createDefaultProjectState(): PersistedProjectState {
  return {
    version: 2,
    projectKind: "none",
    uploadedProject: null,
    view: "overview",
    visitedViews: [],
    completedTaskIds: [],
    weeklyHours: 10,
    targetGrade: 70,
    draftText: SAMPLE_DRAFT_TEXT,
    selectedSectionId: "analysis-recommendations",
    draftResult: null,
    checkedDraftText: null,
    uploadedCriterionReviews: [],
    readinessChecks: [],
  };
}

export const DEFAULT_PROJECT_STATE = createDefaultProjectState();

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function boundedStrings(value: unknown, maximumCount: number): string[] {
  return Array.isArray(value)
    ? unique(
        value.filter(
          (item): item is string =>
            typeof item === "string" &&
            item.trim().length > 0 &&
            item.length <= MAX_ID_LENGTH,
        ),
      ).slice(0, maximumCount)
    : [];
}

function knownCompletedTaskIds(state: PersistedProjectState): Set<string> {
  if (state.projectKind === "sample") {
    return new Set(DEFAULT_PLAN_TASK_TEMPLATES.map((template) => template.id));
  }
  if (state.projectKind === "uploaded" && state.uploadedProject) {
    return new Set([
      "confirm-brief",
      "rubric-outline",
      "draft",
      "rubric-audit",
      "submission-qa",
      ...state.uploadedProject.criteria.map((_, index) => `criterion-${index + 1}`),
    ]);
  }
  return new Set();
}

function normalizeValidatedState(state: PersistedProjectState): {
  state: PersistedProjectState;
  recovered: boolean;
} {
  const knownTaskIds = knownCompletedTaskIds(state);
  const criterionIds = new Set(
    state.uploadedProject?.criteria.map((criterion) => criterion.id) ?? [],
  );
  const reviewByCriterion = new Map<string, UploadedCriterionReview>();
  const knownReadinessIds = new Set<string>(
    (state.projectKind === "sample"
      ? SAMPLE_READINESS
      : state.projectKind === "uploaded"
        ? UPLOADED_READINESS
        : []
    ).map(([id]) => id),
  );
  if (state.projectKind === "uploaded") {
    state.uploadedCriterionReviews.forEach((review) => {
      if (criterionIds.has(review.criterionId)) {
        reviewByCriterion.set(review.criterionId, review);
      }
    });
  }

  const nextState: PersistedProjectState = {
    ...state,
    visitedViews: unique(state.visitedViews),
    completedTaskIds: unique(state.completedTaskIds).filter((id) => knownTaskIds.has(id)),
    selectedSectionId:
      state.selectedSectionId === "analysis-and-recommendations"
        ? "analysis-recommendations"
        : state.selectedSectionId,
    uploadedCriterionReviews: [...reviewByCriterion.values()],
    readinessChecks: unique(state.readinessChecks).filter((id) =>
      knownReadinessIds.has(id),
    ),
  };

  return {
    state: nextState,
    recovered: JSON.stringify(nextState) !== JSON.stringify(state),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasArrayAtMost(
  value: Record<string, unknown>,
  key: string,
  maximum: number,
): boolean {
  const candidate = value[key];
  return Array.isArray(candidate) && candidate.length <= maximum;
}

function hasBoundedDraftResultCollections(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (
    !hasArrayAtMost(value, "criteria", 50) ||
    !hasArrayAtMost(value, "feedback", 200) ||
    !hasArrayAtMost(value, "nextActions", 100)
  ) {
    return false;
  }

  const criteria = value.criteria as unknown[];
  const feedback = value.feedback as unknown[];
  const nextActions = value.nextActions as unknown[];

  return (
    criteria.every(
      (criterion) =>
        isRecord(criterion) &&
        hasArrayAtMost(criterion, "strengths", 100) &&
        hasArrayAtMost(criterion, "gaps", 100) &&
        hasArrayAtMost(criterion, "evidenceRefs", 100),
    ) &&
    feedback.every(
      (item) =>
        isRecord(item) &&
        hasArrayAtMost(item, "rubricIds", 50) &&
        hasArrayAtMost(item, "draftEvidence", 50) &&
        hasArrayAtMost(item, "sourceEvidenceRefs", 100),
    ) &&
    nextActions.every(
      (action) => isRecord(action) && hasArrayAtMost(action, "rubricIds", 50),
    )
  );
}

function hasBoundedProjectCollections(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (
    !hasArrayAtMost(value, "visitedViews", VIEWS.length) ||
    !hasArrayAtMost(value, "completedTaskIds", MAX_TASK_IDS) ||
    !hasArrayAtMost(value, "uploadedCriterionReviews", MAX_CRITERIA) ||
    !hasArrayAtMost(value, "readinessChecks", MAX_READINESS_IDS) ||
    !hasBoundedDraftResultCollections(value.draftResult)
  ) {
    return false;
  }

  if (value.uploadedProject === null) return true;
  return (
    isRecord(value.uploadedProject) &&
    hasArrayAtMost(value.uploadedProject, "fileNames", MAX_FILES) &&
    hasArrayAtMost(value.uploadedProject, "criteria", MAX_CRITERIA)
  );
}

export function parsePersistedProjectStateValue(
  value: unknown,
): ProjectStateParseResult {
  if (!isRecord(value)) return { ok: false, reason: "invalid-state" };
  if (value.version !== 2) {
    return {
      ok: false,
      reason: typeof value.version === "number" ? "unsupported-version" : "invalid-state",
    };
  }
  if (!hasBoundedProjectCollections(value)) {
    return { ok: false, reason: "invalid-state" };
  }

  const parsed = persistedProjectStateSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: "invalid-state" };
  return { ok: true, ...normalizeValidatedState(parsed.data) };
}

export function serializePersistedProjectStateValue(
  value: unknown,
): ProjectStateSerializationResult {
  const parsed = parsePersistedProjectStateValue(value);
  if (!parsed.ok) return parsed;
  const serialized = JSON.stringify(parsed.state);
  if (serialized.length > MAX_STORED_CHARACTERS) {
    return { ok: false, reason: "invalid-state" };
  }
  return { ...parsed, serialized };
}

function parseV2(raw: string): ReturnType<typeof normalizeValidatedState> | null {
  if (raw.length > MAX_STORED_CHARACTERS) return null;
  try {
    const parsed = parsePersistedProjectStateValue(JSON.parse(raw));
    return parsed.ok
      ? { state: parsed.state, recovered: parsed.recovered }
      : null;
  } catch {
    return null;
  }
}

function validNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : fallback;
}

function migrateLegacy(raw: string): PersistedProjectState | null {
  if (raw.length > MAX_STORED_CHARACTERS) return null;
  try {
    const legacy = JSON.parse(raw) as unknown;
    if (typeof legacy !== "object" || legacy === null || Array.isArray(legacy)) return null;
    const candidate = legacy as Record<string, unknown>;
    const fallback = createDefaultProjectState();
    const parsedDraftResult = hasBoundedDraftResultCollections(candidate.draftResult)
      ? draftCheckResultSchema.safeParse(candidate.draftResult)
      : { success: false as const };
    const view = viewSchema.safeParse(candidate.view);
    const draftText =
      typeof candidate.draftText === "string" &&
      candidate.draftText.length <= PROJECT_DRAFT_MAX_CHARACTERS
        ? candidate.draftText
        : SAMPLE_DRAFT_TEXT;
    const checkedDraftText =
      typeof candidate.checkedDraftText === "string" &&
      candidate.checkedDraftText.length <= PROJECT_DRAFT_MAX_CHARACTERS
        ? candidate.checkedDraftText
        : null;
    const selectedSectionId =
      typeof candidate.selectedSectionId === "string" &&
      candidate.selectedSectionId.trim().length > 0 &&
      candidate.selectedSectionId.length <= MAX_ID_LENGTH
        ? candidate.selectedSectionId
        : fallback.selectedSectionId;

    const migrated = persistedProjectStateSchema.safeParse({
      ...fallback,
      projectKind: candidate.sampleLoaded === true ? "sample" : "none",
      view: view.success ? view.data : "overview",
      visitedViews: [],
      completedTaskIds: boundedStrings(candidate.completedTaskIds, MAX_TASK_IDS),
      weeklyHours: validNumber(candidate.weeklyHours, 1, 40, fallback.weeklyHours),
      targetGrade: validNumber(candidate.targetGrade, 40, 95, fallback.targetGrade),
      draftText,
      selectedSectionId,
      draftResult: parsedDraftResult.success ? parsedDraftResult.data : null,
      checkedDraftText,
      uploadedCriterionReviews: [],
      readinessChecks: boundedStrings(candidate.readinessChecks, MAX_READINESS_IDS),
    });
    return migrated.success ? normalizeValidatedState(migrated.data).state : null;
  } catch {
    return null;
  }
}

export function readProjectStateWithStatus(): ProjectStateReadResult {
  const fallback = createDefaultProjectState();
  if (typeof window === "undefined") {
    return { state: fallback, source: "default", recovered: false };
  }

  let v2Raw: string | null;
  try {
    v2Raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return { state: fallback, source: "default", recovered: true };
  }

  if (v2Raw !== null) {
    const parsed = parseV2(v2Raw);
    if (parsed) {
      return { state: parsed.state, source: "v2", recovered: parsed.recovered };
    }
  }

  let legacyRaw: string | null;
  try {
    legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return { state: fallback, source: "default", recovered: true };
  }

  if (legacyRaw !== null) {
    const migrated = migrateLegacy(legacyRaw);
    if (migrated) {
      return { state: migrated, source: "legacy", recovered: true };
    }
  }

  return {
    state: fallback,
    source: "default",
    recovered: v2Raw !== null || legacyRaw !== null,
  };
}

export function readProjectState(): PersistedProjectState {
  return readProjectStateWithStatus().state;
}

export function writeProjectState(state: PersistedProjectState): ProjectStateWriteResult {
  if (typeof window === "undefined") return { ok: false, reason: "unavailable" };

  const parsed = serializePersistedProjectStateValue(state);
  if (!parsed.ok) return { ok: false, reason: "invalid-state" };

  try {
    window.localStorage.setItem(STORAGE_KEY, parsed.serialized);
    return { ok: true };
  } catch {
    return { ok: false, reason: "storage-error" };
  }
}

export function clearProjectState(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Reset still succeeds in memory when browser storage is unavailable.
  }
}
