"use client";

import { useRef } from "react";
import { AlertTriangle, ArrowRight, CalendarClock, Check, CheckCircle2, CircleDashed, FileWarning, ShieldCheck } from "lucide-react";
import type { ActionPlan, AssignmentAnalysis, DraftCheckResult } from "@/lib/domain";
import { daysBetween } from "@/lib/plan";
import { SAMPLE_READINESS } from "@/lib/readiness";
import { todayIso } from "@/lib/uploaded-project";

interface ProgressViewProps {
  analysis: AssignmentAnalysis;
  plan: ActionPlan;
  draftResult: DraftCheckResult | null;
  readinessChecks: string[];
  onToggleReadiness: (id: string) => void;
  onContinue: (target: "plan" | "draft") => void;
}

function deadlineStatus(date: string) {
  const days = daysBetween(todayIso(), date.slice(0, 10));
  if (days < 0) return { value: `${Math.abs(days)} days`, label: "overdue", overdue: true };
  if (days === 0) return { value: "Today", label: "deadline", overdue: false };
  return { value: `${days} days`, label: "until deadline", overdue: false };
}

function demoSignalLabel(value: number | null) {
  if (value === null) return "Not checked";
  if (value >= 70) return "Stronger";
  if (value >= 50) return "Some";
  return "Limited";
}

