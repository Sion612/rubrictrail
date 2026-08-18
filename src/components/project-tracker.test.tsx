import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";

import { ProjectTracker } from "@/components/project-tracker";
import { LocaleProvider } from "@/components/locale-provider";
import { DEFAULT_PLAN_INPUT, generateActionPlan } from "@/lib/plan";
import { SAMPLE_ASSIGNMENT } from "@/lib/sample-data";

afterEach(cleanup);

function TrackerHarness({ onOpenTask = vi.fn() }: { onOpenTask?: (taskId: string) => void }) {
  const openerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const plan = generateActionPlan(DEFAULT_PLAN_INPUT);
  const assignment = {
    id: SAMPLE_ASSIGNMENT.id,
    title: SAMPLE_ASSIGNMENT.title,
    course: SAMPLE_ASSIGNMENT.course,
    dueDate: SAMPLE_ASSIGNMENT.dueAt.slice(0, 10),
  };

  return (
    <LocaleProvider>
      <button type="button" ref={openerRef} onClick={() => setOpen(true)}>
        Open tracker
      </button>
      {open ? (
        <ProjectTracker
          plan={plan}
          assignment={assignment}
          openerRef={openerRef}
          onClose={() => setOpen(false)}
          onToggleTask={vi.fn()}
          onOpenTask={onOpenTask}
        />
      ) : null}
    </LocaleProvider>
  );
}

describe("ProjectTracker", () => {
  it("opens as a labelled modal, traps focus, and restores the opener on Escape", async () => {
    render(<TrackerHarness />);
    const opener = screen.getByRole("button", { name: "Open tracker" });
    fireEvent.click(opener);

    const dialog = await screen.findByRole("dialog", { name: /project execution summary/i });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Close project tracker" })).toHaveFocus());

    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    expect(focusable.length).toBeGreaterThan(2);
    focusable.at(-1)?.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(focusable[0]).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(focusable.at(-1)).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("shows tracker metrics and sends the selected task to the parent", async () => {
    const onOpenTask = vi.fn();
    render(<TrackerHarness onOpenTask={onOpenTask} />);
    fireEvent.click(screen.getByRole("button", { name: "Open tracker" }));
    await screen.findByRole("dialog", { name: /project execution summary/i });

    const dialog = screen.getByRole("dialog", { name: /project execution summary/i });
    expect(within(dialog).getByText(/^\d+ incomplete$/)).toBeInTheDocument();
    expect(within(dialog).getByText(/^\d+ blocked$/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tracker-open-next-task"));
    expect(onOpenTask).toHaveBeenCalledWith("p1");
  });
});
