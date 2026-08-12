import { z } from "zod";
import { dateOnlySchema, draftCheckResultSchema } from "@/lib/domain";
import type { UploadedSourceEvidence } from "@/lib/files/parse-assignment-files";
import { DEFAULT_PLAN_TASK_TEMPLATES } from "@/lib/plan";
import { SAMPLE_READINESS, UPLOADED_READINESS } from "@/lib/readiness";
import { SAMPLE_DRAFT_TEXT } from "@/lib/sample-data";
import {
  isSafeSingleLineProjectMetadata,
  maximumSupportedDueDate,
  UPLOADED_REVIEW_MAX_CHARACTERS,
} from "@/lib/uploaded-project";
import type {
  PersistedProjectState,
  UploadedCriterionReview,
  UploadedProject,
  UploadedProjectCriterion,
} from "@/lib/ui-types";

export const STORAGE_KEY = "rubrictrail.project.v3";
export const PREVIOUS_STORAGE_KEY = "rubrictrail.project.v2";
export const LEGACY_STORAGE_KEY = "proofline.project.v1";
export const PROJECT_RECORD_KEY = "rubrictrail.project.store.v1";
export const PROJECT_LOCK_NAME = "rubrictrail.project.store.v1";

export const MAX_STORED_CHARACTERS = 2_500_000;
const MAX_ID_LENGTH = 160;
export const PROJECT_DRAFT_MAX_CHARACTERS = 100_000;
const MAX_CRITERIA = 50;
const MAX_FILES = 25;
const MAX_TASK_IDS = 200;
const MAX_READINESS_IDS = 32;
const UNSAFE_PERSISTED_FILE_NAME_CHARACTER =
  /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u;
const CANONICAL_SOURCE_ID = /^source-([1-9]\d*)$/u;
const V2_FINGERPRINT_PATTERN = /^v1:\d+:[0-9a-f]{8}:[0-9a-f]{8}$/;
const MAX_PROJECT_RECORD_CHARACTERS = MAX_STORED_CHARACTERS + 1_024;

const VIEWS = ["overview", "rubric", "plan", "draft", "progress"] as const;
const viewSchema = z.enum(VIEWS);

const nonBlankString = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0, "Expected a non-blank string");

const idSchema = nonBlankString(MAX_ID_LENGTH);
const savedFileNameSchema = nonBlankString(255).refine(
  (value) => !UNSAFE_PERSISTED_FILE_NAME_CHARACTER.test(value),
  "Saved filenames cannot contain control or bidirectional formatting characters",
);
const singleLineProjectMetadataSchema = (maximum: number) =>
  nonBlankString(maximum).refine(
    isSafeSingleLineProjectMetadata,
    "Project metadata cannot contain line breaks, control characters, or bidirectional formatting characters",
  );

const uploadedSourceEvidenceSchema: z.ZodType<UploadedSourceEvidence> = z
  .object({
    sourceId: idSchema.nullable(),
    fileName: savedFileNameSchema.nullable(),
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
    weight: z.number().finite().positive().max(100).nullable(),
    evidence: uploadedSourceEvidenceSchema.nullable(),
  })
  .strict();

