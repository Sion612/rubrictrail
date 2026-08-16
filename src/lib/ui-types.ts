import type { DraftCheckResult } from "@/lib/domain";
import type {
  AssignmentFileErrorCode,
  SkippedAssignmentFile,
  UploadedAssignmentSummary,
  UploadedSourceEvidence,
} from "@/lib/files/parse-assignment-files";

export type WorkspaceView = "overview" | "rubric" | "plan" | "draft" | "progress";
export type ProjectKind = "none" | "sample" | "uploaded";
export type WorkflowState = "complete" | "in_progress" | "needs_review" | "not_started";
export type AssignmentIntakeMode = "files" | "paste";
export type RubricWeightingMode = "complete" | "not_complete";
export type RubricWeightingStatus = "complete" | "incomplete" | "none";

export interface AssignmentFileIntakeError {
  code: AssignmentFileErrorCode | "NO_READABLE_FILES" | "UNKNOWN";
  fileName: string | null;
  title: string;
  message: string;
  preferredRecovery: AssignmentIntakeMode;
  fileIssues: SkippedAssignmentFile[];
}

export interface PastedTextIntakeError {
  code?: "brief-required" | "unreadable" | "too-many-characters" | "too-many-lines" | "too-large" | "unknown";
  target: "brief" | "combined" | "unknown";
  message: string;
}

export interface UploadedProjectCriterion {
  id: string;
  name: string;
  /** A percentage explicitly confirmed from the rubric; never an inferred equal share. */
  weight: number | null;
  evidence: UploadedSourceEvidence | null;
}

export interface UploadedProject {
  id: string;
  title: string;
  course: string;
  dueDate: string;
  wordCount: number;
  citationStyle: string;
  fileNames: string[];
  extractedWordCount: number;
  /** Whether the retained official percentages form a complete 100% breakdown. */
  weightingStatus: RubricWeightingStatus;
  criteria: UploadedProjectCriterion[];
  createdAt: string;
}

export interface UploadedCriterionReview {
  criterionId: string;
  draftText: string;
  evidenceVisible: boolean;
  linkExplained: boolean;
  sourceTraceable: boolean;
  updatedAt: string | null;
}

export interface PersistedProjectState {
  version: 3;
  /** Fingerprint of the v2 bytes this v3 state superseded, when migrated locally. */
  supersededV2Fingerprint: string | null;
  projectKind: ProjectKind;
  uploadedProject: UploadedProject | null;
  view: WorkspaceView;
  visitedViews: WorkspaceView[];
  completedTaskIds: string[];
  weeklyHours: number;
  targetGrade: number;
  draftText: string;
  selectedSectionId: string;
  draftResult: DraftCheckResult | null;
  checkedDraftText: string | null;
  uploadedCriterionReviews: UploadedCriterionReview[];
  readinessChecks: string[];
}

export interface UploadFlowResult {
  intakeMethod: AssignmentIntakeMode;
  fileNames: string[];
  sources?: Array<{
    fileName: string;
    origin: "extracted" | "ocr";
  }>;
  skippedFiles: SkippedAssignmentFile[];
  totalWords: number;
  summary: UploadedAssignmentSummary;
}

export interface UploadedProjectDraft {
  title: string;
  course: string;
  dueDate: string;
  wordCount: string;
  citationStyle: string;
  weightingMode: RubricWeightingMode | null;
  criteria: Array<{
    name: string;
    weight: string;
    evidence: UploadedSourceEvidence | null;
  }>;
}

export interface NoticeState {
  tone: "success" | "warning" | "info";
  message: string;
}
