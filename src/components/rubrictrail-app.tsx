"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Info, Route, X } from "lucide-react";
import { WelcomeScreen } from "@/components/welcome-screen";
import { WorkspaceShell, type WorkspaceProjectMeta } from "@/components/workspace-shell";
import { UploadSummaryView } from "@/components/upload-summary-view";
import { EvidencePanel } from "@/components/evidence-panel";
import { UploadedEvidencePanel } from "@/components/uploaded-evidence-panel";
import { StorageConflictBanner } from "@/components/storage-conflict-banner";
import { PersistenceUnavailableBanner } from "@/components/persistence-unavailable-banner";
import { OverviewView } from "@/components/views/overview-view";
import { RubricView } from "@/components/views/rubric-view";
import { ActionPlanView } from "@/components/views/action-plan-view";
import { DraftCheckView } from "@/components/views/draft-check-view";
import { ProgressView } from "@/components/views/progress-view";
import {
  UploadedBriefView,
  UploadedDraftReviewView,
  UploadedProgressView,
  UploadedRubricView,
} from "@/components/views/uploaded-project-views";
import { BRAND } from "@/lib/brand";
import type { PlanningDepth } from "@/lib/domain";
import { SAMPLE_ASSIGNMENT, SAMPLE_DRAFT_TEXT } from "@/lib/sample-data";
import {
  generateActionPlan,
  legacyTargetGradeForPlanningDepth,
  planningDepthFromLegacyTargetGrade,
  PLANNING_DEPTH_OPTIONS,
} from "@/lib/plan";
import { runMockDraftCheck } from "@/lib/mock-service";
import { UPLOADED_READINESS } from "@/lib/readiness";
import {
  ASSIGNMENT_EXTRACTED_TEXT_MAX_CHARACTERS,
  ASSIGNMENT_EXTRACTED_TEXT_MAX_LINES,
  ASSIGNMENT_EXTRACTED_TEXT_MAX_WORDS,
  ASSIGNMENT_PDF_MAX_PAGES,
  ASSIGNMENT_PDFS_MAX_TOTAL_PAGES,
  AssignmentFileBatchParseError,
  AssignmentFileParseError,
  buildUploadedAssignmentSummary,
  parseAssignmentFiles,
  parseAssignmentFilesWithRecovery,
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
  buildUploadedPlanTemplates,
  isConfirmedUploadedReview,
  todayIso,
} from "@/lib/uploaded-project";
import type {
  AssignmentFileIntakeError,
  AssignmentIntakeMode,
  NoticeState,
  PastedTextIntakeError,
  PersistedProjectState,
  UploadedCriterionReview,
  UploadedProject,
  UploadFlowResult,
  WorkflowState,
  WorkspaceView,
} from "@/lib/ui-types";

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

const FILE_ERROR_RECOVERY: Record<
  AssignmentFileParseError["code"],
  Pick<AssignmentFileIntakeError, "title" | "message" | "preferredRecovery">