const uploadedProjectSchema: z.ZodType<UploadedProject> = z
  .object({
    id: idSchema,
    title: singleLineProjectMetadataSchema(300),
    course: singleLineProjectMetadataSchema(200),
    dueDate: dateOnlySchema,
    wordCount: z.number().int().positive().max(50_000),
    citationStyle: nonBlankString(160),
    fileNames: z.array(savedFileNameSchema).min(1).max(MAX_FILES),
    extractedWordCount: z.number().int().nonnegative().max(5_000_000),
    weightingStatus: z.enum(["complete", "incomplete", "none"]),
    criteria: z.array(uploadedProjectCriterionSchema).min(1).max(MAX_CRITERIA),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((project, context) => {
    const fileNames = new Set(project.fileNames);
    const sourceFileNames = new Map<string, string>();
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

      const evidence = criterion.evidence;
      if (
        evidence !== null &&
        evidence.fileName !== null &&
        !fileNames.has(evidence.fileName)
      ) {
        context.addIssue({
          code: "custom",
          message: "Criterion evidence filename is not part of the saved project sources",
          path: ["criteria", index, "evidence", "fileName"],
        });
      }
      if (evidence !== null) {
        if (evidence.sourceId === null || evidence.fileName === null) {
          context.addIssue({
            code: "custom",
            message: "Criterion evidence must include both its source id and filename",
            path: ["criteria", index, "evidence", "sourceId"],
          });
        }
        if (evidence.sourceId !== null) {
          const sourceIdMatch = CANONICAL_SOURCE_ID.exec(evidence.sourceId);
          const sourceNumber = sourceIdMatch ? Number(sourceIdMatch[1]) : Number.NaN;
          if (!Number.isSafeInteger(sourceNumber) || sourceNumber > MAX_FILES) {
            context.addIssue({
              code: "custom",
              message: "Criterion evidence source id is not canonical",
              path: ["criteria", index, "evidence", "sourceId"],
            });
          }
        }
        if (evidence.endOffset - evidence.startOffset !== evidence.excerpt.length) {
          context.addIssue({
            code: "custom",
            message: "Criterion evidence offsets do not match its retained excerpt",
            path: ["criteria", index, "evidence", "endOffset"],
          });
        }
        if (evidence.sourceId !== null && evidence.fileName !== null) {
          const previousFileName = sourceFileNames.get(evidence.sourceId);
          if (previousFileName !== undefined && previousFileName !== evidence.fileName) {
            context.addIssue({
              code: "custom",
              message: "One criterion evidence source id cannot name multiple files",
              path: ["criteria", index, "evidence", "fileName"],
            });
          } else {
            sourceFileNames.set(evidence.sourceId, evidence.fileName);
          }
        }
      }
    });

    const numericWeights = project.criteria.filter(
      (criterion): criterion is UploadedProjectCriterion & { weight: number } =>
        criterion.weight !== null,
    );
    const totalWeight = numericWeights.reduce(
      (total, criterion) => total + criterion.weight,
      0,
    );
    const hasCompleteWeights =
      numericWeights.length === project.criteria.length &&
      Math.abs(totalWeight - 100) <= 0.01;
    const weightingStatusMatches =
      (project.weightingStatus === "complete" && hasCompleteWeights) ||
      (project.weightingStatus === "none" && numericWeights.length === 0) ||
      (project.weightingStatus === "incomplete" && numericWeights.length > 0);
    if (!weightingStatusMatches) {
      context.addIssue({
        code: "custom",
        message:
          "Uploaded rubric weights do not match the confirmed weighting status",
        path: ["weightingStatus"],
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
    version: z.literal(3),
    supersededV2Fingerprint: z
      .string()
      .max(40)
      .regex(V2_FINGERPRINT_PATTERN)
      .nullable(),
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

export type ProjectStorageRecordValue =
  | { kind: "project"; state: PersistedProjectState }
  | { kind: "cleared" };

export interface ProjectStorageRecordV1 {
  formatVersion: 1;
  revision: number;
  value: ProjectStorageRecordValue;
  legacyFingerprints: {
    v3: string | null;
    v2: string | null;
    v1: string | null;
  };
}

const storageFingerprintSchema = z
  .string()
  .max(40)
  .regex(V2_FINGERPRINT_PATTERN)
  .nullable();

const projectStorageRecordSchema = z
  .object({
    formatVersion: z.literal(1),
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    value: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("project"),
          state: z.unknown(),
        })
        .strict(),
      z.object({ kind: z.literal("cleared") }).strict(),
    ]),
    legacyFingerprints: z
      .object({
        v3: storageFingerprintSchema,
        v2: storageFingerprintSchema,
        v1: storageFingerprintSchema,
      })
      .strict(),
  })
  .strict();

export type ProjectRecordStatus = "missing" | "active" | "cleared" | "invalid";

export interface ProjectStorageBaseline {
  recordStatus: ProjectRecordStatus;
  recordValue: string | null;
  revision: number | null;
  legacyV3Value: string | null;
  legacyV2Value: string | null;
  legacyV1Value: string | null;
}

export interface LegacyConflictCandidate {
  source: "v3" | "v2" | "legacy";
  state: PersistedProjectState;
}

export type ProjectStateReadSource =
  | "record"
  | "v3"
  | "v2"
  | "legacy"
  | "default";

export interface ProjectStateReadResult {
  state: PersistedProjectState;
  source: ProjectStateReadSource;
  recovered: boolean;
  storedValue: string | null;
  previousStoredValue: string | null;
  crossVersionConflict: boolean;
  storageAvailable: boolean;
  mutationAvailable: boolean;
  baseline: ProjectStorageBaseline;
  legacyConflictCandidate: LegacyConflictCandidate | null;
}

export interface ProjectMutationOptions {
  /**
   * Revalidates the caller's in-memory intent after the exclusive project lock
   * is acquired. This callback must be synchronous and side-effect free.
   */
  intentGuard?: () => boolean;
}

export type ProjectStateWriteResult =
  | {
      ok: true;
      recordValue: string;
      revision: number;
      baseline: ProjectStorageBaseline;
    }
  | {
      ok: false;
      reason:
        | "unavailable"
        | "coordination-unavailable"
        | "invalid-state"
        | "invalid-record"
        | "storage-error"
        | "intent-changed"
        | "conflict";
    };

export type ProjectStateClearResult =
  | {
      ok: true;
      recordValue: string;
      revision: number;
      baseline: ProjectStorageBaseline;
    }
  | {
      ok: false;
      reason:
        | "unavailable"
        | "coordination-unavailable"
        | "invalid-record"
        | "storage-error"
        | "conflict";
    };

export type ProjectStatePurgeResult =
  | {
      ok: true;
      recordValue: string;
      revision: number;
      baseline: ProjectStorageBaseline;
    }
  | {
      ok: false;
      reason:
        | "unavailable"
        | "coordination-unavailable"
        | "invalid-record"
        | "storage-error"
        | "intent-changed"
        | "conflict";
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
    version: 3,
    supersededV2Fingerprint: null,
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

function fingerprintStoredValue(raw: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < raw.length; index += 1) {
    const codeUnit = raw.charCodeAt(index);
    first = Math.imul(first ^ codeUnit, 0x01000193);
    second = Math.imul(second ^ codeUnit, 0x85ebca6b);
    second ^= second >>> 13;
  }
  const hex = (value: number) => (value >>> 0).toString(16).padStart(8, "0");
  return `v1:${raw.length}:${hex(first)}:${hex(second)}`;
}

function migrateV2ProjectStateValue(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const state = { ...value };
  delete state.supersededV2Fingerprint;
  const uploadedProject = state.uploadedProject;
  delete state.uploadedProject;
  let migratedUploadedProject = uploadedProject;
  if (isRecord(uploadedProject)) {
    const project = { ...uploadedProject };
    delete project.weightingStatus;
    migratedUploadedProject = {
      ...project,
      weightingStatus: "complete",
    };
  }
  return {
    ...state,
    version: 3,
    supersededV2Fingerprint: null,
    uploadedProject: migratedUploadedProject,
  };
}

function normalizeLegacyEvidenceOffsets(value: Record<string, unknown>): {
  value: Record<string, unknown>;
  recovered: boolean;
} {
  const uploadedProject = value.uploadedProject;
  if (!isRecord(uploadedProject) || !Array.isArray(uploadedProject.criteria)) {
    return { value, recovered: false };
  }

  let recovered = false;
  const criteria = uploadedProject.criteria.map((criterion) => {
    if (!isRecord(criterion) || !isRecord(criterion.evidence)) return criterion;
    const evidence = criterion.evidence;
    const { excerpt, startOffset, endOffset } = evidence;
    if (
      typeof excerpt !== "string" ||
      typeof startOffset !== "number" ||
      !Number.isInteger(startOffset) ||
      typeof endOffset !== "number" ||
      !Number.isInteger(endOffset) ||
      endOffset - startOffset <= excerpt.length
    ) {
      return criterion;
    }

    recovered = true;
    return {
      ...criterion,
      evidence: {
        ...evidence,
        // v0.2.0 retained a trimmed excerpt while its offsets covered the
        // untrimmed source line. The original text is no longer available, so
        // preserve the recorded start and normalize the span to the excerpt.
        endOffset: startOffset + excerpt.length,
      },
    };
  });

  if (!recovered) return { value, recovered: false };
  return {
    value: {
      ...value,
      uploadedProject: { ...uploadedProject, criteria },
    },
    recovered: true,
  };
}

export function parsePersistedProjectStateValue(
  value: unknown,
): ProjectStateParseResult {
  if (!isRecord(value)) return { ok: false, reason: "invalid-state" };
  if (value.version !== 2 && value.version !== 3) {
    return {
      ok: false,
      reason: typeof value.version === "number" ? "unsupported-version" : "invalid-state",
    };
  }
  if (!hasBoundedProjectCollections(value)) {
    return { ok: false, reason: "invalid-state" };
  }

  const migratedValue = value.version === 2 ? migrateV2ProjectStateValue(value) : value;
  const evidenceNormalization = normalizeLegacyEvidenceOffsets(migratedValue);
  const parsed = persistedProjectStateSchema.safeParse(evidenceNormalization.value);
  if (!parsed.success) return { ok: false, reason: "invalid-state" };

  const normalized = normalizeValidatedState(parsed.data);
  return {
    ok: true,
    state: normalized.state,
    recovered:
      value.version === 2 ||
      evidenceNormalization.recovered ||
      normalized.recovered,
  };
}

export function parsePreviousProjectStateValue(
  raw: string,
): ProjectStateParseResult {
  if (raw.length > MAX_STORED_CHARACTERS) {
    return { ok: false, reason: "invalid-state" };
  }
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value)) return { ok: false, reason: "invalid-state" };
    if (value.version !== 2) {
      return {
        ok: false,
        reason:
          typeof value.version === "number"
            ? "unsupported-version"
            : "invalid-state",
      };
    }
    return parsePersistedProjectStateValue(value);
  } catch {
    return { ok: false, reason: "invalid-state" };
  }
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

