"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Info, Route, X } from "lucide-react";
import { WelcomeScreen } from "@/components/welcome-screen";
import { WorkspaceShell, type WorkspaceProjectMeta } from "@/components/workspace-shell";
import { StorageConflictBanner } from "@/components/storage-conflict-banner";
import { PersistenceUnavailableBanner } from "@/components/persistence-unavailable-banner";
import { useI18n, useLocalizedMessages } from "@/components/locale-provider";
import { BRAND } from "@/lib/brand";
import type { PlanningDepth } from "@/lib/domain";
import { SAMPLE_ASSIGNMENT, SAMPLE_DRAFT_TEXT } from "@/lib/sample-data";
import {
  generateActionPlan,
  legacyTargetGradeForPlanningDepth,
  planningDepthFromLegacyTargetGrade,
} from "@/lib/plan";
import { runMockDraftCheck } from "@/lib/mock-service";
import { UPLOADED_READINESS } from "@/lib/readiness";
import {
  appEn,
  appZhCN,
  formatAppMessage,
  localizeStoredAppMessage,
  type AppMessageKey,
} from "@/lib/i18n/messages/app";
import type { Locale } from "@/lib/i18n/types";
import {
  ASSIGNMENT_EXTRACTED_TEXT_MAX_CHARACTERS,
  ASSIGNMENT_EXTRACTED_TEXT_MAX_LINES,
  ASSIGNMENT_EXTRACTED_TEXT_MAX_WORDS,
  ASSIGNMENT_IMAGE_MAX_DIMENSION,
  ASSIGNMENT_IMAGE_MAX_PIXELS,
  ASSIGNMENT_PDF_MAX_PAGES,
  ASSIGNMENT_PDFS_MAX_TOTAL_PAGES,
  AssignmentFileBatchParseError,
  AssignmentFileParseError,
  buildUploadedAssignmentSummary,
  parseAssignmentFiles,
  parseAssignmentFilesWithRecovery,
  type AssignmentImageOcrProgress,
} from "@/lib/files/parse-assignment-files";
import {
  createPastedAssignmentFiles,
  validatePastedAssignmentText,
} from "@/lib/pasted-text-intake";
import {
  createDefaultProjectState,
  LEGACY_STORAGE_KEY,
  parsePreviousProjectStateValue,
  PREVIOUS_STORAGE_KEY,
  PROJECT_RECORD_KEY,
  purgeProjectState,
  readProjectStateWithStatus,
  STORAGE_KEY,
  type ProjectStorageBaseline,
  writeProjectState,
} from "@/lib/local-state";
import {
  projectBackupFileName,
  projectBackupTitle,
  ProjectBackupError,
  readProjectBackupFile,
  serializeProjectBackup,
} from "@/lib/project-backup";
import {
  applyManualSourceLocator,
  buildUploadedPlanTemplates,
  invalidateUploadedReviewAfterLocatorChange,
  isConfirmedUploadedReview,
  todayIso,
} from "@/lib/uploaded-project";
import type {
  AssignmentFileIntakeError,
  AssignmentIntakeMode,
  ManualSourceLocator,
  NoticeState,
  PastedTextIntakeError,
  PersistedProjectState,
  UploadedCriterionReview,
  UploadedProject,
  UploadFlowResult,
  WorkflowState,
  WorkspaceView,
} from "@/lib/ui-types";

function DeferredPhaseFallback() {
  const { t } = useI18n();

  return (
    <div
      className="checking-state"
      role="status"
      aria-live="polite"
      aria-label={t("app.loading")}
    >
      <Route aria-hidden="true" />
      <h2>{t("app.loading")}</h2>
      <div className="loading-line" aria-hidden="true"><span /></div>
    </div>
  );
}

function DeferredEvidenceFallback() {
  const { t } = useI18n();

  return (
    <div className="evidence-panel-shell" data-testid="deferred-evidence-shell">
      <div className="evidence-panel-shell__backdrop" aria-hidden="true" />
      <div className="evidence-panel" aria-busy="true">
        <div
          className="checking-state"
          role="status"
          aria-live="polite"
          aria-label={t("app.loading")}
        >
          <Route aria-hidden="true" />
          <h2>{t("app.loading")}</h2>
          <div className="loading-line" aria-hidden="true"><span /></div>
        </div>
      </div>
    </div>
  );
}

const UploadSummaryView = dynamic(
  () => import("@/components/upload-summary-view").then((module) => module.UploadSummaryView),
  { loading: DeferredPhaseFallback, ssr: false },
);
const EvidencePanel = dynamic(
  () => import("@/components/evidence-panel").then((module) => module.EvidencePanel),
  { loading: DeferredEvidenceFallback, ssr: false },
);
const UploadedEvidencePanel = dynamic(
  () => import("@/components/uploaded-evidence-panel").then((module) => module.UploadedEvidencePanel),
  { loading: DeferredEvidenceFallback, ssr: false },
);
const OverviewView = dynamic(
  () => import("@/components/views/overview-view").then((module) => module.OverviewView),
  { loading: DeferredPhaseFallback, ssr: false },
);
const RubricView = dynamic(
  () => import("@/components/views/rubric-view").then((module) => module.RubricView),
  { loading: DeferredPhaseFallback, ssr: false },
);
const ActionPlanView = dynamic(
  () => import("@/components/views/action-plan-view").then((module) => module.ActionPlanView),
  { loading: DeferredPhaseFallback, ssr: false },
);
const DraftCheckView = dynamic(
  () => import("@/components/views/draft-check-view").then((module) => module.DraftCheckView),
  { loading: DeferredPhaseFallback, ssr: false },
);
const ProgressView = dynamic(
  () => import("@/components/views/progress-view").then((module) => module.ProgressView),
  { loading: DeferredPhaseFallback, ssr: false },
);
const UploadedBriefView = dynamic(
  () => import("@/components/views/uploaded-project-views").then((module) => module.UploadedBriefView),
  { loading: DeferredPhaseFallback, ssr: false },
);
const UploadedRubricView = dynamic(
  () => import("@/components/views/uploaded-project-views").then((module) => module.UploadedRubricView),
  { loading: DeferredPhaseFallback, ssr: false },
);
const UploadedDraftReviewView = dynamic(
  () => import("@/components/views/uploaded-project-views").then((module) => module.UploadedDraftReviewView),
  { loading: DeferredPhaseFallback, ssr: false },
);
const UploadedProgressView = dynamic(
  () => import("@/components/views/uploaded-project-views").then((module) => module.UploadedProgressView),
  { loading: DeferredPhaseFallback, ssr: false },
);

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

type AppNoticeState = NoticeState | {
  kind: "plan-updated";
  tone: NoticeState["tone"];
  weeklyHours: number;
  planningDepth: PlanningDepth;
};

function fileErrorRecovery(locale: Locale): Record<
  AssignmentFileParseError["code"],
  Pick<AssignmentFileIntakeError, "title" | "message" | "preferredRecovery">