> = {
  UNSUPPORTED_FILE_TYPE: {
    title: "This file type is not supported yet.",
    message: "Choose a PDF, DOCX or TXT file, or paste the assignment text.",
    preferredRecovery: "files",
  },
  INVALID_FILE_NAME: {
    title: "A file needs a shorter, usable name.",
    message: "Rename the file to 255 characters or fewer, then choose it again.",
    preferredRecovery: "files",
  },
  FILE_TOO_LARGE: {
    title: "There is too much to process at once.",
    message: "Choose a file at or below 10 MiB, or paste only the assignment instructions.",
    preferredRecovery: "files",
  },
  TOO_MANY_FILES: {
    title: "There is too much to process at once.",
    message: "Choose no more than 10 files, keeping only the brief and rubric.",
    preferredRecovery: "files",
  },
  TOTAL_FILE_SIZE_TOO_LARGE: {
    title: "There is too much to process at once.",
    message: "Keep the combined upload at or below 25 MiB, or paste only the relevant text.",
    preferredRecovery: "files",
  },
  EXTRACTED_TEXT_TOO_LARGE: {
    title: "The selected files contain too much text to process at once.",
    message: `Choose fewer or shorter files with ${ASSIGNMENT_EXTRACTED_TEXT_MAX_CHARACTERS.toLocaleString("en-US")} characters or fewer combined, or paste only the brief and rubric.`,
    preferredRecovery: "paste",
  },
  EXTRACTED_TEXT_TOO_MANY_LINES: {
    title: "The selected files contain too many lines to process at once.",
    message: `Choose fewer or shorter files with ${ASSIGNMENT_EXTRACTED_TEXT_MAX_LINES.toLocaleString("en-US")} lines or fewer combined, or paste only the brief and rubric.`,
    preferredRecovery: "paste",
  },
  EXTRACTED_TEXT_TOO_MANY_WORDS: {
    title: "The selected files contain too many words to process at once.",
    message: `Choose fewer or shorter files with ${ASSIGNMENT_EXTRACTED_TEXT_MAX_WORDS.toLocaleString("en-US")} words or fewer combined, or paste only the brief and rubric.`,
    preferredRecovery: "paste",
  },
  PDF_TOO_MANY_PAGES: {
    title: "This PDF has too many pages to process at once.",
    message: `Choose a PDF with ${ASSIGNMENT_PDF_MAX_PAGES.toLocaleString("en-US")} pages or fewer, split out only the relevant pages, or paste only the brief and rubric.`,
    preferredRecovery: "paste",
  },
  TOTAL_PDF_PAGES_TOO_LARGE: {
    title: "The selected PDFs have too many pages to process at once.",
    message: `Choose fewer or shorter PDFs with ${ASSIGNMENT_PDFS_MAX_TOTAL_PAGES.toLocaleString("en-US")} pages or fewer combined, or paste only the brief and rubric.`,
    preferredRecovery: "paste",
  },
  EMPTY_FILE: {
    title: "This file has no readable text.",
    message: "Open it, copy the assignment instructions, then paste them here.",
    preferredRecovery: "paste",
  },
  INVALID_TEXT_ENCODING: {
    title: "This TXT file is not valid UTF-8.",
    message: "Save it as UTF-8 text, choose a fresh copy, or paste the assignment text.",
    preferredRecovery: "files",
  },
  SCANNED_NO_TEXT: {
    title: "This file has no selectable text.",
    message: "Open the scan, copy or transcribe the assignment instructions, then paste them here.",
    preferredRecovery: "paste",
  },
  ENCRYPTED_PDF: {
    title: "This PDF needs a password.",
    message: "Open it with the password and save an unlocked copy, or paste the text.",
    preferredRecovery: "paste",
  },
  PARSER_UNAVAILABLE: {
    title: "The local document reader is unavailable.",
    message: "Try again, choose a TXT file, or paste the assignment text.",
    preferredRecovery: "paste",
  },
  CORRUPT_DOCUMENT: {
    title: "We could not open this file.",
    message: "Download or save a fresh copy, choose another file, or paste the text.",
    preferredRecovery: "files",
  },
};

const BATCH_WIDE_FILE_ERROR_CODES = new Set<AssignmentFileParseError["code"]>([
  "TOO_MANY_FILES",
  "TOTAL_FILE_SIZE_TOO_LARGE",
  "EXTRACTED_TEXT_TOO_LARGE",
  "EXTRACTED_TEXT_TOO_MANY_LINES",
  "EXTRACTED_TEXT_TOO_MANY_WORDS",
  "TOTAL_PDF_PAGES_TOO_LARGE",
]);

export function friendlyFileError(error: unknown): AssignmentFileIntakeError {
  if (error instanceof AssignmentFileBatchParseError) {
    if (error.failures.length === 1) {
      const failure = error.failures[0];
      return {
        code: failure.code,
        fileName: failure.fileName,
        ...FILE_ERROR_RECOVERY[failure.code],
        fileIssues: [],
      };
    }
    const preferPaste = error.failures.every(
      (failure) => FILE_ERROR_RECOVERY[failure.code].preferredRecovery === "paste",
    );
    return {
      code: "NO_READABLE_FILES",
      fileName: null,
      title: "None of these files could be read.",
      message: "Review each file below, then choose replacements or paste the assignment text.",
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
      ...FILE_ERROR_RECOVERY[error.code],
      fileIssues: [],
    };
  }
  return {
    code: "UNKNOWN",
    fileName: null,
    title: "We could not prepare these files.",
    message: "Try a text-based PDF, DOCX or TXT file, or paste the assignment text.",
    preferredRecovery: "files",
    fileIssues: [],
  };
}

function friendlyBackupError(error: unknown): string {
  return error instanceof ProjectBackupError
    ? error.message
    : "The backup could not be read safely. Your current project was not changed.";
}