function parseStoredVersion(
  raw: string,
  expectedVersion: 2 | 3,
): ReturnType<typeof normalizeValidatedState> | null {
  if (raw.length > MAX_STORED_CHARACTERS) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || value.version !== expectedVersion) return null;
    const parsed = parsePersistedProjectStateValue(value);
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

interface ParsedProjectStorageRecord {
  record: ProjectStorageRecordV1;
  status: "active" | "cleared";
  state: PersistedProjectState | null;
  recovered: boolean;
}

interface LocalProjectStorageSnapshot {
  recordValue: string | null;
  legacyV3Value: string | null;
  legacyV2Value: string | null;
  legacyV1Value: string | null;
}

function fingerprintOptionalStoredValue(raw: string | null): string | null {
  return raw === null ? null : fingerprintStoredValue(raw);
}

function parseProjectStorageRecord(
  raw: string,
): ParsedProjectStorageRecord | null {
  if (raw.length > MAX_PROJECT_RECORD_CHARACTERS) return null;
  try {
    const parsedRecord = projectStorageRecordSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsedRecord.success) return null;

    const { formatVersion, revision, legacyFingerprints } = parsedRecord.data;
    if (parsedRecord.data.value.kind === "cleared") {
      return {
        record: {
          formatVersion,
          revision,
          value: { kind: "cleared" },
          legacyFingerprints,
        },
        status: "cleared",
        state: null,
        recovered: false,
      };
    }

    const rawState = parsedRecord.data.value.state;
    if (!isRecord(rawState) || rawState.version !== 3) return null;
    const parsedState = parsePersistedProjectStateValue(rawState);
    if (!parsedState.ok) return null;
    return {
      record: {
        formatVersion,
        revision,
        value: { kind: "project", state: parsedState.state },
        legacyFingerprints,
      },
      status: "active",
      state: parsedState.state,
      recovered: parsedState.recovered,
    };
  } catch {
    return null;
  }
}

