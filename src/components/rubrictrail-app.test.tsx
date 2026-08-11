import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RubricTrailApp } from "@/components/rubrictrail-app";
import { STORAGE_KEY } from "@/lib/local-state";

const LEGACY_STORAGE_KEY = "proofline.project.v1";

async function advance(milliseconds: number) {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("RubricTrailApp reliability", () => {
  it("writes a recovered legacy project to v2 once hydration succeeds", async () => {
    window.localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify({ sampleLoaded: false }),
    );
    render(<RubricTrailApp />);

    await advance(0);
    expect(
      screen.getByText(/An older local project was recovered/),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    await advance(250);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({
      version: 2,
      projectKind: "none",
    });
  });

  it("does not overwrite incompatible v2 data before the user changes anything", async () => {
    const malformed = "{not valid JSON";
    window.localStorage.setItem(STORAGE_KEY, malformed);
    render(<RubricTrailApp />);

    await advance(1_000);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(malformed);
    expect(
      screen.getByText(/recovered with safe defaults/),
    ).toBeInTheDocument();
  });

  it("flushes the latest edit when the page closes before the debounce", async () => {
    render(<RubricTrailApp />);
    await advance(0);
    fireEvent.click(screen.getByTestId("try-sample"));
    await advance(450);

    fireEvent.click(screen.getAllByRole("button", { name: /Check/i })[0]);
    const draft = screen.getByTestId("draft-text");
    fireEvent.change(draft, {
      target: { value: "A last-second draft edit that must reach local storage." },
    });
    window.dispatchEvent(new Event("pagehide"));

    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({
      projectKind: "sample",
      draftText: "A last-second draft edit that must reach local storage.",
    });
  });

  it("cancels an in-flight demo check when the draft changes", async () => {
    render(<RubricTrailApp />);
    await advance(0);
    fireEvent.click(screen.getByTestId("try-sample"));
    await advance(450);
    fireEvent.click(screen.getAllByRole("button", { name: /Check/i })[0]);

    fireEvent.click(screen.getByTestId("run-draft-check"));
    expect(screen.getByTestId("checking-state")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("draft-text"), {
      target: { value: "The draft changed while the check was running." },
    });
    await advance(2_000);

    expect(screen.queryByTestId("checking-state")).not.toBeInTheDocument();
    expect(screen.queryByTestId("draft-results")).not.toBeInTheDocument();
  });

  it("keeps sample draft input inside the persisted-state limit", async () => {
    render(<RubricTrailApp />);
    await advance(0);
    fireEvent.click(screen.getByTestId("try-sample"));
    await advance(450);
    fireEvent.click(screen.getAllByRole("button", { name: /Check/i })[0]);

    expect(screen.getByTestId("draft-text")).toHaveAttribute(
      "maxlength",
      "100000",
    );
  });
});
