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
  UPLOADED_READINESS,
  UploadedRubricView,
} from "@/components/views/uploaded-project-views";
import { BRAND } from "@/lib/brand";
import { SAMPLE_ASSIGNMENT, SAMPLE_DRAFT_TEXT } from "@/lib/sample-data";
import { generateActionPlan } from "@/lib/plan";
import { runMockDraftCheck } from "@/lib/mock-service";
import {
  AssignmentFileParseError,
  buildUploadedAssignmentSummary,
  parseAssignmentFiles,
} from "@/lib/files/parse-assignment-files";
import {
  clearProjectState,
  createDefaultProjectState,
  readProjectStateWithStatus,
  writeProjectState,
} from "@/lib/local-state";
import {
  buildUploadedPlanTemplates,
  isConfirmedUploadedReview,
  todayIso,
} from "@/lib/uploaded-project";
import type {
  NoticeState,
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

function friendlyFileError(error: unknown): string {
  if (error instanceof AssignmentFileParseError) {
    const recovery: Record<AssignmentFileParseError["code"], string> = {
      UNSUPPORTED_FILE_TYPE: "Choose a PDF, DOCX, or TXT file.",
      FILE_TOO_LARGE: "Choose a file smaller than 10 MB.",
      TOO_MANY_FILES: "Upload no more than 10 files at a time.",
      TOTAL_FILE_SIZE_TOO_LARGE: "Keep the combined upload at or below 25 MB.",
      EXTRACTED_TEXT_TOO_LARGE: "Split the assignment into smaller files or remove unrelated text.",
      EMPTY_FILE: "Choose a file that contains readable text.",
      SCANNED_NO_TEXT: "This looks like a scanned PDF. Paste the text or use a text-based PDF.",
      ENCRYPTED_PDF: "Remove the PDF password locally, then try again.",
      CORRUPT_DOCUMENT: "The document could not be parsed. Export a fresh copy or try TXT.",
    };
    return `${error.message} ${recovery[error.code]}`;
  }
  return "The files could not be parsed locally. Try a text-based PDF, DOCX, or TXT file.";
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
  const [uploadError, setUploadError] = useState<string | null>(null);
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
    draftCheckRunId.current += 1;
    draftCheckActive.current = false;
    setUploadResult(null);
    setUploadError(null);
    setIsLoadingSample(true);
    await wait(450);
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

  async function handleFiles(files: File[]) {
    setUploadStatus("parsing");
    setUploadError(null);
    try {
      const parsed = await parseAssignmentFiles(files);
      const summary = buildUploadedAssignmentSummary(parsed);
      setUploadResult({
        fileNames: parsed.sources.map((source) => source.fileName),
        totalWords: parsed.wordCount,
        summary,
      });
      setUploadStatus("idle");
    } catch (error) {
      setUploadStatus("error");
      setUploadError(friendlyFileError(error));
    }
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
    setSelectedEvidenceId(null);
    showNotice({
      tone: "success",
      message: "Local project created in this session. Original files were not retained; confirmed fields and short excerpts are set to autosave.",
    });
  }

  function resetProject() {
    if (!window.confirm("Reset this local project? This clears saved draft excerpts, checks, results and task progress from this browser.")) return;
    clearProjectState();
    draftCheckRunId.current += 1;
    draftCheckActive.current = false;
    setIsChecking(false);
    updateProject(createDefaultProjectState());
    setSelectedEvidenceId(null);
    setUploadResult(null);
    setUploadStatus("idle");
    setUploadError(null);
    setPersistenceWarning(null);
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
          isLoadingSample={isLoadingSample}
          uploadStatus={uploadStatus}
          uploadError={uploadError}
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
