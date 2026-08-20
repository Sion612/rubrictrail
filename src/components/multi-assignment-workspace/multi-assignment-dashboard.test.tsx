import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LanguageSwitcher } from "@/components/language-switcher";
import { LocaleProvider } from "@/components/locale-provider";

import { MultiAssignmentDashboard } from "./multi-assignment-dashboard";
import { buildDashboardProjectFixture } from "./multi-assignment-dashboard.test-fixtures";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const firstProject = buildDashboardProjectFixture({
  projectId: "11111111-1111-4111-8111-111111111111",
  title: "Fictional market entry analysis",
  course: "International Strategy Lab",
  dueDate: "2026-09-20",
});

const secondProject = buildDashboardProjectFixture({
  projectId: "22222222-2222-4222-8222-222222222222",
  title: "Fictional presentation",
  course: "Language Studio",
  dueDate: "2026-08-19",
  completedTaskIds: [
    "confirm-brief",
    "criterion-1",
    "rubric-outline",
    "draft",
    "rubric-audit",
  ],
});

function renderDashboard(
  projects = [firstProject, secondProject],
  onOpenAssignment = vi.fn(),
  onNewAssignment = vi.fn(),
) {
  render(
    <LocaleProvider>
      <LanguageSwitcher />
      <button type="button" data-testid="intake-focus-target">
        Fictional intake target
      </button>
      <MultiAssignmentDashboard
        projects={projects}
        asOfDate="2026-08-20"
        upNextLimit={12}
        onOpenAssignment={onOpenAssignment}
        onNewAssignment={onNewAssignment}
      />
    </LocaleProvider>,
  );
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "en" },
  });
  return { onOpenAssignment, onNewAssignment };
}

describe("MultiAssignmentDashboard", () => {
  it("renders semantic cards with visible deadlines, progress, target and non-colour status", () => {
    const { onOpenAssignment } = renderDashboard();

    expect(
      screen.getByRole("heading", { level: 1, name: "My assignments" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 assignments")).toBeInTheDocument();

    const firstCard = screen
      .getByRole("heading", { name: "Fictional market entry analysis" })
      .closest("article");
    expect(firstCard).not.toBeNull();
    expect(within(firstCard!).getByText("International Strategy Lab")).toBeInTheDocument();
    expect(within(firstCard!).getByText("20 Sept 2026")).toBeInTheDocument();
    expect(within(firstCard!).getByText("0% complete")).toBeInTheDocument();
    expect(
      within(firstCard!).getByText("Confirm the brief and log open questions"),
    ).toBeInTheDocument();
    expect(within(firstCard!).getByText("5 blocked")).toBeInTheDocument();
    expect(within(firstCard!).getByText("0 overdue")).toBeInTheDocument();

    fireEvent.click(
      within(firstCard!).getByRole("button", {
        name: "Open assignment: Fictional market entry analysis",
      }),
    );
    expect(onOpenAssignment).toHaveBeenCalledWith(firstProject.projectId);
  });

  it("orders real cross-assignment plan tasks and labels blocked work", () => {
    renderDashboard();

    const upNext = screen.getByRole("heading", { name: "Up Next" }).closest("section");
    expect(upNext).not.toBeNull();
    const items = within(upNext!).getAllByRole("listitem");
    expect(items.some((item) => item.textContent?.includes("Complete final submission QA") && item.textContent?.includes("Fictional presentation"))).toBe(true);
    expect(items.some((item) => item.textContent?.includes("Fictional market entry analysis"))).toBe(true);
    expect(items.some((item) => item.textContent?.includes("Blocked"))).toBe(true);
    expect(items.some((item) => item.textContent?.includes("Ready"))).toBe(true);
  });

  it("keeps creation keyboard-accessible, focuses the first method and restores focus on Escape", async () => {
    const { onNewAssignment } = renderDashboard();
    const trigger = screen.getByRole("button", { name: "New assignment" });
    fireEvent.click(trigger);

    const choices = screen.getByRole("group", {
      name: "Choose how to start a new assignment",
    });
    const upload = within(choices).getByRole("button", {
      name: "Upload assignment files",
    });
    await waitFor(() => expect(upload).toHaveFocus());

    fireEvent.keyDown(choices, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("group", {
      name: "Choose how to start a new assignment",
    })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    onNewAssignment.mockImplementation(() => {
      screen.getByTestId("intake-focus-target").focus();
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Paste assignment details" }),
    );
    expect(onNewAssignment).toHaveBeenCalledWith("paste");
    await waitFor(() =>
      expect(screen.getByTestId("intake-focus-target")).toHaveFocus(),
    );
  });

  it("renders a focused zero-assignment state without inventing a project", async () => {
    renderDashboard([]);

    expect(
      screen.getByRole("heading", { name: "No assignments yet" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Stale duplicate title")).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", {
      name: "Create first assignment",
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute(
      "aria-controls",
      screen.getByRole("group", {
        name: "Choose how to start a new assignment",
      }).id,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Upload assignment files" }),
      ).toHaveFocus(),
    );
  });

  it("uses a truthful singular assignment count", () => {
    renderDashboard([firstProject]);

    expect(screen.getByText("1 assignment")).toBeInTheDocument();
    expect(screen.queryByText("1 assignments")).not.toBeInTheDocument();
  });

  it("switches system copy to Simplified Chinese without translating user content", () => {
    renderDashboard();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zh-CN" },
    });

    expect(screen.getByRole("heading", { level: 1, name: "我的作业" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建作业" })).toBeInTheDocument();
    expect(
      screen.getAllByText("Fictional market entry analysis").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("International Strategy Lab")).toBeInTheDocument();
    expect(screen.getAllByText("确认作业说明并记录待解决问题").length).toBeGreaterThan(0);
    expect(screen.getByText("5 项被阻塞")).toBeInTheDocument();
    expect(screen.getAllByText("0 项逾期").length).toBeGreaterThan(0);
  });
});