function friendlyPastedParseError(error: unknown): PastedTextIntakeError {
  if (error instanceof AssignmentFileParseError) {
    if (error.code === "EMPTY_FILE" || error.code === "SCANNED_NO_TEXT") {
      return {
        target: "brief",
        message: "The pasted brief does not contain readable text. Paste the assignment instructions, then try again.",
      };
    }
    if (error.code === "EXTRACTED_TEXT_TOO_LARGE") {
      return {
        target: "combined",
        message: "The pasted source is too large to prepare safely. Remove unrelated text, then try again.",
      };
    }
  }
  return {
    target: "unknown",
    message: "The pasted source could not be prepared locally. Your current project was not changed.",
  };
}

function backupDateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function backupProjectDetails(state: PersistedProjectState): string {
  const course = state.uploadedProject?.course ?? SAMPLE_ASSIGNMENT.course;
  const dueDate =
    state.uploadedProject?.dueDate ?? SAMPLE_ASSIGNMENT.dueAt.slice(0, 10);
  const dueLabel = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
  }).format(new Date(`${dueDate}T12:00:00`));
  return `Course: ${course}\nDue: ${dueLabel}`;
}

function planStartFor(dueDate: string, today: string): string {
  return dueDate < today ? dueDate : today;
}

interface PersistenceWarningState {
  kind: "recovered" | "write";
  message: string;
}

type PersistenceFlushOutcome = "saved" | "blocked" | "failed";

