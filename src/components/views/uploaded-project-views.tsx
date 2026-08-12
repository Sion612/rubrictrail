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
  UPLOADED_REVIEW_MAX_CHARACTERS,
} from "@/lib/uploaded-project";
import type {
  UploadedCriterionReview,
  UploadedProject,
  WorkspaceView,
} from "@/lib/ui-types";

interface UploadedBriefViewProps {
  project: UploadedProject;
  onNavigate: (view: WorkspaceView) => void;
}

export function UploadedBriefView({ project, onNavigate }: UploadedBriefViewProps) {
  const hasCompletePublishedWeights = hasPublishedRubricWeights(project);
  const weightingSummary =
    project.weightingStatus === "complete"
      ? "complete published percentages"
      : project.weightingStatus === "incomplete"
        ? "incomplete published breakdown"
        : "no published percentages recorded";
  return (
    <div className="view-stack uploaded-brief-view">
      <header className="view-header">
        <p className="eyebrow">Brief</p>
        <h1>{project.title}</h1>
        <p>
          These are the planning inputs you confirmed. RubricTrail keeps the trail honest by
          separating source-backed fields from anything you entered yourself.
        </p>
      </header>

      <div className="project-fact-grid">
        <div><span>Deadline</span><strong>{new Intl.DateTimeFormat("en-GB", { dateStyle: "long" }).format(new Date(`${project.dueDate}T12:00:00`))}</strong></div>
        <div><span>Word count</span><strong>{project.wordCount.toLocaleString()} words</strong></div>
        <div><span>Citation style</span><strong>{project.citationStyle}</strong></div>
        <div>
          <span>Rubric</span>
          <strong>
            {project.criteria.length} confirmed criteria · {weightingSummary}
          </strong>
        </div>
      </div>

      <section className="uploaded-source-register" aria-labelledby="source-register-title">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Source register</p>
            <h2 id="source-register-title">Sources used for this project</h2>
          </div>
          <span>{project.extractedWordCount.toLocaleString()} source words</span>
        </div>
        <ul>
          {project.fileNames.map((fileName) => (
            <li key={fileName}><FileText aria-hidden="true" /><span><strong>{fileName}</strong><small>Full source text not stored</small></span></li>
          ))}
        </ul>
      </section>

      <section className="trace-explainer" aria-labelledby="trace-title">
        <div>
          <span className="trace-node"><FileText aria-hidden="true" /></span>
          <h2 id="trace-title">Brief</h2>
          <p>Confirmed constraints</p>
        </div>
        <i aria-hidden="true" />
        <div>
          <span className="trace-node"><Quote aria-hidden="true" /></span>
          <h2>Rubric</h2>
          <p>Exact source excerpts</p>
        </div>
        <i aria-hidden="true" />
        <div>
          <span className="trace-node"><CheckCircle2 aria-hidden="true" /></span>
          <h2>Plan</h2>
          <p>Work with a definition of done</p>
        </div>
      </section>

      <div className="integrity-note">
        <LockKeyhole aria-hidden="true" />
        <p>
          <strong>Local-only project.</strong> Confirmed fields and short excerpts remain in this
          browser until you reset. On a shared computer, reset when you finish.
        </p>
      </div>

      <div className="view-next-action">
        <div>
          <span>Next</span>
          <strong>
            {hasCompletePublishedWeights
              ? "Check every criterion and published percentage against the original rubric."
              : project.weightingStatus === "incomplete"
                ? "Check every recorded percentage and every missing value against the original rubric. Planning remains neutral until the breakdown is complete."
                : "Check every criterion against the original rubric. No percentage weights were recorded."}
          </strong>
        </div>
        <button className="button button-primary" type="button" onClick={() => onNavigate("rubric")}>
          Review rubric <ArrowRight aria-hidden="true" />
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
  const hasCompletePublishedWeights = hasPublishedRubricWeights(project);
  const recordedWeightCount = project.criteria.filter(
    (criterion) => criterion.weight !== null,
  ).length;
  return (
    <div className="view-stack uploaded-rubric-view">
      <header className="view-header split-header">
        <div>
          <p className="eyebrow">Rubric</p>
          <h1>Confirm what earns marks.</h1>
          <p>Each criterion remains attached to its retained source excerpt. Manually added rows are clearly marked.</p>
        </div>
        <div className="header-progress">
          <strong>
            {hasCompletePublishedWeights
              ? "100%"
              : project.weightingStatus === "incomplete"
                ? `${recordedWeightCount}/${project.criteria.length}`
                : project.criteria.length}
          </strong>
          <span>
            {hasCompletePublishedWeights
              ? "published total"
              : project.weightingStatus === "incomplete"
                ? "published weights recorded · incomplete"
                : "criteria · no published weights recorded"}
          </span>
        </div>
      </header>

      <div className="rubric-summary-band">
        <div><strong>{project.criteria.length}</strong><span>criteria</span></div>
        <div><strong>{project.criteria.filter((item) => item.evidence).length}</strong><span>source-linked</span></div>
        <div><strong>{project.criteria.filter((item) => !item.evidence).length}</strong><span>manually confirmed</span></div>
      </div>

      <section className="uploaded-rubric-table" aria-label="Confirmed rubric criteria">
        <div className="uploaded-rubric-head" aria-hidden="true">
          <span>Criterion</span><span>{project.weightingStatus === "none" ? "Weighting" : "Published weight"}</span><span>Status</span><span>Evidence source</span>
        </div>
        {project.criteria.map((criterion, index) => (
          <article key={criterion.id} className="uploaded-rubric-row">
            <div className="criterion-title">
              <span>{index + 1}</span>
              <div>
                <strong>{criterion.name}</strong>
                <small>
                  {hasCompletePublishedWeights
                    ? "Plan effort starts from this published percentage."
                    : project.weightingStatus === "incomplete" && criterion.weight !== null
                      ? "Official percentage recorded; the plan still uses a neutral starting point."
                      : "Neutral planning starting point — not an equal mark value."}
                </small>
              </div>
            </div>
            <strong className={`criterion-weight ${criterion.weight === null ? "not-published" : ""}`}>
              {criterion.weight === null ? "Not recorded" : `${criterion.weight}%`}
            </strong>
            <span className={criterion.evidence ? "verified-state" : "manual-state"}>
              {criterion.evidence ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
              {criterion.evidence ? "Source-linked" : "Manual check"}
            </span>
            <button
              className="evidence-source-button"
              type="button"
              onClick={() => onOpenEvidence(criterion.id)}
              aria-label={`Open source for ${criterion.name}`}
            >
              <span>
                {criterion.evidence?.excerpt ?? "No source excerpt — compare with the original rubric."}
              </span>
              <small>
                {criterion.evidence?.fileName ?? "Manually entered"}
                {criterion.evidence?.page ? ` · p.${criterion.evidence.page}` : ""}
              </small>
            </button>
          </article>
        ))}
      </section>

      <div className="integrity-note">
        <ShieldCheck aria-hidden="true" />
        <p>
          <strong>No inferred scoring.</strong>{" "}
          {hasCompletePublishedWeights
            ? "Published percentages shown here are values you confirmed; none were inferred. RubricTrail does not predict a grade."
            : project.weightingStatus === "incomplete"
              ? "Known official percentages are retained and missing values remain blank. Because the breakdown is incomplete, every criterion uses the same neutral planning baseline."
              : "No grading percentages were recorded. Equal planning effort is a scheduling default only."}
        </p>
      </div>

      <div className="view-next-action">
        <div><span>Next</span><strong>Turn each criterion into visible, scheduled work.</strong></div>
        <button className="button button-primary" type="button" onClick={() => onNavigate("plan")}>
          Build action plan <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

interface UploadedDraftReviewViewProps {
  project: UploadedProject;
  reviews: UploadedCriterionReview[];
  onChange: (review: UploadedCriterionReview) => void;
  onSave: (review: UploadedCriterionReview) => Promise<void>;
  onNavigate: (view: WorkspaceView) => void;
}

export function UploadedDraftReviewView({
  project,
  reviews,
  onChange,
  onSave,
  onNavigate,
}: UploadedDraftReviewViewProps) {
  const [criterionId, setCriterionId] = useState(project.criteria[0]?.id ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [workingReviews, setWorkingReviews] = useState<Record<string, Omit<UploadedCriterionReview, "criterionId" | "updatedAt">>>(
    () => Object.fromEntries(reviews.map((review) => [review.criterionId, {
      draftText: review.draftText,
      evidenceVisible: review.evidenceVisible,
      linkExplained: review.linkExplained,
      sourceTraceable: review.sourceTraceable,
    }])),
  );
  const activeReview = workingReviews[criterionId] ?? {
    draftText: "",
    evidenceVisible: false,
    linkExplained: false,
    sourceTraceable: false,
  };

  function updateActive(patch: Partial<typeof activeReview>) {
    const nextReview = { ...activeReview, ...patch };
    setWorkingReviews((current) => ({
      ...current,
      [criterionId]: nextReview,
    }));
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
          <p className="eyebrow">Check</p>
          <h1>Review your evidence — without a fake score.</h1>
          <p>
            This local checklist records your own judgment. It does not claim to understand the
            quality of the argument or predict a mark.
          </p>
        </div>
        <div className="header-progress"><strong>{completeCount}/{project.criteria.length}</strong><span>criteria self-checked</span></div>
      </header>

      <div className="uploaded-check-grid">
        <section className="draft-review-editor" aria-labelledby="review-editor-title">
          <label>
            <span>Rubric criterion</span>
            <select disabled={isSaving} value={criterionId} onChange={(event) => setCriterionId(event.target.value)}>
              {project.criteria.map((criterion) => (
                <option key={criterion.id} value={criterion.id}>
                  {criterion.name}{criterion.weight !== null ? ` · ${criterion.weight}%` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span id="review-editor-title">Paste the paragraph or notes that support this criterion</span>
            <textarea
              value={activeReview.draftText}
              disabled={isSaving}
              onChange={(event) => updateActive({ draftText: event.target.value })}
              placeholder="Paste your own draft text here…"
              maxLength={UPLOADED_REVIEW_MAX_CHARACTERS}
              aria-describedby="uploaded-review-count"
              data-testid="uploaded-review-text"
            />
          </label>
          <p className="editor-meta" id="uploaded-review-count">
            {activeReview.draftText.length.toLocaleString()} / {UPLOADED_REVIEW_MAX_CHARACTERS.toLocaleString()} characters
          </p>
          {!canSave && activeReview.draftText ? <p className="field-message warning">Add at least 20 characters so the saved note is meaningful.</p> : null}
          <button className="button button-primary button-full" type="button" disabled={!canSave || isSaving} aria-busy={isSaving} onClick={save} data-testid="save-self-check">
            {isSaving ? "Saving self-check…" : "Save self-check"}
          </button>
          <div className="integrity-note compact">
            <LockKeyhole aria-hidden="true" />
            <p><strong>Save checks browser storage.</strong> The criterion counts complete only when the note and all three checks are present.</p>
          </div>
        </section>

        <section className="evidence-self-check" aria-labelledby="evidence-self-check-title">
          <div>
            <p className="eyebrow">Evidence test</p>
            <h2 id="evidence-self-check-title">Can a reviewer follow the trail?</h2>
            <p>Tick only what you can point to in the text above.</p>
          </div>
          <label>
            <input type="checkbox" disabled={isSaving} checked={activeReview.evidenceVisible} onChange={(event) => updateActive({ evidenceVisible: event.target.checked })} />
            <span aria-hidden="true"><Check /></span>
            <div><strong>Evidence is visible</strong><small>A fact, example, calculation or source appears in the paragraph.</small></div>
          </label>
          <label>
            <input type="checkbox" disabled={isSaving} checked={activeReview.linkExplained} onChange={(event) => updateActive({ linkExplained: event.target.checked })} />
            <span aria-hidden="true"><Check /></span>
            <div><strong>The link is explained</strong><small>Your words explain why the evidence helps meet this criterion.</small></div>
          </label>
          <label>
            <input type="checkbox" disabled={isSaving} checked={activeReview.sourceTraceable} onChange={(event) => updateActive({ sourceTraceable: event.target.checked })} />
            <span aria-hidden="true"><Check /></span>
            <div><strong>The source is traceable</strong><small>A reader can find the original source, data or calculation.</small></div>
          </label>
          <div className={`self-check-state ${activeReview.evidenceVisible && activeReview.linkExplained && activeReview.sourceTraceable ? "complete" : "incomplete"}`}>
            {activeReview.evidenceVisible && activeReview.linkExplained && activeReview.sourceTraceable ? <CheckCircle2 aria-hidden="true" /> : <CircleDashed aria-hidden="true" />}
            <div>
              <strong>{activeReview.evidenceVisible && activeReview.linkExplained && activeReview.sourceTraceable ? "All three trail checks selected" : "Self-check still incomplete"}</strong>
              <span>Saving records your selections; it does not validate them automatically.</span>
            </div>
          </div>
        </section>
      </div>

      <div className="view-next-action">
        <div><span>When every criterion has been checked</span><strong>Review remaining work and final submission gates.</strong></div>
        <button className="button button-primary" type="button" onClick={() => onNavigate("progress")}>
          Open progress <ArrowRight aria-hidden="true" />
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
  onContinue: (target: "plan" | "draft") => void;
}

function deadlineStatus(dueDate: string): { value: string; label: string; overdue: boolean } {
  const days = daysBetween(todayIso(), dueDate);
  if (days < 0) return { value: `${Math.abs(days)} days`, label: "overdue", overdue: true };
  if (days === 0) return { value: "Today", label: "deadline", overdue: false };
  return { value: `${days} days`, label: "until deadline", overdue: false };
}

export function UploadedProgressView({
  project,
  plan,
  reviews,
  readinessChecks,
  onToggleReadiness,
  onContinue,
}: UploadedProgressViewProps) {
  const completedTasks = plan.tasks.filter((task) => task.completed).length;
  const completeReviewIds = new Set(
    reviews
      .filter(isConfirmedUploadedReview)
      .map((review) => review.criterionId),
  );
  const checksComplete = UPLOADED_READINESS.filter(([id]) => readinessChecks.includes(id)).length;
  const allCriteriaReviewed = project.criteria.every((criterion) => completeReviewIds.has(criterion.id));
  const ready = plan.completionPercent === 100 && allCriteriaReviewed && checksComplete === UPLOADED_READINESS.length;
  const deadline = deadlineStatus(project.dueDate);
  const nextTask = plan.tasks.find((task) => !task.completed);
  const nextUnchecked = project.criteria.find((criterion) => !completeReviewIds.has(criterion.id));
  const checklistIncomplete = checksComplete < UPLOADED_READINESS.length;
  const nextHeading = nextTask?.title ?? (nextUnchecked
    ? `Self-check ${nextUnchecked.name}`
    : checklistIncomplete
      ? "Finish the human submission checklist"
      : "All tracked gates are complete");
  const nextDescription = nextTask?.doneDefinition[0] ?? (nextUnchecked
    ? "Paste the relevant draft text and verify its evidence trail."
    : checklistIncomplete
      ? "Confirm each final gate against the actual file you will submit."
      : "Carry out one final human review of the actual submission file.");

  function continueNextAction() {
    if (nextTask) {
      onContinue("plan");
      return;
    }
    if (nextUnchecked) {
      onContinue("draft");
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
          <p className="eyebrow">Submission readiness</p>
          <h1>{ready ? "Ready for final human review." : "Not ready yet — the remaining work is visible below."}</h1>
          <p>RubricTrail reports only completed tasks, saved self-checks and checklist answers. It does not predict a grade.</p>
        </div>
      </header>

      <div className="progress-facts">
        <div className={deadline.overdue ? "fact-warning" : ""}><CalendarClock aria-hidden="true" /><span><strong>{deadline.value}</strong>{deadline.label}</span></div>
        <div><CheckCircle2 aria-hidden="true" /><span><strong>{completedTasks} of {plan.tasks.length}</strong>tasks complete</span></div>
        <div><ShieldCheck aria-hidden="true" /><span><strong>{completeReviewIds.size} of {project.criteria.length}</strong>criteria self-checked</span></div>
      </div>

      <section className="uploaded-coverage-section" aria-labelledby="uploaded-coverage-title">
        <div className="section-heading compact-heading">
          <div><p className="eyebrow">Rubric trail</p><h2 id="uploaded-coverage-title">Plan work and self-checks stay separate</h2></div>
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
                      ? "No published weight recorded"
                      : project.weightingStatus === "complete"
                        ? `${criterion.weight}% of rubric`
                        : `${criterion.weight}% published · neutral plan`}
                  </span>
                </div>
                <div className="coverage-metric">
                  <span>Plan work complete</span>
                  <progress aria-label={`${criterion.name} plan work complete`} max="100" value={planned}>{Math.round(planned)}%</progress>
                  <strong>{Math.round(planned)}%</strong>
                </div>
                <div className={`review-state ${reviewed ? "complete" : "not-started"}`}>
                  {reviewed ? <CheckCircle2 aria-hidden="true" /> : <CircleDashed aria-hidden="true" />}
                  <span>{reviewed ? "Self-check saved" : "Not fully self-checked"}</span>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <div className="progress-columns">
        <section className="risk-register" aria-labelledby="uploaded-risk-title">
          <div className="section-heading compact-heading"><div><p className="eyebrow">Open risks</p><h2 id="uploaded-risk-title">What still needs attention</h2></div></div>
          <ul>
            {plan.capacityRisk ? <li><AlertTriangle aria-hidden="true" /><div><strong>Schedule capacity</strong><p>{plan.capacityRisk.message}</p></div></li> : null}
            {nextUnchecked ? <li><FileCheck2 aria-hidden="true" /><div><strong>{nextUnchecked.name} is not self-checked</strong><p>Save real draft evidence and complete the three trail questions.</p></div></li> : null}
            {project.criteria.some((criterion) => !criterion.evidence) ? <li><Link2 aria-hidden="true" /><div><strong>Manual rubric entries exist</strong><p>Compare them with the original rubric before final submission.</p></div></li> : null}
            {!plan.capacityRisk && !nextUnchecked && project.criteria.every((criterion) => criterion.evidence) ? <li><CheckCircle2 aria-hidden="true" /><div><strong>No tracked evidence risks</strong><p>Complete the human checklist before submitting.</p></div></li> : null}
          </ul>
        </section>

        <section className="readiness-checklist" aria-labelledby="uploaded-readiness-title">
          <div className="section-heading compact-heading"><div><p className="eyebrow">Final gate</p><h2 id="uploaded-readiness-title" tabIndex={-1}>Human submission checklist</h2></div><span>{checksComplete}/{UPLOADED_READINESS.length}</span></div>
          <div className="checklist-items">
            {UPLOADED_READINESS.map(([id, label]) => (
              <label key={id}>
                <input type="checkbox" checked={readinessChecks.includes(id)} onChange={() => onToggleReadiness(id)} />
                <span aria-hidden="true"><Check /></span>{label}
              </label>
            ))}
          </div>
        </section>
      </div>

      <section className="next-best-action" aria-labelledby="uploaded-next-action-title">
        <span className="next-number">01</span>
        <div>
          <p className="eyebrow">Next best action</p>
          <h2 id="uploaded-next-action-title">{nextHeading}</h2>
          <p>{nextDescription}</p>
        </div>
        {!ready ? (
          <button className="button button-primary" type="button" onClick={continueNextAction}>
            {checklistIncomplete && !nextTask && !nextUnchecked ? "Open final checklist" : "Continue next action"} <ArrowRight aria-hidden="true" />
          </button>
        ) : <CheckCircle2 aria-label="Tracked gates complete" />}
      </section>
    </div>
  );
}
