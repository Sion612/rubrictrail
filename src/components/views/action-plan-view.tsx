"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, Clock3, GitBranch, SlidersHorizontal } from "lucide-react";
import type { ActionPlan, PlanningDepth } from "@/lib/domain";
import type { CalendarExportAssignment } from "@/lib/icalendar";
import { PLANNING_DEPTH_OPTIONS } from "@/lib/plan";
import { useI18n, useLocalizedMessages } from "@/components/locale-provider";
import {
  interpolateViewMessage,
  localizeCriterionReference,
  localizeSystemText,
  planMessagesEn,
  planMessagesZhCN,
} from "@/lib/i18n/messages/views";
import styles from "./action-plan-view.module.css";

const PlanCalendarView = dynamic(
  () => import("@/components/views/plan-calendar-view").then((module) => module.PlanCalendarView),
  { ssr: false },
);

interface ActionPlanViewProps {
  plan: ActionPlan;
  assignment: CalendarExportAssignment;
  onRebalance: (weeklyHours: number, planningDepth: PlanningDepth) => void;
  onToggleTask: (taskId: string) => void;
  onNavigateDraft: () => void;
}

export function ActionPlanView({ plan, assignment, onRebalance, onToggleTask, onNavigateDraft }: ActionPlanViewProps) {
  const messages = useLocalizedMessages(planMessagesEn, planMessagesZhCN);
  const { locale, formatDate, formatNumber } = useI18n();
  const minutesLabel = (minutes: number) => {
    if (minutes < 60) {
      return interpolateViewMessage(messages.min, { minutes: formatNumber(minutes) });
    }
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder
      ? interpolateViewMessage(messages.hoursMinutes, {
          hours: formatNumber(hours),
          minutes: formatNumber(remainder),
        })
      : interpolateViewMessage(messages.hours, { hours: formatNumber(hours) });
  };
  const dateLabel = (value: string) =>
    formatDate(new Date(`${value}T12:00:00`), { day: "numeric", month: "short" });
  const localizedDepth = (value: PlanningDepth) => {
    if (value === "focused") return messages.focused;
    if (value === "standard") return messages.standard;
    if (value === "thorough") return messages.thorough;
    return messages.extended;
  };
  const localizedDepthDescription = (value: PlanningDepth) => {
    if (value === "focused") return messages.focusedDescription;
    if (value === "standard") return messages.standardDescription;
    if (value === "thorough") return messages.thoroughDescription;
    return messages.extendedDescription;
  };
  const localizedPriority = (value: string) => {
    if (value === "high") return messages.high;
    if (value === "medium") return messages.medium;
    if (value === "low") return messages.low;
    return value;
  };
  const profileKey = [
    plan.profile.weeklyHours,
    plan.profile.planningDepth,
    plan.profile.startDate,
    plan.profile.dueDate,
    plan.profile.asOfDate,
  ].join(":");
  const [controlDraft, setControlDraft] = useState(() => ({
    profileKey,
    weeklyHours: plan.profile.weeklyHours,
    planningDepth: plan.profile.planningDepth,
  }));
  const controls =
    controlDraft.profileKey === profileKey
      ? controlDraft
      : {
          profileKey,
          weeklyHours: plan.profile.weeklyHours,
          planningDepth: plan.profile.planningDepth,
        };
  const updateControls = (
    update: Partial<Pick<typeof controls, "weeklyHours" | "planningDepth">>,
  ) => {
    setControlDraft({ ...controls, ...update, profileKey });
  };
  const selectedPlanningDepth =
    PLANNING_DEPTH_OPTIONS.find(
      (option) => option.value === controls.planningDepth,
    ) ??
    PLANNING_DEPTH_OPTIONS[1];
  const [presentation, setPresentation] = useState<"list" | "calendar">("list");
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (!focusTaskId || presentation !== "list") return;
    const node = document.querySelector<HTMLElement>(`[data-testid="task-${focusTaskId}"]`);
    node?.scrollIntoView({ block: "center" });
    node?.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true });
  }, [focusTaskId, presentation]);

  const taskNameById = useMemo(() => new Map(plan.tasks.map((task) => [task.id, task.title])), [plan.tasks]);
  const phases = useMemo(() => {
    const grouped = new Map<string, typeof plan.tasks>();
    for (const task of plan.tasks) grouped.set(task.phase, [...(grouped.get(task.phase) ?? []), task]);
    return Array.from(grouped.entries());
  }, [plan]);

  return (
    <div className="view-stack plan-view">
      <header className="view-header split-header">
        <div>
          <p className="eyebrow">{messages.eyebrow}</p>
          <h1>{messages.title}</h1>
          <p>{messages.description}</p>
        </div>
        <div className="header-progress" aria-label={interpolateViewMessage(messages.completionAria, { percent: formatNumber(Math.round(plan.completionPercent)) })}>
          <strong>{formatNumber(Math.round(plan.completionPercent))}%</strong><span>{messages.workComplete}</span>
        </div>
      </header>

      <section className="plan-controls" aria-labelledby="plan-controls-title">
        <div className="plan-control-title"><SlidersHorizontal aria-hidden="true" /><div><strong id="plan-controls-title">{messages.rebalance}</strong><span id="planning-depth-guidance">{messages.depthGuidance}</span></div></div>
        <label>
          <span>{messages.studyTime}</span>
          <select value={controls.weeklyHours} onChange={(event) => updateControls({ weeklyHours: Number(event.target.value) })} data-testid="weekly-hours">
            {[5, 8, 10, 12, 15].map((hours) => <option key={hours} value={hours}>{interpolateViewMessage(messages.hoursWeek, { hours: formatNumber(hours) })}</option>)}
          </select>
        </label>
        <div className="plan-control-field">
          <label htmlFor="planning-depth"><span>{messages.planningDepth}</span></label>
          <select
            id="planning-depth"
            value={controls.planningDepth}
            onChange={(event) => updateControls({ planningDepth: event.target.value as PlanningDepth })}
            aria-describedby="planning-depth-guidance planning-depth-description"
            data-testid="planning-depth"
          >
            {PLANNING_DEPTH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{localizedDepth(option.value)}</option>
            ))}
          </select>
          <small id="planning-depth-description" className="planning-depth-description">
            {localizedDepthDescription(selectedPlanningDepth.value)}
          </small>
        </div>
        <button className="button button-secondary" type="button" onClick={() => onRebalance(controls.weeklyHours, controls.planningDepth)} data-testid="rebalance-plan">{messages.rebalanceButton}</button>
      </section>

      {plan.capacityRisk ? (
        <div className="inline-alert warning" role="status" data-testid="capacity-risk">
          <AlertTriangle aria-hidden="true" />
          <div><strong>{messages.riskTitle}</strong><span>{localizeSystemText(plan.capacityRisk.message, locale)}</span></div>
        </div>
      ) : (
        <div className="inline-alert success" role="status">
          <CheckCircle2 aria-hidden="true" />
          <div><strong>{messages.feasible}</strong><span>{interpolateViewMessage(messages.projectedWithChecks, { date: dateLabel(plan.projectedFinishDate) })}</span></div>
        </div>
      )}

      <div className={styles.presentation} role="group" aria-label={messages.presentationLabel}>
        <button
          type="button"
          className={presentation === "list" ? styles.isActive : undefined}
          aria-pressed={presentation === "list"}
          data-testid="plan-task-list"
          onClick={() => setPresentation("list")}
        >
          {messages.taskList}
        </button>
        <button
          type="button"
          className={presentation === "calendar" ? styles.isActive : undefined}
          aria-pressed={presentation === "calendar"}
          data-testid="plan-calendar"
          onClick={() => setPresentation("calendar")}
        >
          {messages.calendar}
        </button>
      </div>

      <div className="plan-summary-line">
        <span><Clock3 aria-hidden="true" />{interpolateViewMessage(messages.remaining, { time: minutesLabel(plan.remainingMinutes) })}</span>
        <span><CalendarDays aria-hidden="true" />{interpolateViewMessage(messages.projected, { date: dateLabel(plan.projectedFinishDate) })}</span>
        <span><GitBranch aria-hidden="true" />{messages.dependenciesRespected}</span>
      </div>

      {presentation === "calendar" ? (
        <PlanCalendarView
          plan={plan}
          assignment={assignment}
          onToggleTask={onToggleTask}
          onOpenInList={(taskId) => {
            setPresentation("list");
            setFocusTaskId(taskId);
          }}
        />
      ) : null}

      <div className="phase-list" hidden={presentation !== "list"}>
        {phases.map(([phase, tasks], phaseIndex) => (
          <section className="plan-phase" key={phase} aria-labelledby={`phase-${phaseIndex}`}>
            <div className="phase-heading"><span>{formatNumber(phaseIndex + 1, { minimumIntegerDigits: 2, useGrouping: false })}</span><h2 id={`phase-${phaseIndex}`}>{localizeSystemText(phase, locale)}</h2><small>{interpolateViewMessage(messages.taskCount, { count: formatNumber(tasks.length) })}</small></div>
            <div className="task-list">
              {tasks.map((task) => {
                  const incompleteDependencies = task.dependencies.filter(
                    (id) => !plan.tasks.find((candidate) => candidate.id === id)?.completed,
                  );
                  const blocked = !task.completed && incompleteDependencies.length > 0;
                  return (
                <article className={`plan-task${task.completed ? " is-complete" : ""}${task.late ? " is-late" : ""}${blocked ? " is-blocked" : ""}`} key={task.id} data-testid={`task-${task.id}`}>
                  <label className="task-check">
                    <input type="checkbox" checked={task.completed} disabled={blocked} onChange={() => onToggleTask(task.id)} aria-label={blocked ? interpolateViewMessage(messages.blockedAria, { title: localizeSystemText(task.title, locale) }) : interpolateViewMessage(messages.markTask, { title: localizeSystemText(task.title, locale), state: task.completed ? messages.incomplete : messages.complete })} />
                    <span aria-hidden="true"><CheckCircle2 /></span>
                  </label>
                  <div className="task-body">
                    <div className="task-title-line">
                      <div><span className={`priority-text ${task.priority}`}>{interpolateViewMessage(messages.priority, { priority: localizedPriority(task.priority) })}</span><h3>{localizeSystemText(task.title, locale)}</h3></div>
                      <div className="task-time"><strong>{minutesLabel(task.adjustedMinutes)}</strong><span>{interpolateViewMessage(messages.due, { date: dateLabel(task.dueDate) })}</span></div>
                    </div>
                    <p>{localizeSystemText(task.description, locale)}</p>
                    <div className="task-definition"><strong>{messages.doneWhen}</strong><ul>{task.doneDefinition.map((item) => <li key={item}>{localizeSystemText(item, locale)}</li>)}</ul></div>
                    <div className="task-meta">
                      <span>{interpolateViewMessage(messages.rubric, { items: task.rubricLinks.map((link) => localizeCriterionReference(link.criterionId, locale)).join(" · ") })}</span>
                      <span>{interpolateViewMessage(messages.dependsOn, { items: task.dependencies.length ? task.dependencies.map((id) => localizeSystemText(taskNameById.get(id) ?? id, locale)).join(", ") : messages.nothing })}</span>
                    </div>
                    {blocked ? <p className="task-blocked-note">{interpolateViewMessage(messages.finishFirst, { items: incompleteDependencies.map((id) => localizeSystemText(taskNameById.get(id) ?? id, locale)).join(", ") })}</p> : null}
                  </div>
                </article>
                  );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="view-next-action">
        <div><span>{messages.sectionReady}</span><strong>{messages.sectionReadyDescription}</strong></div>
        <button className="button button-primary" type="button" onClick={onNavigateDraft}>{messages.checkSection} <ArrowRight aria-hidden="true" /></button>
      </div>
    </div>
  );
}