const REPLACEMENT_INTENT_CHANGED_MESSAGE =
  "Your project changed in this tab after you confirmed the replacement. RubricTrail cancelled it so the newer changes were kept. Review them, then try again.";

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
  const [hydrated, setHydrated] = useState(false);
  const [project, setProjectState] = useState<PersistedProjectState>(() => createDefaultProjectState());
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [uploadedReviewCriterionId, setUploadedReviewCriterionId] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadFlowResult | null>(null);
  const [partialUploadResult, setPartialUploadResult] =
    useState<UploadFlowResult | null>(null);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "parsing" | "error">("idle");
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
  const [notice, setNotice] = useState<NoticeState | null>(null);
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
        const message = invalidState
          ? "This project failed local validation, so recent changes are only in this tab. Reset the local project if the warning continues."
          : "Browser storage is unavailable or full. Recent changes are only in this tab and may be lost when it closes.";
        if (result.reason === "unavailable") {
          markDurableSavingUnavailable();
        } else if (result.reason === "storage-error") {
          setDurableSavingUnavailable(true);
        }
        setPersistenceWarning({ kind: "write", message });
        return "failed";
      })
      .catch((): PersistenceFlushOutcome => {
        setDurableSavingUnavailable(true);
        setPersistenceWarning({
          kind: "write",
          message:
            "RubricTrail could not finish the local save. Recent changes are only in this tab; download a backup before closing.",
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
              ? "An older local project was recovered and is ready to upgrade. Review its details before continuing."
              : result.source === "v2"
                ? "An earlier RubricTrail project was recovered and is ready to upgrade. Review its details before continuing."
                : result.source === "v3"
                  ? "Obsolete entries were removed from this saved project. Review its details before continuing."
                  : "Saved browser data was incomplete or incompatible, so RubricTrail recovered with safe defaults. Review the project before continuing.",
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

  const showNotice = useCallback((nextNotice: NoticeState) => {
    setNotice(nextNotice);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3600);
  }, []);

  const reportReplacementIntentChanged = useCallback(
    (surface: "project" | "backup" = "project") => {
      if (surface === "backup") {
        setBackupError(REPLACEMENT_INTENT_CHANGED_MESSAGE);
      }
      showNotice({
        tone: "warning",
        message: REPLACEMENT_INTENT_CHANGED_MESSAGE,
      });
      schedulePendingPersistence();
    },
    [schedulePendingPersistence, showNotice],
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
    showNotice({ tone: "success", message: "Sample mapped with traceable evidence links. No API request was sent." });
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
      const recovered = intakeMethod === "files"
        ? await parseAssignmentFilesWithRecovery(files)
        : {
            parsed: await parseAssignmentFiles(files),
            skippedFiles: [],
          };
      if (operationId !== intakeRunId.current) return;
      const { parsed, skippedFiles } = recovered;
      const summary = buildUploadedAssignmentSummary(parsed);
      const nextResult: UploadFlowResult = {
        intakeMethod,
        fileNames: parsed.sources.map((source) => source.fileName),
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
    } catch (error) {
      if (operationId !== intakeRunId.current) return;
      setUploadStatus("error");
      if (intakeMethod === "paste") {
        setPastedTextError(friendlyPastedParseError(error));
      } else {
        setUploadError(friendlyFileError(error));
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
        ? "Local project created in this tab. Full source text was not retained. Browser saving is unavailable, so download a backup before closing this tab."
        : "Local project created in this session. Full source text was not retained; confirmed fields and short excerpts are set to autosave.",
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
    const message =
      purgeResult.reason === "coordination-unavailable"
        ? "Safe multi-tab storage coordination is unavailable, so RubricTrail did not delete the saved project and this tab was left unchanged."
        : "RubricTrail could not confirm complete deletion of the saved project. Some browser data may remain; reload before trying again.";
    if (
      purgeResult.reason === "coordination-unavailable" ||
      purgeResult.reason === "unavailable"
    ) {
      markDurableSavingUnavailable();
    } else {
      setDurableSavingUnavailable(true);
    }
    setPersistenceWarning({ kind: "write", message });
    showNotice({ tone: "warning", message });
    schedulePendingPersistence();
    return false;
  }

  async function resetProject() {
    const confirmedProject = latestProject.current;
    if (!window.confirm("Reset this local project? This clears saved draft excerpts, checks, results and task progress from this browser.")) return;
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
    if (!window.confirm("Leave the sample demo and use your own assignment? Demo changes and progress will be cleared from this browser.")) return;
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
        message: "Project backup downloaded. It contains saved notes and excerpts, so keep the JSON file private.",
      });
    } catch (error) {
      showNotice({ tone: "warning", message: friendlyBackupError(error) });
    }
  }

  async function loadLatestSavedProject() {
    cancelPersistenceTimer();
    if (persistenceInFlight.current) await persistenceInFlight.current;
    const storageSnapshot = readProjectStateWithStatus();
    if (!storageSnapshot.storageAvailable) {
      const message =
        "Browser storage could not be read, so nothing was replaced. This tab and its conflict warning were left unchanged.";
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
      const message =
        "Both browser storage versions changed, so RubricTrail cannot safely decide which is newer. Download this tab, then explicitly keep it or reopen the other tab before replacing anything.";
      setPersistenceWarning({ kind: "write", message });
      showNotice({ tone: "warning", message });
      schedulePendingPersistence();
      return;
    }

    const confirmedProject = latestProject.current;
    if (
      !window.confirm(
        legacyCandidate !== null || shouldLoadPrevious
          ? "Load and upgrade the project saved by the older RubricTrail tab? Changes kept only in this tab will be replaced. Download this tab first if you may need them."
          : "Load the project version saved by another tab? Changes kept only in this tab will be replaced. Download this tab first if you may need them.",
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
        const message =
          "The older-version saved project is incomplete or incompatible, so it was not loaded. Both browser values were left unchanged.";
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
            ? "The saved project changed again while the older version was being upgraded. Nothing was selected; review the conflict and try again."
            : promoted.reason === "invalid-state"
              ? "The older-version project failed migration validation, so neither saved value was replaced."
              : "Browser storage could not save the upgraded project, so neither saved value was replaced.";
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
      const message =
        "The saved browser data is incomplete or incompatible, so it was not loaded. Download this tab before resetting or replacing anything.";
      setPersistenceWarning({ kind: "write", message });
      showNotice({ tone: "warning", message });
      return;
    } else if (storageSnapshot.crossVersionConflict) {
      const message =
        "Two different browser storage versions are present, so RubricTrail did not guess which one to load. Download this tab or explicitly keep it before replacing either version.";
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
            message:
              "The saved project was loaded with obsolete entries removed. Review its details before continuing.",
          }
        : null,
    );
    showNotice({
      tone: "success",
      message: result.mutationAvailable
        ? loadedFromPreviousVersion
          ? "Older-version saved project loaded and upgraded. Autosave is active again in this tab."
          : "Saved project loaded. Autosave is active again in this tab."
        : "Saved project loaded into this tab. Browser saving is unavailable, so download a backup before closing.",
    });
  }

  async function keepThisTabProject() {
    if (
      !window.confirm(
        "Make this tab the active saved project? The other browser version will be superseded. Download this tab or the other tab first if either version may be needed.",
      )
    ) {
      return;
    }
    const intentRevision = ++replacementIntentRevision.current;

    cancelPersistenceTimer();
    if (persistenceInFlight.current) await persistenceInFlight.current;
    const currentStorage = readProjectStateWithStatus();
    if (!currentStorage.storageAvailable) {
      const message =
        "Browser storage could not be read, so this tab did not replace the saved project.";
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
          ? "This tab failed local validation, so it did not replace the saved project."
          : result.reason === "conflict"
            ? "The saved project changed again, so this tab did not replace it. Review the conflict and try again."
            : "Browser storage is unavailable or full, so this tab did not replace the saved project.";
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
      message: "This tab is now the active saved version. Autosave is active again.",
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
      const incomingTitle = projectBackupTitle(backup.state);
      const current = latestProject.current;
      const replacement = current.projectKind === "none"
        ? "No existing project will be removed."
        : `This will replace the local project “${projectBackupTitle(current)}”.`;
      const confirmed = window.confirm(
        `Restore “${incomingTitle}”?\n${backupProjectDetails(backup.state)}\nExported: ${backupDateLabel(backup.exportedAt)}\n\n${replacement}\n\nThe backup may contain course details, source labels or file names, short excerpts, draft text, self-checks and progress. Original files and full intake text are not included.`,
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
          const message =
            "The project changed in another tab, so the backup was not restored. Resolve the tab conflict first; neither saved version was overwritten.";
          markStorageConflict();
          setBackupError(message);
          showNotice({ tone: "warning", message });
          return;
        }
        const message = writeResult.reason === "invalid-state"
          ? "The restored project failed final validation. Your current project was not changed."
          : "Browser storage is unavailable or full, so the backup was not restored and your current project was not changed.";
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
          ? "Project restored. Obsolete entries were safely removed during import."
          : "Project restored from backup and saved in this browser.",
      });
    } catch (error) {
      if (operationId !== intakeRunId.current) return;
      const message = friendlyBackupError(error);
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
    const planningDepthLabel = PLANNING_DEPTH_OPTIONS.find(
      (option) => option.value === planningDepth,
    )?.label ?? "Standard";
    showNotice({
      tone: weeklyHours <= 5 ? "warning" : "success",
      message: `Plan updated for ${weeklyHours} hours per week with ${planningDepthLabel} planning depth.`,
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
      showNotice({ tone: "warning", message: "Finish the prerequisite task before marking this one complete." });
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
          message: `${reopenedTaskCount} dependent ${reopenedTaskCount === 1 ? "task was" : "tasks were"} reopened with this prerequisite.`,
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
          message: "The demo signal check could not finish. Your draft was not changed; try again.",
        });
      }
    } finally {
      if (draftCheckRunId.current === runId) {
        draftCheckActive.current = false;
        setIsChecking(false);
      }
    }
    if (committed) {
      showNotice({ tone: "info", message: "Deterministic demo check complete. Treat the signals as prompts, not a grade." });
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
        message:
          "Self-check saved in this browser. It counts as complete only when the draft note and all three evidence checks are present.",
      });
      return;
    }
    showNotice({
      tone: "warning",
      message:
        "Self-check is only in this tab because browser saving was not confirmed. Resolve the storage warning or download a backup before closing.",
    });
  }

  function toggleReadiness(id: string) {
    updateProject((current) => ({
      ...current,
      readinessChecks: current.readinessChecks.includes(id)
        ? current.readinessChecks.filter((item) => item !== id)
        : [...current.readinessChecks, id],
    }));
  }

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
  const persistenceWarningToast = persistenceWarning ? (
    <div className="toast warning persistence-warning" role="alert">
      <AlertTriangle aria-hidden="true" />
      <span>{persistenceWarning.message}</span>
      <button
        className="icon-button"
        type="button"
        onClick={() => setPersistenceWarning(null)}
        aria-label="Dismiss storage warning"
      >
        <X aria-hidden="true" />
      </button>
    </div>
  ) : null;

  if (!hydrated) {
    return (
      <main className="app-loading" aria-label="Loading RubricTrail">
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
          uploadError={uploadError}
          onImportBackup={importProjectBackup}
          isImportingBackup={isImportingBackup}
          backupError={backupError}
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
  const evidencePanel = uploaded
    ? <UploadedEvidencePanel project={uploaded} criterionId={selectedEvidenceId} onClose={() => setSelectedEvidenceId(null)} />
    : <EvidencePanel analysis={SAMPLE_ASSIGNMENT} evidenceId={selectedEvidenceId} onClose={() => setSelectedEvidenceId(null)} />;

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
      {persistenceWarningToast}
      {notice ? (
        <div className={`toast ${notice.tone}`} role="status" data-testid="toast">
          {notice.tone === "warning" ? <AlertTriangle aria-hidden="true" /> : notice.tone === "info" ? <Info aria-hidden="true" /> : <Check aria-hidden="true" />}
          {notice.message}
        </div>
      ) : null}
    </>
  );
}
