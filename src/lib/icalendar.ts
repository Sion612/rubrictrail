import { exclusiveIcsEndDate, toIcsDate } from "@/lib/date-only";
import type { ActionPlan, PlanTask } from "@/lib/domain";

export interface CalendarExportAssignment {
  id: string;
  title: string;
  course: string;
  dueDate: string;
}

export interface IcsExportMessages {
  calendarName: string;
  targetDateNote: string;
  deadlineSummary: string;
  deadlineDescription: string;
  phase: string;
  priority: string;
  duration: string;
  plannedStart: string;
  dependencies: string;
  none: string;
  doneWhen: string;
  assignment: string;
  course: string;
}

const MAX_FILENAME_STEM = 48;

export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let offset = 0;
  let limit = 75;
  while (offset < bytes.length) {
    let end = Math.min(offset + limit, bytes.length);
    while (end > offset && (bytes[end] & 0xc0) === 0x80) {
      end -= 1;
    }
    if (end === offset) {
      end = Math.min(offset + limit, bytes.length);
    }
    parts.push(decoder.decode(bytes.slice(offset, end)));
    offset = end;
    limit = 74;
  }
  return parts.map((part, index) => (index === 0 ? part : ` ${part}`)).join("\r\n");
}

export function escapeIcsText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\n", "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}

export function toIcsUtcStamp(value: Date): string {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function calendarEventUid(
  projectId: string,
  kind: "task" | "deadline",
  taskId?: string,
): string {
  const safeProject = projectId.replace(/[^A-Za-z0-9._-]+/g, "-");
  if (kind === "deadline") return `deadline-${safeProject}@rubrictrail.local`;
  return `task-${safeProject}-${String(taskId ?? "unknown").replace(/[^A-Za-z0-9._-]+/g, "-")}@rubrictrail.local`;
}

export function truncateToCodePoints(value: string, max: number): string {
  return Array.from(value).slice(0, max).join("");
}

export function safeIcsFilename(title: string): string {
  const cleaned = title
    .normalize("NFKD")
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, "")
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/[. ]+$/g, "")
    .replace(/^[. -]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  const trimmed = truncateToCodePoints(cleaned, MAX_FILENAME_STEM).replace(/^[-.]+|[-.]+$/g, "");
  return `${trimmed || "rubrictrail-plan"}.ics`;
}

export interface IcsTextFormatters {
  localizePriority: (priority: string) => string;
  formatDuration: (minutes: number) => string;
  formatDateOnly: (value: string) => string;
}

const defaultFormatters: IcsTextFormatters = {
  localizePriority: (priority) => priority,
  formatDuration: (minutes) => {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  },
  formatDateOnly: (value) => value,
};

function vevent(lines: string[]): string[] {
  return ["BEGIN:VEVENT", ...lines, "END:VEVENT"];
}

export function serializeRemainingPlanIcs(
  assignment: CalendarExportAssignment,
  plan: ActionPlan,
  messages: IcsExportMessages,
  now: Date,
  localizeText: (value: string) => string,
  formatters: IcsTextFormatters = defaultFormatters,
): string {
  const stamp = toIcsUtcStamp(now);
  const titles = new Map(plan.tasks.map((task) => [task.id, localizeText(task.title)]));
  const incomplete = plan.tasks.filter((task) => !task.completed);
  const events = [
    ...incomplete.map((task) => taskEvent(assignment, task, messages, stamp, localizeText, formatters, titles)),
    deadlineEvent(assignment, messages, stamp),
  ];
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RubricTrail//Calendar Export 0.7.0//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(messages.calendarName)}`,
    ...events.flat(),
    "END:VCALENDAR",
    "",
  ];
  return `${lines.map(foldIcsLine).join("\r\n")}`;
}

function taskEvent(
  assignment: CalendarExportAssignment,
  task: PlanTask,
  messages: IcsExportMessages,
  stamp: string,
  localizeText: (value: string) => string,
  formatters: IcsTextFormatters,
  titles: Map<string, string>,
): string[] {
  const title = localizeText(task.title);
  const description = [
    messages.targetDateNote,
    `${messages.assignment}: ${assignment.title}`,
    `${messages.course}: ${assignment.course}`,
    `${messages.phase}: ${localizeText(task.phase)}`,
    `${messages.priority}: ${formatters.localizePriority(task.priority)}`,
    `${messages.duration}: ${formatters.formatDuration(task.adjustedMinutes)}`,
    task.scheduledStartDate !== task.dueDate
      ? `${messages.plannedStart}: ${formatters.formatDateOnly(task.scheduledStartDate)}`
      : null,
    `${messages.dependencies}: ${
      task.dependencies.length
        ? task.dependencies.map((id) => titles.get(id) ?? id).join(", ")
        : messages.none
    }`,
    `${messages.doneWhen}: ${task.doneDefinition.map(localizeText).join("; ")}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  return vevent([
    `UID:${calendarEventUid(assignment.id, "task", task.id)}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${toIcsDate(task.dueDate)}`,
    `DTEND;VALUE=DATE:${exclusiveIcsEndDate(task.dueDate)}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
  ]);
}

function deadlineEvent(
  assignment: CalendarExportAssignment,
  messages: IcsExportMessages,
  stamp: string,
): string[] {
  const description = [
    messages.deadlineDescription,
    `${messages.assignment}: ${assignment.title}`,
    `${messages.course}: ${assignment.course}`,
  ].join("\n");
  return vevent([
    `UID:${calendarEventUid(assignment.id, "deadline")}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${toIcsDate(assignment.dueDate)}`,
    `DTEND;VALUE=DATE:${exclusiveIcsEndDate(assignment.dueDate)}`,
    `SUMMARY:${escapeIcsText(messages.deadlineSummary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
  ]);
}

export function downloadIcsFile(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
