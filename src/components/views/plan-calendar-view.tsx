"use client";

import { useMemo, useState } from "react";
import { Clock3, Download } from "lucide-react";
import type { ActionPlan, PlanTask } from "@/lib/domain";
import {
  addCalendarDays,
  addCalendarMonths,
  compareDateOnly,
  datesInRange,
  startOfMondayWeek,
  startOfMonth,
  visibleMonthGrid,
} from "@/lib/date-only";
import type { CalendarExportAssignment } from "@/lib/icalendar";
import { useI18n, useLocalizedMessages } from "@/components/locale-provider";
import {
  interpolateViewMessage,
  localizeSystemText,
  planMessagesEn,
  planMessagesZhCN,
} from "@/lib/i18n/messages/views";
import styles from "./plan-calendar-view.module.css";

interface PlanCalendarViewProps {
  plan: ActionPlan;
  assignment: CalendarExportAssignment;
  onToggleTask: (taskId: string) => void;
  onOpenInList: (taskId: string) => void;
}

type CalendarTaskState = "completed" | "blocked" | "overdue" | "late" | "upcoming";

const WEEKDAY_KEYS = [
  "weekdayMon",
  "weekdayTue",
  "weekdayWed",
  "weekdayThu",
  "weekdayFri",
  "weekdaySat",
  "weekdaySun",
] as const;

function initialVisibleMonth(plan: ActionPlan): string {
  const incomplete = plan.tasks.filter((task) => !task.completed);
  if (incomplete.length) {
    return [...incomplete].sort((left, right) => compareDateOnly(left.dueDate, right.dueDate))[0].dueDate;
  }
  return plan.profile.dueDate || plan.profile.asOfDate;
}

function taskState(task: PlanTask, plan: ActionPlan): CalendarTaskState {
  if (task.completed) return "completed";
  const blocked = task.dependencies.some(
    (id) => !plan.tasks.find((candidate) => candidate.id === id)?.completed,
  );
  if (blocked) return "blocked";
  if (task.late) return "late";
  if (compareDateOnly(task.dueDate, plan.profile.asOfDate) < 0) return "overdue";
  return "upcoming";
}