> {
  const messages = locale === "zh-CN" ? appZhCN : appEn;
  const numberLocale = locale === "zh-CN" ? "zh-CN" : "en-US";
  return {
  UNSUPPORTED_FILE_TYPE: {
    title: messages["file.unsupported.title"],
    message: messages["file.unsupported.message"],
    preferredRecovery: "files",
  },
  INVALID_FILE_NAME: {
    title: messages["file.name.title"],
    message: messages["file.name.message"],
    preferredRecovery: "files",
  },
  FILE_TOO_LARGE: {
    title: messages["file.large.title"],
    message: messages["file.large.message"],
    preferredRecovery: "files",
  },
  TOO_MANY_FILES: {
    title: messages["file.many.title"],
    message: messages["file.many.message"],
    preferredRecovery: "files",
  },
  TOTAL_FILE_SIZE_TOO_LARGE: {
    title: messages["file.totalSize.title"],
    message: messages["file.totalSize.message"],
    preferredRecovery: "files",
  },
  EXTRACTED_TEXT_TOO_LARGE: {
    title: messages["file.characters.title"],
    message: formatAppMessage(messages["file.characters.message"], {
      count: ASSIGNMENT_EXTRACTED_TEXT_MAX_CHARACTERS.toLocaleString(numberLocale),
    }),
    preferredRecovery: "paste",
  },
  EXTRACTED_TEXT_TOO_MANY_LINES: {
    title: messages["file.lines.title"],
    message: formatAppMessage(messages["file.lines.message"], {
      count: ASSIGNMENT_EXTRACTED_TEXT_MAX_LINES.toLocaleString(numberLocale),
    }),
    preferredRecovery: "paste",
  },
  EXTRACTED_TEXT_TOO_MANY_WORDS: {
    title: messages["file.words.title"],
    message: formatAppMessage(messages["file.words.message"], {
      count: ASSIGNMENT_EXTRACTED_TEXT_MAX_WORDS.toLocaleString(numberLocale),
    }),
    preferredRecovery: "paste",
  },
  PDF_TOO_MANY_PAGES: {
    title: messages["file.pdfPages.title"],
    message: formatAppMessage(messages["file.pdfPages.message"], {
      count: ASSIGNMENT_PDF_MAX_PAGES.toLocaleString(numberLocale),
    }),
    preferredRecovery: "paste",
  },
  TOTAL_PDF_PAGES_TOO_LARGE: {
    title: messages["file.totalPdfPages.title"],
    message: formatAppMessage(messages["file.totalPdfPages.message"], {
      count: ASSIGNMENT_PDFS_MAX_TOTAL_PAGES.toLocaleString(numberLocale),
    }),
    preferredRecovery: "paste",
  },
  EMPTY_FILE: {
    title: messages["file.empty.title"],
    message: messages["file.empty.message"],
    preferredRecovery: "paste",
  },
  INVALID_TEXT_ENCODING: {
    title: messages["file.encoding.title"],
    message: messages["file.encoding.message"],
    preferredRecovery: "files",
  },
  INVALID_IMAGE: {
    title: messages["file.image.title"],
    message: messages["file.image.message"],
    preferredRecovery: "files",
  },
  IMAGE_DIMENSIONS_TOO_LARGE: {
    title: messages["file.imageDimensions.title"],
    message: formatAppMessage(messages["file.imageDimensions.message"], {
      dimension: ASSIGNMENT_IMAGE_MAX_DIMENSION.toLocaleString(numberLocale),
      pixels: ASSIGNMENT_IMAGE_MAX_PIXELS.toLocaleString(numberLocale),
    }),
    preferredRecovery: "files",
  },
  OCR_UNAVAILABLE: {
    title: messages["file.ocrUnavailable.title"],
    message: messages["file.ocrUnavailable.message"],
    preferredRecovery: "paste",
  },
  OCR_NO_TEXT: {
    title: messages["file.ocrEmpty.title"],
    message: messages["file.ocrEmpty.message"],
    preferredRecovery: "paste",
  },
  SCANNED_NO_TEXT: {
    title: messages["file.scanned.title"],
    message: messages["file.scanned.message"],
    preferredRecovery: "paste",
  },
  ENCRYPTED_PDF: {
    title: messages["file.encrypted.title"],
    message: messages["file.encrypted.message"],
    preferredRecovery: "paste",
  },
  PARSER_UNAVAILABLE: {
    title: messages["file.parser.title"],
    message: messages["file.parser.message"],
    preferredRecovery: "paste",
  },
  CORRUPT_DOCUMENT: {
    title: messages["file.corrupt.title"],
    message: messages["file.corrupt.message"],
    preferredRecovery: "files",
  },
  };
}

const BATCH_WIDE_FILE_ERROR_CODES = new Set<AssignmentFileParseError["code"]>([
  "TOO_MANY_FILES",
  "TOTAL_FILE_SIZE_TOO_LARGE",
  "EXTRACTED_TEXT_TOO_LARGE",
  "EXTRACTED_TEXT_TOO_MANY_LINES",
  "EXTRACTED_TEXT_TOO_MANY_WORDS",
  "TOTAL_PDF_PAGES_TOO_LARGE",
]);

export function friendlyFileError(
  error: unknown,
  locale: Locale = "en",
): AssignmentFileIntakeError {
  const recovery = fileErrorRecovery(locale);
  const messages = locale === "zh-CN" ? appZhCN : appEn;
  if (error instanceof AssignmentFileBatchParseError) {
    if (error.failures.length === 1) {
      const failure = error.failures[0];
      return {
        code: failure.code,
        fileName: failure.fileName,
        ...recovery[failure.code],
        fileIssues: [],
      };
    }
    const preferPaste = error.failures.every(
      (failure) => recovery[failure.code].preferredRecovery === "paste",
    );
    return {
      code: "NO_READABLE_FILES",
      fileName: null,
      title: messages["file.none.title"],
      message: messages["file.none.message"],
      preferredRecovery: preferPaste ? "paste" : "files",
      fileIssues: [...error.failures],
    };
  }
  if (error instanceof AssignmentFileParseError) {
    return {
      code: error.code,
      fileName: BATCH_WIDE_FILE_ERROR_CODES.has(error.code)
        ? null
        : error.fileName,
      ...recovery[error.code],
      fileIssues: [],
    };
  }
  return {
    code: "UNKNOWN",
    fileName: null,
    title: messages["file.unknown.title"],
    message: messages["file.unknown.message"],
    preferredRecovery: "files",
    fileIssues: [],
  };
}

function friendlyBackupError(error: unknown, locale: Locale = "en"): string {
  const messages = locale === "zh-CN" ? appZhCN : appEn;
  if (error instanceof ProjectBackupError) {
    return messages[`backup.error.${error.code}` as keyof typeof messages];
  }
  return messages["backup.readFailed"];
}

function localizeFileIntakeError(
  error: AssignmentFileIntakeError | null,
  locale: Locale,
): AssignmentFileIntakeError | null {
  if (!error) return null;
  const messages = locale === "zh-CN" ? appZhCN : appEn;
  if (error.code === "NO_READABLE_FILES") {
    return {
      ...error,
      title: messages["file.none.title"],
      message: messages["file.none.message"],
    };
  }
  if (error.code === "UNKNOWN") {
    return {
      ...error,
      title: messages["file.unknown.title"],
      message: messages["file.unknown.message"],
    };
  }
  return { ...error, ...fileErrorRecovery(locale)[error.code] };
}

function friendlyPastedParseError(
  error: unknown,
  locale: Locale = "en",
): PastedTextIntakeError {
  const messages = locale === "zh-CN" ? appZhCN : appEn;
  if (error instanceof AssignmentFileParseError) {
    if (error.code === "EMPTY_FILE" || error.code === "SCANNED_NO_TEXT") {
      return {
        code: "unreadable",
        target: "brief",
        message: messages["paste.empty"],
      };
    }
    if (error.code === "EXTRACTED_TEXT_TOO_LARGE") {
      return {
        code: "too-large",
        target: "combined",
        message: messages["paste.large"],
      };
    }
  }
  return {
    code: "unknown",
    target: "unknown",
    message: messages["paste.failed"],
  };
}

function backupDateLabel(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function backupProjectDetails(
  state: PersistedProjectState,
  locale: Locale,
): string {
  const messages = locale === "zh-CN" ? appZhCN : appEn;
  const course = state.uploadedProject?.course ?? SAMPLE_ASSIGNMENT.course;
  const dueDate =
    state.uploadedProject?.dueDate ?? SAMPLE_ASSIGNMENT.dueAt.slice(0, 10);
  const dueLabel = new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-GB", {
    dateStyle: "medium",
  }).format(new Date(`${dueDate}T12:00:00`));
  return [
    formatAppMessage(messages["backup.detail.course"], { course }),
    formatAppMessage(messages["backup.detail.due"], { due: dueLabel }),
  ].join("\n");
}

function planStartFor(dueDate: string, today: string): string {
  return dueDate < today ? dueDate : today;
}

interface PersistenceWarningState {
  kind: "recovered" | "write";
  message: string;
}

type PersistenceFlushOutcome = "saved" | "blocked" | "failed";

function sampleStepStates(
  project: PersistedProjectState,
  completion: number,
  hasCurrentDraftResult: boolean,
) {
  const draftState: WorkflowState = hasCurrentDraftResult
    ? "complete"
    : project.visitedViews.includes("draft")
      ? "in_progress"
      : "not_started";
  return {
    overview: "complete",
    rubric: "complete",
    plan: completion === 100
      ? "complete"
      : completion > 0
        ? "in_progress"
        : "needs_review",
    draft: draftState,
    progress: project.visitedViews.includes("progress") ? "in_progress" : "not_started",
  } satisfies Record<WorkspaceView, WorkflowState>;
}

