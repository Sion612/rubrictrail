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

interface CalendarTaskFlags {
  completed: boolean;
  blocked: boolean;
  overdue: boolean;
  beyondDeadline: boolean;
}

const WEEKDAY_KEYS = [
  "weekdayMon",
  "weekdayTue",
  "weekdayWed",
  "weekdayThu",
  "weekdayFri",
  "weekdaySat",
  "weekdaySun",
] as const;

function preferredDate(plan: ActionPlan, assignment: CalendarExportAssignment): string {
  const incomplete = plan.tasks.filter((task) => !task.completed);
  if (incomplete.length) {
    return [...incomplete].sort((left, right) => compareDateOnly(left.dueDate, right.dueDate))[0].dueDate;
  }
  return assignment.dueDate || plan.profile.dueDate || plan.profile.asOfDate;
}

function monthStillUseful(
  date: string,
  plan: ActionPlan,
  assignment: CalendarExportAssignment,
): boolean {
  const month = startOfMonth(date);
  if (startOfMonth(assignment.dueDate) === month) return true;
  if (startOfMonth(plan.profile.asOfDate) === month) return true;
  return plan.tasks.some((task) => startOfMonth(task.dueDate) === month);
}

function resolveSelectedDate(
  current: string,
  plan: ActionPlan,
  assignment: CalendarExportAssignment,
): string {
  if (plan.tasks.length > 0 && plan.tasks.every((task) => task.completed)) {
    return assignment.dueDate;
  }
  if (monthStillUseful(current, plan, assignment)) return current;
  return preferredDate(plan, assignment);
}

function taskFlags(task: PlanTask, plan: ActionPlan, assignment: CalendarExportAssignment): CalendarTaskFlags {
  const blocked = !task.completed && task.dependencies.some(
    (id) => !plan.tasks.find((candidate) => candidate.id === id)?.completed,
  );
  return {
    completed: task.completed,
    blocked,
    overdue: !task.completed && compareDateOnly(task.dueDate, plan.profile.asOfDate) < 0,
    beyondDeadline: !task.completed && (
      task.late || compareDateOnly(task.dueDate, assignment.dueDate) > 0
    ),
  };
}

function flagClassNames(flags: CalendarTaskFlags): string {
  return [
    flags.completed ? styles.completed : "",
    flags.blocked ? styles.blocked : "",
    flags.overdue ? styles.overdue : "",
    flags.beyondDeadline ? styles.beyond : "",
  ].filter(Boolean).join(" ");
}

