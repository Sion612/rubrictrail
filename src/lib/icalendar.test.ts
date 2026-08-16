import { describe, expect, it } from "vitest";
import { generateActionPlan, DEFAULT_PLAN_INPUT } from "@/lib/plan";
import {
  calendarEventUid,
  escapeIcsText,
  foldIcsLine,
  safeIcsFilename,
  serializeRemainingPlanIcs,
} from "@/lib/icalendar";

const messages = {
  calendarName: "RubricTrail remaining plan",
  targetDateNote: "This is a target completion date, not a reserved study-time block.",
  deadlineSummary: "Assignment deadline — verify the exact submission time against the original brief",
  deadlineDescription: "Verify any exact submission time against the original brief.",
  phase: "Phase",
  priority: "Priority",
  duration: "Estimated duration",
  plannedStart: "Planned start",
  dependencies: "Dependencies",
  none: "None",
  doneWhen: "Done when",
  assignment: "Assignment",
  course: "Course",
};

describe("iCalendar export", () => {
  const assignment = {
    id: "project-1",
    title: "Strategy Report",
    course: "BUS302",
    dueDate: "2026-08-07",
  };

  it("serializes a complete CRLF calendar with date-only events", () => {
    const plan = generateActionPlan(DEFAULT_PLAN_INPUT);
    const ics = serializeRemainingPlanIcs(
      assignment,
      plan,
      messages,
      new Date("2026-08-16T08:00:00.000Z"),
      (value) => value,
    );
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("PRODID:-//RubricTrail//Calendar Export 0.7.0//EN");
    expect(ics).toContain("DTSTART;VALUE=DATE:");
    expect(ics).toContain("DTEND;VALUE=DATE:");
    expect(ics).not.toMatch(/(?<!\r)\n/);
    expect(ics).not.toContain("TZID");
    expect(ics).not.toContain("VALARM");
    expect(ics).not.toContain("URL:");
    expect(ics).toContain("DTSTAMP:20260816T080000Z");
    expect(ics).toContain(`UID:${calendarEventUid("project-1", "deadline")}`);
    expect(ics).toContain("SUMMARY:Assignment deadline");
    expect(calendarEventUid("project-1", "deadline")).not.toContain("Strategy");
    expect(calendarEventUid("project-1", "task", "p1")).toBe("task-project-1-p1@rubrictrail.local");
  });

  it("exports incomplete tasks and excludes completed ones", () => {
    const plan = generateActionPlan({
      ...DEFAULT_PLAN_INPUT,
      completedTaskIds: ["p1"],
    });
    const ics = serializeRemainingPlanIcs(
      assignment,
      plan,
      messages,
      new Date("2026-08-16T08:00:00.000Z"),
      (value) => value,
    );
    expect(ics).not.toContain("Decode the brief and tag evidence");
    expect(ics).toContain("BEGIN:VEVENT");
    const emptyPlan = generateActionPlan({
      ...DEFAULT_PLAN_INPUT,
      completedTaskIds: plan.tasks.map((task) => task.id),
    });
    const deadlineOnly = serializeRemainingPlanIcs(
      assignment,
      emptyPlan,
      messages,
      new Date("2026-08-16T08:00:00.000Z"),
      (value) => value,
    );
    expect(deadlineOnly.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(deadlineOnly).toContain("DTSTART;VALUE=DATE:20260807");
    expect(deadlineOnly).toContain("DTEND;VALUE=DATE:20260808");
  });

  it("escapes, folds, and keeps Chinese UTF-8 intact", () => {
    expect(escapeIcsText("A;B,C\\D\nE")).toBe("A\\;B\\,C\\\\D\\nE");
    const folded = foldIcsLine(`SUMMARY:${"目标完成日期".repeat(20)}`);
    expect(folded.split("\r\n").every((line, index) => {
      const octets = new TextEncoder().encode(line).length;
      return index === 0 ? octets <= 75 : octets <= 75;
    })).toBe(true);
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(folded))).not.toThrow();
    const ics = serializeRemainingPlanIcs(
      { ...assignment, title: "中文作业，含逗号;和反斜杠\\" },
      generateActionPlan(DEFAULT_PLAN_INPUT),
      { ...messages, calendarName: "剩余计划：中文" },
      new Date("2026-08-16T08:00:00.000Z"),
      (value) => value,
    );
    expect(ics).toContain("中文");
    expect(ics).not.toContain("brief.txt");
    expect(ics).not.toContain("excerpt");
    expect(ics).not.toContain("OCR");
  });

  it("builds a safe filename", () => {
    expect(safeIcsFilename("Strategy Report")).toBe("Strategy-Report.ics");
    expect(safeIcsFilename("../secret\\file")).toBe("secret-file.ics");
    expect(safeIcsFilename("...")).toBe("rubrictrail-plan.ics");
  });
});
