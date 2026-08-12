import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StorageConflictBanner } from "@/components/storage-conflict-banner";

afterEach(() => {
  cleanup();
});

function renderBanner(context: "project" | "intake" = "project") {
  const onDownloadThisTab = vi.fn();
  const onLoadSavedVersion = vi.fn();
  const onKeepThisTab = vi.fn();
  render(
    <StorageConflictBanner
      context={context}
      onDownloadThisTab={onDownloadThisTab}
      onLoadSavedVersion={onLoadSavedVersion}
      onKeepThisTab={onKeepThisTab}
    />,
  );
  return { onDownloadThisTab, onLoadSavedVersion, onKeepThisTab };
}

describe("StorageConflictBanner", () => {
  it("exposes a named region and a separate concise alert", () => {
    renderBanner();

    const region = screen.getByRole("region", {
      name: "Autosave paused: another tab saved changes",
    });
    const alert = screen.getByRole("alert");

    expect(alert).toHaveTextContent(
      "Autosave paused: another tab saved changes.",
    );
    expect(region).not.toContainElement(alert);
    expect(region).toHaveAccessibleDescription(
      "Your edits in this tab are still here, but they are not being saved while you choose which browser version to use. Loading the saved version replaces changes kept only in this tab. Download this tab backup first if you may need both versions.",
    );
    expect(region).not.toHaveTextContent(/latest/i);
  });

  it("offers explicit project recovery actions without moving focus", () => {
    const callbacks = {
      onDownloadThisTab: vi.fn(),
      onLoadSavedVersion: vi.fn(),
      onKeepThisTab: vi.fn(),
    };
    const { rerender } = render(
      <>
        <button type="button">Continue editing</button>
      </>,
    );
    const editorControl = screen.getByRole("button", { name: "Continue editing" });
    editorControl.focus();

    rerender(
      <>
        <button type="button">Continue editing</button>
        <StorageConflictBanner {...callbacks} />
      </>,
    );

    expect(editorControl).toHaveFocus();
    const region = screen.getByRole("region", {
      name: "Autosave paused: another tab saved changes",
    });
    const download = within(region).getByRole("button", {
      name: "Download this tab backup",
    });
    const load = within(region).getByRole("button", {
      name: "Load saved version",
    });
    const replace = within(region).getByRole("button", {
      name: "Replace saved version with this tab",
    });

    expect(load).toHaveAccessibleDescription(/replaces changes kept only in this tab/i);
    expect(replace).toHaveAccessibleDescription(/replaces changes kept only in this tab/i);
    fireEvent.click(download);
    fireEvent.click(load);
    fireEvent.click(replace);
    expect(callbacks.onDownloadThisTab).toHaveBeenCalledOnce();
    expect(callbacks.onLoadSavedVersion).toHaveBeenCalledOnce();
    expect(callbacks.onKeepThisTab).toHaveBeenCalledOnce();
  });

  it("keeps unsaved intake recovery limited to loading the saved version", () => {
    const callbacks = renderBanner("intake");
    const region = screen.getByRole("region", {
      name: "Autosave paused: another tab saved changes",
    });

    expect(region).toHaveTextContent(
      "A project saved in this browser changed while this intake was open.",
    );
    expect(
      within(region).queryByRole("button", { name: "Download this tab backup" }),
    ).not.toBeInTheDocument();
    expect(
      within(region).queryByRole("button", {
        name: "Replace saved version with this tab",
      }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(region).getByRole("button", {
        name: "Discard intake and load saved version",
      }),
    );
    expect(callbacks.onLoadSavedVersion).toHaveBeenCalledOnce();
    expect(callbacks.onDownloadThisTab).not.toHaveBeenCalled();
    expect(callbacks.onKeepThisTab).not.toHaveBeenCalled();
  });
});
