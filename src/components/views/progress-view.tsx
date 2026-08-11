"use client";

import { AlertTriangle, ArrowRight, CalendarClock, Check, CheckCircle2, CircleDashed, FileWarning, ShieldCheck } from "lucide-react";
import type { ActionPlan, AssignmentAnalysis, DraftCheckResult } from "@/lib/domain";

interface ProgressViewProps {
  analysis: AssignmentAnalysis;
  plan: ActionPlan;
  draftResult: DraftCheckResult | null;
  readinessChecks: string[];
  onToggleReadiness: (id: string) => void;
  onContinue: (target: "plan" | "draft") => void;
}

const READINESS = [
  ["deliverables", "Every required deliverable is present"],
  ["rubric", "I manually compared every criterion with the final draft"],
  ["logic", "Recommendations follow from the diagnosis"],
  ["sources", "Every material claim has a traceable source"],
  ["format", "Word count, structure, and citation format are checked"],
  ["integrity", "No data, citations, or personal experience are invented"],
  ["proofread", "Final human proofread is complete"],
] as const;

function deadlineStatus(date: string) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(date);
  const days = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return { value: `${Math.abs(days)} days`, label: "overdue", overdue: true };
  if (days === 0) return { value: "Today", label: "deadline", overdue: false };
  return { value: `${days} days`, label: "until deadline", overdue: false };
}

export function ProgressView({ analysis, plan, draftResult, readinessChecks, onToggleReadiness, onContinue }: ProgressViewProps) {
  const completedTasks = plan.tasks.filter((task) => task.completed).length;
  const highIssues = draftResult?.feedback.filter((item) => item.severity === "high" && item.kind !== "strength").length ?? 0;
  const nextTask = plan.tasks.find((task) => !task.completed);
  const checksComplete = READINESS.filter(([id]) => readinessChecks.includes(id)).length;
  const draftSignalsReady = Boolean(
    draftResult &&
    highIssues === 0 &&
    draftResult.criteria.every((criterion) => criterion.coverage >= 70),
  );
  const isReady = plan.completionPercent === 100 && checksComplete === READINESS.length && draftSignalsReady;
  const deadline = deadlineStatus(analysis.dueAt);
  const statusHeading = isReady
    ? "Ready for final human review."
    : !draftResult
      ? "Not ready yet — draft evidence has not been checked."
      : highIssues > 0
        ? `Not ready yet — ${highIssues} high-priority ${highIssues === 1 ? "gap" : "gaps"} remain.`
        : "Not ready yet — complete the remaining plan and human checks.";

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
        <div><ShieldCheck aria-hidden="true" /><span><strong>{checksComplete} of {READINESS.length}</strong>readiness checks</span></div>
      </div>

      <section className="coverage-section" aria-labelledby="coverage-title">
        <div className="section-heading compact-heading"><div><p className="eyebrow">Rubric coverage</p><h2 id="coverage-title">Plan work and draft evidence are tracked separately</h2></div></div>
        <div className="coverage-table" role="table" aria-label="Rubric coverage by criterion">
          <div className="coverage-table-head" role="row"><span role="columnheader">Criterion</span><span role="columnheader">Plan work</span><span role="columnheader">Draft evidence</span><span role="columnheader">State</span></div>
          {analysis.rubric.map((criterion) => {
            const planned = plan.rubricProgress.find((item) => item.criterionId === criterion.id)?.percent ?? 0;
            const drafted = draftResult?.criteria.find((item) => item.criterionId === criterion.id)?.coverage ?? 0;
            const state = drafted >= 70 ? "Evidenced" : drafted > 0 ? "Emerging" : "Not checked";
            return <div className="coverage-table-row" role="row" key={criterion.id}><span role="cell"><strong>{criterion.name}</strong><small>{criterion.weight}% of rubric</small></span><span role="cell"><i><b style={{ width: `${planned}%` }} /></i>{Math.round(planned)}%</span><span role="cell"><i><b style={{ width: `${drafted}%` }} /></i>{Math.round(drafted)}%</span><span role="cell" className={`state-text ${state.toLowerCase().replace(" ", "-")}`}>{state}</span></div>;
          })}
        </div>
      </section>

      <div className="progress-columns">
        <section className="risk-register" aria-labelledby="risk-title">
          <div className="section-heading compact-heading"><div><p className="eyebrow">Risk register</p><h2 id="risk-title">What could still cost marks</h2></div></div>
          <ul>
            {plan.capacityRisk ? <li><AlertTriangle aria-hidden="true" /><div><strong>Schedule capacity</strong><p>{plan.capacityRisk.message}</p></div></li> : null}
            <li><FileWarning aria-hidden="true" /><div><strong>{analysis.ambiguities.length} brief questions remain</strong><p>Confirm source count, feasibility assumptions, and how visual labels affect the word count.</p></div></li>
            <li><AlertTriangle aria-hidden="true" /><div><strong>{draftResult ? `${highIssues} high-priority draft gaps` : "Draft signals not checked"}</strong><p>{draftResult ? "Use the deterministic prompts as questions for your own review." : "Run the sample signal check, then verify every result yourself."}</p></div></li>
          </ul>
        </section>

        <section className="readiness-checklist" aria-labelledby="readiness-title">
          <div className="section-heading compact-heading"><div><p className="eyebrow">Final gate</p><h2 id="readiness-title">Ready for submission checklist</h2></div><span>{checksComplete}/{READINESS.length}</span></div>
          <div className="checklist-items">
            {READINESS.map(([id, label]) => <label key={id}><input type="checkbox" checked={readinessChecks.includes(id)} onChange={() => onToggleReadiness(id)} /><span aria-hidden="true"><Check /></span>{label}</label>)}
          </div>
        </section>
      </div>

      <section className="next-best-action" aria-labelledby="next-action-title">
        <span className="next-number">01</span>
        <div><p className="eyebrow">Next best action</p><h2 id="next-action-title">{nextTask?.title ?? (draftResult ? "Resolve the highest-priority evidence gap" : "Check your analysis section against the rubric")}</h2><p>{nextTask?.doneDefinition[0] ?? "Use the feedback to add traceable evidence in your own words."}</p></div>
        <button className="button button-primary" type="button" onClick={() => onContinue(nextTask ? "plan" : "draft")}>Continue next action <ArrowRight aria-hidden="true" /></button>
      </section>
    </div>
  );
}