function uploadedStepStates(project: PersistedProjectState, completion: number) {
  const uploaded = project.uploadedProject;
  const criterionIds = new Set(uploaded?.criteria.map((criterion) => criterion.id) ?? []);
  const completeReviews = uploaded
    ? new Set(project.uploadedCriterionReviews.filter(
        (review) =>
          criterionIds.has(review.criterionId) &&
          isConfirmedUploadedReview(review),
      ).map((review) => review.criterionId)).size
    : 0;
  const readinessComplete = UPLOADED_READINESS.filter(([id]) =>
    project.readinessChecks.includes(id),
  ).length;
  const reviewState: WorkflowState =
    uploaded && completeReviews === uploaded.criteria.length
      ? "complete"
      : completeReviews > 0 || project.visitedViews.includes("draft")
        ? "in_progress"
        : "not_started";
  const progressComplete =
    completion === 100 &&
    uploaded !== null &&
    completeReviews === uploaded.criteria.length &&
    readinessComplete === UPLOADED_READINESS.length;
  return {
    overview: "complete",
    rubric: "complete",
    plan: completion === 100
      ? "complete"
      : completion > 0
        ? "in_progress"
        : "needs_review",
    draft: reviewState,
    progress: progressComplete
      ? "complete"
      : project.visitedViews.includes("progress")
        ? "in_progress"
        : "not_started",
  } satisfies Record<WorkspaceView, WorkflowState>;
}

