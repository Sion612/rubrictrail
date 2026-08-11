"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Route } from "lucide-react";
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
import {
  AssignmentFileParseError,
  buildUploadedAssignmentSummary,
  parseAssignmentFiles,
} from "@/lib/files/parse-assignment-files";
import {
  clearProjectState,
  createDefaultProjectState,
  readProjectState,
  writeProjectState,
} from "@/lib/local-state";
import { buildUploadedPlanTemplates, todayIso } from "@/lib/uploaded-project";
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

function sampleStepStates(project: PersistedProjectState, completion: number) {
  const draftState: WorkflowState = project.draftResult
    ? "complete"
    : project.visitedViews.includes("draft")
      ? "in_progress"
      : "not_started";
  return {
    overview: "complete",
    rubric: "complete",
    plan: completion === 100
      ? "complete"
      : project.completedTaskIds.length
        ? "in_progress"
        : "needs_review",
    draft: draftState,
    progress: project.visitedViews.includes("progress") ? "in_progress" : "not_started",
  } satisfies Record<WorkspaceView, WorkflowState>;
}

function uploadedStepStates(project: PersistedProjectState, completion: number) {
  const uploaded = project.uploadedProject;
  const completeReviews = uploaded
    ? project.uploadedCriterionReviews.filter(
        (review) =>
          review.draftText.trim() &&
          review.evidenceVisible &&
          review.linkExplained &&
          review.sourceTraceable,
      ).length
    : 0;
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
    project.readinessChecks.length === 6;
  return {
    overview: "complete",
    rubric: "complete",
    plan: completion === 100
      ? "complete"
      : project.completedTaskIds.length
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
  const [project, setProject] = useState<PersistedProjectState>(() => createDefaultProjectState());
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadFlowResult | null>(null);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "parsing" | "error">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isLoadingSample, setIsLoadingSample] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [checkingStage, setCheckingStage] = useState(0);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const noticeTimer = useRef<number | null>(null);

  useEffect(() => {
    const hydrationTimer = window.setTimeout(() => {
      setProject(readProjectState());
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(hydrationTimer);
  }, []);

  useEffect(() => {
    if (hydrated) writeProjectState(project);
  }, [hydrated, project]);

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

  function navigate(view: WorkspaceView) {
    setProject((current) => ({
      ...current,
      view,
      visitedViews: current.visitedViews.includes(view)
        ? current.visitedViews
        : [...current.visitedViews, view],
    }));
  }

  async function loadSample() {
    setUploadResult(null);
    setUploadError(null);
    setIsLoadingSample(true);
    await wait(450);
    setProject({
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
    setProject({
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
      message: "Local project created. Original files were not saved; confirmed fields and short excerpts were.",
    });
  }

  function resetProject() {
    if (!window.confirm("Reset this local project? This clears saved draft excerpts, checks, results and task progress from this browser.")) return;
    clearProjectState();
    setProject(createDefaultProjectState());
    setSelectedEvidenceId(null);
    setUploadResult(null);
    setUploadStatus("idle");
    setUploadError(null);
  }

  function rebalancePlan(weeklyHours: number, targetGrade: number) {
    setProject((current) => ({ ...current, weeklyHours, targetGrade }));
    showNotice({
      tone: weeklyHours <= 5 ? "warning" : "success",
      message: `Plan updated for ${weeklyHours} hours per week and a ${targetGrade}% target band.`,
    });
  }

  function toggleTask(taskId: string) {
    const task = plan.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const incompleteDependencies = task.dependencies.filter(
      (id) => !plan.tasks.find((candidate) => candidate.id === id)?.completed,
    );
    if (!task.completed && incompleteDependencies.length) {
      showNotice({ tone: "warning", message: "Finish the prerequisite task before marking this one complete." });
      return;
    }
    setProject((current) => ({
      ...current,
      completedTaskIds: current.completedTaskIds.includes(taskId)
        ? current.completedTaskIds.filter((id) => id !== taskId)
        : [...current.completedTaskIds, taskId],
    }));
  }

  async function runDraftCheck() {
    if (project.projectKind !== "sample" || !project.draftText.trim() || isChecking) return;
    setIsChecking(true);
    setCheckingStage(0);
    for (let stage = 1; stage < 4; stage += 1) {
      await wait(230);
      setCheckingStage(stage);
    }
    const result = await runMockDraftCheck(project.draftText, project.selectedSectionId);
    setProject((current) => ({
      ...current,
      draftResult: result,
      checkedDraftText: current.draftText,
    }));
    setIsChecking(false);
    showNotice({ tone: "info", message: "Deterministic demo check complete. Treat the signals as prompts, not a grade." });
  }

  function saveUploadedReview(review: UploadedCriterionReview) {
    setProject((current) => ({
      ...current,
      uploadedCriterionReviews: [
        ...current.uploadedCriterionReviews.filter((item) => item.criterionId !== review.criterionId),
        review,
      ],
    }));
    showNotice({ tone: "success", message: "Self-check saved locally. It records your judgment; it does not validate the paragraph." });
  }

  function toggleReadiness(id: string) {
    setProject((current) => ({
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
      <UploadSummaryView
        result={uploadResult}
        onBack={() => {
          setUploadResult(null);
          setUploadStatus("idle");
        }}
        onCreateProject={createLocalProject}
      />
    );
  }

  if (project.projectKind === "none") {
    return (
      <WelcomeScreen
        onTrySample={loadSample}
        onFiles={handleFiles}
        isLoadingSample={isLoadingSample}
        uploadStatus={uploadStatus}
        uploadError={uploadError}
      />
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
    activeView = <RubricView analysis={SAMPLE_ASSIGNMENT} draftResult={project.draftResult} plan={plan} onOpenEvidence={setSelectedEvidenceId} />;
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
        onDraftChange={(draftText) => setProject((current) => ({ ...current, draftText }))}
        onSectionChange={(selectedSectionId) => setProject((current) => ({ ...current, selectedSectionId, draftResult: null, checkedDraftText: null }))}
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
        draftResult={project.draftResult}
        readinessChecks={project.readinessChecks}
        onToggleReadiness={toggleReadiness}
        onContinue={navigate}
      />
    );
  }

  const stepStates = uploaded
    ? uploadedStepStates(project, plan.completionPercent)
    : sampleStepStates(project, plan.completionPercent);
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
      {notice ? (
        <div className={`toast ${notice.tone}`} role="status" data-testid="toast">
          <Check aria-hidden="true" />{notice.message}
        </div>
      ) : null}
    </>
  );
}
