"use client";

import { useRef } from "react";
import { AlertTriangle, ArrowRight, CalendarClock, Check, CheckCircle2, CircleDashed, FileWarning, ShieldCheck } from "lucide-react";
import type { ActionPlan, AssignmentAnalysis, DraftCheckResult } from "@/lib/domain";
import { daysBetween } from "@/lib/plan";
import { SAMPLE_READINESS } from "@/lib/readiness";
import { todayIso } from "@/lib/uploaded-project";
import { useI18n, useLocalizedMessages } from "@/components/locale-provider";
import {
  interpolateViewMessage,
  localizeSystemText,
  progressMessagesEn,
  progressMessagesZhCN,
  sampleReadinessZhCN,
} from "@/lib/i18n/messages/views";

interface ProgressViewProps {
  analysis: AssignmentAnalysis;
  plan: ActionPlan;
  draftResult: DraftCheckResult | null;
  readinessChecks: string[];
  onToggleReadiness: (id: string) => void;
  onContinue: (target: "plan" | "draft") => void;
}

function demoSignalState(value: number | null) {
  if (value === null) return "not-checked";
  if (value >= 70) return "stronger";
  if (value >= 50) return "some";
  return "limited";
}

export function ProgressView({ analysis, plan, draftResult, readinessChecks, onToggleReadiness, onContinue }: ProgressViewProps) {
  const messages = useLocalizedMessages(progressMessagesEn, progressMessagesZhCN);
  const { locale, formatNumber } = useI18n();
  const readinessTitleRef = useRef<HTMLHeadingElement>(null);
  const completedTasks = plan.tasks.filter((task) => task.completed).length;
  const highPriorityPrompts = draftResult?.feedback.filter((item) => item.severity === "high" && item.kind !== "strength").length ?? 0;
  const nextTask = plan.tasks.find((task) => !task.completed);
  const checksComplete = SAMPLE_READINESS.filter(([id]) => readinessChecks.includes(id)).length;
  const checksRemaining = SAMPLE_READINESS.length - checksComplete;
  const isReady = !nextTask && checksRemaining === 0 && draftResult !== null;
  const needsDraftReview = draftResult === null;
  const deadlineDays = daysBetween(todayIso(), analysis.dueAt.slice(0, 10));
  const deadline = deadlineDays < 0
    ? { value: interpolateViewMessage(messages.days, { count: formatNumber(Math.abs(deadlineDays)) }), label: messages.overdue, overdue: true }
    : deadlineDays === 0
      ? { value: messages.today, label: messages.deadline, overdue: false }
      : { value: interpolateViewMessage(messages.days, { count: formatNumber(deadlineDays) }), label: messages.untilDeadline, overdue: false };
  const statusHeading = isReady
    ? messages.ready
    : !draftResult
      ? messages.noDraft
      : nextTask
        ? messages.planRemaining
        : interpolateViewMessage(messages.checksRemaining, { count: formatNumber(checksRemaining), noun: checksRemaining === 1 ? messages.checkRemains : messages.checksRemain });
  const nextActionTitle = nextTask
    ? localizeSystemText(nextTask.title, locale)
    : needsDraftReview
      ? draftResult
        ? messages.reviewPrompts
        : messages.runCheck
      : messages.finishChecklist;
  const nextActionDescription = nextTask
    ? localizeSystemText(nextTask.doneDefinition[0], locale)
    : (needsDraftReview
      ? messages.draftReviewDescription
      : interpolateViewMessage(messages.confirmations, { count: formatNumber(checksRemaining), noun: checksRemaining === 1 ? messages.confirmation : messages.confirmationsRemain }));

  function focusReadinessChecklist() {
    readinessTitleRef.current?.focus({ preventScroll: true });
    readinessTitleRef.current?.scrollIntoView({ block: "center" });
  }

  return (
    <div className="view-stack progress-view">
      <header className="submission-status">
        <div className={`status-symbol ${isReady ? "ready" : "not-ready"}`} aria-hidden="true">{isReady ? <Check /> : <CircleDashed />}</div>
        <div>
          <p className="eyebrow">{messages.submissionReadiness}</p>
          <h1>{statusHeading}</h1>
          <p>{messages.separation}</p>
        </div>
      </header>

      <div className="progress-facts">
        <div className={deadline.overdue ? "fact-warning" : ""}><CalendarClock aria-hidden="true" /><span><strong>{deadline.value}</strong>{deadline.label}</span></div>
        <div><CheckCircle2 aria-hidden="true" /><span><strong>{interpolateViewMessage(messages.tasksComplete, { completed: formatNumber(completedTasks), total: formatNumber(plan.tasks.length) })}</strong></span></div>
        <div><ShieldCheck aria-hidden="true" /><span><strong>{interpolateViewMessage(messages.readinessChecks, { completed: formatNumber(checksComplete), total: formatNumber(SAMPLE_READINESS.length) })}</strong></span></div>
      </div>

      <section className="coverage-section" aria-labelledby="coverage-title">
        <div className="section-heading compact-heading"><div><p className="eyebrow">{messages.coverageEyebrow}</p><h2 id="coverage-title">{messages.coverageTitle}</h2></div></div>
        <div className="coverage-table" role="table" aria-label={messages.coverageAria}>
          <div className="coverage-table-head mobile-visually-hidden" role="row"><span role="columnheader">{messages.criterion}</span><span role="columnheader">{messages.planWork}</span><span role="columnheader">{messages.demoSignals}</span><span role="columnheader">{messages.signalState}</span></div>
          {analysis.rubric.map((criterion) => {
            const planned = plan.rubricProgress.find((item) => item.criterionId === criterion.id)?.percent ?? 0;
            const demoSignals = draftResult?.criteria.find((item) => item.criterionId === criterion.id)?.coverage ?? null;
            const signalState = demoSignalState(demoSignals);
            const signalLabel = signalState === "stronger" ? messages.stronger : signalState === "some" ? messages.some : signalState === "limited" ? messages.limited : messages.notChecked;
            const signalStateClass = signalState === "stronger" ? "evidenced" : signalState;
            return <div className="coverage-table-row" role="row" key={criterion.id}><span role="cell"><strong>{criterion.name}</strong><small>{interpolateViewMessage(messages.ofRubric, { weight: formatNumber(criterion.weight) })}</small></span><span role="cell"><i><b style={{ width: `${planned}%` }} /></i>{formatNumber(Math.round(planned))}%</span><span role="cell"><i><b style={{ width: `${demoSignals ?? 0}%` }} /></i>{demoSignals === null ? "—" : `${formatNumber(Math.round(demoSignals))}%`}</span><span role="cell" className={`state-text ${signalStateClass}`}>{signalLabel}</span></div>;
          })}
        </div>
      </section>

      <div className="progress-columns">
        <section className="risk-register" aria-labelledby="risk-title">
          <div className="section-heading compact-heading"><div><p className="eyebrow">{messages.riskRegister}</p><h2 id="risk-title">{messages.risksTitle}</h2></div></div>
          <ul>
            {plan.capacityRisk ? <li><AlertTriangle aria-hidden="true" /><div><strong>{messages.scheduleCapacity}</strong><p>{localizeSystemText(plan.capacityRisk.message, locale)}</p></div></li> : null}
            <li><FileWarning aria-hidden="true" /><div><strong>{interpolateViewMessage(messages.briefQuestions, { count: formatNumber(analysis.ambiguities.length) })}</strong><p>{messages.briefQuestionsDescription}</p></div></li>
            <li><AlertTriangle aria-hidden="true" /><div><strong>{draftResult ? interpolateViewMessage(messages.highPrompts, { count: formatNumber(highPriorityPrompts), noun: highPriorityPrompts === 1 ? messages.prompt : messages.prompts }) : messages.signalsUnchecked}</strong><p>{draftResult ? messages.usePrompts : messages.runSignals}</p></div></li>
          </ul>
        </section>

        <section className="readiness-checklist" aria-labelledby="readiness-title">
          <div className="section-heading compact-heading"><div><p className="eyebrow">{messages.finalGate}</p><h2 id="readiness-title" ref={readinessTitleRef} tabIndex={-1}>{messages.checklist}</h2></div><span>{formatNumber(checksComplete)}/{formatNumber(SAMPLE_READINESS.length)}</span></div>
          <div className="checklist-items">
            {SAMPLE_READINESS.map(([id, label]) => <label key={id}><input type="checkbox" checked={readinessChecks.includes(id)} onChange={() => onToggleReadiness(id)} /><span aria-hidden="true"><Check /></span>{locale === "zh-CN" ? sampleReadinessZhCN[id] : label}</label>)}
          </div>
        </section>
      </div>

      {isReady ? (
        <section className="next-best-action" aria-labelledby="next-action-title">
          <span className="next-number" aria-hidden="true"><Check /></span>
          <div><p className="eyebrow">{messages.completeEyebrow}</p><h2 id="next-action-title">{messages.beginReview}</h2><p>{messages.beginReviewDescription}</p></div>
        </section>
      ) : (
        <section className="next-best-action" aria-labelledby="next-action-title">
          <span className="next-number">01</span>
          <div><p className="eyebrow">{messages.nextBest}</p><h2 id="next-action-title">{nextActionTitle}</h2><p>{nextActionDescription}</p></div>
          <button
            className="button button-primary"
            type="button"
            onClick={() => {
              if (nextTask) onContinue("plan");
              else if (needsDraftReview) onContinue("draft");
              else focusReadinessChecklist();
            }}
          >
            {nextTask ? messages.continuePlan : needsDraftReview ? messages.openDraft : messages.reviewChecklist} <ArrowRight aria-hidden="true" />
          </button>
        </section>
      )}
    </div>
  );
}