export function RubricTrailApp() {
  const { locale } = useI18n();
  const appCopy = useLocalizedMessages(appEn, appZhCN);
  const appText = useCallback(
    (key: AppMessageKey, values?: Record<string, string | number>) =>
      formatAppMessage(appCopy[key], values),
    [appCopy],
  );
  const appTextRef = useRef(appText);
  const [hydrated, setHydrated] = useState(false);
  const [project, setProjectState] = useState<PersistedProjectState>(() => createDefaultProjectState());
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [uploadedReviewCriterionId, setUploadedReviewCriterionId] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadFlowResult | null>(null);
  const [partialUploadResult, setPartialUploadResult] =
    useState<UploadFlowResult | null>(null);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "parsing" | "error">("idle");
  const [imageOcrProgress, setImageOcrProgress] =
    useState<AssignmentImageOcrProgress | null>(null);
  const [uploadError, setUploadError] = useState<AssignmentFileIntakeError | null>(null);
  const [intakeMode, setIntakeMode] = useState<AssignmentIntakeMode>("files");
  const [pastedBrief, setPastedBrief] = useState("");
  const [pastedRubric, setPastedRubric] = useState("");
  const [pastedTextError, setPastedTextError] =
    useState<PastedTextIntakeError | null>(null);
  const [isImportingBackup, setIsImportingBackup] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [isLoadingSample, setIsLoadingSample] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [checkingStage, setCheckingStage] = useState(0);
  const [notice, setNotice] = useState<AppNoticeState | null>(null);
  const [persistenceWarning, setPersistenceWarning] =
    useState<PersistenceWarningState | null>(null);
  const [storageConflict, setStorageConflict] = useState(false);
  const [durableSavingUnavailable, setDurableSavingUnavailable] = useState(false);
  const noticeTimer = useRef<number | null>(null);
  const persistenceTimer = useRef<number | null>(null);
  const draftCheckRunId = useRef(0);
  const draftCheckActive = useRef(false);
  const latestProject = useRef(project);
  const persistenceReady = useRef(false);
  const hasPendingProjectChange = useRef(false);
  const persistHydratedState = useRef(false);
  const skipNextPersistenceWrite = useRef(false);
  const persistenceDisabled = useRef(false);
  const persistenceInFlight = useRef<Promise<PersistenceFlushOutcome> | null>(null);
  const flushPendingProjectRef = useRef<
    (() => Promise<PersistenceFlushOutcome>) | null
  >(null);
  const backupImportActive = useRef(false);
  const intakeRunId = useRef(0);
  const focusWelcomeIntake = useRef<AssignmentIntakeMode | null>(null);
  const observedStorageBaseline = useRef<ProjectStorageBaseline | null>(null);
  const storageConflictActive = useRef(false);
  const replacementIntentRevision = useRef(0);
  const localeRef = useRef(locale);

  useEffect(() => {
    appTextRef.current = appText;
    localeRef.current = locale;
  }, [appText, locale]);

  const markDurableSavingUnavailable = useCallback(() => {
    persistenceDisabled.current = true;
    setDurableSavingUnavailable(true);
  }, []);

  const markDurableSavingAvailable = useCallback(() => {
    persistenceDisabled.current = false;
    setDurableSavingUnavailable(false);
  }, []);

  const cancelPersistenceTimer = useCallback(() => {
    if (persistenceTimer.current) {
      window.clearTimeout(persistenceTimer.current);
      persistenceTimer.current = null;
    }
  }, []);

  const markStorageConflict = useCallback(() => {
    storageConflictActive.current = true;
    cancelPersistenceTimer();
    setStorageConflict(true);
    setPersistenceWarning((current) =>
      current?.kind === "write" ? null : current,
    );
  }, [cancelPersistenceTimer]);

  const clearStorageConflict = useCallback(() => {
    storageConflictActive.current = false;
    setStorageConflict(false);
  }, []);

  const schedulePendingPersistence = useCallback((delay = 250) => {
    if (
      !hasPendingProjectChange.current ||
      persistenceDisabled.current ||
      storageConflictActive.current
    ) {
      return;
    }
    cancelPersistenceTimer();
    persistenceTimer.current = window.setTimeout(() => {
      void flushPendingProjectRef.current?.();
    }, delay);
  }, [cancelPersistenceTimer]);

  const flushPendingProject = useCallback(async (): Promise<PersistenceFlushOutcome> => {
    if (!hasPendingProjectChange.current) return "saved";
    if (persistenceDisabled.current || storageConflictActive.current) return "blocked";
    if (persistenceInFlight.current) {
      const inFlightOutcome = await persistenceInFlight.current;
      if (inFlightOutcome !== "saved") return inFlightOutcome;
      if (!hasPendingProjectChange.current) return "saved";
      if (persistenceDisabled.current || storageConflictActive.current) return "blocked";
      return (await flushPendingProjectRef.current?.()) ?? "failed";
    }

    const baseline = observedStorageBaseline.current;
    if (!baseline) return "failed";
    const projectToSave = latestProject.current;
    const operation = writeProjectState(projectToSave, baseline)
      .then((result): PersistenceFlushOutcome => {
        if (result.ok) {
          observedStorageBaseline.current = result.baseline;
          markDurableSavingAvailable();
          if (latestProject.current === projectToSave) {
            hasPendingProjectChange.current = false;
          }
          setPersistenceWarning((current) =>
            current?.kind === "write" ? null : current,
          );
          return "saved";
        }
        if (result.reason === "conflict" || result.reason === "invalid-record") {
          markStorageConflict();
          return "blocked";
        }
        if (result.reason === "coordination-unavailable") {
          markDurableSavingUnavailable();
          setPersistenceWarning((current) =>
            current?.kind === "write" ? null : current,
          );
          return "blocked";
        }
        const invalidState = result.reason === "invalid-state";
        const warningMessage = invalidState
          ? appText("persistence.invalid")
          : appText("persistence.storage");
        if (result.reason === "unavailable") {
          markDurableSavingUnavailable();
        } else if (result.reason === "storage-error") {
          setDurableSavingUnavailable(true);
        }
        setPersistenceWarning({ kind: "write", message: warningMessage });
        return "failed";
      })
      .catch((): PersistenceFlushOutcome => {
        setDurableSavingUnavailable(true);
        setPersistenceWarning({
          kind: "write",
          message: appText("persistence.saveFailed"),
        });
        return "failed";
      })
      .finally(() => {
        if (persistenceInFlight.current === operation) {
          persistenceInFlight.current = null;
        }
        if (
          hasPendingProjectChange.current &&
          latestProject.current !== projectToSave &&
          !persistenceDisabled.current &&
          !storageConflictActive.current
        ) {
          schedulePendingPersistence(0);
        }
      });
    persistenceInFlight.current = operation;
    const outcome = await operation;
    if (
      outcome === "saved" &&
      hasPendingProjectChange.current &&
      !persistenceDisabled.current &&
      !storageConflictActive.current
    ) {
      return (await flushPendingProjectRef.current?.()) ?? "failed";
    }
    return outcome;
  }, [
    markDurableSavingAvailable,
    markDurableSavingUnavailable,
    markStorageConflict,
    appText,
    schedulePendingPersistence,
  ]);

  useEffect(() => {
    flushPendingProjectRef.current = flushPendingProject;
    return () => {
      if (flushPendingProjectRef.current === flushPendingProject) {
        flushPendingProjectRef.current = null;
      }
    };
  }, [flushPendingProject]);

  const updateProject = useCallback(
    (
      action:
        | PersistedProjectState
        | ((current: PersistedProjectState) => PersistedProjectState),
    ) => {
      const current = latestProject.current;
      const next = typeof action === "function" ? action(current) : action;
      latestProject.current = next;
      hasPendingProjectChange.current = true;
      setProjectState(next);
    },
    [],
  );

  useEffect(() => {
    const hydrationTimer = window.setTimeout(() => {
      const result = readProjectStateWithStatus();
      latestProject.current = result.state;
      observedStorageBaseline.current = result.baseline;
      if (result.mutationAvailable) {
        markDurableSavingAvailable();
      } else {
        markDurableSavingUnavailable();
      }
      storageConflictActive.current = result.crossVersionConflict;
      persistHydratedState.current =
        result.recovered &&
        result.source !== "default" &&
        !result.crossVersionConflict &&
        result.mutationAvailable;
      setStorageConflict(result.crossVersionConflict);
      setProjectState(result.state);
      if (result.recovered && result.mutationAvailable) {
        setPersistenceWarning({
          kind: "recovered",
            message:
              result.source === "legacy"
                ? appTextRef.current("recovery.legacy")
                : result.source === "v2"
                  ? appTextRef.current("recovery.v2")
                  : result.source === "v3"
                    ? appTextRef.current("recovery.v3")
                    : appTextRef.current("recovery.default"),
        });
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(hydrationTimer);
  }, [markDurableSavingAvailable, markDurableSavingUnavailable]);

  useEffect(() => {
    if (!hydrated) return;
    if (!persistenceReady.current) {
      persistenceReady.current = true;
      if (!persistHydratedState.current) return;
      persistHydratedState.current = false;
      hasPendingProjectChange.current = true;
    }
    if (skipNextPersistenceWrite.current) {
      skipNextPersistenceWrite.current = false;
      return;
    }
    if (storageConflictActive.current) {
      cancelPersistenceTimer();
      return;
    }
    if (persistenceDisabled.current) {
      cancelPersistenceTimer();
      return;
    }
    schedulePendingPersistence();
    return () => {
      cancelPersistenceTimer();
    };
  }, [cancelPersistenceTimer, hydrated, project, schedulePendingPersistence]);

  useEffect(() => {
    if (!hydrated) return;
    const flushLatestProject = () => {
      if (!hasPendingProjectChange.current || storageConflictActive.current) return;
      void flushPendingProjectRef.current?.();
    };
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flushLatestProject();
    };
    document.addEventListener("visibilitychange", flushWhenHidden);
    window.addEventListener("pagehide", flushLatestProject);
    return () => {
      document.removeEventListener("visibilitychange", flushWhenHidden);
      window.removeEventListener("pagehide", flushLatestProject);
    };
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const detectExternalProjectChange = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      if (
        event.key !== PROJECT_RECORD_KEY &&
        event.key !== STORAGE_KEY &&
        event.key !== PREVIOUS_STORAGE_KEY &&
        event.key !== LEGACY_STORAGE_KEY &&
        event.key !== null
      ) return;
      const baseline = observedStorageBaseline.current;
      if (!baseline) return;
      if (event.key === PROJECT_RECORD_KEY && event.newValue === baseline.recordValue) return;
      if (event.key === STORAGE_KEY && event.newValue === baseline.legacyV3Value) return;
      if (event.key === PREVIOUS_STORAGE_KEY && event.newValue === baseline.legacyV2Value) return;
      if (event.key === LEGACY_STORAGE_KEY && event.newValue === baseline.legacyV1Value) return;
      if (
        event.key === null &&
        baseline.recordValue === null &&
        baseline.legacyV3Value === null &&
        baseline.legacyV2Value === null &&
        baseline.legacyV1Value === null
      ) return;
      markStorageConflict();
    };
    window.addEventListener("storage", detectExternalProjectChange);
    return () => window.removeEventListener("storage", detectExternalProjectChange);
  }, [hydrated, markStorageConflict]);

  useEffect(() => {
    if (!hydrated || project.projectKind === "none" || uploadResult) return;
    const frame = window.requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 820px)").matches) {
        document
          .querySelector<HTMLButtonElement>('.mobile-workflow button[aria-current="step"]')
          ?.scrollIntoView({ block: "nearest", inline: "center" });
      }
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.getElementById("workspace-main")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hydrated, project.projectKind, project.view, uploadResult]);

  useEffect(() => {
    if (
      !hydrated ||
      project.projectKind !== "none" ||
      !focusWelcomeIntake.current
    ) {
      return;
    }
    const target = focusWelcomeIntake.current;
    const frame = window.requestAnimationFrame(() => {
      focusWelcomeIntake.current = null;
      document
        .getElementById(
          target === "paste" ? "paste-intake-title" : "choose-assignment-files",
        )
        ?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hydrated, project.projectKind, uploadResult]);

  const showNotice = useCallback((nextNotice: AppNoticeState) => {
    setNotice(nextNotice);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3600);
  }, []);

  const reportReplacementIntentChanged = useCallback(
    (surface: "project" | "backup" = "project") => {
      const intentMessage = appText("replace.changed");
      if (surface === "backup") {
        setBackupError(intentMessage);
      }
      showNotice({
        tone: "warning",
        message: intentMessage,
      });
      schedulePendingPersistence();
    },
    [appText, schedulePendingPersistence, showNotice],
  );

  useEffect(
    () => () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      cancelPersistenceTimer();
    },
    [cancelPersistenceTimer],
  );

  const today = todayIso();
  const dueDate =
    project.projectKind === "uploaded" && project.uploadedProject
      ? project.uploadedProject.dueDate
      : SAMPLE_ASSIGNMENT.dueAt.slice(0, 10);
  const uploadedTemplates = useMemo(
    () => project.uploadedProject ? buildUploadedPlanTemplates(project.uploadedProject) : null,
    [project.uploadedProject],
  );
  const plan = useMemo(
    () =>
      generateActionPlan(
        {
          weeklyHours: project.weeklyHours,
          planningDepth: planningDepthFromLegacyTargetGrade(project.targetGrade),
          startDate: planStartFor(dueDate, today),
          dueDate,
          asOfDate: today,
          completedTaskIds: project.completedTaskIds,
        },
        uploadedTemplates ?? undefined,
      ),
    [dueDate, project.completedTaskIds, project.targetGrade, project.weeklyHours, today, uploadedTemplates],
  );
  const currentDraftResult =
    project.draftResult &&
    project.checkedDraftText === project.draftText &&
    project.draftResult.sectionId === project.selectedSectionId
      ? project.draftResult
      : null;

  function navigate(view: WorkspaceView) {
    updateProject((current) => ({
      ...current,
      view,
      visitedViews: current.visitedViews.includes(view)
        ? current.visitedViews
        : [...current.visitedViews, view],
    }));
  }

  function continueUploadedProgress(
    target: "plan" | "draft",
    criterionId?: string,
  ) {
    if (target === "draft") {
      setUploadedReviewCriterionId(criterionId ?? null);
    }
    navigate(target);
  }

  async function loadSample() {
    if (backupImportActive.current) return;
    const operationId = ++intakeRunId.current;
    draftCheckRunId.current += 1;
    draftCheckActive.current = false;
    setUploadResult(null);
    setPartialUploadResult(null);
    setUploadError(null);
    setImageOcrProgress(null);
    setPastedTextError(null);
    setPastedBrief("");
    setPastedRubric("");
    setBackupError(null);
    setIsLoadingSample(true);
    await wait(450);
    if (operationId !== intakeRunId.current) return;
    updateProject({
      ...createDefaultProjectState(),
      projectKind: "sample",
      view: "overview",
      visitedViews: ["overview"],
      draftText: SAMPLE_DRAFT_TEXT,
    });
    setIsLoadingSample(false);
    showNotice({ tone: "success", message: appText("notice.sampleLoaded") });
  }

  async function handleFiles(
    files: File[],
    intakeMethod: AssignmentIntakeMode = "files",
  ) {
    if (backupImportActive.current) return;
    const operationId = ++intakeRunId.current;
    setIntakeMode(intakeMethod);
    setUploadStatus("parsing");
    setUploadResult(null);
    setPartialUploadResult(null);
    setUploadError(null);
    setPastedTextError(null);
    setBackupError(null);
    try {
      const ocrOptions = {
        onImageOcrProgress: (progress: AssignmentImageOcrProgress) => {
          if (operationId === intakeRunId.current) setImageOcrProgress(progress);
        },
      };
      const recovered = intakeMethod === "files"
        ? await parseAssignmentFilesWithRecovery(files, ocrOptions)
        : {
            parsed: await parseAssignmentFiles(files, ocrOptions),
            skippedFiles: [],
          };
      if (operationId !== intakeRunId.current) return;
      const { parsed, skippedFiles } = recovered;
      const summary = buildUploadedAssignmentSummary(parsed);
      const nextResult: UploadFlowResult = {
        intakeMethod,
        fileNames: parsed.sources.map((source) => source.fileName),
        sources: parsed.sources.map((source) => ({
          id: source.id,
          fileName: source.fileName,
          kind: source.kind,
          origin: source.origin,
          intakeMethod,
          pageCount: source.pageCount,
        })),
        skippedFiles,
        totalWords: parsed.wordCount,
        summary,
      };
      if (skippedFiles.length > 0) {
        setPartialUploadResult(nextResult);
      } else {
        setUploadResult(nextResult);
      }
      setUploadStatus("idle");
      setImageOcrProgress(null);
    } catch (error) {
      if (operationId !== intakeRunId.current) return;
      setUploadStatus("error");
      setImageOcrProgress(null);
      if (intakeMethod === "paste") {
        setPastedTextError(friendlyPastedParseError(error, locale));
      } else {
        setUploadError(friendlyFileError(error, locale));
      }
    }
  }

  function handlePastedText(brief: string, rubric: string) {
    if (backupImportActive.current) return;
    const value = { brief, rubric };
    const issue = validatePastedAssignmentText(value);
    if (issue) {
      setPastedTextError(issue);
      return;
    }
    void handleFiles(createPastedAssignmentFiles(value), "paste");
  }

  function createLocalProject(uploadedProject: UploadedProject) {
    updateProject({
      ...createDefaultProjectState(),
      projectKind: "uploaded",
      uploadedProject,
      view: "overview",
      visitedViews: ["overview"],
      draftText: "",
    });
    setUploadResult(null);
    setPartialUploadResult(null);
    setUploadStatus("idle");
    setUploadError(null);
    setPastedTextError(null);
    setPastedBrief("");
    setPastedRubric("");
    setBackupError(null);
    setSelectedEvidenceId(null);
    showNotice({
      tone: "success",
      message: persistenceDisabled.current
        ? appText("notice.projectCreatedTab")
        : appText("notice.projectCreated"),
    });
  }

  async function purgeSavedProjectForReplacement(
    intentGuard: () => boolean,
    intentRevision: number,
  ): Promise<boolean> {
    cancelPersistenceTimer();
    if (persistenceInFlight.current) await persistenceInFlight.current;
    const baseline = observedStorageBaseline.current;
    if (!baseline) return false;
    const purgeResult = await purgeProjectState(baseline, { intentGuard });
    if (purgeResult.ok) {
      observedStorageBaseline.current = purgeResult.baseline;
      markDurableSavingAvailable();
      hasPendingProjectChange.current = false;
      clearStorageConflict();
      return true;
    }
    if (purgeResult.reason === "intent-changed") {
      if (replacementIntentRevision.current === intentRevision) {
        reportReplacementIntentChanged();
      }
      return false;
    }
    if (purgeResult.reason === "conflict" || purgeResult.reason === "invalid-record") {
      markStorageConflict();
      return false;
    }
    const purgeMessage =
      purgeResult.reason === "coordination-unavailable"
        ? appText("purge.coordination")
        : appText("purge.failed");
    if (
      purgeResult.reason === "coordination-unavailable" ||
      purgeResult.reason === "unavailable"
    ) {
      markDurableSavingUnavailable();
    } else {
      setDurableSavingUnavailable(true);
    }
    setPersistenceWarning({ kind: "write", message: purgeMessage });
    showNotice({ tone: "warning", message: purgeMessage });
    schedulePendingPersistence();
    return false;
  }

  async function resetProject() {
    const confirmedProject = latestProject.current;
    if (!window.confirm(appText("confirm.reset"))) return;
    const intentRevision = ++replacementIntentRevision.current;
    if (
      !(await purgeSavedProjectForReplacement(
        () =>
          replacementIntentRevision.current === intentRevision &&
          latestProject.current === confirmedProject,
        intentRevision,
      ))
    ) return;
    intakeRunId.current += 1;
    backupImportActive.current = false;
    setIsImportingBackup(false);
    focusWelcomeIntake.current = "files";
    setIntakeMode("files");
    draftCheckRunId.current += 1;
    draftCheckActive.current = false;
    setIsChecking(false);
    updateProject(createDefaultProjectState());
    setSelectedEvidenceId(null);
    setUploadResult(null);
    setPartialUploadResult(null);
    setUploadStatus("idle");
    setUploadError(null);
    setPastedTextError(null);
    setPastedBrief("");
    setPastedRubric("");
    setBackupError(null);
    setPersistenceWarning(null);
  }

  async function startOwnProject() {
    const confirmedProject = latestProject.current;
    if (!window.confirm(appText("confirm.leaveSample"))) return;
    const intentRevision = ++replacementIntentRevision.current;
    if (
      !(await purgeSavedProjectForReplacement(
        () =>
          replacementIntentRevision.current === intentRevision &&
          latestProject.current === confirmedProject,
        intentRevision,
      ))
    ) return;
    intakeRunId.current += 1;
    backupImportActive.current = false;
    setIsImportingBackup(false);
    focusWelcomeIntake.current = "files";
    setIntakeMode("files");
    draftCheckRunId.current += 1;
    draftCheckActive.current = false;
    setIsChecking(false);
    updateProject(createDefaultProjectState());
    setSelectedEvidenceId(null);
    setUploadResult(null);
    setPartialUploadResult(null);
    setUploadStatus("idle");
    setUploadError(null);
    setPastedTextError(null);
    setPastedBrief("");
    setPastedRubric("");
    setBackupError(null);
    setPersistenceWarning(null);
  }

  function exportProjectBackup() {
    const exportedAt = new Date().toISOString();
    try {
      const state = latestProject.current;
      const serialized = serializeProjectBackup(state, exportedAt);
      const url = URL.createObjectURL(
        new Blob([serialized], { type: "application/json;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = projectBackupFileName(state, exportedAt);
      anchor.hidden = true;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      showNotice({
        tone: "success",
        message: appText("notice.backupDownloaded"),
      });
    } catch (error) {
      showNotice({ tone: "warning", message: friendlyBackupError(error, locale) });
    }
  }

  async function loadLatestSavedProject() {
    cancelPersistenceTimer();
    if (persistenceInFlight.current) await persistenceInFlight.current;
    const storageSnapshot = readProjectStateWithStatus();
    if (!storageSnapshot.storageAvailable) {
      const message = appText("load.readFailed");
      markDurableSavingUnavailable();
      setPersistenceWarning({ kind: "write", message });
      showNotice({ tone: "warning", message });
      schedulePendingPersistence();
      return;
    }

    const observedBaseline = observedStorageBaseline.current;
    if (!observedBaseline) return;
    const currentRecordChanged =
      storageSnapshot.baseline.recordValue !== observedBaseline.recordValue;
    const currentV3Changed =
      storageSnapshot.baseline.legacyV3Value !== observedBaseline.legacyV3Value;
    const currentV2Changed =
      storageSnapshot.baseline.legacyV2Value !== observedBaseline.legacyV2Value;
    const legacyCandidate =
      currentRecordChanged ? null : storageSnapshot.legacyConflictCandidate;
    const shouldLoadPrevious =
      legacyCandidate === null &&
      storageSnapshot.baseline.legacyV2Value !== null &&
      !currentRecordChanged &&
      ((!currentV3Changed && currentV2Changed) ||
        (!currentV3Changed &&
          !currentV2Changed &&
          storageSnapshot.crossVersionConflict));

    if (
      storageSnapshot.crossVersionConflict &&
      ((currentRecordChanged && storageSnapshot.legacyConflictCandidate !== null) ||
        ((currentRecordChanged || currentV3Changed) && currentV2Changed))
    ) {
      const message = appText("load.bothChanged");
      setPersistenceWarning({ kind: "write", message });
      showNotice({ tone: "warning", message });
      schedulePendingPersistence();
      return;
    }

    const confirmedProject = latestProject.current;
    if (
      !window.confirm(
        legacyCandidate !== null || shouldLoadPrevious
          ? appText("confirm.loadLegacy")
          : appText("confirm.loadSaved"),
      )
    ) {
      return;
    }
    const intentRevision = ++replacementIntentRevision.current;

    let result = storageSnapshot;
    let loadedFromPreviousVersion = false;
    if (
      legacyCandidate !== null ||
      (shouldLoadPrevious && storageSnapshot.baseline.legacyV2Value !== null)
    ) {
      const parsedPrevious = legacyCandidate ?? parsePreviousProjectStateValue(
        storageSnapshot.baseline.legacyV2Value!,
      );
      if ("ok" in parsedPrevious && !parsedPrevious.ok) {
        const message = appText("load.legacyInvalid");
        setPersistenceWarning({ kind: "write", message });
        showNotice({ tone: "warning", message });
        return;
      }
      const previousState = parsedPrevious.state;
      const previousSource = "source" in parsedPrevious
        ? parsedPrevious.source
        : "v2";
      const promoted = await writeProjectState(
        previousState,
        storageSnapshot.baseline,
        {
          intentGuard: () =>
            replacementIntentRevision.current === intentRevision &&
            latestProject.current === confirmedProject,
        },
      );
      if (!promoted.ok) {
        if (promoted.reason === "intent-changed") {
          if (replacementIntentRevision.current === intentRevision) {
            reportReplacementIntentChanged();
          }
          return;
        }
        const message =
          promoted.reason === "conflict"
            ? appText("load.changedAgain")
            : promoted.reason === "invalid-state"
              ? appText("load.migrationFailed")
              : appText("load.upgradeSaveFailed");
        if (
          promoted.reason === "coordination-unavailable" ||
          promoted.reason === "unavailable"
        ) {
          markDurableSavingUnavailable();
        } else if (promoted.reason === "storage-error") {
          setDurableSavingUnavailable(true);
        }
        setPersistenceWarning({ kind: "write", message });
        showNotice({ tone: "warning", message });
        return;
      }
      result = {
        state: previousState,
        source: previousSource,
        recovered: true,
        storedValue: promoted.recordValue,
        previousStoredValue: storageSnapshot.previousStoredValue,
        crossVersionConflict: false,
        storageAvailable: true,
        baseline: promoted.baseline,
        mutationAvailable: true,
        legacyConflictCandidate: null,
      };
      loadedFromPreviousVersion = true;
    } else if (
      storageSnapshot.source === "default" &&
      storageSnapshot.recovered
    ) {
      const message = appText("load.savedInvalid");
      setPersistenceWarning({ kind: "write", message });
      showNotice({ tone: "warning", message });
      return;
    } else if (storageSnapshot.crossVersionConflict) {
      const message = appText("load.versionConflict");
      setPersistenceWarning({ kind: "write", message });
      showNotice({ tone: "warning", message });
      return;
    }

    intakeRunId.current += 1;
    backupImportActive.current = false;
    cancelPersistenceTimer();
    draftCheckRunId.current += 1;
    draftCheckActive.current = false;
    latestProject.current = result.state;
    observedStorageBaseline.current = result.baseline;
    if (result.mutationAvailable) {
      markDurableSavingAvailable();
    } else {
      markDurableSavingUnavailable();
    }
    hasPendingProjectChange.current = false;
    skipNextPersistenceWrite.current = true;
    clearStorageConflict();
    setProjectState(result.state);
    setSelectedEvidenceId(null);
    setUploadResult(null);
    setPartialUploadResult(null);
    setUploadStatus("idle");
    setUploadError(null);
    setPastedTextError(null);
    setPastedBrief("");
    setPastedRubric("");
    setBackupError(null);
    setIsImportingBackup(false);
    setIsLoadingSample(false);
    setIsChecking(false);
    setPersistenceWarning(
      result.recovered
        ? {
            kind: "recovered",
            message: appText("load.recovered"),
          }
        : null,
    );
    showNotice({
      tone: "success",
      message: result.mutationAvailable
        ? loadedFromPreviousVersion
          ? appText("notice.loadedUpgraded")
          : appText("notice.loaded")
        : appText("notice.loadedTabOnly"),
    });
  }

  async function keepThisTabProject() {
    if (
      !window.confirm(appText("confirm.keepTab"))
    ) {
      return;
    }
    const intentRevision = ++replacementIntentRevision.current;

    cancelPersistenceTimer();
    if (persistenceInFlight.current) await persistenceInFlight.current;
    const currentStorage = readProjectStateWithStatus();
    if (!currentStorage.storageAvailable) {
      const message = appText("keep.readFailed");
      markDurableSavingUnavailable();
      setPersistenceWarning({ kind: "write", message });
      showNotice({ tone: "warning", message });
      return;
    }
    const projectToSave = latestProject.current;
    const result = await writeProjectState(projectToSave, currentStorage.baseline, {
      intentGuard: () => replacementIntentRevision.current === intentRevision,
    });
    if (!result.ok) {
      if (result.reason === "intent-changed") {
        if (replacementIntentRevision.current === intentRevision) {
          reportReplacementIntentChanged();
        }
        return;
      }
      const message =
        result.reason === "invalid-state"
          ? appText("keep.invalid")
          : result.reason === "conflict"
            ? appText("keep.conflict")
            : appText("keep.storage");
      setPersistenceWarning({ kind: "write", message });
      if (
        result.reason === "coordination-unavailable" ||
        result.reason === "unavailable"
      ) {
        markDurableSavingUnavailable();
      } else if (result.reason === "storage-error") {
        setDurableSavingUnavailable(true);
      }
      showNotice({ tone: "warning", message });
      return;
    }

    observedStorageBaseline.current = result.baseline;
    markDurableSavingAvailable();
    const hasNewerProjectChange = latestProject.current !== projectToSave;
    hasPendingProjectChange.current = hasNewerProjectChange;
    clearStorageConflict();
    setPersistenceWarning((current) =>
      current?.kind === "write" ? null : current,
    );
    showNotice({
      tone: "success",
      message: appText("notice.kept"),
    });
    if (hasNewerProjectChange) schedulePendingPersistence(0);
  }

  async function importProjectBackup(file: File) {
    if (backupImportActive.current) return;
    const operationId = ++intakeRunId.current;
    backupImportActive.current = true;
    setIsImportingBackup(true);
    setIsLoadingSample(false);
    setUploadStatus("idle");
    setUploadError(null);
    setPastedTextError(null);
    setBackupError(null);
    setPartialUploadResult(null);

    try {
      const backup = await readProjectBackupFile(file);
      if (operationId !== intakeRunId.current) return;
      const currentLocale = localeRef.current;
      const currentText = appTextRef.current;
      const incomingTitle = projectBackupTitle(backup.state);
      const current = latestProject.current;
      const replacement = current.projectKind === "none"
        ? currentText("backup.noReplacement")
        : currentText("backup.willReplace", { title: projectBackupTitle(current) });
      const confirmed = window.confirm(
        currentText("backup.restorePrompt", {
          title: incomingTitle,
          details: backupProjectDetails(backup.state, currentLocale),
          exported: backupDateLabel(backup.exportedAt, currentLocale),
          replacement,
        }),
      );
      if (!confirmed) return;
      const intentRevision = ++replacementIntentRevision.current;

      cancelPersistenceTimer();
      if (persistenceInFlight.current) await persistenceInFlight.current;
      const baseline = observedStorageBaseline.current;
      if (!baseline) return;
      const writeResult = await writeProjectState(
        backup.state,
        baseline,
        {
          intentGuard: () =>
            replacementIntentRevision.current === intentRevision &&
            latestProject.current === current,
        },
      );
      if (!writeResult.ok) {
        if (writeResult.reason === "intent-changed") {
          if (replacementIntentRevision.current === intentRevision) {
            reportReplacementIntentChanged("backup");
          }
          return;
        }
        if (writeResult.reason === "conflict") {
          const message = appText("backup.tabConflict");
          markStorageConflict();
          setBackupError(message);
          showNotice({ tone: "warning", message });
          return;
        }
        const message = writeResult.reason === "invalid-state"
          ? appText("backup.invalid")
          : appText("backup.storage");
        if (
          writeResult.reason === "coordination-unavailable" ||
          writeResult.reason === "unavailable"
        ) {
          markDurableSavingUnavailable();
        } else if (writeResult.reason === "storage-error") {
          setDurableSavingUnavailable(true);
        }
        setBackupError(message);
        setPersistenceWarning({ kind: "write", message });
        showNotice({ tone: "warning", message });
        schedulePendingPersistence();
        return;
      }
      cancelPersistenceTimer();

      draftCheckRunId.current += 1;
      draftCheckActive.current = false;
      setIsChecking(false);
      latestProject.current = backup.state;
      observedStorageBaseline.current = writeResult.baseline;
      markDurableSavingAvailable();
      hasPendingProjectChange.current = false;
      skipNextPersistenceWrite.current = true;
      clearStorageConflict();
      setProjectState(backup.state);
      setSelectedEvidenceId(null);
      setUploadResult(null);
      setPartialUploadResult(null);
      setUploadStatus("idle");
      setUploadError(null);
      setPastedTextError(null);
      setPastedBrief("");
      setPastedRubric("");
      setPersistenceWarning(null);
      showNotice({
        tone: backup.recovered ? "info" : "success",
        message: backup.recovered
          ? appText("notice.restoredRecovered")
          : appText("notice.restored"),
      });
    } catch (error) {
      if (operationId !== intakeRunId.current) return;
      const message = friendlyBackupError(error, localeRef.current);
      setBackupError(message);
      if (latestProject.current.projectKind !== "none") {
        showNotice({ tone: "warning", message });
      }
    } finally {
      if (operationId === intakeRunId.current) {
        backupImportActive.current = false;
        setIsImportingBackup(false);
      }
    }
  }

  function rebalancePlan(weeklyHours: number, planningDepth: PlanningDepth) {
    updateProject((current) => ({
      ...current,
      weeklyHours,
      targetGrade: legacyTargetGradeForPlanningDepth(planningDepth),
    }));
    showNotice({
      kind: "plan-updated",
      tone: weeklyHours <= 5 ? "warning" : "success",
      weeklyHours,
      planningDepth,
    });
  }

  function toggleTask(taskId: string) {
    const task = plan.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const validCompletedIds = plan.tasks
      .filter((item) => item.completed)
      .map((item) => item.id);
    const incompleteDependencies = task.dependencies.filter(
      (id) => !plan.tasks.find((candidate) => candidate.id === id)?.completed,
    );
    if (!task.completed && incompleteDependencies.length) {
      showNotice({ tone: "warning", message: appText("notice.prerequisite") });
      return;
    }
    if (task.completed) {
      const idsToClear = new Set([taskId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const candidate of plan.tasks) {
          if (
            !idsToClear.has(candidate.id) &&
            candidate.dependencies.some((id) => idsToClear.has(id))
          ) {
            idsToClear.add(candidate.id);
            changed = true;
          }
        }
      }
      updateProject((current) => ({
        ...current,
        completedTaskIds: validCompletedIds.filter(
          (id) => !idsToClear.has(id),
        ),
      }));
      const reopenedTaskCount = validCompletedIds.filter(
        (id) => id !== taskId && idsToClear.has(id),
      ).length;
      if (reopenedTaskCount > 0) {
        showNotice({
          tone: "warning",
          message: appText(
            reopenedTaskCount === 1
              ? "notice.tasksReopened.one"
              : "notice.tasksReopened.many",
            { count: reopenedTaskCount },
          ),
        });
      }
      return;
    }
    updateProject((current) => ({
      ...current,
      completedTaskIds: [...validCompletedIds, taskId],
    }));
  }

  async function runDraftCheck() {
    if (
      project.projectKind !== "sample" ||
      !project.draftText.trim() ||
      isChecking ||
      draftCheckActive.current
    ) return;
    const runId = draftCheckRunId.current + 1;
    draftCheckRunId.current = runId;
    draftCheckActive.current = true;
    const checkedDraftText = project.draftText;
    const checkedSectionId = project.selectedSectionId;
    setIsChecking(true);
    setCheckingStage(0);
    let committed = false;
    try {
      for (let stage = 1; stage < 4; stage += 1) {
        await wait(230);
        if (draftCheckRunId.current !== runId) return;
        setCheckingStage(stage);
      }
      const result = await runMockDraftCheck(checkedDraftText, checkedSectionId);
      if (draftCheckRunId.current !== runId) return;
      const current = latestProject.current;
      if (
        current.projectKind !== "sample" ||
        current.draftText !== checkedDraftText ||
        current.selectedSectionId !== checkedSectionId
      ) return;
      updateProject({
        ...current,
        draftResult: result,
        checkedDraftText,
      });
      committed = true;
    } catch {
      if (draftCheckRunId.current === runId) {
        showNotice({
          tone: "warning",
          message: appText("notice.checkFailed"),
        });
      }
    } finally {
      if (draftCheckRunId.current === runId) {
        draftCheckActive.current = false;
        setIsChecking(false);
      }
    }
    if (committed) {
      showNotice({ tone: "info", message: appText("notice.checkComplete") });
    }
  }

  function changeDraftText(draftText: string) {
    draftCheckRunId.current += 1;
    draftCheckActive.current = false;
    setIsChecking(false);
    updateProject((current) => ({ ...current, draftText }));
  }

  function changeDraftSection(selectedSectionId: string) {
    draftCheckRunId.current += 1;
    draftCheckActive.current = false;
    setIsChecking(false);
    updateProject((current) => ({
      ...current,
      selectedSectionId,
      draftResult: null,
      checkedDraftText: null,
    }));
  }

  function updateUploadedReview(review: UploadedCriterionReview) {
    updateProject((current) => ({
      ...current,
      uploadedCriterionReviews: [
        ...current.uploadedCriterionReviews.filter((item) => item.criterionId !== review.criterionId),
        review,
      ],
    }));
  }

  async function saveUploadedReview(review: UploadedCriterionReview) {
    updateUploadedReview(review);
    const outcome = await flushPendingProject();
    if (outcome === "saved") {
      showNotice({
        tone: "success",
        message: appText("notice.selfCheckSaved"),
      });
      return;
    }
    showNotice({
      tone: "warning",
      message: appText("notice.selfCheckTabOnly"),
    });
  }

  async function saveManualSourceLocator(
    criterionId: string,
    locator: ManualSourceLocator | null,
  ): Promise<"saved" | "tab-only" | "failed"> {
    const current = latestProject.current;
    if (!current.uploadedProject) return "failed";
    try {
      const nextProject = applyManualSourceLocator(
        current.uploadedProject,
        criterionId,
        locator,
      );
      const existingReview = current.uploadedCriterionReviews.find(
        (review) => review.criterionId === criterionId,
      );
      const nextReview = invalidateUploadedReviewAfterLocatorChange(existingReview);
      updateProject({
        ...current,
        uploadedProject: nextProject,
        uploadedCriterionReviews: nextReview
          ? [
              ...current.uploadedCriterionReviews.filter(
                (review) => review.criterionId !== criterionId,
              ),
              nextReview,
            ]
          : current.uploadedCriterionReviews,
      });
    } catch {
      showNotice({ tone: "warning", message: appText("notice.locatorFailed") });
      return "failed";
    }
    const outcome = await flushPendingProject();
    if (outcome === "saved") {
      showNotice({
        tone: "success",
        message: locator
          ? appText("notice.locatorSaved")
          : appText("notice.locatorRemoved"),
      });
      return "saved";
    }
    if (outcome === "blocked") {
      showNotice({ tone: "warning", message: appText("notice.locatorTabOnly") });
      return "tab-only";
    }
    showNotice({ tone: "warning", message: appText("notice.locatorFailed") });
    return "failed";
  }

  function toggleReadiness(id: string) {
    updateProject((current) => ({
      ...current,
      readinessChecks: current.readinessChecks.includes(id)
        ? current.readinessChecks.filter((item) => item !== id)
        : [...current.readinessChecks, id],
    }));
  }

  const localizedUploadError = useMemo(
    () => localizeFileIntakeError(uploadError, locale),
    [locale, uploadError],
  );
  const localizedBackupError = backupError
    ? localizeStoredAppMessage(backupError, locale)
    : null;

  const storageConflictNotice = storageConflict ? (
    <StorageConflictBanner
      onDownloadThisTab={exportProjectBackup}
      onLoadSavedVersion={loadLatestSavedProject}
      onKeepThisTab={keepThisTabProject}
    />
  ) : null;
  const intakeStorageConflictNotice = storageConflict ? (
    <StorageConflictBanner
      context="intake"
      onDownloadThisTab={exportProjectBackup}
      onLoadSavedVersion={loadLatestSavedProject}
      onKeepThisTab={keepThisTabProject}
    />
  ) : null;
  const persistenceUnavailableNotice = durableSavingUnavailable ? (
    <PersistenceUnavailableBanner onDownloadBackup={exportProjectBackup} />
  ) : null;
  const localizedPersistenceWarningMessage = persistenceWarning
    ? localizeStoredAppMessage(persistenceWarning.message, locale)
    : null;
  const localizedNoticeMessage = notice
    ? "message" in notice
      ? localizeStoredAppMessage(notice.message, locale)
      : appText("notice.planUpdated", {
          hours: notice.weeklyHours,
          depth: appText(`planning.${notice.planningDepth}` as AppMessageKey),
        })
    : null;
  const duplicateWarningNotice = Boolean(
    notice?.tone === "warning" &&
    localizedNoticeMessage === localizedPersistenceWarningMessage,
  );
  const persistenceWarningToast = persistenceWarning ? (
    <div className="toast warning persistence-warning" role="alert">
      <AlertTriangle aria-hidden="true" />
      <span>{localizedPersistenceWarningMessage}</span>
      <button
        className="icon-button"
        type="button"
        onClick={() => {
          setPersistenceWarning(null);
          if (duplicateWarningNotice) {
            if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
            noticeTimer.current = null;
            setNotice(null);
          }
        }}
        aria-label={appText("storage.dismiss")}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  ) : null;
  const transientNoticeToast = notice && !duplicateWarningNotice ? (
    <div className={`toast ${notice.tone}`} role="status" data-testid="toast">
      {notice.tone === "warning" ? <AlertTriangle aria-hidden="true" /> : notice.tone === "info" ? <Info aria-hidden="true" /> : <Check aria-hidden="true" />}
      <span>{localizedNoticeMessage}</span>
      <button
        type="button"
        className="toast-dismiss"
        aria-label={appText("notice.dismiss")}
        onClick={() => {
          if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
          noticeTimer.current = null;
          setNotice(null);
        }}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  ) : null;
  const toastStack = persistenceWarningToast || transientNoticeToast ? (
    <div className="toast-stack">
      {persistenceWarningToast}
      {transientNoticeToast}
    </div>
  ) : null;

  if (!hydrated) {
    return (
      <main className="app-loading" aria-label={appText("loading.label")}>
        <span className="brand-mark" aria-hidden="true"><Route /></span>
        <strong>{BRAND.name}</strong>
        <div className="loading-line"><span /></div>
      </main>
    );
  }

  if (uploadResult) {
    return (
      <>
        {intakeStorageConflictNotice}
        <UploadSummaryView
          result={uploadResult}
          onBack={() => {
            focusWelcomeIntake.current = uploadResult.skippedFiles.length > 0
              ? null
              : uploadResult.intakeMethod;
            setIntakeMode(uploadResult.intakeMethod);
            setUploadResult(null);
            setUploadStatus("idle");
          }}
          onCreateProject={createLocalProject}
        />
        {persistenceWarningToast}
      </>
    );
  }

  if (project.projectKind === "none") {
    return (
      <>
        {intakeStorageConflictNotice}
        <WelcomeScreen
          onTrySample={loadSample}
          onFiles={handleFiles}
          onPastedText={handlePastedText}
          intakeMode={intakeMode}
          onIntakeModeChange={setIntakeMode}
          partialUploadResult={partialUploadResult}
          onReviewPartialUpload={() => {
            if (partialUploadResult) {
              setUploadResult(partialUploadResult);
            }
          }}
          pastedBrief={pastedBrief}
          onPastedBriefChange={(value) => {
            setPastedBrief(value);
            setPastedTextError(null);
          }}
          pastedRubric={pastedRubric}
          onPastedRubricChange={(value) => {
            setPastedRubric(value);
            setPastedTextError(null);
          }}
          pastedTextError={pastedTextError}
          isLoadingSample={isLoadingSample}
          uploadStatus={uploadStatus}
          imageOcrProgress={imageOcrProgress}
          uploadError={localizedUploadError}
          onImportBackup={importProjectBackup}
          isImportingBackup={isImportingBackup}
          backupError={localizedBackupError}
        />
        {persistenceWarningToast}
      </>
    );
  }

  const uploaded = project.uploadedProject;
  const projectMeta: WorkspaceProjectMeta = uploaded
    ? {
        course: uploaded.course,
        title: uploaded.title,
        dueDate: uploaded.dueDate,
        wordCount: uploaded.wordCount,
        mode: "uploaded",
      }
    : {
        course: SAMPLE_ASSIGNMENT.course,
        title: SAMPLE_ASSIGNMENT.title,
        dueDate: SAMPLE_ASSIGNMENT.dueAt.slice(0, 10),
        wordCount: SAMPLE_ASSIGNMENT.wordCount.target,
        mode: "sample",
      };

  let activeView: React.ReactNode;
  if (uploaded) {
    if (project.view === "overview") {
      activeView = <UploadedBriefView project={uploaded} onNavigate={navigate} />;
    } else if (project.view === "rubric") {
      activeView = (
        <UploadedRubricView
          project={uploaded}
          onOpenEvidence={setSelectedEvidenceId}
          onNavigate={navigate}
        />
      );
    } else if (project.view === "plan") {
      activeView = (
        <ActionPlanView
          plan={plan}
          onRebalance={rebalancePlan}
          onToggleTask={toggleTask}
          onNavigateDraft={() => navigate("draft")}
        />
      );
    } else if (project.view === "draft") {
      activeView = (
        <UploadedDraftReviewView
          project={uploaded}
          reviews={project.uploadedCriterionReviews}
          initialCriterionId={uploadedReviewCriterionId}
          onChange={updateUploadedReview}
          onSave={saveUploadedReview}
          onNavigate={navigate}
        />
      );
    } else {
      activeView = (
        <UploadedProgressView
          project={uploaded}
          plan={plan}
          reviews={project.uploadedCriterionReviews}
          readinessChecks={project.readinessChecks}
          onToggleReadiness={toggleReadiness}
          onContinue={continueUploadedProgress}
        />
      );
    }
  } else if (project.view === "overview") {
    activeView = <OverviewView analysis={SAMPLE_ASSIGNMENT} onOpenEvidence={setSelectedEvidenceId} onNavigate={navigate} />;
  } else if (project.view === "rubric") {
    activeView = <RubricView analysis={SAMPLE_ASSIGNMENT} draftResult={currentDraftResult} plan={plan} onOpenEvidence={setSelectedEvidenceId} />;
  } else if (project.view === "plan") {
    activeView = (
      <ActionPlanView
        plan={plan}
        onRebalance={rebalancePlan}
        onToggleTask={toggleTask}
        onNavigateDraft={() => navigate("draft")}
      />
    );
  } else if (project.view === "draft") {
    activeView = (
      <DraftCheckView
        analysis={SAMPLE_ASSIGNMENT}
        draftText={project.draftText}
        selectedSectionId={project.selectedSectionId}
        result={project.draftResult}
        checkedDraftText={project.checkedDraftText}
        isChecking={isChecking}
        checkingStage={checkingStage}
        onDraftChange={changeDraftText}
        onSectionChange={changeDraftSection}
        onCheck={runDraftCheck}
        onOpenEvidence={setSelectedEvidenceId}
        onNavigateProgress={() => navigate("progress")}
      />
    );
  } else {
    activeView = (
      <ProgressView
        analysis={SAMPLE_ASSIGNMENT}
        plan={plan}
        draftResult={currentDraftResult}
        readinessChecks={project.readinessChecks}
        onToggleReadiness={toggleReadiness}
        onContinue={navigate}
      />
    );
  }

  const stepStates = uploaded
    ? uploadedStepStates(project, plan.completionPercent)
    : sampleStepStates(project, plan.completionPercent, currentDraftResult !== null);
  const evidencePanel = selectedEvidenceId
    ? uploaded
      ? <UploadedEvidencePanel project={uploaded} criterionId={selectedEvidenceId} onClose={() => setSelectedEvidenceId(null)} onSaveManualSourceLocator={saveManualSourceLocator} />
      : <EvidencePanel analysis={SAMPLE_ASSIGNMENT} evidenceId={selectedEvidenceId} onClose={() => setSelectedEvidenceId(null)} />
    : null;

  return (
    <>
      <WorkspaceShell
        view={project.view}
        onNavigate={navigate}
        onReset={resetProject}
        onStartOwnProject={startOwnProject}
        onExportBackup={exportProjectBackup}
        onImportBackup={importProjectBackup}
        isImportingBackup={isImportingBackup}
        progress={plan.completionPercent}
        stepStates={stepStates}
        project={projectMeta}
        evidencePanel={evidencePanel}
      >
        {persistenceUnavailableNotice}
        {storageConflictNotice}
        {activeView}
      </WorkspaceShell>
      {toastStack}
    </>
  );
}