function readLocalProjectStorageSnapshot(): LocalProjectStorageSnapshot | null {
  try {
    return {
      recordValue: window.localStorage.getItem(PROJECT_RECORD_KEY),
      legacyV3Value: window.localStorage.getItem(STORAGE_KEY),
      legacyV2Value: window.localStorage.getItem(PREVIOUS_STORAGE_KEY),
      legacyV1Value: window.localStorage.getItem(LEGACY_STORAGE_KEY),
    };
  } catch {
    return null;
  }
}

function baselineFromSnapshot(
  snapshot: LocalProjectStorageSnapshot,
  parsedRecord: ParsedProjectStorageRecord | null =
    snapshot.recordValue === null
      ? null
      : parseProjectStorageRecord(snapshot.recordValue),
): ProjectStorageBaseline {
  return {
    recordStatus:
      snapshot.recordValue === null
        ? "missing"
        : parsedRecord?.status ?? "invalid",
    recordValue: snapshot.recordValue,
    revision: parsedRecord?.record.revision ?? null,
    legacyV3Value: snapshot.legacyV3Value,
    legacyV2Value: snapshot.legacyV2Value,
    legacyV1Value: snapshot.legacyV1Value,
  };
}

function emptyStorageBaseline(): ProjectStorageBaseline {
  return {
    recordStatus: "missing",
    recordValue: null,
    revision: null,
    legacyV3Value: null,
    legacyV2Value: null,
    legacyV1Value: null,
  };
}

function getProjectLockManager(): LockManager | null {
  if (typeof navigator === "undefined") return null;
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  return locks && typeof locks.request === "function" ? locks : null;
}

function legacyFingerprintMismatches(
  record: ProjectStorageRecordV1,
  snapshot: LocalProjectStorageSnapshot,
): Array<"v3" | "v2" | "legacy"> {
  const mismatches: Array<"v3" | "v2" | "legacy"> = [];
  if (
    record.legacyFingerprints.v3 !==
    fingerprintOptionalStoredValue(snapshot.legacyV3Value)
  ) {
    mismatches.push("v3");
  }
  if (
    record.legacyFingerprints.v2 !==
    fingerprintOptionalStoredValue(snapshot.legacyV2Value)
  ) {
    mismatches.push("v2");
  }
  if (
    record.legacyFingerprints.v1 !==
    fingerprintOptionalStoredValue(snapshot.legacyV1Value)
  ) {
    mismatches.push("legacy");
  }
  return mismatches;
}

function legacyConflictCandidate(
  mismatches: Array<"v3" | "v2" | "legacy">,
  snapshot: LocalProjectStorageSnapshot,
): LegacyConflictCandidate | null {
  if (mismatches.length !== 1) return null;
  const source = mismatches[0];
  if (source === "v3") {
    const raw = snapshot.legacyV3Value;
    const parsed = raw === null ? null : parseStoredVersion(raw, 3);
    return parsed ? { source, state: parsed.state } : null;
  }
  if (source === "v2") {
    const raw = snapshot.legacyV2Value;
    const parsed = raw === null ? null : parseStoredVersion(raw, 2);
    return parsed ? { source, state: parsed.state } : null;
  }
  const raw = snapshot.legacyV1Value;
  const state = raw === null ? null : migrateLegacy(raw);
  return state ? { source, state } : null;
}

interface ColdStartAlternative {
  source: LegacyConflictCandidate["source"];
  raw: string | null;
  state: PersistedProjectState | null;
  superseded?: boolean;
}

