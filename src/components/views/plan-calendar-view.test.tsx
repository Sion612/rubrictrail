import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionPlanView } from "@/components/views/action-plan-view";
import { PlanCalendarView } from "@/components/views/plan-calendar-view";
import { DEFAULT_PLAN_INPUT, generateActionPlan, rebalanceActionPlan } from "@/lib/plan";
import { SAMPLE_ASSIGNMENT } from "@/lib/sample-data";

afterEach(cleanup);

const assignment = {
  id: SAMPLE_ASSIGNMENT.id,
  title: SAMPLE_ASSIGNMENT.title,
  course: SAMPLE_ASSIGNMENT.course,
  dueDate: SAMPLE_ASSIGNMENT.dueAt.slice(0, 10),
};

function renderCalendar(
  plan = generateActionPlan(DEFAULT_PLAN_INPUT),
  onToggleTask = vi.fn(),
  currentDate = "2026-08-26",
) {
  return render(
    <PlanCalendarView
      plan={plan}
      assignment={assignment}
      currentDate={currentDate}
      onToggleTask={onToggleTask}
      onOpenInList={vi.fn()}
    />,
  );
}

describe("project tracker calendar", () => {
  it("keeps Plan on the task list and exposes one tracker shortcut", () => {
    const plan = generateActionPlan(DEFAULT_PLAN_INPUT);
    const onOpenTracker = vi.fn();
    render(
      <ActionPlanView
        plan={plan}
        assignment={assignment}
        onRebalance={vi.fn()}
        onToggleTask={vi.fn()}
        onNavigateDraft={vi.fn()}
        onOpenTracker={onOpenTracker}
      />,
    );
    expect(screen.getByTestId("open-project-tracker")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-calendar-grid")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("open-project-tracker"));
    expect(onOpenTracker).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("plan-calendar")).not.toBeInTheDocument();
  });

  it("uses the same completion callback from the calendar agenda", async () => {
    const onToggleTask = vi.fn();
    const plan = generateActionPlan(DEFAULT_PLAN_INPUT);
    renderCalendar(plan, onToggleTask);
    const firstIncomplete = plan.tasks.find((task) => !task.completed);
    expect(firstIncomplete).toBeTruthy();
    const day = await screen.findByTestId(`calendar-day-${firstIncomplete!.dueDate}`);
    fireEvent.click(day);
    fireEvent.click(screen.getByTestId(`calendar-task-${firstIncomplete!.id}`).querySelector("input") as HTMLInputElement);
    expect(onToggleTask).toHaveBeenCalledWith(firstIncomplete!.id);
  });

  it("lets Previous and Next reach empty months and keeps the selected week in that month", async () => {
    renderCalendar();
    expect(screen.getByTestId("calendar-legend")).toHaveTextContent("Task status");
    expect(screen.getByTestId("plan-calendar-grid").querySelector("button ul")).toBeNull();

    // shiftMonth now anchors on visibleMonth (always 1st), so selectedDate
    // after navigating becomes the first of the target month.
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "June 2026" })).toBeInTheDocument());
    expect(screen.getByTestId("calendar-day-2026-06-01")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("No tasks have a target completion date in this week.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument());
    expect(screen.getByTestId("calendar-day-2026-10-01")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/The assignment deadline is outside this month/)).toBeInTheDocument();
  });

  it("still allows month navigation after every task is complete", async () => {
    const seed = generateActionPlan(DEFAULT_PLAN_INPUT);
    const plan = generateActionPlan({
      ...DEFAULT_PLAN_INPUT,
      completedTaskIds: seed.tasks.map((task) => task.id),
    });
    renderCalendar(plan);
    await waitFor(() => expect(screen.getByRole("heading", { name: "September 2026" })).toBeInTheDocument());
    expect(screen.getByTestId("calendar-day-2026-09-07")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "August 2026" })).toBeInTheDocument());
    expect(screen.getByTestId("calendar-day-2026-08-01")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument());
    expect(screen.getByTestId("calendar-day-2026-10-01")).toHaveAttribute("aria-pressed", "true");
  });

  it("moves a late sample task later when weekly hours drop from 10 to 5", () => {
    const input = {
      weeklyHours: 10,
      planningDepth: "standard" as const,
      startDate: "2026-08-17",
      dueDate: "2026-09-07",
      asOfDate: "2026-08-17",
      completedTaskIds: ["p1"],
    };
    const standard = generateActionPlan(input);
    const reduced = generateActionPlan({ ...input, weeklyHours: 5 });
    const lateId = "p13";
    expect(standard.tasks.find((task) => task.id === lateId)?.dueDate).toBe("2026-08-28");
    expect(reduced.tasks.find((task) => task.id === lateId)?.dueDate).toBe("2026-09-11");
  });

  it("does not snap back the visible month when a task is toggled from an empty month", async () => {
    // Reproduce P1: navigate to a future empty month, then re-render with
    // a rebalanced plan (simulating task completion).  The visible month
    // must remain where the user navigated.
    const plan = generateActionPlan(DEFAULT_PLAN_INPUT);
    const onToggleTask = vi.fn();
    const { rerender } = render(
      <PlanCalendarView
        plan={plan}
        assignment={assignment}
        currentDate="2026-08-26"
        onToggleTask={onToggleTask}
        onOpenInList={vi.fn()}
      />,
    );

    // Navigate forward to October — an empty month with no tasks.
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument());
    expect(screen.getByTestId("calendar-day-2026-10-01")).toHaveAttribute("aria-pressed", "true");

    // Simulate a task toggle: the parent rebalances the plan and re-renders
    // PlanCalendarView with the updated plan.
    const rebalancedPlan = rebalanceActionPlan(plan, { completedTaskIds: ["p1"] });
    rerender(
      <PlanCalendarView
        plan={rebalancedPlan}
        assignment={assignment}
        currentDate="2026-08-26"
        onToggleTask={onToggleTask}
        onOpenInList={vi.fn()}
      />,
    );

    // The visible month MUST stay on October — the user's explicit navigation
    // must not be displaced by schedule reconciliation.
    await waitFor(() => expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument());
    expect(screen.getByTestId("calendar-day-2026-10-01")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/The assignment deadline is outside this month/)).toBeInTheDocument();
  });

  it("keeps planning date distinct while Today and overdue use the real current date", async () => {
    const generated = generateActionPlan({
      ...DEFAULT_PLAN_INPUT,
      startDate: "2026-08-21",
      asOfDate: "2026-08-21",
      dueDate: "2026-09-07",
    });
    const plan = {
      ...generated,
      tasks: generated.tasks.map((task, index) =>
        index === 0 ? { ...task, dueDate: "2026-08-24", completed: false } : task,
      ),
    };
    renderCalendar(plan, vi.fn(), "2026-08-26");

    expect(screen.getByTestId("calendar-day-2026-08-21")).toHaveAccessibleName(
      /planning date/i,
    );
    expect(screen.getByTestId("calendar-day-2026-08-26")).toHaveAccessibleName(/today/i);
    expect(screen.getByTestId("calendar-day-2026-08-24")).toHaveAccessibleName(/overdue/i);
    expect(plan.profile.asOfDate).toBe("2026-08-21");
    expect(plan.tasks[0]?.dueDate).toBe("2026-08-24");

    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() =>
      expect(screen.getByTestId("calendar-day-2026-08-26")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
  });
});
