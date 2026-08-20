"use client";

import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  FilePlus2,
  FileText,
  ListChecks,
  Plus,
  Sparkles,
  Upload,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { useI18n, useLocalizedMessages } from "@/components/locale-provider";
import {
  dashboardEn,
  dashboardZhCN,
  formatDashboardMessage,
} from "@/components/multi-assignment-workspace/dashboard-messages";
import {
  deriveWorkspaceDashboardModel,
  type WorkspaceDashboardProject,
} from "@/components/multi-assignment-workspace/dashboard-model";
import { localizeSystemText } from "@/lib/i18n/messages/views";

import styles from "./multi-assignment-dashboard.module.css";

export type NewAssignmentMethod = "upload" | "paste" | "restore" | "sample";

export interface MultiAssignmentDashboardProps {
  projects: readonly WorkspaceDashboardProject[];
  asOfDate: string;
  onOpenAssignment: (projectId: string) => void;
  onNewAssignment: (method: NewAssignmentMethod) => void;
  upNextLimit?: number;
}

/**
 * Workspace-home surface only. The dormant assignment shell owns its
 * All assignments/brand return control so this never becomes a sixth stage.
 */
export function MultiAssignmentDashboard({
  projects,
  asOfDate,
  onOpenAssignment,
  onNewAssignment,
  upNextLimit = 5,
}: MultiAssignmentDashboardProps) {
  const messages = useLocalizedMessages(dashboardEn, dashboardZhCN);
  const { locale, formatDate, formatNumber } = useI18n();
  const [creationOpen, setCreationOpen] = useState(false);
  const creationOptionsId = useId();
  const headingId = useId();
  const assignmentsHeadingId = useId();
  const upNextHeadingId = useId();
  const firstCreationOptionRef = useRef<HTMLButtonElement>(null);
  const creationOpenerRef = useRef<HTMLButtonElement | null>(null);
  const wasCreationOpenRef = useRef(false);
  const restoreCreationFocusRef = useRef(true);
  const model = useMemo(
    () =>
      deriveWorkspaceDashboardModel(projects, {
        asOfDate,
        upNextLimit,
      }),
    [asOfDate, projects, upNextLimit],
  );

  useEffect(() => {
    if (creationOpen) {
      firstCreationOptionRef.current?.focus();
    } else if (wasCreationOpenRef.current) {
      if (restoreCreationFocusRef.current) {
        creationOpenerRef.current?.focus({ preventScroll: true });
      }
      restoreCreationFocusRef.current = true;
    }
    wasCreationOpenRef.current = creationOpen;
  }, [creationOpen]);

  const dateLabel = (value: string) =>
    formatDate(new Date(`${value}T12:00:00`), { dateStyle: "medium" });
  const countLabel = (template: string, count: number) =>
    formatDashboardMessage(template, { count: formatNumber(count) });

  function toggleCreationOptions(opener: HTMLButtonElement) {
    creationOpenerRef.current = opener;
    restoreCreationFocusRef.current = true;
    setCreationOpen((current) => !current);
  }

  function openCreationOptions(opener: HTMLButtonElement) {
    creationOpenerRef.current = opener;
    restoreCreationFocusRef.current = true;
    setCreationOpen(true);
  }

  function chooseCreationMethod(method: NewAssignmentMethod) {
    restoreCreationFocusRef.current = false;
    setCreationOpen(false);
    onNewAssignment(method);
  }

  return (
    <section className={styles.shell} aria-labelledby={headingId}>
      <header className={styles.header}>
        <div className={styles.headingCopy}>
          <p className={styles.eyebrow}>{messages.workspaceEyebrow}</p>
          <h1
            id={headingId}
            data-workspace-dashboard-heading
            tabIndex={-1}
          >
            {messages.heading}
          </h1>
          <p className={styles.description}>{messages.description}</p>
        </div>

        <div className={styles.creationArea}>
          <button
            type="button"
            className={styles.newAssignmentButton}
            aria-expanded={creationOpen}
            aria-controls={creationOptionsId}
            onClick={(event) => toggleCreationOptions(event.currentTarget)}
          >
            <Plus aria-hidden="true" />
            {messages.newAssignment}
          </button>
          {creationOpen ? (
            <div
              id={creationOptionsId}
              className={styles.creationOptions}
              role="group"
              aria-label={messages.newAssignmentOptions}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  restoreCreationFocusRef.current = true;
                  setCreationOpen(false);
                }
              }}
            >
              <button
                ref={firstCreationOptionRef}
                type="button"
                onClick={() => chooseCreationMethod("upload")}
              >
                <Upload aria-hidden="true" />
                <span>{messages.uploadAssignment}</span>
              </button>
              <button
                type="button"
                onClick={() => chooseCreationMethod("paste")}
              >
                <FileText aria-hidden="true" />
                <span>{messages.pasteAssignment}</span>
              </button>
              <button
                type="button"
                onClick={() => chooseCreationMethod("restore")}
              >
                <FilePlus2 aria-hidden="true" />
                <span>{messages.restoreAssignment}</span>
              </button>
              <button
                type="button"
                onClick={() => chooseCreationMethod("sample")}
              >
                <Sparkles aria-hidden="true" />
                <span>{messages.sampleAssignment}</span>
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {model.assignments.length > 0 ? (
        <>
          <section
            className={styles.assignmentsSection}
            aria-labelledby={assignmentsHeadingId}
          >
            <div className={styles.sectionHeading}>
              <h2 id={assignmentsHeadingId}>{messages.assignmentsHeading}</h2>
              <p>
                {model.assignments.length === 1
                  ? messages.assignmentCountOne
                  : countLabel(messages.assignmentCount, model.assignments.length)}
              </p>
            </div>

            <div className={styles.assignmentGrid}>
              {model.assignments.map((assignment) => {
                const titleId = `${assignmentsHeadingId}-${assignment.projectId}`;
                const progressLabel = formatDashboardMessage(
                  messages.progressValue,
                  { percent: formatNumber(assignment.progress) },
                );

                return (
                  <article
                    key={assignment.projectId}
                    className={styles.assignmentCard}
                    aria-labelledby={titleId}
                  >
                    <div className={styles.cardHeading}>
                      <p className={styles.course}>{assignment.course}</p>
                      <h3 id={titleId}>{assignment.title}</h3>
                    </div>

                    <p className={styles.deadline}>
                      <CalendarDays aria-hidden="true" />
                      <span>{messages.deadline}</span>
                      <time dateTime={assignment.deadline}>
                        {dateLabel(assignment.deadline)}
                      </time>
                    </p>

                    <div className={styles.progressBlock}>
                      <div className={styles.progressHeading}>
                        <span>{messages.progress}</span>
                        <strong>{progressLabel}</strong>
                      </div>
                      <progress
                        max={100}
                        value={assignment.progress}
                        aria-label={`${assignment.title}: ${progressLabel}`}
                      />
                    </div>

                    <div className={styles.nextTarget}>
                      <ListChecks aria-hidden="true" />
                      <div>
                        <span>{messages.nextTarget}</span>
                        <strong>
                          {assignment.nextTarget
                            ? localizeSystemText(assignment.nextTarget.title, locale)
                            : messages.allComplete}
                        </strong>
                      </div>
                    </div>

                    <div className={styles.metrics}>
                      <span
                        className={
                          assignment.blockedCount > 0
                            ? styles.metricWarning
                            : styles.metricNeutral
                        }
                      >
                        {assignment.blockedCount > 0 ? (
                          <CircleAlert aria-hidden="true" />
                        ) : (
                          <CheckCircle2 aria-hidden="true" />
                        )}
                        {countLabel(messages.blockedCount, assignment.blockedCount)}
                      </span>
                      <span
                        className={
                          assignment.overdueCount > 0
                            ? styles.metricDanger
                            : styles.metricNeutral
                        }
                      >
                        {assignment.overdueCount > 0 ? (
                          <AlertTriangle aria-hidden="true" />
                        ) : (
                          <CheckCircle2 aria-hidden="true" />
                        )}
                        {countLabel(messages.overdueCount, assignment.overdueCount)}
                      </span>
                    </div>

                    <button
                      type="button"
                      className={styles.openAssignmentButton}
                      data-workspace-project-open={assignment.projectId}
                      aria-label={formatDashboardMessage(
                        messages.openAssignmentLabel,
                        { title: assignment.title },
                      )}
                      onClick={() => onOpenAssignment(assignment.projectId)}
                    >
                      {messages.openAssignment}
                      <ArrowRight aria-hidden="true" />
                    </button>
                  </article>
                );
              })}
            </div>
          </section>

          <section
            className={styles.upNextSection}
            aria-labelledby={upNextHeadingId}
          >
            <div className={styles.upNextHeading}>
              <div>
                <p className={styles.eyebrow}>{messages.workspaceEyebrow}</p>
                <h2 id={upNextHeadingId}>{messages.upNextHeading}</h2>
              </div>
              <p>{messages.upNextDescription}</p>
            </div>

            {model.upNext.length > 0 ? (
              <ol className={styles.upNextList}>
                {model.upNext.map((task) => (
                  <li key={`${task.projectId}:${task.taskId}`}>
                    <time dateTime={task.dueDate}>{dateLabel(task.dueDate)}</time>
                    <div className={styles.upNextTask}>
                      <strong>{localizeSystemText(task.title, locale)}</strong>
                      <span>{task.assignmentTitle}</span>
                    </div>
                    <div className={styles.taskStatuses}>
                      {task.overdue ? (
                        <span className={styles.statusOverdue}>
                          <AlertTriangle aria-hidden="true" />
                          {messages.overdue}
                        </span>
                      ) : null}
                      {task.blocked ? (
                        <span className={styles.statusBlocked}>
                          <CircleAlert aria-hidden="true" />
                          {messages.blocked}
                        </span>
                      ) : null}
                      {!task.overdue && !task.blocked ? (
                        <span className={styles.statusReady}>
                          <CheckCircle2 aria-hidden="true" />
                          {messages.ready}
                        </span>
                      ) : null}
                    </div>
                    <span className={styles.targetDate}>
                      {formatDashboardMessage(messages.targetDate, {
                        date: dateLabel(task.dueDate),
                      })}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className={styles.allComplete}>
                <CheckCircle2 aria-hidden="true" />
                {messages.allComplete}
              </p>
            )}
          </section>
        </>
      ) : (
        <section className={styles.emptyState} aria-labelledby={assignmentsHeadingId}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <ListChecks />
          </span>
          <h2 id={assignmentsHeadingId}>{messages.emptyHeading}</h2>
          <p>{messages.emptyDescription}</p>
          <button
            type="button"
            className={styles.emptyAction}
            aria-expanded={creationOpen}
            aria-controls={creationOptionsId}
            onClick={(event) => openCreationOptions(event.currentTarget)}
          >
            <Plus aria-hidden="true" />
            {messages.createFirst}
          </button>
        </section>
      )}
    </section>
  );
}