function analyzeColdStartAlternatives(
  primaryState: PersistedProjectState | null,
  alternatives: ColdStartAlternative[],
): {
  crossVersionConflict: boolean;
  legacyConflictCandidate: LegacyConflictCandidate | null;
} {
  const differences = alternatives.filter((alternative) => {
    if (alternative.raw === null || alternative.superseded === true) return false;
    return !(
      primaryState !== null &&
      alternative.state !== null &&
      canonicalStatesEquivalent(primaryState, alternative.state)
    );
  });
  const onlyDifference = differences.length === 1 ? differences[0] : null;
  return {
    crossVersionConflict: differences.length > 0,
    legacyConflictCandidate:
      onlyDifference?.state === null || onlyDifference === null
        ? null
        : { source: onlyDifference.source, state: onlyDifference.state },
  };
}

export function readProjectStateWithStatus(): ProjectStateReadResult {
  const fallback = createDefaultProjectState();
  if (typeof window === "undefined") {
    return {
      state: fallback,
      source: "default",
      recovered: false,
      storedValue: null,
      previousStoredValue: null,
      crossVersionConflict: false,
      storageAvailable: false,
      mutationAvailable: false,
      baseline: emptyStorageBaseline(),
      legacyConflictCandidate: null,
    };
  }

  const snapshot = readLocalProjectStorageSnapshot();
  if (snapshot === null) {
    return {
      state: fallback,
      source: "default",
      recovered: true,
      storedValue: null,
      previousStoredValue: null,
      crossVersionConflict: false,
      storageAvailable: false,
      mutationAvailable: false,
      baseline: emptyStorageBaseline(),
      legacyConflictCandidate: null,
    };
  }

  const lockManager = getProjectLockManager();
  const parsedRecord =
    snapshot.recordValue === null
      ? null
      : parseProjectStorageRecord(snapshot.recordValue);
  const baseline = baselineFromSnapshot(snapshot, parsedRecord);

  if (snapshot.recordValue !== null) {
    if (parsedRecord === null) {
      return {
        state: fallback,
        source: "default",
        recovered: true,
        storedValue: snapshot.recordValue,
        previousStoredValue: snapshot.legacyV2Value,
        crossVersionConflict: true,
        storageAvailable: true,
        mutationAvailable: lockManager !== null,
        baseline,
        legacyConflictCandidate: null,
      };
    }

    const mismatches = legacyFingerprintMismatches(parsedRecord.record, snapshot);
    return {
      state: parsedRecord.state ?? fallback,
      source: "record",
      recovered: parsedRecord.recovered,
      storedValue: snapshot.recordValue,
      previousStoredValue: snapshot.legacyV2Value,
      crossVersionConflict: mismatches.length > 0,
      storageAvailable: true,
      mutationAvailable: lockManager !== null,
      baseline,
      legacyConflictCandidate: legacyConflictCandidate(mismatches, snapshot),
    };
  }

  const v3Raw = snapshot.legacyV3Value;
  const v2Raw = snapshot.legacyV2Value;
  const legacyRaw = snapshot.legacyV1Value;
  const parsedV3 = v3Raw === null ? null : parseStoredVersion(v3Raw, 3);
  const parsedV2 = v2Raw === null ? null : parseStoredVersion(v2Raw, 2);
  const parsedLegacy = legacyRaw === null ? null : migrateLegacy(legacyRaw);

  if (v3Raw !== null) {
    const alternatives = analyzeColdStartAlternatives(
      parsedV3?.state ?? null,
      [
        {
          source: "v2",
          raw: v2Raw,
          state: parsedV2?.state ?? null,
          superseded:
            parsedV3 !== null &&
            v2Raw !== null &&
            parsedV3.state.supersededV2Fingerprint ===
              fingerprintStoredValue(v2Raw),
        },
        { source: "legacy", raw: legacyRaw, state: parsedLegacy },
      ],
    );
    if (parsedV3) {
      return {
        state: parsedV3.state,
        source: "v3",
        recovered: parsedV3.recovered,
        storedValue: v3Raw,
        previousStoredValue: v2Raw,
        crossVersionConflict: alternatives.crossVersionConflict,
        storageAvailable: true,
        mutationAvailable: lockManager !== null,
        baseline,
        legacyConflictCandidate: alternatives.legacyConflictCandidate,
      };
    }

    return {
      state: fallback,
      source: "default",
      recovered: true,
      storedValue: v3Raw,
      previousStoredValue: v2Raw,
      crossVersionConflict: alternatives.crossVersionConflict,
      storageAvailable: true,
      mutationAvailable: lockManager !== null,
      baseline,
      legacyConflictCandidate: alternatives.legacyConflictCandidate,
    };
  }

  if (parsedV2) {
    const alternatives = analyzeColdStartAlternatives(parsedV2.state, [
      { source: "legacy", raw: legacyRaw, state: parsedLegacy },
    ]);
    return {
      state: parsedV2.state,
      source: "v2",
      recovered: true,
      storedValue: v3Raw,
      previousStoredValue: v2Raw,
      crossVersionConflict: alternatives.crossVersionConflict,
      storageAvailable: true,
      mutationAvailable: lockManager !== null,
      baseline,
      legacyConflictCandidate: alternatives.legacyConflictCandidate,
    };
  }

  if (parsedLegacy !== null) {
    return {
      state: parsedLegacy,
      source: "legacy",
      recovered: true,
      storedValue: v3Raw,
      previousStoredValue: v2Raw,
      crossVersionConflict: false,
      storageAvailable: true,
      mutationAvailable: lockManager !== null,
      baseline,
      legacyConflictCandidate: null,
    };
  }

  return {
    state: fallback,
    source: "default",
    recovered: v2Raw !== null || legacyRaw !== null,
    storedValue: v3Raw,
    previousStoredValue: v2Raw,
    crossVersionConflict: false,
    storageAvailable: true,
    mutationAvailable: lockManager !== null,
    baseline,
    legacyConflictCandidate: null,
  };
}

