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

export interface AssignmentFileIntakeError {
  code: AssignmentFileErrorCode | "NO_READABLE_FILES" | "UNKNOWN";
  fileName: string | null;
  title: string;
  message: string;
  preferredRecovery: AssignmentIntakeMode;
  fileIssues: SkippedAssignmentFile[];
}

export interface PastedTextIntakeError {
  target: "brief" | "combined" | "unknown";
  message: string;
}

export interface UploadedProjectCriterion {
  id: string;
  name: string;
  weight: number;
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
  version: 2;
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
