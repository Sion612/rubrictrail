import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  friendlyFileError,
  RubricTrailApp,
  type ExistingWorkspaceSession,
  type NewWorkspaceSession,
} from "@/components/rubrictrail-app";
import { LocaleProvider } from "@/components/locale-provider";
import { assignmentFileIssueReason } from "@/lib/file-intake-messages";
import {
  AssignmentFileBatchParseError,
  AssignmentFileParseError,
} from "@/lib/files/parse-assignment-files";
import {
  createDefaultProjectState,
  PREVIOUS_STORAGE_KEY,
  PROJECT_LOCK_NAME,
  PROJECT_RECORD_KEY,
  readProjectStateWithStatus,
  serializePersistedProjectStateValue,
  STORAGE_KEY,
  type ProjectStorageRecordV1,
} from "@/lib/local-state";
import { serializeProjectBackup } from "@/lib/project-backup";
import { buildUploadedPlanTemplates } from "@/lib/uploaded-project";
import type { PersistedProjectState, UploadedProject } from "@/lib/ui-types";
import {
  createFifoLockManager,
  holdLock,
  installLockManager,
  removeLockManager,
} from "../../tests/web-locks-mock";

const LEGACY_STORAGE_KEY = "proofline.project.v1";

async function advance(milliseconds: number) {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
    await Promise.resolve();
  });
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function loadDeferredModule(loader: () => Promise<unknown>) {
  await act(async () => {
    await loader();
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
  await loadDeferredModule(() => import("@/components/views/draft-check-view"));
  await advance(250);

  const storedValue = window.localStorage.getItem(PROJECT_RECORD_KEY);
  if (storedValue === null) throw new Error("Expected a saved sample project");
  return {
    draft: screen.getByTestId("draft-text"),
    storedValue,
  };
}

function projectRecord(storedValue: string): ProjectStorageRecordV1 {
  return JSON.parse(storedValue) as ProjectStorageRecordV1;
}

function storedProjectState(storedValue: string): PersistedProjectState {
  const record = projectRecord(storedValue);
  if (record.value.kind !== "project") {
    throw new Error("Expected an active saved project record");
  }
  return record.value.state;
}

function currentStoredProjectState(): PersistedProjectState {
  const storedValue = window.localStorage.getItem(PROJECT_RECORD_KEY);
  if (storedValue === null) throw new Error("Expected a saved project record");
  return storedProjectState(storedValue);
}

function storedDraftValue(storedValue: string, draftText: string) {
  const record = projectRecord(storedValue);
  if (record.value.kind !== "project") {
    throw new Error("Expected an active saved project record");
  }
  return JSON.stringify({
    ...record,
    revision: record.revision + 1,
    value: {
      kind: "project",
      state: { ...record.value.state, draftText },
    },
  } satisfies ProjectStorageRecordV1);
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
  key = PROJECT_RECORD_KEY,
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

let testLocks: ReturnType<typeof createFifoLockManager>;
let restoreLockManager: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  testLocks = createFifoLockManager();
  restoreLockManager = installLockManager(testLocks.manager);
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
  restoreLockManager?.();
  restoreLockManager = null;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("RubricTrailApp reliability", () => {
  it("autosaves a controlled assignment after the 250ms debounce without touching legacy storage", async () => {
    const nextStates: PersistedProjectState[] = [];
    const onFlush = vi.fn().mockResolvedValue("saved");
    const session: ExistingWorkspaceSession = {
      mode: "existing",
      projectId: "workspace-project-a",
      authorityEpoch: 0,
      project: {
        ...createDefaultProjectState(),
        projectKind: "sample",
        view: "draft",
        visitedViews: ["overview", "rubric", "plan", "draft"],
        draftText: "A controlled assignment draft.",
      },
      onProjectChange: (next) => {
        nextStates.push(next);
        return true;
      },
      onFlush,
      onReplaceProject: vi.fn().mockResolvedValue(true),
      onRequestManagement: vi.fn(),
    };
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");

    const rendered = render(<RubricTrailApp workspaceSession={session} />);
    await advance(0);
    await loadDeferredModule(() => import("@/components/views/draft-check-view"));

    expect(screen.getByTestId("draft-text")).toHaveValue(
      "A controlled assignment draft.",
    );
    fireEvent.change(screen.getByTestId("draft-text"), {
      target: { value: "A controlled edit queued by the workspace." },
    });
    expect(nextStates.at(-1)?.draftText).toBe(
      "A controlled edit queued by the workspace.",
    );

    rendered.rerender(
      <RubricTrailApp
        workspaceSession={{
          ...session,
          project: { ...session.project },
        }}
      />,
    );
    await advance(0);
    expect(screen.getByTestId("draft-text")).toHaveValue(
      "A controlled edit queued by the workspace.",
    );

    await advance(249);
    expect(onFlush).not.toHaveBeenCalled();
    await advance(1);
    expect(onFlush).toHaveBeenCalledTimes(1);
    await advance(1_000);
    expect(onFlush).toHaveBeenCalledTimes(1);

    const legacyKeys = new Set([
      PROJECT_RECORD_KEY,
      STORAGE_KEY,
      PREVIOUS_STORAGE_KEY,
      LEGACY_STORAGE_KEY,
    ]);
    expect(getItem.mock.calls.some(([key]) => legacyKeys.has(key))).toBe(false);
    expect(setItem.mock.calls.some(([key]) => legacyKeys.has(key))).toBe(false);
    expect(removeItem.mock.calls.some(([key]) => legacyKeys.has(key))).toBe(false);
    expect(screen.getByRole("button", { name: "Use my assignment" })).toBeInTheDocument();
  });

  it("rehydrates a same-ID controlled assignment only after an explicit authority epoch change", async () => {
    const nextStates: PersistedProjectState[] = [];
    const onFlush = vi.fn().mockResolvedValue("saved");
    const initial: PersistedProjectState = {
      ...createDefaultProjectState(),
      projectKind: "sample",
      view: "draft",
      visitedViews: ["overview", "rubric", "plan", "draft"],
      draftText: "Original authority draft.",
    };
    const session: ExistingWorkspaceSession = {
      mode: "existing",
      projectId: "workspace-project-authority",
      authorityEpoch: 0,
      project: initial,
      onProjectChange: (next) => {
        nextStates.push(next);
        return true;
      },
      onFlush,
      onReplaceProject: vi.fn().mockResolvedValue(true),
      onRequestManagement: vi.fn(),
    };
    const rendered = render(<RubricTrailApp workspaceSession={session} />);
    await advance(0);
    await loadDeferredModule(() => import("@/components/views/draft-check-view"));

    fireEvent.change(screen.getByTestId("draft-text"), {
      target: { value: "Pending local edit." },
    });
    rendered.rerender(
      <RubricTrailApp
        workspaceSession={{
          ...session,
          project: { ...initial },
        }}
      />,
    );
    await advance(0);
    expect(screen.getByTestId("draft-text")).toHaveValue("Pending local edit.");

    const replacement: PersistedProjectState = {
      ...initial,
      view: "draft",
      visitedViews: ["overview", "rubric", "plan", "draft"],
      draftText: "Restored authority draft.",
      targetGrade: 82,
    };
    rendered.rerender(
      <RubricTrailApp
        workspaceSession={{
          ...session,
          authorityEpoch: 1,
          project: replacement,
        }}
      />,
    );
    await advance(0);
    expect(screen.getByTestId("draft-text")).toHaveValue("Restored authority draft.");
    await advance(250);
    expect(onFlush).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("draft-text"), {
      target: { value: "Edit after authoritative restore." },
    });
    expect(nextStates.at(-1)).toEqual(expect.objectContaining({
      projectKind: "sample",
      draftText: "Edit after authoritative restore.",
      targetGrade: 82,
    }));
    await advance(250);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("flushes a controlled edit once on pagehide and cancels a later debounce on unmount", async () => {
    const onFlush = vi.fn().mockResolvedValue("saved");
    const session: ExistingWorkspaceSession = {
      mode: "existing",
      projectId: "workspace-project-pagehide",
      authorityEpoch: 0,
      project: {
        ...createDefaultProjectState(),
        projectKind: "sample",
        view: "draft",
        visitedViews: ["overview", "rubric", "plan", "draft"],
        draftText: "A controlled assignment draft.",
      },
      onProjectChange: vi.fn().mockReturnValue(true),
      onFlush,
      onReplaceProject: vi.fn().mockResolvedValue(true),
      onRequestManagement: vi.fn(),
    };
    const rendered = render(<RubricTrailApp workspaceSession={session} />);
    await advance(0);
    await loadDeferredModule(() => import("@/components/views/draft-check-view"));

    fireEvent.change(screen.getByTestId("draft-text"), {
      target: { value: "Flush this edit when the page is hidden." },
    });
    window.dispatchEvent(new Event("pagehide"));
    await flushMicrotasks();

    expect(onFlush).toHaveBeenCalledTimes(1);
    await advance(250);
    expect(onFlush).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByTestId("draft-text"), {
      target: { value: "Cancel this pending debounce on unmount." },
    });
    rendered.unmount();
    await advance(250);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("deduplicates pagehide against a controlled debounce flush already in flight", async () => {
    let resolveFlush!: (outcome: "saved") => void;
    const flushPromise = new Promise<"saved">((resolve) => {
      resolveFlush = resolve;
    });
    const onFlush = vi.fn(() => flushPromise);
    const session: ExistingWorkspaceSession = {
      mode: "existing",
      projectId: "workspace-project-in-flight",
      authorityEpoch: 0,
      project: {
        ...createDefaultProjectState(),
        projectKind: "sample",
        view: "draft",
        visitedViews: ["overview", "rubric", "plan", "draft"],
        draftText: "A controlled assignment draft.",
      },
      onProjectChange: vi.fn().mockReturnValue(true),
      onFlush,
      onReplaceProject: vi.fn().mockResolvedValue(true),
      onRequestManagement: vi.fn(),
    };
    render(<RubricTrailApp workspaceSession={session} />);
    await advance(0);
    await loadDeferredModule(() => import("@/components/views/draft-check-view"));

    fireEvent.change(screen.getByTestId("draft-text"), {
      target: { value: "Keep one flush while pagehide races the coordinator." },
    });
    await advance(250);
    expect(onFlush).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("pagehide"));
    await flushMicrotasks();
    expect(onFlush).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFlush("saved");
      await Promise.resolve();
      await Promise.resolve();
    });
    await advance(1_000);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("routes controlled reset to workspace management without confirming or deleting", async () => {
    const onRequestManagement = vi.fn();
    const onProjectChange = vi.fn().mockReturnValue(true);
    const onFlush = vi.fn().mockResolvedValue("saved");
    const confirm = vi.spyOn(window, "confirm");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const session: ExistingWorkspaceSession = {
      mode: "existing",
      projectId: "workspace-project-management",
      authorityEpoch: 0,
      project: {
        ...createDefaultProjectState(),
        projectKind: "sample",
        view: "overview",
        visitedViews: ["overview"],
      },
      onProjectChange,
      onFlush,
      onReplaceProject: vi.fn().mockResolvedValue(true),
      onRequestManagement,
    };

    render(<RubricTrailApp workspaceSession={session} />);
    await advance(0);
    fireEvent.click(screen.getByRole("button", { name: "Reset local project" }));

    expect(onRequestManagement).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(onProjectChange).not.toHaveBeenCalled();
    expect(onFlush).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it("keeps standalone reset behind its existing confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<RubricTrailApp />);
    await advance(0);
    fireEvent.click(screen.getByTestId("try-sample"));
    await advance(450);

    fireEvent.click(screen.getByRole("button", { name: "Reset local project" }));

    expect(confirm).toHaveBeenCalledWith(
      "Reset this local project? This clears saved draft excerpts, checks, results and task progress from this browser.",
    );
    expect(screen.getByRole("button", { name: "Use my assignment" })).toBeInTheDocument();
  });

  it("creates a new workspace assignment from pasted intake without touching legacy storage", async () => {
    const onCreateProject = vi.fn().mockResolvedValue(true);
    const session: NewWorkspaceSession = {
      mode: "new",
      initialIntakeMode: "paste",
      onCreateProject,
    };
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    render(<RubricTrailApp workspaceSession={session} />);
    await advance(0);

    expect(screen.getByTestId("pasted-assignment-brief")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("pasted-assignment-brief"), {
      target: {
        value: [
          "Assignment title: Workspace intake report",
          "Deadline: 24 September 2026",
          "Word count: 2500 words",
          "Use APA 7 referencing.",
        ].join("\n"),
      },
    });
    fireEvent.change(screen.getByTestId("pasted-assignment-rubric"), {
      target: { value: "Rubric\nAnalysis | 100%" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review assignment details" }));
    await advance(0);
    await loadDeferredModule(() => import("@/components/upload-summary-view"));
    const createButton = screen.getByTestId("create-project");
    expect(createButton).not.toBeDisabled();
    fireEvent.click(createButton);
    await flushMicrotasks();

    expect(onCreateProject).toHaveBeenCalledWith(
      expect.objectContaining({
        projectKind: "uploaded",
        uploadedProject: expect.objectContaining({ title: "Workspace intake report" }),
      }),
      "intake",
    );
    expect(setItem.mock.calls.some(([key]) => key === PROJECT_RECORD_KEY)).toBe(false);
  });

  it("routes controlled backup restore to replace for an existing assignment and create for a new assignment", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const replacement = vi.fn().mockResolvedValue(true);
    const existing: ExistingWorkspaceSession = {
      mode: "existing",
      projectId: "workspace-project-b",
      authorityEpoch: 0,
      project: {
        ...createDefaultProjectState(),
        projectKind: "sample",
        view: "overview",
        visitedViews: ["overview"],
      },
      onProjectChange: vi.fn().mockReturnValue(true),
      onFlush: vi.fn().mockResolvedValue("saved"),
      onReplaceProject: replacement,
      onRequestManagement: vi.fn(),
    };
    const existingRender = render(<RubricTrailApp workspaceSession={existing} />);
    await advance(0);
    await restoreBackup(
      screen.getByTestId("workspace-backup-file-input"),
      uploadedBackupState(),
    );
    expect(replacement).toHaveBeenCalledWith(
      expect.objectContaining({ projectKind: "uploaded" }),
    );

    existingRender.unmount();
    const creation = vi.fn().mockResolvedValue(true);
    const created: NewWorkspaceSession = {
      mode: "new",
      initialIntakeMode: "files",
      onCreateProject: creation,
    };
    render(<RubricTrailApp workspaceSession={created} />);
    await advance(0);
    await restoreBackup(screen.getByTestId("backup-file-input"), uploadedBackupState());
    expect(creation).toHaveBeenCalledWith(
      expect.objectContaining({ projectKind: "uploaded" }),
      "backup",
    );
  });

  it("keeps a deferred evidence load inside a non-interactive fixed drawer shell", async () => {
    render(
      <LocaleProvider>
        <RubricTrailApp />
      </LocaleProvider>,
    );
    await advance(0);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "en" } });
    fireEvent.click(screen.getByTestId("try-sample"));
    await advance(700);
    await loadDeferredModule(() => import("@/components/views/overview-view"));

    fireEvent.click(screen.getAllByRole("button", { name: /Open source 1 for/i })[0]);

    const shell = screen.getByTestId("deferred-evidence-shell");
    expect(shell).toHaveClass("evidence-panel-shell");
    expect(shell.parentElement).toHaveClass("app-shell");
    expect(shell.querySelector(".evidence-panel-shell__backdrop")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(
      within(shell).getByRole("status", { name: "Loading RubricTrail" }),
    ).toBeInTheDocument();
    expect(within(shell).queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("relocalizes an active notice without rerunning the completed action", async () => {
    render(
      <LocaleProvider>
        <RubricTrailApp />
      </LocaleProvider>,
    );
    await advance(0);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "en" } });
    fireEvent.click(screen.getByTestId("try-sample"));
    await advance(450);
    expect(screen.getByTestId("toast")).toHaveTextContent(
      "Sample mapped with traceable evidence links",
    );

    fireEvent.change(screen.getByLabelText("Interface language"), {
      target: { value: "zh-CN" },
    });
    expect(screen.getByTestId("toast")).toHaveTextContent(
      "示例已映射到可追溯的原文依据",
    );
  });

  it("keeps an unsaved draft edit when the interface language changes", async () => {
    window.localStorage.setItem(
      "rubrictrail.preferences.v1",
      JSON.stringify({ version: 1, locale: "en" }),
    );
    render(
      <LocaleProvider>
        <RubricTrailApp />
      </LocaleProvider>,
    );
    await advance(0);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "en" } });
    fireEvent.click(screen.getByTestId("try-sample"));
    await advance(700);
    fireEvent.click(screen.getAllByRole("button", { name: /Check/i })[0]);
    await loadDeferredModule(() => import("@/components/views/draft-check-view"));

    const pendingDraft = "This edit must survive an immediate language switch.";
    fireEvent.change(screen.getByTestId("draft-text"), {
      target: { value: pendingDraft },
    });
    fireEvent.change(screen.getByLabelText("Interface language"), {
      target: { value: "zh-CN" },
    });
    await advance(0);

    expect(screen.getByTestId("draft-text")).toHaveValue(pendingDraft);
    expect(screen.getByLabelText("界面语言")).toHaveValue("zh-CN");
    await advance(250);
    await flushMicrotasks();
    expect(currentStoredProjectState().draftText).toBe(pendingDraft);
  });

  it("keeps a no-lock project visibly tab-only and never claims autosave", async () => {
    restoreLockManager?.();
    restoreLockManager = null;
    removeLockManager();
    render(<RubricTrailApp />);
    await advance(0);

    fireEvent.click(screen.getByRole("button", { name: "Paste text" }));
    fireEvent.change(screen.getByTestId("pasted-assignment-brief"), {
      target: {
        value: [
          "Assignment title: Tab-only Strategy Report",
          "Deadline: 24 September 2026",
          "Word count: 2500 words",
          "Use APA 7 referencing.",
        ].join("\n"),
      },
    });
    fireEvent.change(screen.getByTestId("pasted-assignment-rubric"), {
      target: { value: "Rubric\nAnalysis | 60%\nCommunication | 40%" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Review assignment details" }),
    );
    await advance(0);
    await loadDeferredModule(() => import("@/components/upload-summary-view"));
    fireEvent.click(screen.getByTestId("create-project"));

    expect(
      screen.getByRole("region", { name: "Browser saving is unavailable" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Download project backup" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("toast")).toHaveTextContent(
      "Local project created in this tab",
    );
    expect(screen.getByTestId("toast")).not.toHaveTextContent(/autosave/i);
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBeNull();

    await advance(4_000);
    expect(
      screen.getByRole("region", { name: "Browser saving is unavailable" }),
    ).toBeInTheDocument();
  });

  it.each([
    {
      code: "PDF_TOO_MANY_PAGES",
      fileName: "long-brief.pdf",
      expectedFileName: "long-brief.pdf",
      title: "This PDF has too many pages to process at once.",
      message: "200 pages or fewer",
    },
    {
      code: "TOTAL_PDF_PAGES_TOO_LARGE",
      fileName: "second-brief.pdf",
      expectedFileName: null,
      title: "The selected PDFs have too many pages to process at once.",
      message: "400 pages or fewer combined",
    },
    {
      code: "EXTRACTED_TEXT_TOO_MANY_LINES",
      fileName: "second-brief.txt",
      expectedFileName: null,
      title: "The selected files contain too many lines to process at once.",
      message: "50,000 lines or fewer combined",
    },
    {
      code: "EXTRACTED_TEXT_TOO_MANY_WORDS",
      fileName: "second-brief.txt",
      expectedFileName: null,
      title: "The selected files contain too many words to process at once.",
      message: "100,000 words or fewer combined",
    },
    {
      code: "EXTRACTED_TEXT_TOO_LARGE",
      fileName: "second-brief.txt",
      expectedFileName: null,
      title: "The selected files contain too much text to process at once.",
      message: "2,000,000 characters or fewer combined",
    },
  ] as const)(
    "maps $code to scoped, actionable recovery copy",
    ({ code, fileName, expectedFileName, title, message }) => {
      const recovery = friendlyFileError(
        new AssignmentFileParseError(code, "Internal parser detail", fileName),
      );

      expect(recovery).toMatchObject({
        code,
        fileName: expectedFileName,
        title,
        preferredRecovery: "paste",
      });
      expect(recovery.message).toContain(message);
    },
  );

  it("uses binary units and exact bounded-parser issue reasons", () => {
    expect(assignmentFileIssueReason("FILE_TOO_LARGE")).toContain("10 MiB");
    expect(assignmentFileIssueReason("TOTAL_FILE_SIZE_TOO_LARGE")).toContain(
      "25 MiB",
    );
    expect(assignmentFileIssueReason("PDF_TOO_MANY_PAGES")).toBe(
      "The PDF contains more than 200 pages.",
    );
    expect(assignmentFileIssueReason("TOTAL_PDF_PAGES_TOO_LARGE")).toBe(
      "The selected PDFs contain more than 400 pages combined.",
    );
    expect(assignmentFileIssueReason("EXTRACTED_TEXT_TOO_MANY_LINES")).toBe(
      "The readable text contains more than 50,000 lines in total.",
    );
    expect(assignmentFileIssueReason("EXTRACTED_TEXT_TOO_MANY_WORDS")).toBe(
      "The readable text contains more than 100,000 words in total.",
    );
    expect(assignmentFileIssueReason("INVALID_TEXT_ENCODING")).toBe(
      "The TXT file is not valid UTF-8 text.",
    );
  });

  it("maps invalid UTF-8 to accurate save-as-UTF-8 recovery", () => {
    const failure = {
      inputIndex: 0,
      fileName: "legacy-encoding.txt",
      code: "INVALID_TEXT_ENCODING" as const,
      message: "Internal decoder detail",
    };

    const recovery = friendlyFileError(
      new AssignmentFileBatchParseError([failure]),
    );

    expect(recovery).toEqual({
      code: "INVALID_TEXT_ENCODING",
      fileName: "legacy-encoding.txt",
      title: "This TXT file is not valid UTF-8.",
      message:
        "Save it as UTF-8 text, choose a fresh copy, or paste the assignment text.",
      preferredRecovery: "files",
      fileIssues: [],
    });
  });

  it("writes a recovered legacy project to the canonical record once hydration succeeds", async () => {
    window.localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify({ sampleLoaded: false }),
    );
    render(<RubricTrailApp />);

    await advance(0);
    expect(
      screen.getByText(/An older local project was recovered/),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    await advance(250);
    expect(currentStoredProjectState()).toMatchObject({
      version: 3,
      projectKind: "none",
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("promotes a v2 project to the canonical record only after all baselines still match", async () => {
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
    expect(currentStoredProjectState()).toMatchObject({
      version: 3,
      projectKind: "none",
    });
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe(previousRaw);
    expect(
      currentStoredProjectState().supersededV2Fingerprint,
    ).toMatch(/^v1:/);
    expect(readProjectStateWithStatus().crossVersionConflict).toBe(false);
  });

  it("does not overwrite incompatible v3 data before the user changes anything", async () => {
    const malformed = "{not valid JSON";
    window.localStorage.setItem(STORAGE_KEY, malformed);
    render(<RubricTrailApp />);

    await advance(1_000);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(malformed);
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBeNull();
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
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(currentStoredProjectState()).toMatchObject({
      projectKind: "sample",
      draftText: "A last-second draft edit that must reach local storage.",
    });
  });

  it("queues a pagehide flush behind the project lock and preserves a newer revision", async () => {
    const { draft, storedValue } = await openSavedSampleCheck();
    const holder = holdLock(testLocks.manager, PROJECT_LOCK_NAME);
    await act(async () => {
      await holder.entered;
    });

    fireEvent.change(draft, {
      target: { value: "This close-time edit must wait for the project lock." },
    });
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
    });

    expect(testLocks.pendingCount()).toBe(1);
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(storedValue);

    const newerExternalValue = storedDraftValue(
      storedValue,
      "A newer revision committed before the held lock was released.",
    );
    window.localStorage.setItem(PROJECT_RECORD_KEY, newerExternalValue);

    await act(async () => {
      holder.release();
      await holder.done;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(
      newerExternalValue,
    );
    expect(
      screen.getByRole("heading", {
        name: "Autosave paused: another tab saved changes",
      }),
    ).toBeInTheDocument();
  });

  it("saves the latest value after rapid edits overlap an in-flight write", async () => {
    const { draft, storedValue } = await openSavedSampleCheck();
    const initialRevision = projectRecord(storedValue).revision;
    const holder = holdLock(testLocks.manager, PROJECT_LOCK_NAME);
    await act(async () => {
      await holder.entered;
    });

    fireEvent.change(draft, {
      target: { value: "The first rapidly entered draft." },
    });
    await advance(250);
    expect(testLocks.pendingCount()).toBe(1);

    fireEvent.change(draft, {
      target: { value: "The final rapidly entered draft." },
    });
    await act(async () => {
      holder.release();
      await holder.done;
      await Promise.resolve();
      await Promise.resolve();
    });

    const finalCommit = window.localStorage.getItem(PROJECT_RECORD_KEY);
    if (finalCommit === null) throw new Error("Expected the latest write to commit");
    expect(projectRecord(finalCommit).revision).toBe(initialRevision + 2);
    expect(storedProjectState(finalCommit).draftText).toBe(
      "The final rapidly entered draft.",
    );
  });

  it("confirms an explicit self-check save only after the durable write finishes", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<RubricTrailApp />);
    await advance(0);
    await restoreBackup(
      screen.getByTestId("backup-file-input"),
      uploadedBackupState(),
    );
    fireEvent.click(screen.getAllByRole("button", { name: /Check/i })[0]);
    await loadDeferredModule(() => import("@/components/views/uploaded-project-views"));

    const holder = holdLock(testLocks.manager, PROJECT_LOCK_NAME);
    await act(async () => {
      await holder.entered;
    });

    const reviewText =
      "The evidence supports the strategy because the cited source explains the constraint.";
    fireEvent.change(screen.getByTestId("uploaded-review-text"), {
      target: { value: reviewText },
    });
    fireEvent.click(screen.getByLabelText(/Evidence is visible/));
    fireEvent.click(screen.getByLabelText(/The link is explained/));
    fireEvent.click(screen.getByLabelText(/The source is traceable/));
    fireEvent.click(screen.getByTestId("save-self-check"));
    await flushMicrotasks();

    expect(testLocks.pendingCount()).toBe(1);
    expect(screen.getByTestId("save-self-check")).toHaveTextContent("Saving self-check");
    expect(screen.getByTestId("toast")).not.toHaveTextContent(
      "Self-check saved in this browser",
    );
    expect(currentStoredProjectState().uploadedCriterionReviews).toEqual([]);

    await act(async () => {
      holder.release();
      await holder.done;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(currentStoredProjectState().uploadedCriterionReviews).toEqual([
      expect.objectContaining({
        criterionId: "analysis-1",
        draftText: reviewText,
        evidenceVisible: true,
        linkExplained: true,
        sourceTraceable: true,
      }),
    ]);
    expect(screen.getByTestId("toast")).toHaveTextContent(
      "Self-check saved in this browser",
    );
    expect(screen.getByTestId("save-self-check")).toHaveTextContent("Save self-check");
  });

  it("keeps exact external bytes when a stale tab edits or closes", async () => {
    const { draft, storedValue } = await openSavedSampleCheck();
    const externalValue = storedDraftValue(
      storedValue,
      "The draft saved by the other tab.",
    );
    window.localStorage.setItem(PROJECT_RECORD_KEY, externalValue);
    dispatchExternalStorageUpdate(storedValue, externalValue);

    expect(
      screen.getByRole("heading", { name: "Autosave paused: another tab saved changes" }),
    ).toBeInTheDocument();

    fireEvent.change(draft, {
      target: { value: "A stale local draft that must not win silently." },
    });
    await advance(250);
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(externalValue);

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
    });
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(externalValue);
    expect(
      screen.getByRole("heading", { name: "Autosave paused: another tab saved changes" }),
    ).toBeInTheDocument();
  });

  it("detects an unannounced external write during pagehide", async () => {
    const { draft, storedValue } = await openSavedSampleCheck();
    const externalValue = storedDraftValue(
      storedValue,
      "External bytes written before this tab could receive an event.",
    );
    window.localStorage.setItem(PROJECT_RECORD_KEY, externalValue);
    fireEvent.change(draft, {
      target: { value: "A pending local edit flushed immediately on close." },
    });

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
    });

    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(externalValue);
    expect(
      screen.getByRole("heading", { name: "Autosave paused: another tab saved changes" }),
    ).toBeInTheDocument();
    await advance(250);
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(externalValue);
  });

  it("refuses a confirmed reset after an unannounced external write", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { draft, storedValue } = await openSavedSampleCheck();
    const currentDraft = (draft as HTMLTextAreaElement).value;
    const externalValue = storedDraftValue(
      storedValue,
      "External bytes that reset must not clear.",
    );
    window.localStorage.setItem(PROJECT_RECORD_KEY, externalValue);

    fireEvent.click(screen.getByRole("button", { name: "Reset local project" }));
    await flushMicrotasks();

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("Reset this local project?"),
    );
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(externalValue);
    expect(screen.getByTestId("draft-text")).toHaveValue(currentDraft);
    expect(screen.getByRole("button", { name: "Use my assignment" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Autosave paused: another tab saved changes" }),
    ).toBeInTheDocument();

    await advance(250);
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(externalValue);
  });

  it("cancels a confirmed reset when this tab changes while purge waits for the lock", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { draft, storedValue } = await openSavedSampleCheck();
    const holder = holdLock(testLocks.manager, PROJECT_LOCK_NAME);
    await act(async () => {
      await holder.entered;
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset local project" }));
    await flushMicrotasks();
    expect(testLocks.pendingCount()).toBe(1);

    const postConfirmDraft = "This newer edit must cancel the confirmed reset.";
    fireEvent.change(draft, { target: { value: postConfirmDraft } });
    await act(async () => {
      holder.release();
      await holder.done;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("draft-text")).toHaveValue(postConfirmDraft);
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(storedValue);
    expect(screen.getByTestId("toast")).toHaveTextContent(
      "project changed in this tab after you confirmed",
    );

    await advance(250);
    await flushMicrotasks();
    expect(currentStoredProjectState().draftText).toBe(postConfirmDraft);
  });

  it("loads the exact saved version after confirmation and clears the conflict", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { draft, storedValue } = await openSavedSampleCheck();
    const externalDraft = "The newer draft loaded from browser storage.";
    const externalValue = storedDraftValue(storedValue, externalDraft);
    window.localStorage.setItem(PROJECT_RECORD_KEY, externalValue);
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
      screen.queryByRole("heading", { name: "Autosave paused: another tab saved changes" }),
    ).not.toBeInTheDocument();
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(externalValue);

    await advance(250);
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(externalValue);
  });

  it("keeps the current tab when browser storage cannot be read during load", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { draft, storedValue } = await openSavedSampleCheck();
    const currentDraft = "This in-memory draft must survive a failed read.";
    const externalValue = storedDraftValue(
      storedValue,
      "The other tab's saved draft.",
    );
    window.localStorage.setItem(PROJECT_RECORD_KEY, externalValue);
    dispatchExternalStorageUpdate(storedValue, externalValue);
    fireEvent.change(draft, { target: { value: currentDraft } });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });

    fireEvent.click(screen.getByRole("button", { name: "Load saved version" }));

    expect(screen.getByTestId("draft-text")).toHaveValue(currentDraft);
    expect(
      screen.getByRole("heading", { name: "Autosave paused: another tab saved changes" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/Browser storage could not be read, so nothing was replaced/),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss storage warning" }));
    expect(
      screen.queryAllByText(/Browser storage could not be read, so nothing was replaced/),
    ).toHaveLength(0);
  });

  it("keeps this tab after confirmation and replaces the external bytes", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { draft, storedValue } = await openSavedSampleCheck();
    const localDraft = "The explicitly chosen draft from this tab.";
    const externalValue = storedDraftValue(
      storedValue,
      "The newer draft currently saved by the other tab.",
    );
    window.localStorage.setItem(PROJECT_RECORD_KEY, externalValue);
    dispatchExternalStorageUpdate(storedValue, externalValue);
    fireEvent.change(draft, { target: { value: localDraft } });

    fireEvent.click(screen.getByRole("button", { name: "Replace saved version with this tab" }));
    await flushMicrotasks();

    const expected = serializePersistedProjectStateValue({
      ...storedProjectState(storedValue),
      draftText: localDraft,
    });
    expect(expected.ok).toBe(true);
    if (!expected.ok) throw new Error("Expected the local sample to serialize");
    expect(currentStoredProjectState()).toEqual(expected.state);
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).not.toBe(externalValue);
    expect(
      screen.queryByRole("heading", { name: "Autosave paused: another tab saved changes" }),
    ).not.toBeInTheDocument();
  });

  it("persists an edit made while keep-this-tab waits for the project lock", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { draft, storedValue } = await openSavedSampleCheck();
    const externalValue = storedDraftValue(
      storedValue,
      "The other tab's saved draft before conflict resolution.",
    );
    window.localStorage.setItem(PROJECT_RECORD_KEY, externalValue);
    dispatchExternalStorageUpdate(storedValue, externalValue);
    fireEvent.change(draft, {
      target: { value: "The version selected when keep started." },
    });

    const holder = holdLock(testLocks.manager, PROJECT_LOCK_NAME);
    await act(async () => {
      await holder.entered;
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Replace saved version with this tab" }),
    );
    await flushMicrotasks();
    expect(testLocks.pendingCount()).toBe(1);

    fireEvent.change(draft, {
      target: { value: "The newer edit entered while keep was waiting." },
    });
    await act(async () => {
      holder.release();
      await holder.done;
      await Promise.resolve();
      await Promise.resolve();
    });
    await advance(0);
    await flushMicrotasks();

    expect(currentStoredProjectState().draftText).toBe(
      "The newer edit entered while keep was waiting.",
    );
    expect(
      screen.queryByRole("heading", {
        name: "Autosave paused: another tab saved changes",
      }),
    ).not.toBeInTheDocument();
  });

  it("lets the latest confirmed replacement cancel an older queued keep intent", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { storedValue } = await openSavedSampleCheck();
    const announcedExternalValue = storedDraftValue(
      storedValue,
      "An announced external draft that was already restored to the original bytes.",
    );
    dispatchExternalStorageUpdate(storedValue, announcedExternalValue);
    expect(
      screen.getByRole("heading", { name: "Autosave paused: another tab saved changes" }),
    ).toBeInTheDocument();

    const holder = holdLock(testLocks.manager, PROJECT_LOCK_NAME);
    await act(async () => {
      await holder.entered;
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Replace saved version with this tab" }),
    );
    await flushMicrotasks();
    expect(testLocks.pendingCount()).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Reset local project" }));
    await flushMicrotasks();
    expect(testLocks.pendingCount()).toBe(2);

    await act(async () => {
      holder.release();
      await holder.done;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushMicrotasks();

    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: "Add your assignment" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Autosave paused: another tab saved changes" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("toast")).not.toBeInTheDocument();
    const storedAfterReset = window.localStorage.getItem(PROJECT_RECORD_KEY);
    expect(storedAfterReset).not.toBeNull();
    const record = projectRecord(storedAfterReset!);
    expect(record.value).toEqual({ kind: "cleared" });
    expect(record.legacyFingerprints).toEqual({ v3: null, v2: null, v1: null });
    expect(record.revision).toBe(projectRecord(storedValue).revision + 2);
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
    const externalRecord = JSON.stringify({
      formatVersion: 1,
      revision: 1,
      value: { kind: "project", state: serialized.state },
      legacyFingerprints: { v3: null, v2: null, v1: null },
    } satisfies ProjectStorageRecordV1);
    window.localStorage.setItem(PROJECT_RECORD_KEY, externalRecord);
    dispatchExternalStorageUpdate(null, externalRecord);

    expect(
      screen.getByRole("button", {
        name: "Discard intake and load saved version",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Download this tab backup" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Replace saved version with this tab" }),
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
    window.localStorage.setItem(PROJECT_RECORD_KEY, externalValue);

    await restoreBackup(
      screen.getByTestId("workspace-backup-file-input"),
      uploadedBackupState(),
    );

    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(externalValue);
    expect(
      screen.getByRole("heading", { name: "Autosave paused: another tab saved changes" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("toast")).toHaveTextContent(
      "backup was not restored",
    );

    await advance(250);
    window.dispatchEvent(new Event("pagehide"));
    await flushMicrotasks();
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(externalValue);
  });

  it("cancels backup restore when this tab changes while the write waits for the lock", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { draft, storedValue } = await openSavedSampleCheck();
    const holder = holdLock(testLocks.manager, PROJECT_LOCK_NAME);
    await act(async () => {
      await holder.entered;
    });

    await restoreBackup(
      screen.getByTestId("workspace-backup-file-input"),
      uploadedBackupState(),
    );
    expect(testLocks.pendingCount()).toBe(1);

    const postConfirmDraft = "This newer edit must cancel the backup replacement.";
    fireEvent.change(draft, { target: { value: postConfirmDraft } });
    await act(async () => {
      holder.release();
      await holder.done;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByRole("heading", { name: "Restored Strategy Report" })).not.toBeInTheDocument();
    expect(screen.getByTestId("draft-text")).toHaveValue(postConfirmDraft);
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(storedValue);
    expect(screen.getByTestId("toast")).toHaveTextContent(
      "project changed in this tab after you confirmed",
    );

    await advance(250);
    await flushMicrotasks();
    expect(currentStoredProjectState().draftText).toBe(postConfirmDraft);
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
    render(
      <LocaleProvider>
        <RubricTrailApp />
      </LocaleProvider>,
    );
    await advance(0);
    fireEvent.change(
      screen.getByRole("combobox", { name: /Interface language|界面语言/ }),
      { target: { value: "en" } },
    );
    fireEvent.click(screen.getByTestId("try-sample"));
    await advance(450);
    expect(
      screen.getByRole("button", { name: "RubricTrail: open project brief" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Plan/i })[0]);
    await loadDeferredModule(() => import("@/components/views/action-plan-view"));

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
    expect(screen.getByTestId("toast").parentElement).toHaveClass("toast-stack");
    expect(rebalance).toHaveFocus();

    fireEvent.change(screen.getByLabelText("Interface language"), {
      target: { value: "zh-CN" },
    });
    expect(screen.getByTestId("toast")).toHaveTextContent(
      "行动计划已按每周 10 小时和“深入”计划深度更新。",
    );
    expect(screen.getByTestId("toast")).not.toHaveTextContent("Thorough");
  });

  it("gives sample users a direct, explicit path to their own files", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<RubricTrailApp />);
    await advance(0);
    fireEvent.click(screen.getByTestId("try-sample"));
    await advance(450);

    fireEvent.click(screen.getByRole("button", { name: "Use my assignment" }));
    await flushMicrotasks();
    await advance(16);

    expect(
      screen.getByRole("heading", { name: "Add your assignment" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose files" })).toHaveFocus();
  });

  it("cancels the sample handoff when this tab changes while purge waits for the lock", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { draft, storedValue } = await openSavedSampleCheck();
    const holder = holdLock(testLocks.manager, PROJECT_LOCK_NAME);
    await act(async () => {
      await holder.entered;
    });

    fireEvent.click(screen.getByRole("button", { name: "Use my assignment" }));
    await flushMicrotasks();
    expect(testLocks.pendingCount()).toBe(1);

    const postConfirmDraft = "This newer edit must keep the sample open.";
    fireEvent.change(draft, { target: { value: postConfirmDraft } });
    await act(async () => {
      holder.release();
      await holder.done;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "Use my assignment" })).toBeInTheDocument();
    expect(screen.getByTestId("draft-text")).toHaveValue(postConfirmDraft);
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(storedValue);
    expect(screen.getByTestId("toast")).toHaveTextContent(
      "project changed in this tab after you confirmed",
    );

    await advance(250);
    await flushMicrotasks();
    expect(currentStoredProjectState().draftText).toBe(postConfirmDraft);
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

    const stored = window.localStorage.getItem(PROJECT_RECORD_KEY) ?? "";
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
      screen.getByRole("heading", { name: "Autosave paused: another tab saved changes" }),
    ).toBeInTheDocument();
    fireEvent.change(draft, {
      target: { value: "A v3 edit that must wait for conflict resolution." },
    });
    await advance(250);

    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(storedValue);
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe(previousValue);
  });

  it("loads and upgrades the exact v2 project that triggered a cross-version conflict", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { storedValue } = await openSavedSampleCheck();
    const previousDraft = "The exact older-version draft the user chose to load.";
    const currentState = storedProjectState(storedValue);
    const previousValue = JSON.stringify(
      realV2State(currentState, { draftText: previousDraft }),
    );
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, previousValue);
    dispatchExternalStorageUpdate(null, previousValue, PREVIOUS_STORAGE_KEY);

    fireEvent.click(screen.getByRole("button", { name: "Load saved version" }));
    await flushMicrotasks();

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("older RubricTrail tab"),
    );
    expect(screen.getByTestId("draft-text")).toHaveValue(previousDraft);
    expect(
      screen.queryByRole("heading", { name: "Autosave paused: another tab saved changes" }),
    ).not.toBeInTheDocument();
    const promoted = currentStoredProjectState();
    expect(promoted.version).toBe(3);
    expect(promoted.draftText).toBe(previousDraft);
    expect(promoted.supersededV2Fingerprint).toMatch(/^v1:/);
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe(previousValue);
    expect(readProjectStateWithStatus().crossVersionConflict).toBe(false);
  });

  it("cancels legacy promotion when this tab changes while the write waits for the lock", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { draft, storedValue } = await openSavedSampleCheck();
    const previousValue = JSON.stringify(
      realV2State(storedProjectState(storedValue), {
        draftText: "The older project that must not replace a post-confirm edit.",
      }),
    );
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, previousValue);
    dispatchExternalStorageUpdate(null, previousValue, PREVIOUS_STORAGE_KEY);
    const holder = holdLock(testLocks.manager, PROJECT_LOCK_NAME);
    await act(async () => {
      await holder.entered;
    });

    fireEvent.click(screen.getByRole("button", { name: "Load saved version" }));
    await flushMicrotasks();
    expect(testLocks.pendingCount()).toBe(1);

    const postConfirmDraft = "This newer tab edit must cancel legacy promotion.";
    fireEvent.change(draft, { target: { value: postConfirmDraft } });
    await act(async () => {
      holder.release();
      await holder.done;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("draft-text")).toHaveValue(postConfirmDraft);
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(storedValue);
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe(previousValue);
    expect(
      screen.getByRole("heading", { name: "Autosave paused: another tab saved changes" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("toast")).toHaveTextContent(
      "project changed in this tab after you confirmed",
    );
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
    await loadDeferredModule(() => import("@/components/upload-summary-view"));

    const noPublishedWeights = screen.getByRole("radio", {
      name: /No — no complete percentage breakdown is published/,
    });
    expect(noPublishedWeights).not.toBeChecked();
    fireEvent.click(noPublishedWeights);
    expect(screen.getByTestId("criterion-weight-0")).toHaveValue(null);
    expect(screen.getByTestId("criterion-weight-1")).toHaveValue(null);
    fireEvent.click(screen.getByTestId("create-project"));
    await advance(250);
    await loadDeferredModule(() => import("@/components/views/uploaded-project-views"));

    const stored = currentStoredProjectState();
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
    await loadDeferredModule(() => import("@/components/views/uploaded-project-views"));
    expect(screen.getAllByText("Not recorded")).toHaveLength(2);
    expect(screen.getByText(/No grading percentages were recorded/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Plan/i })[0]);
    await loadDeferredModule(() => import("@/components/views/action-plan-view"));
    expect(screen.getByText(/Give every criterion the same planning baseline/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Check/i })[0]);
    await loadDeferredModule(() => import("@/components/views/uploaded-project-views"));
    expect(screen.getByRole("option", { name: "Analysis" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Communication" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open progress" }));
    await loadDeferredModule(() => import("@/components/views/uploaded-project-views"));
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

    const stored = currentStoredProjectState();
    expect(stored.uploadedProject?.weightingStatus).toBe("incomplete");
    expect(
      stored.uploadedProject?.criteria.map((criterion) => criterion.weight),
    ).toEqual([null, 40]);

    fireEvent.click(
      screen.getAllByRole("button", { name: /RubricConfirmed/i })[0],
    );
    await loadDeferredModule(() => import("@/components/views/uploaded-project-views"));
    expect(screen.getByText("Not recorded")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(
      screen.getByText(/Known official percentages are retained/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Plan/i })[0]);
    await loadDeferredModule(() => import("@/components/views/action-plan-view"));
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
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBeNull();

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

    const stored = window.localStorage.getItem(PROJECT_RECORD_KEY) ?? "";
    expect(screen.getByRole("heading", { name: "Partial Strategy Report" })).toBeInTheDocument();
    expect(stored).toContain("brief.txt");
    expect(stored).not.toContain("legacy-rubric.doc");
    expect(stored).not.toContain(omittedTail);
    const backup = serializeProjectBackup(
      storedProjectState(stored),
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
    expect(currentStoredProjectState()).toMatchObject({
      projectKind: "uploaded",
      uploadedProject: { title: "Restored Strategy Report" },
    });
    expect(screen.getByTestId("toast")).toHaveTextContent(
      "Project restored from backup",
    );
  });

  it("opens the actual next unchecked criterion from uploaded progress", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const project: UploadedProject = {
      ...uploadedProject(),
      weightingStatus: "complete",
      criteria: [
        {
          id: "analysis-1",
          name: "Analysis",
          weight: 60,
          evidence: null,
        },
        {
          id: "communication-2",
          name: "Communication",
          weight: 40,
          evidence: null,
        },
      ],
    };
    const state: PersistedProjectState = {
      ...uploadedBackupState(),
      uploadedProject: project,
      view: "progress",
      visitedViews: ["overview", "progress"],
      completedTaskIds: buildUploadedPlanTemplates(project).map((task) => task.id),
      uploadedCriterionReviews: [
        {
          criterionId: "analysis-1",
          draftText: "This saved analysis note contains enough real draft evidence.",
          evidenceVisible: true,
          linkExplained: true,
          sourceTraceable: true,
          updatedAt: "2026-08-12T08:00:00.000Z",
        },
      ],
    };
    render(<RubricTrailApp />);
    await advance(0);

    await restoreBackup(screen.getByTestId("backup-file-input"), state);

    expect(
      screen.getByRole("heading", { name: "Self-check Communication" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Continue next action" }),
    );

    expect(screen.getByRole("combobox", { name: "Rubric criterion" })).toHaveValue(
      "communication-2",
    );
  });

  it("keeps the current project and storage unchanged when replacement is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<RubricTrailApp />);
    await advance(0);
    fireEvent.click(screen.getByTestId("try-sample"));
    await advance(700);
    const before = window.localStorage.getItem(PROJECT_RECORD_KEY);

    await restoreBackup(
      screen.getByTestId("workspace-backup-file-input"),
      uploadedBackupState(),
    );

    expect(screen.getByRole("button", { name: "Use my assignment" })).toBeInTheDocument();
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(before);
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
    expect(currentStoredProjectState()).toMatchObject({
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