export function readProjectState(): PersistedProjectState {
  return readProjectStateWithStatus().state;
}

function storageBaselineMatches(
  expected: ProjectStorageBaseline,
  snapshot: LocalProjectStorageSnapshot,
  actual: ProjectStorageBaseline,
): boolean {
  return (
    expected.recordStatus === actual.recordStatus &&
    expected.recordValue === snapshot.recordValue &&
    expected.revision === actual.revision &&
    expected.legacyV3Value === snapshot.legacyV3Value &&
    expected.legacyV2Value === snapshot.legacyV2Value &&
    expected.legacyV1Value === snapshot.legacyV1Value
  );
}

function legacyFingerprintsFromSnapshot(
  snapshot: LocalProjectStorageSnapshot,
): ProjectStorageRecordV1["legacyFingerprints"] {
  return {
    v3: fingerprintOptionalStoredValue(snapshot.legacyV3Value),
    v2: fingerprintOptionalStoredValue(snapshot.legacyV2Value),
    v1: fingerprintOptionalStoredValue(snapshot.legacyV1Value),
  };
}

function serializeProjectStorageRecord(
  record: ProjectStorageRecordV1,
): string | null {
  const parsed = projectStorageRecordSchema.safeParse(record);
  if (!parsed.success) return null;
  const serialized = JSON.stringify(record);
  return serialized.length <= MAX_PROJECT_RECORD_CHARACTERS ? serialized : null;
}

function successfulMutationBaseline(
  recordValue: string,
  revision: number,
  status: "active" | "cleared",
  snapshot: LocalProjectStorageSnapshot,
): ProjectStorageBaseline {
  return {
    recordStatus: status,
    recordValue,
    revision,
    legacyV3Value: snapshot.legacyV3Value,
    legacyV2Value: snapshot.legacyV2Value,
    legacyV1Value: snapshot.legacyV1Value,
  };
}

function legacyValuesMatch(
  before: LocalProjectStorageSnapshot,
  after: LocalProjectStorageSnapshot,
): boolean {
  return (
    before.legacyV3Value === after.legacyV3Value &&
    before.legacyV2Value === after.legacyV2Value &&
    before.legacyV1Value === after.legacyV1Value
  );
}

function storageSnapshotsMatch(
  expected: LocalProjectStorageSnapshot,
  actual: LocalProjectStorageSnapshot,
): boolean {
  return (
    expected.recordValue === actual.recordValue &&
    expected.legacyV3Value === actual.legacyV3Value &&
    expected.legacyV2Value === actual.legacyV2Value &&
    expected.legacyV1Value === actual.legacyV1Value
  );
}