export function PlanCalendarView({
  plan,
  assignment,
  onToggleTask,
  onOpenInList,
}: PlanCalendarViewProps) {
  const messages = useLocalizedMessages(planMessagesEn, planMessagesZhCN);
  const { locale, formatDate, formatNumber } = useI18n();
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(initialVisibleMonth(plan)));
  const [selectedDate, setSelectedDate] = useState(() => initialVisibleMonth(plan));
  const tasksByDate = useMemo(() => {
    const grouped = new Map<string, PlanTask[]>();
    for (const task of plan.tasks) {
      grouped.set(task.dueDate, [...(grouped.get(task.dueDate) ?? []), task]);
    }
    return grouped;
  }, [plan.tasks]);
  const grid = visibleMonthGrid(visibleMonth);
  const weekStart = startOfMondayWeek(selectedDate);
  const weekDates = datesInRange(weekStart, addCalendarDays(weekStart, 6));
  const monthLabel = formatDate(new Date(`${visibleMonth}T12:00:00`), { month: "long", year: "numeric" });
  const incompleteCount = plan.tasks.filter((task) => !task.completed).length;
  const deadlineInMonth = startOfMonth(assignment.dueDate) === visibleMonth;

  const weekTasks = weekDates.flatMap((date) =>
    (tasksByDate.get(date) ?? []).map((task) => ({ date, task })),
  );

  function stateLabel(state: CalendarTaskState): string {
    if (state === "completed") return messages.completedState;
    if (state === "blocked") return messages.blockedState;
    if (state === "overdue") return messages.overdueState;
    if (state === "late") return messages.lateState;
    return messages.upcomingState;
  }

  async function exportIcs() {
    const { serializeRemainingPlanIcs: serialize, downloadIcsFile: download, safeIcsFilename: filenameFor } = await import(
      "@/lib/icalendar"
    );
    const contents = serialize(
      assignment,
      plan,
      {
        calendarName: messages.icsCalendarName,
        targetDateNote: messages.icsTargetNote,
        deadlineSummary: messages.icsDeadlineSummary,
        deadlineDescription: messages.icsDeadlineDescription,
        phase: messages.icsPhase,
        priority: messages.icsPriority,
        duration: messages.icsDuration,
        plannedStart: messages.icsPlannedStart,
        dependencies: messages.icsDependencies,
        none: messages.icsNone,
        doneWhen: messages.icsDoneWhen,
        assignment: messages.icsAssignment,
        course: messages.icsCourse,
      },
      new Date(),
      (value) => localizeSystemText(value, locale),
    );
    download(filenameFor(assignment.title), contents);
  }

  return (
    <section className={styles.calendar} aria-labelledby="plan-calendar-title">
      <div className={styles.intro}>
        <p>{messages.calendarExplanation}</p>
      </div>
      <div className={styles.toolbar}>
        <div className={styles.nav}>
          <button type="button" className="button button-secondary" onClick={() => setVisibleMonth(addCalendarMonths(visibleMonth, -1))}>
            {messages.previousMonth}
          </button>
          <h2 id="plan-calendar-title">{monthLabel}</h2>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setVisibleMonth(startOfMonth(plan.profile.asOfDate))}
          >
            {messages.today}
          </button>
          <button type="button" className="button button-secondary" onClick={() => setVisibleMonth(addCalendarMonths(visibleMonth, 1))}>
            {messages.nextMonth}
          </button>
        </div>
        <button type="button" className="button button-secondary" data-testid="export-ics" onClick={() => void exportIcs()}>
          <Download aria-hidden="true" /> {messages.exportIcs}
        </button>
      </div>
      <p className={styles.privacy}>{messages.icsPrivacy}</p>
      {!incompleteCount ? <p className={styles.empty}>{messages.noIncompleteTasks}</p> : null}
      {!deadlineInMonth ? <p className={styles.empty}>{messages.deadlineOutsideMonth}</p> : null}

      <table className={styles.grid} data-testid="plan-calendar-grid">
        <thead>
          <tr>
            {WEEKDAY_KEYS.map((key) => (
              <th key={key} scope="col">{messages[key]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }, (_, week) => (
            <tr key={week}>
              {grid.slice(week * 7, week * 7 + 7).map((date) => {
                const dayTasks = tasksByDate.get(date) ?? [];
                const outside = startOfMonth(date) !== visibleMonth;
                const isDeadline = date === assignment.dueDate;
                const isPlanning = date === plan.profile.asOfDate;
                const isSelected = date === selectedDate;
                const visibleTasks = dayTasks.slice(0, 2);
                const overflow = dayTasks.length - visibleTasks.length;
                const longDate = formatDate(new Date(`${date}T12:00:00`), { dateStyle: "full" });
                return (
                  <td key={date} className={outside ? styles.outside : undefined}>
                    <button
                      type="button"
                      className={`${styles.day}${isSelected ? ` ${styles.selected}` : ""}`}
                      data-testid={`calendar-day-${date}`}
                      aria-label={interpolateViewMessage(messages.dayCellAria, {
                        date: longDate,
                        count: formatNumber(dayTasks.length),
                        deadline: isDeadline ? messages.deadlineMarker : "",
                      })}
                      aria-pressed={isSelected}
                      onClick={() => setSelectedDate(date)}
                    >
                      <span>{formatNumber(Number(date.slice(8)))}</span>
                      {isDeadline ? <span className={styles.flag}>{messages.assignmentDeadline}</span> : null}
                      {isPlanning ? <span className={styles.flag}>{messages.planningDate}</span> : null}
                      <ul>
                        {visibleTasks.map((task) => (
                          <li key={task.id} className={`is-${taskState(task, plan)}`}>
                            {localizeSystemText(task.title, locale)}
                          </li>
                        ))}
                      </ul>
                      {overflow > 0 ? (
                        <small>{interpolateViewMessage(messages.moreTasks, { count: formatNumber(overflow) })}</small>
                      ) : null}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <section aria-labelledby="calendar-week-title">
        <h3 id="calendar-week-title">{messages.weekAgenda}</h3>
        {plan.tasks.every((task) => task.completed) ? (
          <p>{messages.allTasksComplete}</p>
        ) : weekTasks.length === 0 ? (
          <p>{messages.noTasksInWeek}</p>
        ) : (
          <ol>
            {weekTasks.map(({ date, task }) => {
              const state = taskState(task, plan);
              const blocked = state === "blocked";
              return (
                <li key={task.id} className={styles.agendaItem} data-testid={`calendar-task-${task.id}`}>
                  <div>
                    <strong>{localizeSystemText(task.title, locale)}</strong>
                    <p>
                      {localizeSystemText(task.phase, locale)} · {task.priority} · {interpolateViewMessage(messages.targetCompletion, {
                        date: formatDate(new Date(`${date}T12:00:00`), { dateStyle: "medium" }),
                      })}
                    </p>
                    <p>
                      <Clock3 aria-hidden="true" /> {task.adjustedMinutes} min
                      {task.scheduledStartDate !== task.dueDate
                        ? ` · ${interpolateViewMessage(messages.plannedWindow, {
                            start: task.scheduledStartDate,
                            end: task.dueDate,
                          })}`
                        : ""}
                    </p>
                    <p>{stateLabel(state)}</p>
                  </div>
                  <div className={styles.agendaActions}>
                    <label>
                      <input
                        type="checkbox"
                        checked={task.completed}
                        disabled={blocked}
                        onChange={() => onToggleTask(task.id)}
                      />
                      {task.completed ? messages.complete : messages.incomplete}
                    </label>
                    <button type="button" className="button button-secondary" onClick={() => onOpenInList(task.id)}>
                      {messages.openInList}
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </section>
  );
}
