import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RubricTrailApp } from "@/components/rubrictrail-app";
import {
  createDefaultProjectState,
  PREVIOUS_STORAGE_KEY,
  readProjectStateWithStatus,
  serializePersistedProjectStateValue,
  STORAGE_KEY,
} from "@/lib/local-state";
import { serializeProjectBackup } from "@/lib/project-backup";
import type { PersistedProjectState, UploadedProject } from "@/lib/ui-types";

const LEGACY_STORAGE_KEY = "proofline.project.v1";

async function advance(milliseconds: number) {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
    await Promise.resolve();
  });
}

function uploadedProject(): UploadedProject {
  return {
    id: "restored-project",
    title: "Restored Strategy Report",
    course: "BUS302",
    dueDate: "2026-09-24",
    wordCount: 2_500,
    citationStyle: "APA 7",
    fileNames: ["brief.txt"],
    extractedWordCount: 120,
    weightingStatus: "complete",
    criteria: [
      {
        id: "analysis-1",
        name: "Analysis",
        weight: 100,
        evidence: null,
      },
    ],
    createdAt: "2026-08-12T00:00:00.000Z",
  };
}

function uploadedBackupState(): PersistedProjectState {
  return {
    ...createDefaultProjectState(),
    projectKind: "uploaded",
    uploadedProject: uploadedProject(),
    draftText: "",
  };
}

function backupFile(state: PersistedProjectState): File {
  const serialized = serializeProjectBackup(state, "2026-08-12T08:00:00.000Z");
  const bytes = new TextEncoder().encode(serialized);
  const file = new File([bytes], "project.rubrictrail.json", {
    type: "application/json",
  });
  Object.defineProperty(file, "arrayBuffer", {
    configurable: true,
    value: async () => bytes.buffer,
  });
  return file;
}

