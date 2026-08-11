"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, Clock3, GitBranch, SlidersHorizontal } from "lucide-react";
import type { ActionPlan } from "@/lib/domain";

interface ActionPlanViewProps {
  plan: ActionPlan;
  onRebalance: (weeklyHours: number, targetGrade: number) => void;
  onToggleTask: (taskId: string) => void;
  onNavigateDraft: () => void;
}

function minutesLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00`));
}

export function ActionPlanView({ plan, onRebalance, onToggleTask, onNavigateDraft }: ActionPlanViewProps) {
  const [weeklyHours, setWeeklyHours] = useState(plan.profile.weeklyHours);
  const [targetGrade, setTargetGrade] = useState(plan.profile.targetGrade);
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
          <p className="eyebrow">Action plan</p>
          <h1>A plan with a definition of done.</h1>
          <p>Every task builds visible evidence for the rubric — and reschedules around the time you actually have.</p>
        </div>
        <div className="header-progress" aria-label={`${Math.round(plan.completionPercent)}% of plan complete`}>
          <strong>{Math.round(plan.completionPercent)}%</strong><span>work complete</span>
        </div>
      </header>

      <section className="plan-controls" aria-labelledby="plan-controls-title">
        <div className="plan-control-title"><SlidersHorizontal aria-hidden="true" /><div><strong id="plan-controls-title">Rebalance your plan</strong><span>Change one constraint and see the schedule respond.</span></div></div>
        <label>
          <span>Study time</span>
          <select value={weeklyHours} onChange={(event) => setWeeklyHours(Number(event.target.value))} data-testid="weekly-hours">
            {[5, 8, 10, 12, 15].map((hours) => <option key={hours} value={hours}>{hours} hours / week</option>)}
          </select>
        </label>
        <label>
          <span>Target band</span>
          <select value={targetGrade} onChange={(event) => setTargetGrade(Number(event.target.value))} data-testid="target-grade">
            <option value={60}>60% target</option>
            <option value={70}>70% target</option>
            <option value={75}>75% target</option>
            <option value={80}>80% target</option>
          </select>
        </label>
        <button className="button button-secondary" type="button" onClick={() => onRebalance(weeklyHours, targetGrade)} data-testid="rebalance-plan">Rebalance plan</button>
      </section>

      {plan.capacityRisk ? (
        <div className="inline-alert warning" role="status" data-testid="capacity-risk">
          <AlertTriangle aria-hidden="true" />
          <div><strong>Time risk detected</strong><span>{plan.capacityRisk.message}</span></div>
        </div>
      ) : (
        <div className="inline-alert success" role="status">
          <CheckCircle2 aria-hidden="true" />
          <div><strong>Schedule is feasible</strong><span>Projected finish: {dateLabel(plan.projectedFinishDate)}, leaving time for final checks.</span></div>
        </div>
      )}

      <div className="plan-summary-line">
        <span><Clock3 aria-hidden="true" />{minutesLabel(plan.remainingMinutes)} remaining</span>
        <span><CalendarDays aria-hidden="true" />Projected finish {dateLabel(plan.projectedFinishDate)}</span>
        <span><GitBranch aria-hidden="true" />Dependencies respected</span>
      </div>

      <div className="phase-list">
        {phases.map(([phase, tasks], phaseIndex) => (
          <section className="plan-phase" key={phase} aria-labelledby={`phase-${phaseIndex}`}>
            <div className="phase-heading"><span>{String(phaseIndex + 1).padStart(2, "0")}</span><h2 id={`phase-${phaseIndex}`}>{phase}</h2><small>{tasks.length} tasks</small></div>
            <div className="task-list">
              {tasks.map((task) => {
                  const incompleteDependencies = task.dependencies.filter(
                    (id) => !plan.tasks.find((candidate) => candidate.id === id)?.completed,
                  );
                  const blocked = !task.completed && incompleteDependencies.length > 0;
                  return (
                <article className={`plan-task${task.completed ? " is-complete" : ""}${task.late ? " is-late" : ""}${blocked ? " is-blocked" : ""}`} key={task.id} data-testid={`task-${task.id}`}>
                  <label className="task-check">
                    <input type="checkbox" checked={task.completed} disabled={blocked} onChange={() => onToggleTask(task.id)} aria-label={blocked ? `${task.title} is blocked by unfinished dependencies` : `Mark ${task.title} ${task.completed ? "incomplete" : "complete"}`} />
                    <span aria-hidden="true"><CheckCircle2 /></span>
                  </label>
                  <div className="task-body">
                    <div className="task-title-line">
                      <div><span className={`priority-text ${task.priority}`}>{task.priority} priority</span><h3>{task.title}</h3></div>
                      <div className="task-time"><strong>{minutesLabel(task.adjustedMinutes)}</strong><span>Due {dateLabel(task.dueDate)}</span></div>
                    </div>
                    <p>{task.description}</p>
                    <div className="task-definition"><strong>Done when</strong><ul>{task.doneDefinition.map((item) => <li key={item}>{item}</li>)}</ul></div>
                    <div className="task-meta">
                      <span>Rubric: {task.rubricLinks.map((link) => link.criterionId.replaceAll("-", " ")).join(" · ")}</span>
                      <span>Depends on: {task.dependencies.length ? task.dependencies.map((id) => taskNameById.get(id) ?? id).join(", ") : "Nothing"}</span>
                    </div>
                    {blocked ? <p className="task-blocked-note">Finish {incompleteDependencies.map((id) => taskNameById.get(id) ?? id).join(", ")} first.</p> : null}
                  </div>
                </article>
                  );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="view-next-action">
        <div><span>When you have a section ready</span><strong>Check whether the evidence is visible in your own words.</strong></div>
        <button className="button button-primary" type="button" onClick={onNavigateDraft}>Check a draft section <ArrowRight aria-hidden="true" /></button>
      </div>
    </div>
  );
}
