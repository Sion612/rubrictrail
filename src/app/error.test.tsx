import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ErrorPage from "@/app/error";

const STORAGE_KEY = "rubrictrail.project.v3";
const PREVIOUS_STORAGE_KEY = "rubrictrail.project.v2";
const LEGACY_STORAGE_KEY = "proofline.project.v1";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("ErrorPage recovery", () => {
  it("keeps local projects when destructive reset is not confirmed", () => {
    window.localStorage.setItem(STORAGE_KEY, "current project");
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, "previous project");
    window.localStorage.setItem(LEGACY_STORAGE_KEY, "legacy project");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<ErrorPage error={new Error("test failure")} reset={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset local project" }));

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("cannot be undone"),
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("current project");
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe("previous project");
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBe("legacy project");
  });

  it("refuses to delete a project changed after the recovery page opened", () => {
    window.localStorage.setItem(STORAGE_KEY, "observed project");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);

    render(<ErrorPage error={new Error("test failure")} reset={vi.fn()} />);
    window.localStorage.setItem(STORAGE_KEY, "newer project from another tab");
    fireEvent.click(screen.getByRole("button", { name: "Reset local project" }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(alert).toHaveBeenCalledWith(
      expect.stringContaining("changed after this recovery page opened"),
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      "newer project from another tab",
    );
  });
});