async function restoreBackup(input: HTMLElement, state: PersistedProjectState) {
  await act(async () => {
    fireEvent.change(input, { target: { files: [backupFile(state)] } });
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function openSavedSampleCheck() {
  render(<RubricTrailApp />);
  await advance(0);
  fireEvent.click(screen.getByTestId("try-sample"));
  await advance(700);
  fireEvent.click(screen.getAllByRole("button", { name: /Check/i })[0]);
  await advance(250);

  const storedValue = window.localStorage.getItem(STORAGE_KEY);
  if (storedValue === null) throw new Error("Expected a saved sample project");
  return {
    draft: screen.getByTestId("draft-text"),
    storedValue,
  };
}

function storedDraftValue(storedValue: string, draftText: string) {
  const state = JSON.parse(storedValue) as PersistedProjectState;
  return JSON.stringify({ ...state, draftText }, null, 2);
}

function realV2State(
  state: PersistedProjectState,
  patch: Partial<PersistedProjectState> = {},
) {
  const merged = { ...state, ...patch };
  const v2State = { ...merged } as Record<string, unknown>;
  delete v2State.supersededV2Fingerprint;
  let v2UploadedProject: Record<string, unknown> | null = null;
  if (merged.uploadedProject) {
    v2UploadedProject = {
      ...merged.uploadedProject,
    } as unknown as Record<string, unknown>;
    delete v2UploadedProject.weightingStatus;
  }
  return {
    ...v2State,
    version: 2,
    uploadedProject: v2UploadedProject,
  };
}

function dispatchExternalStorageUpdate(
  oldValue: string | null,
  newValue: string | null,
  key = STORAGE_KEY,
) {
  fireEvent(
    window,
    new StorageEvent("storage", {
      key,
      oldValue,
      newValue,
      storageArea: window.localStorage,
      url: window.location.href,
    }),
  );
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
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("RubricTrailApp reliability", () => {
  it("writes a recovered legacy project to v3 once hydration succeeds", async () => {
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
      version: 3,
      projectKind: "none",
    });
  });

  it("promotes a v2 project to v3 only after both storage baselines still match", async () => {
    const previous = realV2State(createDefaultProjectState());
    const previousRaw = JSON.stringify(previous);
    window.localStorage.setItem(
      PREVIOUS_STORAGE_KEY,
      previousRaw,
    );

    render(<RubricTrailApp />);
    await advance(0);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "earlier RubricTrail project was recovered",
    );

    await advance(250);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({
      version: 3,
      projectKind: "none",
    });
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe(previousRaw);
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")
        .supersededV2Fingerprint,
    ).toMatch(/^v1:/);
    expect(readProjectStateWithStatus().crossVersionConflict).toBe(false);
  });

  it("does not overwrite incompatible v3 data before the user changes anything", async () => {
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

  it("keeps exact external bytes when a stale tab edits or closes", async () => {
    const { draft, storedValue } = await openSavedSampleCheck();
    const externalValue = storedDraftValue(
      storedValue,
      "The draft saved by the other tab.",
    );
    window.localStorage.setItem(STORAGE_KEY, externalValue);
    dispatchExternalStorageUpdate(storedValue, externalValue);

    expect(
      screen.getByRole("heading", { name: "Project changed in another tab" }),
    ).toBeInTheDocument();

    fireEvent.change(draft, {
      target: { value: "A stale local draft that must not win silently." },
    });
    await advance(250);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(externalValue);

    window.dispatchEvent(new Event("pagehide"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(externalValue);
    expect(
      screen.getByRole("heading", { name: "Project changed in another tab" }),
    ).toBeInTheDocument();
  });

  it("detects an unannounced external write during pagehide", async () => {
    const { draft, storedValue } = await openSavedSampleCheck();
    const externalValue = storedDraftValue(
      storedValue,
      "External bytes written before this tab could receive an event.",
    );
    window.localStorage.setItem(STORAGE_KEY, externalValue);
    fireEvent.change(draft, {
      target: { value: "A pending local edit flushed immediately on close." },
    });

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
    });

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(externalValue);
    expect(
      screen.getByRole("heading", { name: "Project changed in another tab" }),
    ).toBeInTheDocument();
    await advance(250);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(externalValue);
  });

  it("refuses a confirmed reset after an unannounced external write", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { draft, storedValue } = await openSavedSampleCheck();
    const currentDraft = (draft as HTMLTextAreaElement).value;
    const externalValue = storedDraftValue(
      storedValue,
      "External bytes that reset must not clear.",
    );
    window.localStorage.setItem(STORAGE_KEY, externalValue);

    fireEvent.click(screen.getByRole("button", { name: "Reset local project" }));

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("Reset this local project?"),
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(externalValue);
    expect(screen.getByTestId("draft-text")).toHaveValue(currentDraft);
    expect(screen.getByRole("button", { name: "Use my assignment" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Project changed in another tab" }),
    ).toBeInTheDocument();

    await advance(250);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(externalValue);
  });

  it("loads the exact saved version after confirmation and clears the conflict", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { draft, storedValue } = await openSavedSampleCheck();
    const externalDraft = "The newer draft loaded from browser storage.";
    const externalValue = storedDraftValue(storedValue, externalDraft);
    window.localStorage.setItem(STORAGE_KEY, externalValue);
    dispatchExternalStorageUpdate(storedValue, externalValue);
    fireEvent.change(draft, {
      target: { value: "This tab has a pending draft that should be replaced." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Load saved version" }));

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("Load the project version saved by another tab?"),
    );
    expect(screen.getByTestId("draft-text")).toHaveValue(externalDraft);
    expect(
      screen.queryByRole("heading", { name: "Project changed in another tab" }),
    ).not.toBeInTheDocument();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(externalValue);

    await advance(250);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(externalValue);
  });

  it("keeps the current tab when browser storage cannot be read during load", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { draft, storedValue } = await openSavedSampleCheck();
    const currentDraft = "This in-memory draft must survive a failed read.";
    const externalValue = storedDraftValue(
      storedValue,
      "The other tab's saved draft.",
    );
    window.localStorage.setItem(STORAGE_KEY, externalValue);
    dispatchExternalStorageUpdate(storedValue, externalValue);
    fireEvent.change(draft, { target: { value: currentDraft } });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });

    fireEvent.click(screen.getByRole("button", { name: "Load saved version" }));

    expect(screen.getByTestId("draft-text")).toHaveValue(currentDraft);
    expect(
      screen.getByRole("heading", { name: "Project changed in another tab" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/Browser storage could not be read, so nothing was replaced/),
    ).not.toHaveLength(0);
  });

  it("keeps this tab after confirmation and replaces the external bytes", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { draft, storedValue } = await openSavedSampleCheck();
    const localDraft = "The explicitly chosen draft from this tab.";
    const externalValue = storedDraftValue(
      storedValue,
      "The newer draft currently saved by the other tab.",
    );
    window.localStorage.setItem(STORAGE_KEY, externalValue);
    dispatchExternalStorageUpdate(storedValue, externalValue);
    fireEvent.change(draft, { target: { value: localDraft } });

    fireEvent.click(screen.getByRole("button", { name: "Keep this tab" }));

    const expected = serializePersistedProjectStateValue({
      ...(JSON.parse(storedValue) as PersistedProjectState),
      draftText: localDraft,
    });
    expect(expected.ok).toBe(true);
    if (!expected.ok) throw new Error("Expected the local sample to serialize");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(expected.serialized);
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBe(externalValue);
    expect(
      screen.queryByRole("heading", { name: "Project changed in another tab" }),
    ).not.toBeInTheDocument();
  });

  it("does not offer project overwrite actions for unsaved intake", async () => {
    render(<RubricTrailApp />);
    await advance(0);
    const externalState: PersistedProjectState = {
      ...createDefaultProjectState(),
      projectKind: "sample",
    };
    const serialized = serializePersistedProjectStateValue(externalState);
    if (!serialized.ok) throw new Error("Expected external sample state to serialize");
    window.localStorage.setItem(STORAGE_KEY, serialized.serialized);
    dispatchExternalStorageUpdate(null, serialized.serialized);

    expect(
      screen.getByRole("button", {
        name: "Discard intake and load saved version",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Download this tab" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Keep this tab" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/intake is not part of a saved project yet/i)).toBeInTheDocument();
  });

  it("rejects backup restore after an unannounced external write", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { storedValue } = await openSavedSampleCheck();
    const externalValue = storedDraftValue(
      storedValue,
      "External bytes written without a storage event.",
    );
    window.localStorage.setItem(STORAGE_KEY, externalValue);

    await restoreBackup(
      screen.getByTestId("workspace-backup-file-input"),
      uploadedBackupState(),
    );

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(externalValue);
    expect(
      screen.getByRole("heading", { name: "Project changed in another tab" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("toast")).toHaveTextContent(
      "backup was not restored",
    );

    await advance(250);
    window.dispatchEvent(new Event("pagehide"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(externalValue);
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

  it("rebalances by planning depth without presenting a grade target", async () => {
    render(<RubricTrailApp />);
    await advance(0);
    fireEvent.click(screen.getByTestId("try-sample"));
    await advance(450);
    expect(
      screen.getByRole("button", { name: "RubricTrail: open project brief" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Plan/i })[0]);

    const planningDepth = screen.getByTestId("planning-depth");
    expect(planningDepth).toHaveValue("standard");
    expect(planningDepth).toHaveAccessibleName("Planning depth");
    expect(screen.getByRole("option", { name: "Focused" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Standard" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Thorough" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Extended" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Planning depth adjusts task scope and time allowance only. It does not correspond to or predict a grade.",
      ),
    ).toBeInTheDocument();
    expect(planningDepth).toHaveAccessibleDescription(
      /A balanced plan with a source-and-language review pass\./,
    );
    expect(screen.queryByText("Target band")).not.toBeInTheDocument();

    fireEvent.change(planningDepth, { target: { value: "thorough" } });
    expect(planningDepth).toHaveAccessibleDescription(
      /More time for limitations, alternatives and deeper review\./,
    );
    const rebalance = screen.getByTestId("rebalance-plan");
    rebalance.focus();
    fireEvent.click(rebalance);

    expect(screen.getByTestId("toast")).toHaveTextContent(
      "Plan updated for 10 hours per week with Thorough planning depth.",
    );
    expect(screen.getByTestId("toast")).not.toHaveTextContent("%");
    expect(rebalance).toHaveFocus();
  });

  it("gives sample users a direct, explicit path to their own files", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<RubricTrailApp />);
    await advance(0);
    fireEvent.click(screen.getByTestId("try-sample"));
    await advance(450);

    fireEvent.click(screen.getByRole("button", { name: "Use my assignment" }));
    await advance(16);

    expect(
      screen.getByRole("heading", { name: "Add your assignment" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose files" })).toHaveFocus();
  });

  it("keeps the sample handoff focused and unchanged when exit is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<RubricTrailApp />);
    await advance(0);
    fireEvent.click(screen.getByTestId("try-sample"));
    await advance(450);
    const handoff = screen.getByRole("button", { name: "Use my assignment" });
    handoff.focus();

    fireEvent.click(handoff);

    expect(handoff).toBeInTheDocument();
    expect(handoff).toHaveFocus();
  });

  it("previews pasted sources, preserves them on Back, and never persists the full text", async () => {
    const privateTail = "PRIVATE-TAIL-MUST-NOT-BE-PERSISTED-8F21";
    render(<RubricTrailApp />);
    await advance(0);

    fireEvent.click(screen.getByRole("button", { name: "Paste text" }));
    fireEvent.change(screen.getByTestId("pasted-assignment-brief"), {
      target: {
        value: [
          "Assignment title: Pasted Strategy Report",
          "Deadline: 24 September 2026",
          "Word count: 2500 words",
          "Use APA 7 referencing.",
          privateTail,
        ].join("\n"),
      },
    });
    fireEvent.change(screen.getByTestId("pasted-assignment-rubric"), {
      target: { value: "Rubric\nAnalysis | 60%\nCommunication | 40%" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review assignment details" }));
    await advance(0);

    expect(
      screen.getByRole("heading", { name: "Confirm what the assignment says." }),
    ).toHaveFocus();
    expect(screen.getByText("Pasted assignment brief, Pasted rubric")).toBeInTheDocument();
    expect(screen.getAllByText("Found in pasted text").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Edit pasted text" }));
    await advance(16);
    expect(screen.getByRole("heading", { name: "Paste your assignment text" })).toHaveFocus();
    expect(
      (screen.getByTestId("pasted-assignment-brief") as HTMLTextAreaElement).value,
    ).toContain(privateTail);

    fireEvent.click(screen.getByRole("button", { name: "Review assignment details" }));
    await advance(0);
    fireEvent.click(screen.getByTestId("create-project"));
    await advance(250);

    const stored = window.localStorage.getItem(STORAGE_KEY) ?? "";
    expect(screen.getByRole("heading", { name: "Pasted Strategy Report" })).toBeInTheDocument();
    expect(stored).not.toContain(privateTail);
    expect(stored).toContain("Pasted assignment brief.txt");
  });

  it("pauses v3 autosave when an older tab writes the previous v2 key", async () => {
    const { draft, storedValue } = await openSavedSampleCheck();
    const previousValue = JSON.stringify(
      realV2State(createDefaultProjectState(), {
        projectKind: "sample",
        draftText: "The draft saved by the older RubricTrail tab.",
      }),
    );
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, previousValue);
    dispatchExternalStorageUpdate(null, previousValue, PREVIOUS_STORAGE_KEY);

    expect(
      screen.getByRole("heading", { name: "Project changed in another tab" }),
    ).toBeInTheDocument();
    fireEvent.change(draft, {
      target: { value: "A v3 edit that must wait for conflict resolution." },
    });
    await advance(250);

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(storedValue);
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe(previousValue);
  });

  it("loads and upgrades the exact v2 project that triggered a cross-version conflict", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { storedValue } = await openSavedSampleCheck();
    const previousDraft = "The exact older-version draft the user chose to load.";
    const currentState = JSON.parse(storedValue) as PersistedProjectState;
    const previousValue = JSON.stringify(
      realV2State(currentState, { draftText: previousDraft }),
    );
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, previousValue);
    dispatchExternalStorageUpdate(null, previousValue, PREVIOUS_STORAGE_KEY);

    fireEvent.click(screen.getByRole("button", { name: "Load saved version" }));

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("older RubricTrail tab"),
    );
    expect(screen.getByTestId("draft-text")).toHaveValue(previousDraft);
    expect(
      screen.queryByRole("heading", { name: "Project changed in another tab" }),
    ).not.toBeInTheDocument();
    const promoted = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "{}",
    ) as PersistedProjectState;
    expect(promoted.version).toBe(3);
    expect(promoted.draftText).toBe(previousDraft);
    expect(promoted.supersededV2Fingerprint).toMatch(/^v1:/);
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe(previousValue);
    expect(readProjectStateWithStatus().crossVersionConflict).toBe(false);
  });

  it("creates, saves, and renders an unweighted rubric without invented percentages", async () => {
    render(<RubricTrailApp />);
    await advance(0);

    fireEvent.click(screen.getByRole("button", { name: "Paste text" }));
    fireEvent.change(screen.getByTestId("pasted-assignment-brief"), {
      target: {
        value: [
          "Assignment title: Pasted Unweighted Report",
          "Deadline: 24 September 2026",
          "Word count: 2500 words",
          "Use APA 7 referencing.",
        ].join("\n"),
      },
    });
    fireEvent.change(screen.getByTestId("pasted-assignment-rubric"), {
      target: { value: "Rubric\n- Analysis\n- Communication" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review assignment details" }));
    await advance(0);

    const noPublishedWeights = screen.getByRole("radio", {
      name: /No — no complete percentage breakdown is published/,
    });
    expect(noPublishedWeights).not.toBeChecked();
    fireEvent.click(noPublishedWeights);
    expect(screen.getByTestId("criterion-weight-0")).toHaveValue(null);
    expect(screen.getByTestId("criterion-weight-1")).toHaveValue(null);
    fireEvent.click(screen.getByTestId("create-project"));
    await advance(250);

    const stored = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "{}",
    ) as PersistedProjectState;
    expect(stored.version).toBe(3);
    expect(stored.uploadedProject?.weightingStatus).toBe("none");
    expect(
      stored.uploadedProject?.criteria.map((criterion) => criterion.weight),
    ).toEqual([null, null]);
    expect(
      screen.getByRole("heading", { name: "Pasted Unweighted Report" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole("button", { name: /RubricConfirmed/i })[0],
    );
    expect(screen.getAllByText("Not recorded")).toHaveLength(2);
    expect(screen.getByText(/No grading percentages were recorded/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Plan/i })[0]);
    expect(screen.getByText(/Give every criterion the same planning baseline/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Check/i })[0]);
    expect(screen.getByRole("option", { name: "Analysis" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Communication" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open progress" }));
    expect(screen.getAllByText("No published weight recorded")).toHaveLength(2);
    expect(screen.queryByText(/\d+% of rubric/)).not.toBeInTheDocument();
  });

  it("retains a known partial percentage while keeping the plan neutral", async () => {
    render(<RubricTrailApp />);
    await advance(0);

    fireEvent.click(screen.getByRole("button", { name: "Paste text" }));
    fireEvent.change(screen.getByTestId("pasted-assignment-brief"), {
      target: {
        value: [
          "Assignment title: Pasted Partial Weight Report",
          "Deadline: 24 September 2026",
          "Word count: 2500 words",
          "Use APA 7 referencing.",
        ].join("\n"),
      },
    });
    fireEvent.change(screen.getByTestId("pasted-assignment-rubric"), {
      target: { value: "Rubric\n- Analysis\n- Communication — 40%" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review assignment details" }));
    await advance(0);

    fireEvent.click(
      screen.getByRole("radio", {
        name: /No — no complete percentage breakdown is published/,
      }),
    );
    expect(screen.getByTestId("criterion-weight-0")).toHaveValue(null);
    expect(screen.getByTestId("criterion-weight-1")).toHaveValue(40);
    fireEvent.click(screen.getByTestId("create-project"));
    await advance(250);

    const stored = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "{}",
    ) as PersistedProjectState;
    expect(stored.uploadedProject?.weightingStatus).toBe("incomplete");
    expect(
      stored.uploadedProject?.criteria.map((criterion) => criterion.weight),
    ).toEqual([null, 40]);

    fireEvent.click(
      screen.getAllByRole("button", { name: /RubricConfirmed/i })[0],
    );
    expect(screen.getByText("Not recorded")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(
      screen.getByText(/Known official percentages are retained/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Plan/i })[0]);
    expect(
      screen.getByText(/Give every criterion the same planning baseline/),
    ).toBeInTheDocument();
  });

  it("keeps an empty pasted intake recoverable without changing local storage", async () => {
    render(<RubricTrailApp />);
    await advance(0);
    fireEvent.click(screen.getByRole("button", { name: "Paste text" }));
    fireEvent.click(screen.getByRole("button", { name: "Review assignment details" }));
    await advance(16);

    expect(screen.getByTestId("pasted-assignment-brief")).toHaveFocus();
    expect(screen.getByTestId("pasted-assignment-brief")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    fireEvent.change(screen.getByTestId("pasted-assignment-brief"), {
      target: { value: "Assignment title: Recoverable text" },
    });
    expect(screen.queryByTestId("pasted-text-error")).not.toBeInTheDocument();
  });

  it("requires an explicit decision for partial files and never persists omitted metadata", async () => {
    const readableText = [
      "Assignment title: Partial Strategy Report",
      "Deadline: 24 September 2026",
      "Word count: 2500 words",
      "Use APA 7 referencing.",
      "Rubric",
      "Analysis | 60%",
      "Communication | 40%",
    ].join("\n");
    const omittedTail = "OMITTED-FILE-CONTENT-MUST-NOT-PERSIST-41A9";
    render(<RubricTrailApp />);
    await advance(0);

    await act(async () => {
      fireEvent.change(screen.getByTestId("file-input"), {
        target: {
          files: [
            new File([readableText], "brief.txt", { type: "text/plain" }),
            new File([omittedTail], "legacy-rubric.doc", {
              type: "application/msword",
            }),
          ],
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    await advance(16);

    const partial = screen.getByTestId("partial-upload");
    expect(partial).toHaveFocus();
    expect(partial).toHaveTextContent("We read 1 of 2 files");
    expect(partial).toHaveTextContent("legacy-rubric.doc");

    fireEvent.click(
      screen.getByRole("button", { name: "Paste all text instead" }),
    );
    await advance(16);
    expect(screen.getByRole("heading", { name: "Paste your assignment text" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Upload files" }));
    await advance(16);
    expect(screen.getByTestId("partial-upload")).toHaveFocus();

    fireEvent.click(
      screen.getByRole("button", { name: "Review 1 ready file" }),
    );
    await advance(16);
    expect(
      screen.getByRole("heading", { name: "Confirm what the assignment says." }),
    ).toHaveFocus();
    expect(
      screen.getByRole("heading", {
        name: "This preview uses 1 of the 2 selected files.",
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Review file selection" })[0],
    );
    await advance(16);
    expect(screen.getByTestId("partial-upload")).toHaveFocus();
    fireEvent.click(
      screen.getByRole("button", { name: "Review 1 ready file" }),
    );
    fireEvent.click(screen.getByTestId("create-project"));
    await advance(250);

    const stored = window.localStorage.getItem(STORAGE_KEY) ?? "";
    expect(screen.getByRole("heading", { name: "Partial Strategy Report" })).toBeInTheDocument();
    expect(stored).toContain("brief.txt");
    expect(stored).not.toContain("legacy-rubric.doc");
    expect(stored).not.toContain(omittedTail);
    const backup = serializeProjectBackup(
      JSON.parse(stored) as PersistedProjectState,
      "2026-08-12T08:00:00.000Z",
    );
    expect(backup).toContain("brief.txt");
    expect(backup).not.toContain("legacy-rubric.doc");
    expect(backup).not.toContain(omittedTail);
  });

  it("restores a validated backup from the welcome screen and persists it first", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<RubricTrailApp />);
    await advance(0);

    await restoreBackup(
      screen.getByTestId("backup-file-input"),
      uploadedBackupState(),
    );

    expect(
      screen.getByRole("heading", { name: "Restored Strategy Report" }),
    ).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({
      projectKind: "uploaded",
      uploadedProject: { title: "Restored Strategy Report" },
    });
    expect(screen.getByTestId("toast")).toHaveTextContent(
      "Project restored from backup",
    );
  });

  it("keeps the current project and storage unchanged when replacement is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<RubricTrailApp />);
    await advance(0);
    fireEvent.click(screen.getByTestId("try-sample"));
    await advance(700);
    const before = window.localStorage.getItem(STORAGE_KEY);

    await restoreBackup(
      screen.getByTestId("workspace-backup-file-input"),
      uploadedBackupState(),
    );

    expect(screen.getByRole("button", { name: "Use my assignment" })).toBeInTheDocument();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(before);
    expect(screen.getByLabelText("Project backup options")).toHaveFocus();
  });

  it("does not replace the current project when the imported state cannot be stored", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<RubricTrailApp />);
    await advance(0);
    fireEvent.click(screen.getByTestId("try-sample"));
    await advance(700);
    fireEvent.click(screen.getAllByRole("button", { name: /Check/i })[0]);
    fireEvent.change(screen.getByTestId("draft-text"), {
      target: { value: "A pending edit that still needs its normal autosave." },
    });
    const nativeSetItem = Storage.prototype.setItem;
    let setAttempts = 0;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      setAttempts += 1;
      if (setAttempts === 1) {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      }
      nativeSetItem.call(this, key, value);
    });

    await restoreBackup(
      screen.getByTestId("workspace-backup-file-input"),
      uploadedBackupState(),
    );

    expect(screen.getByRole("button", { name: "Use my assignment" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "backup was not restored",
    );
    await advance(250);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({
      projectKind: "sample",
      draftText: "A pending edit that still needs its normal autosave.",
    });
  });

  it("exports the latest in-memory edit and revokes the download URL", async () => {
    const NativeBlob = globalThis.Blob;
    let backupJson = "";
    class CapturingBlob extends NativeBlob {
      constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
        super(parts, options);
        backupJson = typeof parts[0] === "string" ? parts[0] : "";
      }
    }
    vi.stubGlobal("Blob", CapturingBlob);
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:rubrictrail-backup");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<RubricTrailApp />);
    await advance(0);
    fireEvent.click(screen.getByTestId("try-sample"));
    await advance(450);
    fireEvent.click(screen.getAllByRole("button", { name: /Check/i })[0]);
    fireEvent.change(screen.getByTestId("draft-text"), {
      target: { value: "The latest unsaved-in-debounce draft text." },
    });

    fireEvent.click(screen.getByLabelText("Project backup options"));
    fireEvent.click(screen.getByRole("button", { name: /Download backup/ }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Project backup options")).toHaveFocus();
    expect(JSON.parse(backupJson)).toMatchObject({
      project: { draftText: "The latest unsaved-in-debounce draft text." },
    });
    await advance(0);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:rubrictrail-backup");
  });

  it("closes the project backup menu with Escape and returns focus", async () => {
    render(<RubricTrailApp />);
    await advance(0);
    fireEvent.click(screen.getByTestId("try-sample"));
    await advance(450);
    const summary = screen.getByLabelText("Project backup options");

    fireEvent.click(summary);
    expect(summary.closest("details")).toHaveAttribute("open");
    fireEvent.keyDown(document, { key: "Escape" });

    expect(summary.closest("details")).not.toHaveAttribute("open");
    expect(summary).toHaveFocus();
  });
});
