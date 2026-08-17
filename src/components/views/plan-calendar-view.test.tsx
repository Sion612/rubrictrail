import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionPlanView } from "@/components/views/action-plan-view";
import { addCalendarMonths } from "@/lib/date-only";
import { DEFAULT_PLAN_INPUT, generateActionPlan } from "@/lib/plan";
import { SAMPLE_ASSIGNMENT } from "@/lib/sample-data";

afterEach(cleanup);

const assignment = {
  id: SAMPLE_ASSIGNMENT.id,
  title: SAMPLE_ASSIGNMENT.title,
  course: SAMPLE_ASSIGNMENT.course,
  dueDate: SAMPLE_ASSIGNMENT.dueAt.slice(0, 10),
};

describe("plan calendar presentation", () => {
  it("defaults to the task list and does not persist the calendar switch", async () => {
    const plan = generateActionPlan(DEFAULT_PLAN_INPUT);
    render(
      <ActionPlanView
        plan={plan}
        assignment={assignment}
        onRebalance={vi.fn()}
        onToggleTask={vi.fn()}
        onNavigateDraft={vi.fn()}
      />,
    );
    expect(screen.getByTestId("plan-task-list")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("plan-calendar-grid")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("plan-calendar"));
    await waitFor(() => expect(screen.getByTestId("plan-calendar-grid")).toBeInTheDocument());
    expect(screen.getByText(/target completion dates/)).toBeInTheDocument();
  });

  it("uses the same completion callback from the calendar agenda", async () => {
    const onToggleTask = vi.fn();
    const plan = generateActionPlan(DEFAULT_PLAN_INPUT);
    render(
      <ActionPlanView
        plan={plan}
        assignment={assignment}
        onRebalance={vi.fn()}
        onToggleTask={onToggleTask}
        onNavigateDraft={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("plan-calendar"));
    const firstIncomplete = plan.tasks.find((task) => !task.completed);
    expect(firstIncomplete).toBeTruthy();
    const day = await screen.findByTestId(`calendar-day-${firstIncomplete!.dueDate}`);
    fireEvent.click(day);
    fireEvent.click(screen.getByTestId(`calendar-task-${firstIncomplete!.id}`).querySelector("input") as HTMLInputElement);
    expect(onToggleTask).toHaveBeenCalledWith(firstIncomplete!.id);
  });

  it("keeps the selected week in the visible month and exposes a status legend", async () => {
    const plan = generateActionPlan(DEFAULT_PLAN_INPUT);
    render(
      <ActionPlanView
        plan={plan}
        assignment={assignment}
        onRebalance={vi.fn()}
        onToggleTask={vi.fn()}
        onNavigateDraft={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("plan-calendar"));
    await waitFor(() => expect(screen.getByTestId("plan-calendar-grid")).toBeInTheDocument());
    expect(screen.getByTestId("calendar-legend")).toHaveTextContent("Task status");
    expect(screen.getByTestId("plan-calendar-grid").querySelector("button ul")).toBeNull();
    const firstIncomplete = plan.tasks.find((task) => !task.completed);
    expect(firstIncomplete).toBeTruthy();
    const initialHeading = screen.getByRole("heading", { level: 2 }).textContent;
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    const moved = addCalendarMonths(firstIncomplete!.dueDate, 1);
    await waitFor(() => expect(screen.getByRole("heading", { level: 2 }).textContent).not.toBe(initialHeading));
    expect(screen.getByTestId(`calendar-day-${moved}`)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Selected week" })).toBeInTheDocument();
  });
});