async function requestExclusiveProjectLock<T>(
  operation: () => T,
): Promise<{ ok: true; value: T } | { ok: false }> {
  const lockManager = getProjectLockManager();
  if (lockManager === null) return { ok: false };
  try {
    const value = await lockManager.request(
      PROJECT_LOCK_NAME,
      { mode: "exclusive" },
      () => operation(),
    );
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

function mutationIntentIsCurrent(options: ProjectMutationOptions): boolean {
  try {
    return options.intentGuard?.() ?? true;
  } catch {
    return false;
  }
}

export async function writeProjectState(
  state: PersistedProjectState,
  expected: ProjectStorageBaseline,
  options: ProjectMutationOptions = {},
): Promise<ProjectStateWriteResult> {
  if (typeof window === "undefined") return { ok: false, reason: "unavailable" };
  if (getProjectLockManager() === null) {
    return { ok: false, reason: "coordination-unavailable" };
  }

  const preparedState = serializePersistedProjectStateValue(state);
  if (!preparedState.ok) return { ok: false, reason: "invalid-state" };

  const locked = await requestExclusiveProjectLock<ProjectStateWriteResult>(() => {
    const snapshot = readLocalProjectStorageSnapshot();
    if (snapshot === null) return { ok: false, reason: "storage-error" };
    const parsedRecord =
      snapshot.recordValue === null
        ? null
        : parseProjectStorageRecord(snapshot.recordValue);
    const actual = baselineFromSnapshot(snapshot, parsedRecord);
    if (!storageBaselineMatches(expected, snapshot, actual)) {
      return { ok: false, reason: "conflict" };
    }
    if (actual.recordStatus === "invalid") {
      return { ok: false, reason: "invalid-record" };
    }

    const currentRevision = parsedRecord?.record.revision ?? 0;
    if (currentRevision >= Number.MAX_SAFE_INTEGER) {
      return { ok: false, reason: "invalid-record" };
    }
    const revision = currentRevision + 1;
    const finalState = serializePersistedProjectStateValue({
      ...preparedState.state,
      supersededV2Fingerprint: fingerprintOptionalStoredValue(
        snapshot.legacyV2Value,
      ),
    });
    if (!finalState.ok) return { ok: false, reason: "invalid-state" };

    const record: ProjectStorageRecordV1 = {
      formatVersion: 1,
      revision,
      value: { kind: "project", state: finalState.state },
      legacyFingerprints: legacyFingerprintsFromSnapshot(snapshot),
    };
    const recordValue = serializeProjectStorageRecord(record);
    if (recordValue === null) return { ok: false, reason: "invalid-state" };
    if (!mutationIntentIsCurrent(options)) {
      return { ok: false, reason: "intent-changed" };
    }

    try {
      window.localStorage.setItem(PROJECT_RECORD_KEY, recordValue);
    } catch {
      return { ok: false, reason: "storage-error" };
    }

    const verified = readLocalProjectStorageSnapshot();
    if (verified === null) return { ok: false, reason: "storage-error" };
    if (
      verified.recordValue !== recordValue ||
      !legacyValuesMatch(snapshot, verified)
    ) {
      // Do not attempt a non-atomic rollback. The committed record and changed
      // legacy value remain separate, recoverable conflict candidates.
      return { ok: false, reason: "conflict" };
    }

    return {
      ok: true,
      recordValue,
      revision,
      baseline: successfulMutationBaseline(
        recordValue,
        revision,
        "active",
        verified,
      ),
    };
  });

  return locked.ok
    ? locked.value
    : { ok: false, reason: "coordination-unavailable" };
}

function canonicalStatesEquivalent(
  current: PersistedProjectState,
  previous: PersistedProjectState,
): boolean {
  return JSON.stringify({ ...current, supersededV2Fingerprint: null }) ===
    JSON.stringify({ ...previous, supersededV2Fingerprint: null });
}

export async function clearProjectState(
  expected: ProjectStorageBaseline,
): Promise<ProjectStateClearResult> {
  if (typeof window === "undefined") return { ok: false, reason: "unavailable" };
  if (getProjectLockManager() === null) {
    return { ok: false, reason: "coordination-unavailable" };
  }

  const locked = await requestExclusiveProjectLock<ProjectStateClearResult>(() => {
    const snapshot = readLocalProjectStorageSnapshot();
    if (snapshot === null) return { ok: false, reason: "storage-error" };
    const parsedRecord =
      snapshot.recordValue === null
        ? null
        : parseProjectStorageRecord(snapshot.recordValue);
    const actual = baselineFromSnapshot(snapshot, parsedRecord);
    if (!storageBaselineMatches(expected, snapshot, actual)) {
      return { ok: false, reason: "conflict" };
    }

    const currentRevision = parsedRecord?.record.revision ?? 0;
    if (currentRevision >= Number.MAX_SAFE_INTEGER) {
      return { ok: false, reason: "invalid-record" };
    }
    // An exact invalid baseline may be replaced only by this explicit destructive
    // recovery path. Ordinary writes remain fail-closed for invalid records.
    const revision = currentRevision + 1;
    const record: ProjectStorageRecordV1 = {
      formatVersion: 1,
      revision,
      value: { kind: "cleared" },
      legacyFingerprints: legacyFingerprintsFromSnapshot(snapshot),
    };
    const recordValue = serializeProjectStorageRecord(record);
    if (recordValue === null) return { ok: false, reason: "invalid-record" };

    try {
      window.localStorage.setItem(PROJECT_RECORD_KEY, recordValue);
    } catch {
      return { ok: false, reason: "storage-error" };
    }

    const verified = readLocalProjectStorageSnapshot();
    if (verified === null) return { ok: false, reason: "storage-error" };
    if (
      verified.recordValue !== recordValue ||
      !legacyValuesMatch(snapshot, verified)
    ) {
      return { ok: false, reason: "conflict" };
    }

    return {
      ok: true,
      recordValue,
      revision,
      baseline: successfulMutationBaseline(
        recordValue,
        revision,
        "cleared",
        verified,
      ),
    };
  });

  return locked.ok
    ? locked.value
    : { ok: false, reason: "coordination-unavailable" };
}

export async function purgeProjectState(
  expected: ProjectStorageBaseline,
  options: ProjectMutationOptions = {},
): Promise<ProjectStatePurgeResult> {
  if (typeof window === "undefined") return { ok: false, reason: "unavailable" };
  if (getProjectLockManager() === null) {
    return { ok: false, reason: "coordination-unavailable" };
  }

  const locked = await requestExclusiveProjectLock<ProjectStatePurgeResult>(() => {
    const snapshot = readLocalProjectStorageSnapshot();
    if (snapshot === null) return { ok: false, reason: "storage-error" };
    const parsedRecord =
      snapshot.recordValue === null
        ? null
        : parseProjectStorageRecord(snapshot.recordValue);
    const actual = baselineFromSnapshot(snapshot, parsedRecord);
    if (!storageBaselineMatches(expected, snapshot, actual)) {
      return { ok: false, reason: "conflict" };
    }

    const currentRevision = parsedRecord?.record.revision ?? 0;
    if (currentRevision > Number.MAX_SAFE_INTEGER - 2) {
      return { ok: false, reason: "invalid-record" };
    }

    // Publish a content-free guard before deleting legacy data. Current-version
    // writers that observed the old record will then fail their exact baseline
    // check even if this purge is interrupted partway through.
    const guardRevision = currentRevision + 1;
    const guardRecordValue = serializeProjectStorageRecord({
      formatVersion: 1,
      revision: guardRevision,
      value: { kind: "cleared" },
      legacyFingerprints: legacyFingerprintsFromSnapshot(snapshot),
    });
    if (guardRecordValue === null) {
      return { ok: false, reason: "invalid-record" };
    }
    if (!mutationIntentIsCurrent(options)) {
      return { ok: false, reason: "intent-changed" };
    }

    try {
      window.localStorage.setItem(PROJECT_RECORD_KEY, guardRecordValue);
    } catch {
      return { ok: false, reason: "storage-error" };
    }

    const guarded = readLocalProjectStorageSnapshot();
    if (guarded === null) return { ok: false, reason: "storage-error" };
    const expectedGuarded: LocalProjectStorageSnapshot = {
      ...snapshot,
      recordValue: guardRecordValue,
    };
    if (!storageSnapshotsMatch(expectedGuarded, guarded)) {
      return { ok: false, reason: "conflict" };
    }

    let working = guarded;
    const removeLegacyValue = (
      key: string,
      field: "legacyV3Value" | "legacyV2Value" | "legacyV1Value",
    ): ProjectStatePurgeResult | null => {
      const before = readLocalProjectStorageSnapshot();
      if (before === null) return { ok: false, reason: "storage-error" };
      if (!storageSnapshotsMatch(working, before)) {
        return { ok: false, reason: "conflict" };
      }
      if (before[field] === null) {
        working = before;
        return null;
      }

      try {
        window.localStorage.removeItem(key);
      } catch {
        return { ok: false, reason: "storage-error" };
      }

      const after = readLocalProjectStorageSnapshot();
      if (after === null) return { ok: false, reason: "storage-error" };
      const expectedAfter = { ...working, [field]: null };
      if (!storageSnapshotsMatch(expectedAfter, after)) {
        return { ok: false, reason: "conflict" };
      }
      working = after;
      return null;
    };

    const legacyV1Removal = removeLegacyValue(
      LEGACY_STORAGE_KEY,
      "legacyV1Value",
    );
    if (legacyV1Removal !== null) return legacyV1Removal;
    const legacyV2Removal = removeLegacyValue(
      PREVIOUS_STORAGE_KEY,
      "legacyV2Value",
    );
    if (legacyV2Removal !== null) return legacyV2Removal;
    const legacyV3Removal = removeLegacyValue(STORAGE_KEY, "legacyV3Value");
    if (legacyV3Removal !== null) return legacyV3Removal;

    // A final tombstone records the now-empty legacy baseline. Keeping this
    // content-free record prevents stale or older tabs from becoming an
    // authoritative project again without surfacing a conflict.
    const revision = guardRevision + 1;
    const recordValue = serializeProjectStorageRecord({
      formatVersion: 1,
      revision,
      value: { kind: "cleared" },
      legacyFingerprints: {
        v3: null,
        v2: null,
        v1: null,
      },
    });
    if (recordValue === null) {
      return { ok: false, reason: "invalid-record" };
    }

    const beforeFinalWrite = readLocalProjectStorageSnapshot();
    if (beforeFinalWrite === null) {
      return { ok: false, reason: "storage-error" };
    }
    if (!storageSnapshotsMatch(working, beforeFinalWrite)) {
      return { ok: false, reason: "conflict" };
    }
    try {
      window.localStorage.setItem(PROJECT_RECORD_KEY, recordValue);
    } catch {
      return { ok: false, reason: "storage-error" };
    }

    const verified = readLocalProjectStorageSnapshot();
    if (verified === null) return { ok: false, reason: "storage-error" };
    const expectedFinal: LocalProjectStorageSnapshot = {
      recordValue,
      legacyV3Value: null,
      legacyV2Value: null,
      legacyV1Value: null,
    };
    if (!storageSnapshotsMatch(expectedFinal, verified)) {
      return { ok: false, reason: "conflict" };
    }

    return {
      ok: true,
      recordValue,
      revision,
      baseline: successfulMutationBaseline(
        recordValue,
        revision,
        "cleared",
        verified,
      ),
    };
  });

  return locked.ok
    ? locked.value
    : { ok: false, reason: "coordination-unavailable" };
}