export function ProgressView({ analysis, plan, draftResult, readinessChecks, onToggleReadiness, onContinue }: ProgressViewProps) {
  const readinessTitleRef = useRef<HTMLHeadingElement>(null);
  const completedTasks = plan.tasks.filter((task) => task.completed).length;
  const highPriorityPrompts = draftResult?.feedback.filter((item) => item.severity === "high" && item.kind !== "strength").length ?? 0;
  const nextTask = plan.tasks.find((task) => !task.completed);
  const checksComplete = SAMPLE_READINESS.filter(([id]) => readinessChecks.includes(id)).length;
  const checksRemaining = SAMPLE_READINESS.length - checksComplete;
  const isReady = !nextTask && checksRemaining === 0 && draftResult !== null;
  const needsDraftReview = draftResult === null;
  const deadline = deadlineStatus(analysis.dueAt);
  const statusHeading = isReady
    ? "Ready for final human review."
    : !draftResult
      ? "Not ready yet — the demo signal check has not been run."
      : nextTask
        ? "Not ready yet — complete the remaining plan work."
        : `Not ready yet — ${checksRemaining} human ${checksRemaining === 1 ? "check remains" : "checks remain"}.`;
  const nextActionTitle = nextTask
    ? nextTask.title
    : needsDraftReview
      ? draftResult
        ? "Review the demo prompts against your draft"
        : "Run the demo signal check"
      : "Finish the human submission checklist";
  const nextActionDescription = nextTask?.doneDefinition[0]
    ?? (needsDraftReview
      ? "Use the deterministic prompts as questions, then verify every change against the rubric yourself."
      : `${checksRemaining} human ${checksRemaining === 1 ? "confirmation remains" : "confirmations remain"} before final review.`);

  function focusReadinessChecklist() {
    readinessTitleRef.current?.focus({ preventScroll: true });
    readinessTitleRef.current?.scrollIntoView({ block: "center" });
  }

  return (
    <div className="view-stack progress-view">
      <header className="submission-status">
        <div className={`status-symbol ${isReady ? "ready" : "not-ready"}`} aria-hidden="true">{isReady ? <Check /> : <CircleDashed />}</div>
        <div>
          <p className="eyebrow">Submission readiness</p>
          <h1>{statusHeading}</h1>
          <p>Task completion, deterministic demo signals and your own checklist are kept separate. None of them predicts a grade.</p>
        </div>
      </header>

      <div className="progress-facts">
        <div className={deadline.overdue ? "fact-warning" : ""}><CalendarClock aria-hidden="true" /><span><strong>{deadline.value}</strong>{deadline.label}</span></div>
        <div><CheckCircle2 aria-hidden="true" /><span><strong>{completedTasks} of {plan.tasks.length}</strong>tasks complete</span></div>
        <div><ShieldCheck aria-hidden="true" /><span><strong>{checksComplete} of {SAMPLE_READINESS.length}</strong>readiness checks</span></div>
      </div>

      <section className="coverage-section" aria-labelledby="coverage-title">
        <div className="section-heading compact-heading"><div><p className="eyebrow">Rubric coverage</p><h2 id="coverage-title">Plan work and demo signals are tracked separately</h2></div></div>
        <div className="coverage-table" role="table" aria-label="Plan work and deterministic demo signals by rubric criterion">
          <div className="coverage-table-head mobile-visually-hidden" role="row"><span role="columnheader">Criterion</span><span role="columnheader">Plan work</span><span role="columnheader">Demo signals</span><span role="columnheader">Signal state</span></div>
          {analysis.rubric.map((criterion) => {
            const planned = plan.rubricProgress.find((item) => item.criterionId === criterion.id)?.percent ?? 0;
            const demoSignals = draftResult?.criteria.find((item) => item.criterionId === criterion.id)?.coverage ?? null;
            const signalState = demoSignalLabel(demoSignals);
            const signalStateClass = signalState === "Stronger" ? "evidenced" : signalState.toLowerCase().replace(" ", "-");
            return <div className="coverage-table-row" role="row" key={criterion.id}><span role="cell"><strong>{criterion.name}</strong><small>{criterion.weight}% of rubric</small></span><span role="cell"><i><b style={{ width: `${planned}%` }} /></i>{Math.round(planned)}%</span><span role="cell"><i><b style={{ width: `${demoSignals ?? 0}%` }} /></i>{demoSignals === null ? "—" : `${Math.round(demoSignals)}%`}</span><span role="cell" className={`state-text ${signalStateClass}`}>{signalState}</span></div>;
          })}
        </div>
      </section>

      <div className="progress-columns">
        <section className="risk-register" aria-labelledby="risk-title">
          <div className="section-heading compact-heading"><div><p className="eyebrow">Risk register</p><h2 id="risk-title">What could still cost marks</h2></div></div>
          <ul>
            {plan.capacityRisk ? <li><AlertTriangle aria-hidden="true" /><div><strong>Schedule capacity</strong><p>{plan.capacityRisk.message}</p></div></li> : null}
            <li><FileWarning aria-hidden="true" /><div><strong>{analysis.ambiguities.length} brief questions remain</strong><p>Confirm source count, feasibility assumptions, and how visual labels affect the word count.</p></div></li>
            <li><AlertTriangle aria-hidden="true" /><div><strong>{draftResult ? `${highPriorityPrompts} high-priority demo ${highPriorityPrompts === 1 ? "prompt" : "prompts"}` : "Demo signals not checked"}</strong><p>{draftResult ? "Use the deterministic prompts as questions for your own review." : "Run the sample signal check, then verify every result yourself."}</p></div></li>
          </ul>
        </section>

        <section className="readiness-checklist" aria-labelledby="readiness-title">
          <div className="section-heading compact-heading"><div><p className="eyebrow">Final gate</p><h2 id="readiness-title" ref={readinessTitleRef} tabIndex={-1}>Ready for submission checklist</h2></div><span>{checksComplete}/{SAMPLE_READINESS.length}</span></div>
          <div className="checklist-items">
            {SAMPLE_READINESS.map(([id, label]) => <label key={id}><input type="checkbox" checked={readinessChecks.includes(id)} onChange={() => onToggleReadiness(id)} /><span aria-hidden="true"><Check /></span>{label}</label>)}
          </div>
        </section>
      </div>

      {isReady ? (
        <section className="next-best-action" aria-labelledby="next-action-title">
          <span className="next-number" aria-hidden="true"><Check /></span>
          <div><p className="eyebrow">Tracked workflow complete</p><h2 id="next-action-title">Begin the final human review.</h2><p>Open the actual submission file and verify every requirement before submitting. Demo signals are prompts, not approval or a predicted grade.</p></div>
        </section>
      ) : (
        <section className="next-best-action" aria-labelledby="next-action-title">
          <span className="next-number">01</span>
          <div><p className="eyebrow">Next best action</p><h2 id="next-action-title">{nextActionTitle}</h2><p>{nextActionDescription}</p></div>
          <button
            className="button button-primary"
            type="button"
            onClick={() => {
              if (nextTask) onContinue("plan");
              else if (needsDraftReview) onContinue("draft");
              else focusReadinessChecklist();
            }}
          >
            {nextTask ? "Continue plan" : needsDraftReview ? "Open draft check" : "Review final checklist"} <ArrowRight aria-hidden="true" />
          </button>
        </section>
      )}
    </div>
  );
}
