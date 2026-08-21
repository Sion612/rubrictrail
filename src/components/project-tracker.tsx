"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { CheckCircle2, X } from "lucide-react";
import type { ActionPlan } from "@/lib/domain";
import type { CalendarExportAssignment } from "@/lib/icalendar";
import { deriveProjectTrackerSummary } from "@/lib/project-tracker";
import { useI18n, useLocalizedMessages } from "@/components/locale-provider";
import { localizeSystemText } from "@/lib/i18n/messages/views";
import { trackerEn, trackerZhCN } from "@/lib/i18n/messages/tracker";
import { PlanCalendarView } from "@/components/views/plan-calendar-view";
import styles from "./project-tracker.module.css";

interface ProjectTrackerProps {
  plan: ActionPlan;
  assignment: CalendarExportAssignment;
  currentDate: string;
  openerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onToggleTask: (taskId: string) => void;
  onOpenTask: (taskId: string) => void;
}

function message(template: string, values: Record<string, string | number> = {}) {
  return template.replace(/\{([A-Za-z0-9_]+)\}/gu, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

function focusableIn(node: HTMLElement | null): HTMLElement[] {
  return node
    ? Array.from(node.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ))
    : [];
}

export function ProjectTracker({
  plan,
  assignment,
  currentDate,
  openerRef,
  onClose,
  onToggleTask,
  onOpenTask,
}: ProjectTrackerProps) {
  const tracker = useLocalizedMessages(trackerEn, trackerZhCN);
  const { locale, formatDate, formatNumber } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef(true);
  const calendarBusyRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const [calendarBusy, setCalendarBusy] = useState(false);
  useEffect(() => {
    calendarBusyRef.current = calendarBusy;
  }, [calendarBusy]);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const summary = deriveProjectTrackerSummary(plan, assignment.dueDate, currentDate);
  const dateLabel = (value: string) =>
    formatDate(new Date(`${value}T12:00:00`), { dateStyle: "medium" });

  useEffect(() => {
    const previous = openerRef.current;
    const frame = window.requestAnimationFrame(() => {
      const focusable = focusableIn(dialogRef.current);
      (focusable[0] ?? dialogRef.current)?.focus({ preventScroll: true });
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!calendarBusyRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableIn(dialogRef.current);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current?.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      if (restoreFocusRef.current) previous?.focus({ preventScroll: true });
    };
  }, [openerRef]);

  function openTask(taskId: string) {
    restoreFocusRef.current = false;
    onOpenTask(taskId);
  }

  const nextTask = summary.nextTask;
  const nextTaskTitle = nextTask
    ? localizeSystemText(nextTask.title, locale)
    : tracker.allComplete;

  return (
    <div className={styles.shell} data-testid="project-tracker-shell">
      <button
        type="button"
        className={styles.backdrop}
        aria-label={tracker.closeTracker}
        disabled={calendarBusy}
        onClick={() => {
          if (!calendarBusy) onClose();
        }}
      />
      <aside
        ref={dialogRef}
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-tracker-title"
        aria-busy={calendarBusy || undefined}
        tabIndex={-1}
      >
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>{tracker.tracker}</p>
            <h2 id="project-tracker-title">{tracker.summaryLabel}</h2>
            <p>{tracker.trackerDescription}</p>
          </div>
          <button
            type="button"
            className={styles.close}
            aria-label={tracker.closeTracker}
            disabled={calendarBusy}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <section className={styles.summary} aria-labelledby="project-tracker-summary-title">
          <div className={styles.summaryHeading}>
            <div className={styles.nextTask}>
              <strong id="project-tracker-summary-title">{tracker.nextTask}</strong>
              <span className={styles.nextTaskTitle}>{nextTaskTitle}</span>
              {nextTask ? <span className={styles.nextTaskDate}>{dateLabel(nextTask.dueDate)}</span> : null}
            </div>
            {nextTask ? (
              <button
                type="button"
                className={`button button-secondary ${styles.shortcut}`}
                onClick={() => openTask(nextTask.id)}
                data-testid="tracker-open-next-task"
              >
                {tracker.openInTaskList}
              </button>
            ) : <CheckCircle2 aria-hidden="true" />}
          </div>
          <div className={styles.metrics} aria-label={tracker.summaryLabel}>
            <span className={styles.metric}>{message(tracker.incomplete, { count: formatNumber(summary.incompleteCount) })}</span>
            <span className={`${styles.metric} ${summary.blockedCount ? styles.metricAlert : ""}`}>{message(tracker.blocked, { count: formatNumber(summary.blockedCount) })}</span>
            {summary.overdueCount > 0 ? <span className={`${styles.metric} ${styles.metricAlert}`}>{message(tracker.overdue, { count: formatNumber(summary.overdueCount) })}</span> : null}
          </div>
          <p className={styles.deadline}>{message(tracker.deadline, { date: dateLabel(summary.deadline) })}</p>
        </section>

        <div className={styles.calendar}>
          <PlanCalendarView
            plan={plan}
            assignment={assignment}
            currentDate={currentDate}
            onToggleTask={onToggleTask}
            onOpenInList={openTask}
            onBusyChange={setCalendarBusy}
          />
        </div>
        {calendarBusy ? <p role="status">{tracker.calendarBusy}</p> : null}
      </aside>
    </div>
  );
}
