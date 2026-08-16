"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleDashed,
  FileCheck2,
  FileText,
  Link2,
  LockKeyhole,
  Quote,
  ShieldCheck,
} from "lucide-react";
import type { ActionPlan } from "@/lib/domain";
import { daysBetween } from "@/lib/plan";
import { UPLOADED_READINESS } from "@/lib/readiness";
import {
  hasPublishedRubricWeights,
  isConfirmedUploadedReview,
  todayIso,
  uploadedCriterionSourceState,
  UPLOADED_REVIEW_MAX_CHARACTERS,
} from "@/lib/uploaded-project";
import type {
  UploadedCriterionReview,
  UploadedProject,
  WorkspaceView,
} from "@/lib/ui-types";
import { useI18n, useLocalizedMessages } from "@/components/locale-provider";
import {
  interpolateViewMessage,
  localizeSystemText,
  uploadedMessagesEn,
  uploadedMessagesZhCN,
  uploadedReadinessZhCN,
} from "@/lib/i18n/messages/views";

interface UploadedBriefViewProps {
  project: UploadedProject;
  onNavigate: (view: WorkspaceView) => void;
}

export function UploadedBriefView({ project, onNavigate }: UploadedBriefViewProps) {
  const messages = useLocalizedMessages(uploadedMessagesEn, uploadedMessagesZhCN);
  const { formatDate, formatNumber } = useI18n();
  const hasCompletePublishedWeights = hasPublishedRubricWeights(project);
  const weightingSummary =
    project.weightingStatus === "complete"
      ? messages.completeWeights
      : project.weightingStatus === "incomplete"
        ? messages.incompleteWeights
        : messages.noWeights;
  const sourceDescription = (source: NonNullable<UploadedProject["sources"]>[number]) => {
    if (source.intakeMethod === "paste") return messages.sourcePastedKind;
    if (source.kind === "pdf") {
      return interpolateViewMessage(messages.sourcePdfPages, {
        count: formatNumber(source.pageCount ?? 0),
      });
    }
    return interpolateViewMessage(
      source.origin === "ocr" ? messages.sourceOcrKind : messages.sourceExtractedKind,
      { kind: source.kind.toUpperCase() },
    );
  };
  return (
    <div className="view-stack uploaded-brief-view">
      <header className="view-header">
        <p className="eyebrow">{messages.brief}</p>
        <h1>{project.title}</h1>
        <p>{messages.briefDescription}</p>
      </header>

      <div className="project-fact-grid">
        <div><span>{messages.deadline}</span><strong>{formatDate(new Date(`${project.dueDate}T12:00:00`), { dateStyle: "long" })}</strong></div>
        <div><span>{messages.wordCount}</span><strong>{interpolateViewMessage(messages.words, { count: formatNumber(project.wordCount) })}</strong></div>
        <div><span>{messages.citationStyle}</span><strong>{project.citationStyle}</strong></div>
        <div>
          <span>{messages.rubric}</span>
          <strong>
            {interpolateViewMessage(messages.criteriaSummary, { count: formatNumber(project.criteria.length), weighting: weightingSummary })}
          </strong>
        </div>
      </div>

      <section className="uploaded-source-register" aria-labelledby="source-register-title">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">{messages.sourceRegister}</p>
            <h2 id="source-register-title">{messages.sourcesTitle}</h2>
          </div>
          <span>{interpolateViewMessage(messages.sourceWords, { count: formatNumber(project.extractedWordCount) })}</span>
        </div>
        <ul>
          {project.sources
            ? project.sources.map((source) => (
                <li key={source.id}>
                  <FileText aria-hidden="true" />
                  <span>
                    <strong>{source.fileName}</strong>
                    <small>{sourceDescription(source)} · {messages.sourceNotStored}</small>
                  </span>
                </li>
              ))
            : project.fileNames.map((fileName, index) => (
                <li key={`${index}:${fileName}`}><FileText aria-hidden="true" /><span><strong>{fileName}</strong><small>{messages.sourceNotStored}</small></span></li>
              ))}
        </ul>
      </section>

      <section className="trace-explainer" aria-labelledby="trace-title">
        <div>
          <span className="trace-node"><FileText aria-hidden="true" /></span>
          <h2 id="trace-title">{messages.brief}</h2>
          <p>{messages.confirmedConstraints}</p>
        </div>
        <i aria-hidden="true" />
        <div>
          <span className="trace-node"><Quote aria-hidden="true" /></span>
          <h2>{messages.rubric}</h2>
          <p>{messages.recordedExcerpts}</p>
        </div>
        <i aria-hidden="true" />
        <div>
          <span className="trace-node"><CheckCircle2 aria-hidden="true" /></span>
          <h2>{messages.plan}</h2>
          <p>{messages.definitionDone}</p>
        </div>
      </section>

      <div className="integrity-note">
        <LockKeyhole aria-hidden="true" />
        <p><strong>{messages.localProject}</strong> {messages.localDescription}</p>
      </div>

      <div className="view-next-action">
        <div>
          <span>{messages.next}</span>
          <strong>
            {hasCompletePublishedWeights
              ? messages.nextCompleteWeights
              : project.weightingStatus === "incomplete"
                ? messages.nextIncompleteWeights
                : messages.nextNoWeights}
          </strong>
        </div>
        <button className="button button-primary" type="button" onClick={() => onNavigate("rubric")}>
          {messages.reviewRubric} <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

interface UploadedRubricViewProps {
  project: UploadedProject;
  onOpenEvidence: (criterionId: string) => void;
  onNavigate: (view: WorkspaceView) => void;
}

export function UploadedRubricView({
  project,
  onOpenEvidence,
  onNavigate,
}: UploadedRubricViewProps) {
  const messages = useLocalizedMessages(uploadedMessagesEn, uploadedMessagesZhCN);
  const { formatNumber } = useI18n();
  const hasCompletePublishedWeights = hasPublishedRubricWeights(project);
  const recordedWeightCount = project.criteria.filter(
    (criterion) => criterion.weight !== null,
  ).length;
  const sourceStates = project.criteria.map((criterion) =>
    uploadedCriterionSourceState(project, criterion),
  );
  const retainedCount = sourceStates.filter((state) => state.kind === "retained").length;
  const manualLocatorCount = sourceStates.filter((state) => state.kind === "manual").length;
  const unlinkedCount = sourceStates.filter((state) => state.kind === "none").length;
  return (
    <div className="view-stack uploaded-rubric-view">
      <header className="view-header split-header">
        <div>
          <p className="eyebrow">{messages.rubric}</p>
          <h1>{messages.rubricTitle}</h1>
          <p>{messages.rubricDescription}</p>
        </div>
        <div className="header-progress">
          <strong>
            {hasCompletePublishedWeights
              ? "100%"
              : project.weightingStatus === "incomplete"
                ? `${formatNumber(recordedWeightCount)}/${formatNumber(project.criteria.length)}`
                : formatNumber(project.criteria.length)}
          </strong>
          <span>
            {hasCompletePublishedWeights
                ? messages.publishedTotal
                : project.weightingStatus === "incomplete"
                ? messages.recordedIncomplete
                : messages.criteriaNoWeights}
          </span>
        </div>
      </header>

      <div className="rubric-summary-band">
        <div><strong>{formatNumber(project.criteria.length)}</strong><span>{messages.criteria}</span></div>
        <div><strong>{formatNumber(retainedCount)}</strong><span>{messages.sourceLinked}</span></div>
        <div><strong>{formatNumber(manualLocatorCount)}</strong><span>{messages.manuallyConfirmed}</span></div>
        <div><strong>{formatNumber(unlinkedCount)}</strong><span>{messages.sourceUnlinked}</span></div>
      </div>

      <section className="uploaded-rubric-table" aria-label={messages.rubricAria}>
        <div className="uploaded-rubric-head" aria-hidden="true">
          <span>{messages.criterion}</span><span>{project.weightingStatus === "none" ? messages.weighting : messages.publishedWeight}</span><span>{messages.status}</span><span>{messages.evidenceSource}</span>
        </div>
        {project.criteria.map((criterion, index) => {
          const sourceState = sourceStates[index];
          const manualLocator = criterion.manualSourceLocator ?? null;
          const manualSource = sourceState.kind === "manual" ? sourceState.source : null;
          return (
          <article key={criterion.id} className="uploaded-rubric-row">
            <div className="criterion-title">
              <span>{formatNumber(index + 1)}</span>
              <div>
                <strong>{criterion.name}</strong>
                <small>
                  {hasCompletePublishedWeights
                    ? messages.publishedEffort
                    : project.weightingStatus === "incomplete" && criterion.weight !== null
                      ? messages.recordedNeutral
                      : messages.neutral}
                </small>
              </div>
            </div>
            <strong className={`criterion-weight ${criterion.weight === null ? "not-published" : ""}`}>
              {criterion.weight === null ? messages.notRecorded : `${formatNumber(criterion.weight)}%`}
            </strong>
            <span className={sourceState.kind === "retained" ? "verified-state" : "manual-state"}>
              {sourceState.kind === "retained" ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
              {sourceState.kind === "retained"
                ? messages.sourceLinkedState
                : sourceState.kind === "manual"
                  ? messages.manualLocatorState
                  : messages.noSourceState}
            </span>
            <button
              className="evidence-source-button"
              type="button"
              onClick={() => onOpenEvidence(criterion.id)}
              aria-label={interpolateViewMessage(messages.openSource, { criterion: criterion.name })}
            >
              <span>
                {criterion.evidence?.excerpt ??
                  (sourceState.kind === "manual"
                    ? messages.manualLocatorPreview
                    : messages.noSourcePreview)}
              </span>
              <small>
                {criterion.evidence?.fileName ?? manualSource?.fileName ?? messages.manuallyEntered}
                {criterion.evidence?.page ?? manualLocator?.page
                  ? ` · ${interpolateViewMessage(messages.page, {
                      page: formatNumber(
                        criterion.evidence?.page ?? manualLocator?.page ?? 0,
                      ),
                    })}`
                  : ""}
              </small>
            </button>
          </article>
          );
        })}
      </section>

      <div className="integrity-note">
        <ShieldCheck aria-hidden="true" />
        <p>
          <strong>{messages.noInferred}</strong>{" "}
          {hasCompletePublishedWeights
            ? messages.noInferredComplete
            : project.weightingStatus === "incomplete"
              ? messages.noInferredIncomplete
              : messages.noInferredNone}
        </p>
      </div>

      <div className="view-next-action">
        <div><span>{messages.next}</span><strong>{messages.scheduledWork}</strong></div>
        <button className="button button-primary" type="button" onClick={() => onNavigate("plan")}>
          {messages.buildPlan} <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

interface UploadedDraftReviewViewProps {
  project: UploadedProject;
  reviews: UploadedCriterionReview[];
  initialCriterionId?: string | null;
  onChange: (review: UploadedCriterionReview) => void;
  onSave: (review: UploadedCriterionReview) => Promise<void>;
  onNavigate: (view: WorkspaceView) => void;
}

export function UploadedDraftReviewView({
  project,
  reviews,
  initialCriterionId = null,
  onChange,
  onSave,
  onNavigate,
}: UploadedDraftReviewViewProps) {
  const messages = useLocalizedMessages(uploadedMessagesEn, uploadedMessagesZhCN);
  const { formatNumber } = useI18n();
  const criteriaKey = project.criteria.map((criterion) => criterion.id).join("\u0000");
  const [selection, setSelection] = useState(() => ({
    criteriaKey,
    initialCriterionId,
    criterionId: project.criteria.some(
      (criterion) => criterion.id === initialCriterionId,
    )
      ? (initialCriterionId ?? "")
      : (project.criteria[0]?.id ?? ""),
  }));
  const [isSaving, setIsSaving] = useState(false);
  const contextChanged =
    selection.criteriaKey !== criteriaKey ||
    selection.initialCriterionId !== initialCriterionId;
  const requestedCriterionId = contextChanged
    ? initialCriterionId
    : selection.criterionId;
  const criterionId = project.criteria.some(
    (criterion) => criterion.id === requestedCriterionId,
  )
    ? (requestedCriterionId ?? "")
    : (project.criteria[0]?.id ?? "");

  const parentReview = reviews.find((review) => review.criterionId === criterionId);
  const activeReview = {
    draftText: parentReview?.draftText ?? "",
    evidenceVisible: parentReview?.evidenceVisible ?? false,
    linkExplained: parentReview?.linkExplained ?? false,
    sourceTraceable: parentReview?.sourceTraceable ?? false,
  };

  function updateActive(patch: Partial<typeof activeReview>) {
    const nextReview = { ...activeReview, ...patch };
    onChange({
      criterionId,
      ...nextReview,
      updatedAt: null,
    });
  }

  const validCriterionIds = new Set(project.criteria.map((criterion) => criterion.id));
  const completeCount = new Set(
    reviews
      .filter(
        (review) =>
          validCriterionIds.has(review.criterionId) &&
          isConfirmedUploadedReview(review),
      )
      .map((review) => review.criterionId),
  ).size;
  const canSave = activeReview.draftText.trim().length >= 20;
  const showMinimumWarning = !canSave && Boolean(activeReview.draftText);

  async function save() {
    if (!canSave || isSaving) return;
    setIsSaving(true);
    try {
      await onSave({
        criterionId,
        draftText: activeReview.draftText.trim(),
        evidenceVisible: activeReview.evidenceVisible,
        linkExplained: activeReview.linkExplained,
        sourceTraceable: activeReview.sourceTraceable,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="view-stack uploaded-check-view">
      <header className="view-header split-header">
        <div>
          <p className="eyebrow">{messages.check}</p>
          <h1>{messages.checkTitle}</h1>
          <p>{messages.checkDescription}</p>
        </div>
        <div className="header-progress"><strong>{formatNumber(completeCount)}/{formatNumber(project.criteria.length)}</strong><span>{messages.selfChecked}</span></div>
      </header>

      <div className="uploaded-check-grid">
        <section className="draft-review-editor" aria-labelledby="review-editor-title">
          <label>
            <span>{messages.rubricCriterion}</span>
            <select
              disabled={isSaving}
              value={criterionId}
              onChange={(event) => setSelection({
                criteriaKey,
                initialCriterionId,
                criterionId: event.target.value,
              })}
            >
              {project.criteria.map((criterion) => (
                <option key={criterion.id} value={criterion.id}>
                  {criterion.name}{criterion.weight !== null ? ` · ${formatNumber(criterion.weight)}%` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span id="review-editor-title">{messages.pasteSupport}</span>
            <textarea
              value={activeReview.draftText}
              disabled={isSaving}
              onChange={(event) => updateActive({ draftText: event.target.value })}
              placeholder={messages.pastePlaceholder}
              maxLength={UPLOADED_REVIEW_MAX_CHARACTERS}
              aria-describedby={`uploaded-review-count${showMinimumWarning ? " uploaded-review-minimum" : ""}`}
              data-testid="uploaded-review-text"
            />
          </label>
          <p className="editor-meta" id="uploaded-review-count">
            {interpolateViewMessage(messages.characterCount, { count: formatNumber(activeReview.draftText.length), maximum: formatNumber(UPLOADED_REVIEW_MAX_CHARACTERS) })}
          </p>
          {showMinimumWarning ? <p className="field-message warning" id="uploaded-review-minimum">{messages.addTwenty}</p> : null}
          <button className="button button-primary button-full" type="button" disabled={!canSave || isSaving} aria-busy={isSaving} aria-describedby={showMinimumWarning ? "uploaded-review-minimum" : undefined} onClick={save} data-testid="save-self-check">
            {isSaving ? messages.saving : messages.save}
          </button>
          <div className="integrity-note compact">
            <LockKeyhole aria-hidden="true" />
            <p><strong>{messages.storageTitle}</strong> {messages.storageDescription}</p>
          </div>
        </section>

        <section className="evidence-self-check" aria-labelledby="evidence-self-check-title">
          <div>
            <p className="eyebrow">{messages.evidenceTest}</p>
            <h2 id="evidence-self-check-title">{messages.followTrail}</h2>
            <p>{messages.tickOnly}</p>
          </div>
          <label>
            <input type="checkbox" disabled={isSaving} checked={activeReview.evidenceVisible} onChange={(event) => updateActive({ evidenceVisible: event.target.checked })} />
            <span aria-hidden="true"><Check /></span>
            <div><strong>{messages.visibleTitle}</strong><small>{messages.visibleDescription}</small></div>
          </label>
          <label>
            <input type="checkbox" disabled={isSaving} checked={activeReview.linkExplained} onChange={(event) => updateActive({ linkExplained: event.target.checked })} />
            <span aria-hidden="true"><Check /></span>
            <div><strong>{messages.explainedTitle}</strong><small>{messages.explainedDescription}</small></div>
          </label>
          <label>
            <input type="checkbox" disabled={isSaving} checked={activeReview.sourceTraceable} onChange={(event) => updateActive({ sourceTraceable: event.target.checked })} />
            <span aria-hidden="true"><Check /></span>
            <div><strong>{messages.traceableTitle}</strong><small>{messages.traceableDescription}</small></div>
          </label>
          <div className={`self-check-state ${activeReview.evidenceVisible && activeReview.linkExplained && activeReview.sourceTraceable ? "complete" : "incomplete"}`}>
            {activeReview.evidenceVisible && activeReview.linkExplained && activeReview.sourceTraceable ? <CheckCircle2 aria-hidden="true" /> : <CircleDashed aria-hidden="true" />}
            <div>
              <strong>{activeReview.evidenceVisible && activeReview.linkExplained && activeReview.sourceTraceable ? messages.allSelected : messages.incomplete}</strong>
              <span>{messages.selectionDisclaimer}</span>
            </div>
          </div>
        </section>
      </div>

      <div className="view-next-action">
        <div><span>{messages.everyCriterion}</span><strong>{messages.remainingWork}</strong></div>
        <button className="button button-primary" type="button" onClick={() => onNavigate("progress")}>
          {messages.openProgress} <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

interface UploadedProgressViewProps {
  project: UploadedProject;
  plan: ActionPlan;
  reviews: UploadedCriterionReview[];
  readinessChecks: string[];
  onToggleReadiness: (id: string) => void;
  onContinue: (target: "plan" | "draft", criterionId?: string) => void;
}

export function UploadedProgressView({
  project,
  plan,
  reviews,
  readinessChecks,
  onToggleReadiness,
  onContinue,
}: UploadedProgressViewProps) {
  const messages = useLocalizedMessages(uploadedMessagesEn, uploadedMessagesZhCN);
  const { locale, formatNumber } = useI18n();
  const completedTasks = plan.tasks.filter((task) => task.completed).length;
  const completeReviewIds = new Set(
    reviews
      .filter(isConfirmedUploadedReview)
      .map((review) => review.criterionId),
  );
  const checksComplete = UPLOADED_READINESS.filter(([id]) => readinessChecks.includes(id)).length;
  const allCriteriaReviewed = project.criteria.every((criterion) => completeReviewIds.has(criterion.id));
  const ready = plan.completionPercent === 100 && allCriteriaReviewed && checksComplete === UPLOADED_READINESS.length;
  const deadlineDays = daysBetween(todayIso(), project.dueDate);
  const deadline = deadlineDays < 0
    ? { value: interpolateViewMessage(messages.days, { count: formatNumber(Math.abs(deadlineDays)) }), label: messages.overdue, overdue: true }
    : deadlineDays === 0
      ? { value: messages.today, label: messages.deadlineLabel, overdue: false }
      : { value: interpolateViewMessage(messages.days, { count: formatNumber(deadlineDays) }), label: messages.untilDeadline, overdue: false };
  const nextTask = plan.tasks.find((task) => !task.completed);
  const nextUnchecked = project.criteria.find((criterion) => !completeReviewIds.has(criterion.id));
  const manualLocatorCriteria = project.criteria.filter(
    (criterion) => uploadedCriterionSourceState(project, criterion).kind === "manual",
  );
  const unlinkedCriteria = project.criteria.filter(
    (criterion) => uploadedCriterionSourceState(project, criterion).kind === "none",
  );
  const checklistIncomplete = checksComplete < UPLOADED_READINESS.length;
  const nextHeading = nextTask ? localizeSystemText(nextTask.title, locale) : (nextUnchecked
    ? interpolateViewMessage(messages.selfCheckCriterion, { criterion: nextUnchecked.name })
    : checklistIncomplete
      ? messages.finishChecklist
      : messages.allGates);
  const nextDescription = nextTask ? localizeSystemText(nextTask.doneDefinition[0], locale) : (nextUnchecked
    ? messages.pasteVerify
    : checklistIncomplete
      ? messages.confirmFinalGate
      : messages.finalReview);

  function continueNextAction() {
    if (nextTask) {
      onContinue("plan");
      return;
    }
    if (nextUnchecked) {
      onContinue("draft", nextUnchecked.id);
      return;
    }
    document.getElementById("uploaded-readiness-title")?.focus({ preventScroll: true });
    document.getElementById("uploaded-readiness-title")?.scrollIntoView({ block: "center" });
  }

  return (
    <div className="view-stack uploaded-progress-view">
      <header className="submission-status">
        <div className={`status-symbol ${ready ? "ready" : "not-ready"}`} aria-hidden="true">
          {ready ? <Check /> : <CircleDashed />}
        </div>
        <div>
          <p className="eyebrow">{messages.submissionReadiness}</p>
          <h1>{ready ? messages.ready : messages.notReady}</h1>
          <p>{messages.readinessDescription}</p>
        </div>
      </header>

      <div className="progress-facts">
        <div className={deadline.overdue ? "fact-warning" : ""}><CalendarClock aria-hidden="true" /><span><strong>{deadline.value}</strong>{deadline.label}</span></div>
        <div><CheckCircle2 aria-hidden="true" /><span><strong>{interpolateViewMessage(messages.tasksComplete, { completed: formatNumber(completedTasks), total: formatNumber(plan.tasks.length) })}</strong></span></div>
        <div><ShieldCheck aria-hidden="true" /><span><strong>{interpolateViewMessage(messages.criteriaChecked, { completed: formatNumber(completeReviewIds.size), total: formatNumber(project.criteria.length) })}</strong></span></div>
      </div>

      <section className="uploaded-coverage-section" aria-labelledby="uploaded-coverage-title">
        <div className="section-heading compact-heading">
          <div><p className="eyebrow">{messages.rubricTrail}</p><h2 id="uploaded-coverage-title">{messages.separate}</h2></div>
        </div>
        <div className="uploaded-coverage-cards">
          {project.criteria.map((criterion) => {
            const planned = plan.rubricProgress.find((item) => item.criterionId === criterion.id)?.percent ?? 0;
            const reviewed = completeReviewIds.has(criterion.id);
            return (
              <article key={criterion.id}>
                <div>
                  <strong>{criterion.name}</strong>
                  <span>
                    {criterion.weight === null
                      ? messages.noWeightRecorded
                      : project.weightingStatus === "complete"
                        ? interpolateViewMessage(messages.weightOfRubric, { weight: formatNumber(criterion.weight) })
                        : interpolateViewMessage(messages.publishedNeutral, { weight: formatNumber(criterion.weight) })}
                  </span>
                </div>
                <div className="coverage-metric">
                  <span>{messages.planComplete}</span>
                  <progress aria-label={interpolateViewMessage(messages.planCompleteAria, { criterion: criterion.name })} max="100" value={planned}>{formatNumber(Math.round(planned))}%</progress>
                  <strong>{formatNumber(Math.round(planned))}%</strong>
                </div>
                <div className={`review-state ${reviewed ? "complete" : "not-started"}`}>
                  {reviewed ? <CheckCircle2 aria-hidden="true" /> : <CircleDashed aria-hidden="true" />}
                  <span>{reviewed ? messages.selfCheckSaved : messages.notFullyChecked}</span>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <div className="progress-columns">
        <section className="risk-register" aria-labelledby="uploaded-risk-title">
          <div className="section-heading compact-heading"><div><p className="eyebrow">{messages.openRisks}</p><h2 id="uploaded-risk-title">{messages.attention}</h2></div></div>
          <ul>
            {plan.capacityRisk ? <li><AlertTriangle aria-hidden="true" /><div><strong>{messages.scheduleCapacity}</strong><p>{localizeSystemText(plan.capacityRisk.message, locale)}</p></div></li> : null}
            {nextUnchecked ? <li><FileCheck2 aria-hidden="true" /><div><strong>{interpolateViewMessage(messages.criterionUnchecked, { criterion: nextUnchecked.name })}</strong><p>{messages.saveRealEvidence}</p></div></li> : null}
            {manualLocatorCriteria.length ? <li><Link2 aria-hidden="true" /><div><strong>{messages.manualLocatorRisk}</strong><p>{messages.manualLocatorRiskDescription}</p></div></li> : null}
            {unlinkedCriteria.length ? <li><AlertTriangle aria-hidden="true" /><div><strong>{messages.unlinkedRisk}</strong><p>{messages.unlinkedRiskDescription}</p></div></li> : null}
            {!plan.capacityRisk && !nextUnchecked && !manualLocatorCriteria.length && !unlinkedCriteria.length ? <li><CheckCircle2 aria-hidden="true" /><div><strong>{messages.noEvidenceRisks}</strong><p>{messages.completeHumanChecklist}</p></div></li> : null}
          </ul>
        </section>

        <section className="readiness-checklist" aria-labelledby="uploaded-readiness-title">
          <div className="section-heading compact-heading"><div><p className="eyebrow">{messages.finalGate}</p><h2 id="uploaded-readiness-title" tabIndex={-1}>{messages.humanChecklist}</h2></div><span>{formatNumber(checksComplete)}/{formatNumber(UPLOADED_READINESS.length)}</span></div>
          <div className="checklist-items">
            {UPLOADED_READINESS.map(([id, label]) => (
              <label key={id}>
                <input type="checkbox" checked={readinessChecks.includes(id)} onChange={() => onToggleReadiness(id)} />
                <span aria-hidden="true"><Check /></span>{locale === "zh-CN" ? uploadedReadinessZhCN[id] : label}
              </label>
            ))}
          </div>
        </section>
      </div>

      <section className="next-best-action" aria-labelledby="uploaded-next-action-title">
        <span className="next-number">01</span>
        <div>
          <p className="eyebrow">{messages.nextBest}</p>
          <h2 id="uploaded-next-action-title">{nextHeading}</h2>
          <p>{nextDescription}</p>
        </div>
        {!ready ? (
          <button className="button button-primary" type="button" onClick={continueNextAction}>
            {checklistIncomplete && !nextTask && !nextUnchecked ? messages.openFinalChecklist : messages.continueNext} <ArrowRight aria-hidden="true" />
          </button>
        ) : <CheckCircle2 aria-label={messages.gatesComplete} />}
      </section>
    </div>
  );
}
