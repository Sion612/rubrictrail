"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Info, Route, X } from "lucide-react";
import { WelcomeScreen } from "@/components/welcome-screen";
import { WorkspaceShell, type WorkspaceProjectMeta } from "@/components/workspace-shell";
import { UploadSummaryView } from "@/components/upload-summary-view";
import { EvidencePanel } from "@/components/evidence-panel";
import { UploadedEvidencePanel } from "@/components/uploaded-evidence-panel";
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
import { SAMPLE_ASSIGNMENT, SAMPLE_DRAFT_TEXT } from "@/lib/sample-data";
import { generateActionPlan } from "@/lib/plan";
import { runMockDraftCheck } from "@/lib/mock-service";
import { UPLOADED_READINESS } from "@/lib/readiness";
import {
  AssignmentFileParseError,
  buildUploadedAssignmentSummary,
  parseAssignmentFiles,
} from "@/lib/files/parse-assignment-files";
import {
  createPastedAssignmentFiles,
  validatePastedAssignmentText,
} from "@/lib/pasted-text-intake";
import {
  clearProjectState,
  createDefaultProjectState,
  readProjectStateWithStatus,
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

function friendlyFileError(error: unknown): AssignmentFileIntakeError {
  if (error instanceof AssignmentFileParseError) {
    const recovery: Record<
      AssignmentFileParseError["code"],
      Pick<AssignmentFileIntakeError, "title" | "message" | "preferredRecovery">
    > = {
      UNSUPPORTED_FILE_TYPE: {
        title: "This file type is not supported yet.",
        message: "Choose a PDF, DOCX or TXT file, or paste the assignment text.",
        preferredRecovery: "files",
      },
      FILE_TOO_LARGE: {
        title: "There is too much to process at once.",
        message: "Choose a file smaller than 10 MB, or paste only the assignment instructions.",
        preferredRecovery: "files",
      },
      TOO_MANY_FILES: {
        title: "There is too much to process at once.",
        message: "Choose no more than 10 files, keeping only the brief and rubric.",
        preferredRecovery: "files",
      },
      TOTAL_FILE_SIZE_TOO_LARGE: {
        title: "There is too much to process at once.",
        message: "Keep the combined upload at or below 25 MB, or paste only the relevant text.",
        preferredRecovery: "files",
      },
      EXTRACTED_TEXT_TOO_LARGE: {
        title: "There is too much text to process at once.",
        message: "Remove unrelated material, split the source, or paste only the brief and rubric.",
        preferredRecovery: "paste",
      },
      EMPTY_FILE: {
        title: "This file has no readable text.",
        message: "Open it, copy the assignment instructions, then paste them here.",
        preferredRecovery: "paste",
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
      CORRUPT_DOCUMENT: {
        title: "We could not open this file.",
        message: "Download or save a fresh copy, choose another file, or paste the text.",
        preferredRecovery: "files",
      },
    };
    return {
      code: error.code,
      fileName: error.fileName,
      ...recovery[error.code],
    };
  }
  return {
    code: "UNKNOWN",
    fileName: null,
    title: "We could not prepare these files.",
    message: "Try a text-based PDF, DOCX or TXT file, or paste the assignment text.",
    preferredRecovery: "files",
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
  const [uploadResult, setUploadResult] = useState<UploadFlowResult | null>(null);
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
  const noticeTimer = useRef<number | null>(null);
  const persistenceTimer = useRef<number | null>(null);
  const draftCheckRunId = useRef(0);
  const draftCheckActive = useRef(false);
  const latestProject = useRef(project);
  const persistenceReady = useRef(false);
  const hasPendingProjectChange = useRef(false);
  const persistHydratedState = useRef(false);
  const skipNextPersistenceWrite = useRef(false);
  const backupImportActive = useRef(false);
  const intakeRunId = useRef(0);
  const focusWelcomeIntake = useRef<AssignmentIntakeMode | null>(null);

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
      persistHydratedState.current =
        result.recovered && result.source !== "default";
      setProjectState(result.state);
      if (result.recovered) {
        setPersistenceWarning({
          kind: "recovered",
          message:
            result.source === "legacy"
              ? "An older local project was recovered and is ready to upgrade. Review its details before continuing."
              : result.source === "v2"
                ? "Obsolete entries were removed from this saved project. Review its details before continuing."
                : "Saved browser data was incomplete or incompatible, so RubricTrail recovered with safe defaults. Review the project before continuing.",
        });
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(hydrationTimer);
  }, []);

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
    if (persistenceTimer.current) window.clearTimeout(persistenceTimer.current);
    persistenceTimer.current = window.setTimeout(() => {
      const result = writeProjectState(project);
      if (result.ok) {
        if (latestProject.current === project) {
          hasPendingProjectChange.current = false;
        }
        setPersistenceWarning((current) =>
          current?.kind === "write" ? null : current,
        );
        return;
      }
      const message =
        result.reason === "invalid-state"
          ? "This project failed local validation, so recent changes are only in this tab. Reset the local project if the warning continues."
          : "Browser storage is unavailable or full. Recent changes are only in this tab and may be lost when it closes.";
      setPersistenceWarning({ kind: "write", message });
    }, 250);
    return () => {
      if (persistenceTimer.current) window.clearTimeout(persistenceTimer.current);
    };
  }, [hydrated, project]);

  useEffect(() => {
    if (!hydrated) return;
    const flushLatestProject = () => {
      if (hasPendingProjectChange.current) {
        writeProjectState(latestProject.current);
      }
    };
    window.addEventListener("pagehide", flushLatestProject);
    return () => window.removeEventListener("pagehide", flushLatestProject);
  }, [hydrated]);

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

  useEffect(
    () => () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      if (persistenceTimer.current) window.clearTimeout(persistenceTimer.current);
    },
    [],
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
          targetGrade: project.targetGrade,
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

  async function loadSample() {
    if (backupImportActive.current) return;
    const operationId = ++intakeRunId.current;
    draftCheckRunId.current += 1;
    draftCheckActive.current = false;
    setUploadResult(null);
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
    setUploadError(null);
    setPastedTextError(null);
    setBackupError(null);
    try {
      const parsed = await parseAssignmentFiles(files);
      if (operationId !== intakeRunId.current) return;
      const summary = buildUploadedAssignmentSummary(parsed);
      setUploadResult({
        intakeMethod,
        fileNames: parsed.sources.map((source) => source.fileName),
        totalWords: parsed.wordCount,
        summary,
      });
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
    setUploadStatus("idle");
    setUploadError(null);
    setPastedTextError(null);
    setPastedBrief("");
    setPastedRubric("");
    setBackupError(null);
    setSelectedEvidenceId(null);
    showNotice({
      tone: "success",
      message: "Local project created in this session. Full source text was not retained; confirmed fields and short excerpts are set to autosave.",
    });
  }

  function resetProject() {
    if (!window.confirm("Reset this local project? This clears saved draft excerpts, checks, results and task progress from this browser.")) return;
    intakeRunId.current += 1;
    backupImportActive.current = false;
    setIsImportingBackup(false);
    focusWelcomeIntake.current = "files";
    setIntakeMode("files");
    clearProjectState();
    draftCheckRunId.current += 1;
    draftCheckActive.current = false;
    setIsChecking(false);
    updateProject(createDefaultProjectState());
    setSelectedEvidenceId(null);
    setUploadResult(null);
    setUploadStatus("idle");
    setUploadError(null);
    setPastedTextError(null);
    setPastedBrief("");
    setPastedRubric("");
    setBackupError(null);
    setPersistenceWarning(null);
  }

  function startOwnProject() {
    if (!window.confirm("Leave the sample demo and use your own assignment? Demo changes and progress will be cleared from this browser.")) return;
    intakeRunId.current += 1;
    backupImportActive.current = false;
    setIsImportingBackup(false);
    focusWelcomeIntake.current = "files";
    setIntakeMode("files");
    clearProjectState();
    draftCheckRunId.current += 1;
    draftCheckActive.current = false;
    setIsChecking(false);
    updateProject(createDefaultProjectState());
    setSelectedEvidenceId(null);
    setUploadResult(null);
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

      const writeResult = writeProjectState(backup.state);
      if (!writeResult.ok) {
        const message = writeResult.reason === "invalid-state"
          ? "The restored project failed final validation. Your current project was not changed."
          : "Browser storage is unavailable or full, so the backup was not restored and your current project was not changed.";
        setBackupError(message);
        setPersistenceWarning({ kind: "write", message });
        showNotice({ tone: "warning", message });
        return;
      }
      if (persistenceTimer.current) {
        window.clearTimeout(persistenceTimer.current);
        persistenceTimer.current = null;
      }

      draftCheckRunId.current += 1;
      draftCheckActive.current = false;
      setIsChecking(false);
      latestProject.current = backup.state;
      hasPendingProjectChange.current = false;
      skipNextPersistenceWrite.current = true;
      setProjectState(backup.state);
      setSelectedEvidenceId(null);
      setUploadResult(null);
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

  function rebalancePlan(weeklyHours: number, targetGrade: number) {
    updateProject((current) => ({ ...current, weeklyHours, targetGrade }));
    showNotice({
      tone: weeklyHours <= 5 ? "warning" : "success",
      message: `Plan updated for ${weeklyHours} hours per week and a ${targetGrade}% target band.`,
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

  function saveUploadedReview(review: UploadedCriterionReview) {
    updateUploadedReview(review);
    showNotice({ tone: "success", message: "Self-check recorded. It counts as complete only when the draft note and all three evidence checks are present." });
  }

  function toggleReadiness(id: string) {
    updateProject((current) => ({
      ...current,
      readinessChecks: current.readinessChecks.includes(id)
        ? current.readinessChecks.filter((item) => item !== id)
        : [...current.readinessChecks, id],
    }));
  }

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
        <UploadSummaryView
          result={uploadResult}
          onBack={() => {
            focusWelcomeIntake.current = uploadResult.intakeMethod;
            setIntakeMode(uploadResult.intakeMethod);
            setUploadResult(null);
            setUploadStatus("idle");
          }}
          onCreateProject={createLocalProject}
        />
        {persistenceWarning ? (
          <div className="toast warning persistence-warning" role="alert">
            <AlertTriangle aria-hidden="true" />
            <span>{persistenceWarning.message}</span>
            <button className="icon-button" type="button" onClick={() => setPersistenceWarning(null)} aria-label="Dismiss storage warning"><X aria-hidden="true" /></button>
          </div>
        ) : null}
      </>
    );
  }

  if (project.projectKind === "none") {
    return (
      <>
        <WelcomeScreen
          onTrySample={loadSample}
          onFiles={handleFiles}
          onPastedText={handlePastedText}
          intakeMode={intakeMode}
          onIntakeModeChange={setIntakeMode}
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
        {persistenceWarning ? (
          <div className="toast warning persistence-warning" role="alert">
            <AlertTriangle aria-hidden="true" />
            <span>{persistenceWarning.message}</span>
            <button className="icon-button" type="button" onClick={() => setPersistenceWarning(null)} aria-label="Dismiss storage warning"><X aria-hidden="true" /></button>
          </div>
        ) : null}
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
          onContinue={navigate}
        />
      );
    }
  } else if (project.view === "overview") {
    activeView = <OverviewView analysis={SAMPLE_ASSIGNMENT} onOpenEvidence={setSelectedEvidenceId} onNavigate={navigate} />;
  } else if (project.view === "rubric") {
    activeView = <RubricView analysis={SAMPLE_ASSIGNMENT} draftResult={currentDraftResult} plan={plan} onOpenEvidence={setSelectedEvidenceId} />;
  } else if (project.view === "plan") {
    activeView = <ActionPlanView plan={plan} onRebalance={rebalancePlan} onToggleTask={toggleTask} onNavigateDraft={() => navigate("draft")} />;
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
        {activeView}
      </WorkspaceShell>
      {persistenceWarning ? (
        <div className="toast warning persistence-warning" role="alert">
          <AlertTriangle aria-hidden="true" />
          <span>{persistenceWarning.message}</span>
          <button className="icon-button" type="button" onClick={() => setPersistenceWarning(null)} aria-label="Dismiss storage warning"><X aria-hidden="true" /></button>
        </div>
      ) : null}
      {notice ? (
        <div className={`toast ${notice.tone}`} role="status" data-testid="toast">
          {notice.tone === "warning" ? <AlertTriangle aria-hidden="true" /> : notice.tone === "info" ? <Info aria-hidden="true" /> : <Check aria-hidden="true" />}
          {notice.message}
        </div>
      ) : null}
    </>
  );
}
