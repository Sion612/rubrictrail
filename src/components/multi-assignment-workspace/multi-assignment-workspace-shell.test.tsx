import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";

import { buildDashboardProjectFixture } from "./multi-assignment-dashboard.test-fixtures";
import { MultiAssignmentWorkspaceShell } from "./multi-assignment-workspace-shell";

const projectA = buildDashboardProjectFixture({
  projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  title: "Fictional assignment A",
  course: "Fictional course A",
  dueDate: "2026-09-10",
});
const projectB = buildDashboardProjectFixture({
  projectId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  title: "Fictional assignment B",
  course: "Fictional course B",
  dueDate: "2026-09-12",
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderShell(
  pendingProjectIds: readonly string[] = [],
  onSelectionApplied: (projectId: string) => boolean | Promise<boolean> = () =>
    true,
) {
  render(
    <LocaleProvider>
      <MultiAssignmentWorkspaceShell
        projects={[projectA, projectB]}
        currentDate="2026-08-20"
        pendingProjectIds={pendingProjectIds}
        onNewAssignment={vi.fn()}
        onSelectionApplied={onSelectionApplied}
        renderAssignment={(project) => (
          <p>Independent draft: {project.state.draftText}</p>
        )}
      />
    </LocaleProvider>,
  );
}

describe("MultiAssignmentWorkspaceShell", () => {
  it("navigates into an assignment and back with deterministic focus", async () => {
    const selectionOrder: string[] = [];
    renderShell([], () => {
      selectionOrder.push(
        screen.queryByRole("heading", { name: "Fictional assignment A" })
          ? "selection-rendered-before-preference"
          : "preference-too-early",
      );
      return true;
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open assignment: Fictional assignment A",
      }),
    );
    const assignmentHeading = await screen.findByRole("heading", {
      level: 1,
      name: "Fictional assignment A",
    });
    await waitFor(() => expect(assignmentHeading).toHaveFocus());
    expect(selectionOrder).toEqual(["selection-rendered-before-preference"]);
    expect(screen.getByText(/Independent draft:/u)).toHaveTextContent(
      projectA.state.draftText,
    );

    fireEvent.click(screen.getByRole("button", { name: "All assignments" }));
    const dashboardHeading = await screen.findByRole("heading", {
      name: "My assignments",
    });
    await waitFor(() => expect(dashboardHeading).toHaveFocus());
  });

  it("blocks an unsafe cross-project switch while the prior project is pending", async () => {
    const { rerender } = render(
      <LocaleProvider>
        <MultiAssignmentWorkspaceShell
          projects={[projectA, projectB]}
          currentDate="2026-08-20"
          pendingProjectIds={[projectA.projectId]}
          onNewAssignment={vi.fn()}
          renderAssignment={() => <p>Independent assignment content</p>}
        />
      </LocaleProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open assignment: Fictional assignment A",
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "All assignments" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Open assignment: Fictional assignment B",
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Finish or resolve the pending save",
    );
    expect(
      screen.queryByRole("heading", {
        level: 1,
        name: "Fictional assignment B",
      }),
    ).not.toBeInTheDocument();

    rerender(
      <LocaleProvider>
        <MultiAssignmentWorkspaceShell
          projects={[projectA, projectB]}
          currentDate="2026-08-20"
          pendingProjectIds={[]}
          onNewAssignment={vi.fn()}
          renderAssignment={() => <p>Independent assignment content</p>}
        />
      </LocaleProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open assignment: Fictional assignment B",
      }),
    );
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Fictional assignment B",
      }),
    ).toBeInTheDocument();
  });

  it("keeps the selected assignment when preference persistence fails", async () => {
    renderShell([], () => false);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open assignment: Fictional assignment B",
      }),
    );

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Fictional assignment B",
      }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "last-opened preference could not be saved",
      ),
    );
  });

  it("supports a controlled assignment selection without mutating it internally", async () => {
    const requested = vi.fn(() => true);
    const { rerender } = render(
      <LocaleProvider>
        <MultiAssignmentWorkspaceShell
          projects={[projectA, projectB]}
          currentDate="2026-08-20"
          selectedProjectId={null}
          onNewAssignment={vi.fn()}
          onSelectionRequested={requested}
          renderAssignment={() => <p>Controlled assignment content</p>}
        />
      </LocaleProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open assignment: Fictional assignment B",
      }),
    );
    await waitFor(() => expect(requested).toHaveBeenCalledWith(projectB.projectId));
    expect(
      screen.queryByRole("heading", {
        level: 1,
        name: "Fictional assignment B",
      }),
    ).not.toBeInTheDocument();

    rerender(
      <LocaleProvider>
        <MultiAssignmentWorkspaceShell
          projects={[projectA, projectB]}
          currentDate="2026-08-20"
          selectedProjectId={projectB.projectId}
          onNewAssignment={vi.fn()}
          onSelectionRequested={requested}
          renderAssignment={() => <p>Controlled assignment content</p>}
        />
      </LocaleProvider>,
    );
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Fictional assignment B",
      }),
    ).toBeInTheDocument();
  });

  it("renders a controlled new-assignment intake beneath workspace navigation", async () => {
    const onDashboardShown = vi.fn();
    render(
      <LocaleProvider>
        <MultiAssignmentWorkspaceShell
          projects={[projectA]}
          currentDate="2026-08-20"
          selectedProjectId={null}
          creationMethod="paste"
          onNewAssignment={vi.fn()}
          onDashboardShown={onDashboardShown}
          renderAssignment={() => null}
          renderNewAssignment={(method) => <p>Creation method: {method}</p>}
        />
      </LocaleProvider>,
    );

    const heading = screen.getByRole("heading", { name: "New assignment" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText("Creation method: paste")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All assignments" }));
    expect(onDashboardShown).toHaveBeenCalledTimes(1);
  });
});
