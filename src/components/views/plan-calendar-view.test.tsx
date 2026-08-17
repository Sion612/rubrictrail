import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionPlanView } from "@/components/views/action-plan-view";
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

  it("lets Previous and Next reach empty months and keeps the selected week in that month", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "June 2026" })).toBeInTheDocument());
    expect(screen.getByTestId("calendar-day-2026-06-20")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("No tasks have a target completion date in this week.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument());
    expect(screen.getByTestId("calendar-day-2026-10-20")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/The assignment deadline is outside this month/)).toBeInTheDocument();
  });

  it("still allows month navigation after every task is complete", async () => {
    const seed = generateActionPlan(DEFAULT_PLAN_INPUT);
    const plan = generateActionPlan({
      ...DEFAULT_PLAN_INPUT,
      completedTaskIds: seed.tasks.map((task) => task.id),
    });
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
    await waitFor(() => expect(screen.getByRole("heading", { name: "September 2026" })).toBeInTheDocument());
    expect(screen.getByTestId("calendar-day-2026-09-07")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "August 2026" })).toBeInTheDocument());
    expect(screen.getByTestId("calendar-day-2026-08-07")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument());
    expect(screen.getByTestId("calendar-day-2026-10-07")).toHaveAttribute("aria-pressed", "true");
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
});
