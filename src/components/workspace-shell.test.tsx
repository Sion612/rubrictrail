import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMMUNITY_URLS } from "@/components/community-links";
import { WorkspaceShell } from "@/components/workspace-shell";
import type { WorkflowState, WorkspaceView } from "@/lib/ui-types";

afterEach(cleanup);

const stepStates: Record<WorkspaceView, WorkflowState> = {
  overview: "complete",
  rubric: "in_progress",
  plan: "not_started",
  draft: "not_started",
  progress: "not_started",
};

describe("WorkspaceShell community handoff", () => {
  it("opens fixed, keyboard-reachable project links without serializing project data", () => {
    const privateMarker = "PRIVATE-PROJECT-MARKER";
    render(
      <WorkspaceShell
        view="overview"
        onNavigate={vi.fn()}
        onReset={vi.fn()}
        onStartOwnProject={vi.fn()}
        onExportBackup={vi.fn()}
        onImportBackup={vi.fn()}
        isImportingBackup={false}
        progress={20}
        stepStates={stepStates}
        project={{
          course: `${privateMarker}-COURSE`,
          title: `${privateMarker}-TITLE`,
          dueDate: "2026-09-15",
          wordCount: 2_000,
          mode: "uploaded",
        }}
        evidencePanel={null}
      >
        <p>Workspace content</p>
      </WorkspaceShell>,
    );

    const trigger = screen.getByLabelText("Open-source project links");
    expect(trigger.tabIndex).toBe(0);
    fireEvent.click(trigger);
    expect(trigger.closest("details")).toHaveAttribute("open");

    const community = screen.getByRole("navigation", {
      name: "RubricTrail community",
    });
    const links = within(community).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      COMMUNITY_URLS.source,
      COMMUNITY_URLS.report,
      COMMUNITY_URLS.contribute,
    ]);
    for (const link of links) {
      expect(link.tabIndex).toBe(0);
      expect(link.getAttribute("href")).not.toContain(privateMarker);
    }

    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger.closest("details")).not.toHaveAttribute("open");
    expect(trigger).toHaveFocus();
  });

  it("keeps the backup and community menus mutually exclusive for keyboard users", () => {
    render(
      <WorkspaceShell
        view="overview"
        onNavigate={vi.fn()}
        onReset={vi.fn()}
        onStartOwnProject={vi.fn()}
        onExportBackup={vi.fn()}
        onImportBackup={vi.fn()}
        isImportingBackup={false}
        progress={20}
        stepStates={stepStates}
        project={{
          course: "Media Strategy",
          title: "Campaign report",
          dueDate: "2026-09-15",
          wordCount: 2_000,
          mode: "uploaded",
        }}
        evidencePanel={null}
      >
        <p>Workspace content</p>
      </WorkspaceShell>,
    );

    const backupTrigger = screen.getByLabelText("Project backup options");
    const communityTrigger = screen.getByLabelText("Open-source project links");
    fireEvent.click(backupTrigger);
    expect(backupTrigger.closest("details")).toHaveAttribute("open");

    fireEvent.click(communityTrigger);
    expect(backupTrigger.closest("details")).not.toHaveAttribute("open");
    expect(communityTrigger.closest("details")).toHaveAttribute("open");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(communityTrigger.closest("details")).not.toHaveAttribute("open");
    expect(communityTrigger).toHaveFocus();
  });
});
