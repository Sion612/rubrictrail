import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RubricTrailApp } from "@/components/rubrictrail-app";
import { createDefaultProjectState, STORAGE_KEY } from "@/lib/local-state";
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

  it("gives sample users a direct, explicit path to their own files", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<RubricTrailApp />);
    await advance(0);
    fireEvent.click(screen.getByTestId("try-sample"));
    await advance(450);

    fireEvent.click(screen.getByRole("button", { name: "Use my files" }));
    await advance(16);

    expect(
      screen.getByRole("heading", { name: "Preview, confirm, then plan" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose files" })).toHaveFocus();
  });

  it("keeps the sample handoff focused and unchanged when exit is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<RubricTrailApp />);
    await advance(0);
    fireEvent.click(screen.getByTestId("try-sample"));
    await advance(450);
    const handoff = screen.getByRole("button", { name: "Use my files" });
    handoff.focus();

    fireEvent.click(handoff);

    expect(handoff).toBeInTheDocument();
    expect(handoff).toHaveFocus();
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

    expect(screen.getByRole("button", { name: "Use my files" })).toBeInTheDocument();
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

    expect(screen.getByRole("button", { name: "Use my files" })).toBeInTheDocument();
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