export function PlanCalendarView({
  plan,
  assignment,
  onToggleTask,
  onOpenInList,
}: PlanCalendarViewProps) {
  const messages = useLocalizedMessages(planMessagesEn, planMessagesZhCN);
  const { locale, formatDate, formatNumber } = useI18n();
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(preferredDate(plan, assignment)));
  const [selectedDate, setSelectedDate] = useState(() => preferredDate(plan, assignment));
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const resolvedSelected = resolveSelectedDate(selectedDate, plan, assignment);
  if (resolvedSelected !== selectedDate) {
    setSelectedDate(resolvedSelected);
    setVisibleMonth(startOfMonth(resolvedSelected));
  }

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
  const localizedPriority = (value: string) => {
    if (value === "high") return messages.high;
    if (value === "medium") return messages.medium;
    if (value === "low") return messages.low;
    return value;
  };
  const mediumDate = (value: string) => formatDate(new Date(`${value}T12:00:00`), { dateStyle: "medium" });

  function flagLabels(flags: CalendarTaskFlags): string[] {
    const labels: string[] = [];
    if (flags.completed) labels.push(messages.completedState);
    if (flags.blocked) labels.push(messages.blockedState);
    if (flags.overdue) labels.push(messages.overdueState);
    if (flags.beyondDeadline) labels.push(messages.lateState);
    if (!labels.length) labels.push(messages.upcomingState);
    return labels;
  }

  function shiftMonth(amount: number) {
    const nextSelected = addCalendarMonths(selectedDate, amount);
    setSelectedDate(nextSelected);
    setVisibleMonth(startOfMonth(nextSelected));
  }

  function goToPlanningDate() {
    setSelectedDate(plan.profile.asOfDate);
    setVisibleMonth(startOfMonth(plan.profile.asOfDate));
  }

  async function exportIcs() {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const {
        serializeRemainingPlanIcs: serialize,
        downloadIcsFile: download,
        safeIcsFilename: filenameFor,
      } = await import("@/lib/icalendar");
      const contents = serialize(
        assignment,
        plan,
        {
          calendarName: messages.icsCalendarName,
          targetDateNote: messages.icsTargetNote,
          deadlineSummary: interpolateViewMessage(messages.icsDeadlineSummary, { title: assignment.title }),
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
        {
          localizePriority: localizedPriority,
          formatDuration: minutesLabel,
          formatDateOnly: mediumDate,
        },
      );
      download(filenameFor(assignment.title), contents);
    } catch {
      setExportError(messages.icsExportFailed);
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className={styles.calendar} aria-labelledby="plan-calendar-title">
      <div className={styles.intro}>
        <p>{messages.calendarExplanation}</p>
      </div>
      <div className={styles.toolbar}>
        <div className={styles.nav}>
          <button type="button" className="button button-secondary" onClick={() => shiftMonth(-1)}>
            {messages.previousMonth}
          </button>
          <h2 id="plan-calendar-title">{monthLabel}</h2>
          <button type="button" className="button button-secondary" onClick={goToPlanningDate}>
            {messages.today}
          </button>
          <button type="button" className="button button-secondary" onClick={() => shiftMonth(1)}>
            {messages.nextMonth}
          </button>
        </div>
        <button
          type="button"
          className="button button-secondary"
          data-testid="export-ics"
          aria-busy={exporting || undefined}
          disabled={exporting}
          onClick={() => void exportIcs()}
        >
          <Download aria-hidden="true" /> {exporting ? messages.icsExporting : messages.exportIcs}
        </button>
      </div>
      {exportError ? <p className={styles.empty} role="alert" data-testid="ics-export-error">{exportError}</p> : null}
      <p className={styles.privacy}>{messages.icsPrivacy}</p>
      <div className={styles.legend} data-testid="calendar-legend">
        <strong>{messages.legendTitle}</strong>
        <span className={styles.completed}>{messages.completedState}</span>
        <span className={styles.blocked}>{messages.blockedState}</span>
        <span className={styles.overdue}>{messages.overdueState}</span>
        <span className={styles.beyond}>{messages.lateState}</span>
        <span>{messages.legendMultiple}</span>
      </div>
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
                const stateText = dayTasks.flatMap((task) => flagLabels(taskFlags(task, plan, assignment))).join(", ");
                return (
                  <td key={date} className={outside ? styles.outside : undefined}>
                    <button
                      type="button"
                      className={`${styles.day}${isSelected ? ` ${styles.selected}` : ""}`}
                      data-testid={`calendar-day-${date}`}
                      aria-label={[
                        interpolateViewMessage(messages.dayCellAria, {
                          date: longDate,
                          count: formatNumber(dayTasks.length),
                          deadline: isDeadline ? messages.deadlineMarker : "",
                          planning: isPlanning ? messages.planningMarker : "",
                        }),
                        stateText,
                      ].filter(Boolean).join(". ")}
                      aria-pressed={isSelected}
                      onClick={() => setSelectedDate(date)}
                    >
                      <span>{formatNumber(Number(date.slice(8)))}</span>
                      {isDeadline ? <span className={styles.flag}>{messages.assignmentDeadline}</span> : null}
                      {isPlanning ? <span className={styles.flag}>{messages.planningDate}</span> : null}
                      {visibleTasks.map((task) => (
                        <span
                          key={task.id}
                          className={`${styles.chip} ${flagClassNames(taskFlags(task, plan, assignment))}`}
                        >
                          {localizeSystemText(task.title, locale)}
                        </span>
                      ))}
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
              const flags = taskFlags(task, plan, assignment);
              const title = localizeSystemText(task.title, locale);
              return (
                <li key={task.id} className={styles.agendaItem} data-testid={`calendar-task-${task.id}`}>
                  <div>
                    <strong>{title}</strong>
                    <p>
                      {localizeSystemText(task.phase, locale)} · {interpolateViewMessage(messages.priority, { priority: localizedPriority(task.priority) })} · {interpolateViewMessage(messages.targetCompletion, {
                        date: mediumDate(date),
                      })}
                    </p>
                    <p>
                      <Clock3 aria-hidden="true" /> {minutesLabel(task.adjustedMinutes)}
                      {task.scheduledStartDate !== task.dueDate
                        ? ` · ${interpolateViewMessage(messages.plannedWindow, {
                            start: mediumDate(task.scheduledStartDate),
                            end: mediumDate(task.dueDate),
                          })}`
                        : ""}
                    </p>
                    <p className={styles.tags}>
                      {flagLabels(flags).map((label) => (
                        <span key={label} className={styles.tag}>{label}</span>
                      ))}
                    </p>
                  </div>
                  <div className={styles.agendaActions}>
                    <label>
                      <input
                        type="checkbox"
                        checked={task.completed}
                        disabled={flags.blocked}
                        aria-label={interpolateViewMessage(messages.markTask, {
                          title,
                          state: task.completed ? messages.incomplete : messages.complete,
                        })}
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
