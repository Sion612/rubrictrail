import { describe, expect, it } from "vitest";

import { SAMPLE_ASSIGNMENT } from "@/lib/sample-data";

import {
  deriveWorkspaceDashboardModel,
  orderDashboardUpNext,
  type DashboardUpNextItem,
} from "./dashboard-model";
import { buildDashboardProjectFixture } from "./multi-assignment-dashboard.test-fixtures";

const completedUploadedTaskIds = [
  "confirm-brief",
  "criterion-1",
  "rubric-outline",
  "draft",
  "rubric-audit",
];

describe("deriveWorkspaceDashboardModel", () => {
  it("derives identity, progress and real plan tasks from project state without mutating inputs", () => {
    const pastDeadline = buildDashboardProjectFixture({
      projectId: "11111111-1111-4111-8111-111111111111",
      title: "Fictional service analysis",
      course: "Operations Lab",
      dueDate: "2026-08-19",
      completedTaskIds: completedUploadedTaskIds,
    });
    const future = buildDashboardProjectFixture({
      projectId: "22222222-2222-4222-8222-222222222222",
      title: "Fictional language presentation",
      course: "Language Studio",
      dueDate: "2026-09-28",
    });
    const before = JSON.stringify([pastDeadline, future]);

    const model = deriveWorkspaceDashboardModel([pastDeadline, future], {
      currentDate: "2026-08-20",
      upNextLimit: 4,
    });

    expect(model.assignments[0]).toEqual(
      expect.objectContaining({
        projectId: pastDeadline.projectId,
        title: "Fictional service analysis",
        course: "Operations Lab",
        deadline: "2026-08-19",
        blockedCount: 0,
        overdueCount: 1,
        nextTarget: expect.objectContaining({ taskId: "submission-qa" }),
      }),
    );
    expect(model.assignments[0]?.progress).toBeGreaterThan(0);
    expect(model.assignments[0]?.progress).toBeLessThan(100);
    expect(model.assignments[1]).toEqual(
      expect.objectContaining({
        projectId: future.projectId,
        title: "Fictional language presentation",
        progress: 0,
        overdueCount: 1,
      }),
    );
    expect(model.assignments[1]?.blockedCount).toBeGreaterThan(0);
    expect(model.upNext[0]).toEqual(
      expect.objectContaining({
        projectId: pastDeadline.projectId,
        taskId: "submission-qa",
        blocked: false,
        overdue: true,
      }),
    );
    expect(model.upNext.some((item) => item.projectId === future.projectId)).toBe(true);
    expect(JSON.stringify([pastDeadline, future])).toBe(before);
  });

  it("uses the existing sample assignment identity instead of caller-supplied display fields", () => {
    const sample = buildDashboardProjectFixture({
      projectId: "33333333-3333-4333-8333-333333333333",
      title: "Ignored duplicate title",
      course: "Ignored duplicate course",
      dueDate: "2026-12-31",
      kind: "sample",
    });

    expect(
      deriveWorkspaceDashboardModel([sample], { currentDate: "2026-08-20" })
        .assignments[0],
    ).toEqual(
      expect.objectContaining({
        title: SAMPLE_ASSIGNMENT.title,
        course: SAMPLE_ASSIGNMENT.course,
        deadline: SAMPLE_ASSIGNMENT.dueAt.slice(0, 10),
      }),
    );
  });

  it("filters intake-only state and bounds Up Next without inventing an assignment", () => {
    const intakeOnly = buildDashboardProjectFixture({
      projectId: "44444444-4444-4444-8444-444444444444",
      title: "Not yet confirmed",
      course: "Planning Lab",
      dueDate: "2026-10-03",
      kind: "none",
    });

    const model = deriveWorkspaceDashboardModel([intakeOnly], {
      currentDate: "2026-08-20",
      upNextLimit: 0,
    });
    expect(model.assignments).toEqual([]);
    expect(model.upNext).toEqual([]);
  });

  it("fails visibly instead of turning inconsistent uploaded state into an empty workspace", () => {
    const inconsistent = buildDashboardProjectFixture({
      projectId: "55555555-5555-4555-8555-555555555555",
      title: "Missing payload fixture",
      course: "Recovery Lab",
      dueDate: "2026-10-03",
      kind: "none",
    });
    inconsistent.state = {
      ...inconsistent.state,
      projectKind: "uploaded",
      uploadedProject: null,
    };

    expect(() =>
      deriveWorkspaceDashboardModel([inconsistent], { currentDate: "2026-08-20" }),
    ).toThrow("missing its project payload");
  });

  it("orders actionable overdue work before date, workspace order and task order", () => {
    const item = (
      taskId: string,
      dueDate: string,
      workspaceOrder: number,
      taskOrder: number,
      blocked = false,
      overdue = false,
    ): DashboardUpNextItem => ({
      projectId: `project-${workspaceOrder}`,
      assignmentTitle: `Fictional assignment ${workspaceOrder}`,
      taskId,
      title: `Fictional task ${taskId}`,
      dueDate,
      blocked,
      overdue,
      workspaceOrder,
      taskOrder,
    });
    const inputs = [
      item("future", "2026-08-21", 0, 0),
      item("blocked-overdue", "2026-08-18", 0, 1, true, true),
      item("overdue-later", "2026-08-20", 1, 0, false, true),
      item("overdue-earlier", "2026-08-19", 1, 1, false, true),
      item("same-date-later-workspace", "2026-08-22", 1, 0),
      item("same-date-later-task", "2026-08-22", 0, 1),
      item("same-date-earlier-task", "2026-08-22", 0, 0),
    ];

    expect(orderDashboardUpNext(inputs, 7).map((entry) => entry.taskId)).toEqual([
      "overdue-earlier",
      "overdue-later",
      "blocked-overdue",
      "future",
      "same-date-earlier-task",
      "same-date-later-task",
      "same-date-later-workspace",
    ]);
    expect(inputs[0]?.taskId).toBe("future");
  });

  it("advances overdue state with current date without sliding task targets", () => {
    const near = buildDashboardProjectFixture({
      projectId: "66666666-6666-4666-8666-666666666666",
      title: "Fictional near-term analysis",
      course: "Planning Lab",
      dueDate: "2026-08-24",
    });
    const later = buildDashboardProjectFixture({
      projectId: "77777777-7777-4777-8777-777777777777",
      title: "Fictional later analysis",
      course: "Planning Lab",
      dueDate: "2026-09-28",
    });

    const onBaseline = deriveWorkspaceDashboardModel([near, later], {
      currentDate: "2026-08-19",
      upNextLimit: 20,
    });
    const afterTargets = deriveWorkspaceDashboardModel([near, later], {
      currentDate: "2026-08-26",
      upNextLimit: 20,
    });

    expect(
      afterTargets.assignments.map((assignment) => assignment.nextTarget?.dueDate),
    ).toEqual(onBaseline.assignments.map((assignment) => assignment.nextTarget?.dueDate));
    expect(afterTargets.assignments.map((assignment) => assignment.progress)).toEqual(
      onBaseline.assignments.map((assignment) => assignment.progress),
    );
    expect(
      afterTargets.assignments.reduce(
        (total, assignment) => total + assignment.overdueCount,
        0,
      ),
    ).toBeGreaterThan(
      onBaseline.assignments.reduce(
        (total, assignment) => total + assignment.overdueCount,
        0,
      ),
    );
    expect(afterTargets.upNext.some((task) => task.overdue)).toBe(true);
    expect(
      afterTargets.upNext.map(({ projectId, taskId, dueDate }) => ({
        projectId,
        taskId,
        dueDate,
      })),
    ).toEqual(
      expect.arrayContaining(
        onBaseline.upNext.map(({ projectId, taskId, dueDate }) => ({
          projectId,
          taskId,
          dueDate,
        })),
      ),
    );
  });
});
