import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  act,
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

import {
  deriveWorkspaceRecordPolicy,
  WorkspaceLifecyclePanel,
  type WorkspaceLifecycleActionRequest,
  type WorkspaceLifecycleActionResult,
  type WorkspaceLifecyclePanelProps,
} from "./workspace-lifecycle-panel";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const workspace = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  workspaceGeneration: 7,
  indexRevision: 19,
  activeProjectCount: 4,
  tombstoneCount: 65,
  physicalProjectRecordCount: 69,
  legacyValueCount: 4,
  intentToken: "workspace-intent-19",
} as const;

const selectedProject = {
  projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  title: "Fictional hydrology field report",
  course: "LumaLane Earth Systems",
  recordRevision: 6,
  intentToken: "project-intent-6",
} as const;

const replacementPreview = {
  targetProjectId: selectedProject.projectId,
  targetIntentToken: selectedProject.intentToken,
  backupToken: "validated-backup-4b2d",
  backupTitle: "Fictional coastal resilience review",
  backupCourse: "LumaLane Planning Studio",
  backupDeadline: "2026-10-12",
  sourceName: "fictional-coastal-review.rubrictrail.json",
  sizeEffect: "non-growing" as const,
};

const recoveryCandidate = {
  candidateId: "candidate-seven",
  workspaceId: "77777777-7777-4777-8777-777777777777",
  workspaceGeneration: 3,
  activeProjectCount: 2,
  tombstoneCount: 1,
} as const;

function buildProps(
  overrides: Partial<WorkspaceLifecyclePanelProps> = {},
): WorkspaceLifecyclePanelProps {
  return {
    workspace,
    selectedProject,
    replacementPreview,
    storageProtection: {
      mode: "normal",
      reserveStatus: "ready",
      destructiveJournalAvailable: true,
    },
    legacyCleanup: {
      available: true,
      intentToken: "legacy-cleanup-intent-4",
    },
    rotation: {
      eligible: true,
      targetGeneration: 8,
      intentToken: "rotation-intent-8",
    },
    recovery: {
      required: false,
      available: false,
      intentToken: "recovery-intent-none",
      invalidOwnedRecordCount: 0,
      candidates: [],
    },
    onChooseReplacementBackup: vi.fn(),
    onExportSelectedProject: vi.fn(),
    onExportDiagnostics: vi.fn(),
    onConfirmAction: vi.fn<
      (
        request: WorkspaceLifecycleActionRequest,
      ) => WorkspaceLifecycleActionResult
    >(() => ({ ok: true })),
    ...overrides,
  };
}

function panelTree(props: WorkspaceLifecyclePanelProps) {
  return (
    <LocaleProvider>
      <LanguageSwitcher />
      <WorkspaceLifecyclePanel {...props} />
    </LocaleProvider>
  );
}

function renderPanel(overrides: Partial<WorkspaceLifecyclePanelProps> = {}) {
  const props = buildProps(overrides);
  const result = render(panelTree(props));
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "en" },
  });
  return {
    ...result,
    props,
    rerenderPanel(next: WorkspaceLifecyclePanelProps) {
      result.rerender(panelTree(next));
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("WorkspaceLifecyclePanel", () => {
  it("shows exact storage counts, product guardrails and single-project backup scope", () => {
    const onChooseReplacementBackup = vi.fn();
    const onExportSelectedProject = vi.fn();
    renderPanel({ onChooseReplacementBackup, onExportSelectedProject });

    expect(
      screen.getByRole("heading", { name: "Storage & recovery" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Compaction recommended")).toBeInTheDocument();
    expect(screen.getByText("65")).toBeInTheDocument();
    expect(screen.getByText("Recovery reserve ready")).toBeInTheDocument();
    expect(
      screen.getByText(/not a guarantee of browser storage capacity/iu),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/do not create an account, cloud backup or whole-workspace backup/iu),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Download backup for Fictional hydrology field report",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Choose backup to preview" }),
    );
    expect(onExportSelectedProject).toHaveBeenCalledWith(
      selectedProject.projectId,
    );
    expect(onChooseReplacementBackup).toHaveBeenCalledWith(
      selectedProject.projectId,
    );
  });

  it("keeps replacement confirmation open in flight and submits stable exact baselines", async () => {
    const result = deferred<WorkspaceLifecycleActionResult>();
    const onConfirmAction = vi.fn(() => result.promise);
    renderPanel({ onConfirmAction });
    const opener = screen.getByRole("button", { name: "Review replacement" });
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", {
      name: "Replace selected project?",
    });
    const close = within(dialog).getByRole("button", {
      name: "Close confirmation",
    });
    await waitFor(() => expect(close).toHaveFocus());
    expect(
      within(dialog).getByText("Fictional hydrology field report"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Fictional coastal resilience review"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Validated backup token validated-backup-4b2d"),
    ).toBeInTheDocument();

    const confirm = within(dialog).getByRole("button", {
      name: "Replace this project",
    });
    expect(confirm).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    expect(dialog).toHaveAttribute("aria-busy", "true");
    expect(close).toBeDisabled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onConfirmAction).toHaveBeenCalledWith({
      kind: "replace-project",
      workspaceId: workspace.workspaceId,
      workspaceGeneration: 7,
      indexRevision: 19,
      workspaceIntentToken: "workspace-intent-19",
      projectId: selectedProject.projectId,
      projectRevision: 6,
      projectIntentToken: "project-intent-6",
      backupToken: "validated-backup-4b2d",
    });

    await act(async () => result.resolve({ ok: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("invalidates an open replacement when the project intent changes", async () => {
    const { props, rerenderPanel } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Review replacement" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(
      within(dialog).getByRole("button", { name: "Replace this project" }),
    ).toBeEnabled();

    rerenderPanel({
      ...props,
      selectedProject: {
        ...selectedProject,
        recordRevision: 7,
        intentToken: "project-intent-7",
      },
    });

    expect(
      within(screen.getByRole("dialog")).getByText(
        /scope changed after this confirmation opened/iu,
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Replace this project",
      }),
    ).toBeDisabled();
  });

  it("keeps a failed exact legacy cleanup open with truthful old-tab diagnostics", async () => {
    const onConfirmAction = vi.fn(() => ({
      ok: false as const,
      reason: "legacy-drift" as const,
    }));
    renderPanel({ onConfirmAction });
    const opener = screen.getByRole("button", { name: "Review legacy cleanup" });
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", {
      name: "Remove retained legacy values?",
    });
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "REMOVE LEGACY DATA" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Remove legacy values" }),
    );

    const failure = await within(dialog).findByRole("alert");
    expect(failure).toHaveTextContent(
      "An older tab changed a retained legacy value",
    );
    expect(failure).toHaveFocus();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onConfirmAction).toHaveBeenCalledWith({
      kind: "legacy-cleanup",
      workspaceId: workspace.workspaceId,
      workspaceGeneration: 7,
      indexRevision: 19,
      workspaceIntentToken: "workspace-intent-19",
      cleanupIntentToken: "legacy-cleanup-intent-4",
    });

    const close = within(dialog).getByRole("button", {
      name: "Close confirmation",
    });
    const confirm = within(dialog).getByRole("button", {
      name: "Remove legacy values",
    });
    confirm.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.click(close);
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("submits exact delete, privacy-delete and rotation requests without conflating their scopes", async () => {
    const onConfirmAction = vi.fn<
      (
        request: WorkspaceLifecycleActionRequest,
      ) => WorkspaceLifecycleActionResult
    >(() => ({ ok: true }));
    renderPanel({ onConfirmAction });

    fireEvent.click(
      screen.getByRole("button", { name: "Review project deletion" }),
    );
    let dialog = screen.getByRole("dialog", { name: "Delete this project?" });
    expect(dialog).toHaveTextContent(
      "Deleting the final project leaves an active empty workspace",
    );
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "DELETE PROJECT aaaaaaaa" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete this project" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(
      screen.getByRole("button", { name: "Review whole-workspace deletion" }),
    );
    dialog = screen.getByRole("dialog", { name: "Delete the entire workspace?" });
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "DELETE WORKSPACE 11111111" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete entire workspace" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(
      screen.getByRole("button", { name: "Review generation rotation" }),
    );
    dialog = screen.getByRole("dialog", { name: "Rotate workspace generation?" });
    expect(dialog).toHaveTextContent("generation 7 to 8");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Rotate generation" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    expect(onConfirmAction.mock.calls.map(([request]) => request)).toEqual([
      {
        kind: "delete-project",
        workspaceId: workspace.workspaceId,
        workspaceGeneration: 7,
        indexRevision: 19,
        workspaceIntentToken: "workspace-intent-19",
        projectId: selectedProject.projectId,
        projectRevision: 6,
        projectIntentToken: "project-intent-6",
      },
      {
        kind: "delete-workspace",
        workspaceId: workspace.workspaceId,
        workspaceGeneration: 7,
        indexRevision: 19,
        workspaceIntentToken: "workspace-intent-19",
      },
      {
        kind: "rotate-workspace-generation",
        workspaceId: workspace.workspaceId,
        workspaceGeneration: 7,
        indexRevision: 19,
        workspaceIntentToken: "workspace-intent-19",
        targetGeneration: 8,
        rotationIntentToken: "rotation-intent-8",
      },
    ]);
  });

  it("requires explicit recovery selection even for one coherent candidate", async () => {
    const onConfirmAction = vi.fn<
      (
        request: WorkspaceLifecycleActionRequest,
      ) => WorkspaceLifecycleActionResult
    >(() => ({ ok: true }));
    renderPanel({
      workspace: null,
      selectedProject: null,
      replacementPreview: null,
      storageProtection: {
        mode: "recovery-only",
        reserveStatus: "missing",
        destructiveJournalAvailable: false,
      },
      recovery: {
        required: true,
        available: true,
        intentToken: "recovery-intent-44",
        invalidOwnedRecordCount: 2,
        candidates: [recoveryCandidate],
      },
      onConfirmAction,
    });

    expect(screen.getByText("1 coherent candidate group")).toBeInTheDocument();
    expect(
      screen.getByText(/even when only one candidate exists/iu),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Select a recovery candidate" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Recover one exact workspace group?",
    });
    const confirm = within(dialog).getByRole("button", {
      name: "Recover selected group",
    });
    expect(confirm).toBeDisabled();
    expect(within(dialog).getByRole("radio")).not.toBeChecked();
    fireEvent.click(within(dialog).getByRole("radio"));
    expect(confirm).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onConfirmAction).toHaveBeenCalledWith({
      kind: "recover-index",
      recoveryIntentToken: "recovery-intent-44",
      candidateId: "candidate-seven",
      candidateWorkspaceId: recoveryCandidate.workspaceId,
      candidateGeneration: 3,
    });
  });

  it("offers no-candidate recovery privacy deletion without inventing a workspace baseline and stays open in flight", async () => {
    const result = deferred<WorkspaceLifecycleActionResult>();
    const onConfirmAction = vi.fn(() => result.promise);
    renderPanel({
      workspace: null,
      selectedProject: null,
      replacementPreview: null,
      storageProtection: {
        mode: "recovery-only",
        reserveStatus: "missing",
        destructiveJournalAvailable: true,
      },
      recovery: {
        required: true,
        available: false,
        intentToken: "recovery-purge-intent-9",
        invalidOwnedRecordCount: 3,
        candidates: [],
      },
      onConfirmAction,
    });

    expect(
      screen.getByText(/No coherent candidate group is available/iu),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Select a recovery candidate" }),
    ).toBeDisabled();
    const opener = screen.getByRole("button", {
      name: "Review recovery-only privacy deletion",
    });
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", {
      name: "Delete all discovered workspace data?",
    });
    expect(dialog).toHaveTextContent(
      "does not invent a workspace baseline or make any candidate authoritative",
    );
    const confirm = within(dialog).getByRole("button", {
      name: "Delete discovered workspace data",
    });
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "DELETE RECOVERY DATA" },
    });
    expect(confirm).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    expect(dialog).toHaveAttribute("aria-busy", "true");
    expect(
      within(dialog).getByRole("button", { name: "Close confirmation" }),
    ).toBeDisabled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onConfirmAction).toHaveBeenCalledWith({
      kind: "delete-workspace-recovery",
      recoveryIntentToken: "recovery-purge-intent-9",
    });

    await act(async () => result.resolve({ ok: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("invalidates recovery privacy deletion when the scan intent changes", () => {
    const recovery = {
      required: true,
      available: true,
      intentToken: "recovery-purge-intent-10",
      invalidOwnedRecordCount: 0,
      candidates: [recoveryCandidate],
    } as const;
    const { props, rerenderPanel } = renderPanel({
      workspace: null,
      selectedProject: null,
      replacementPreview: null,
      storageProtection: {
        mode: "recovery-only",
        reserveStatus: "ready",
        destructiveJournalAvailable: true,
      },
      recovery,
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Review recovery-only privacy deletion",
      }),
    );
    let dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "DELETE RECOVERY DATA" },
    });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(
      within(dialog).getByRole("button", {
        name: "Delete discovered workspace data",
      }),
    ).toBeEnabled();

    rerenderPanel({
      ...props,
      recovery: { ...recovery, intentToken: "recovery-purge-intent-11" },
    });
    dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(
      "The scope changed after this confirmation opened",
    );
    expect(
      within(dialog).getByRole("button", {
        name: "Delete discovered workspace data",
      }),
    ).toBeDisabled();
  });

  it("localizes recovery-only privacy deletion without changing discovered identifiers", () => {
    renderPanel({
      workspace: null,
      selectedProject: null,
      replacementPreview: null,
      storageProtection: {
        mode: "recovery-only",
        reserveStatus: "ready",
        destructiveJournalAvailable: true,
      },
      recovery: {
        required: true,
        available: true,
        intentToken: "recovery-purge-intent-zh",
        invalidOwnedRecordCount: 0,
        candidates: [recoveryCandidate],
      },
    });
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zh-CN" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "检查仅恢复状态的隐私删除" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "删除扫描发现的全部工作区数据？",
    });
    expect(dialog).toHaveTextContent("不会伪造工作区基线");
    expect(dialog).toHaveTextContent(recoveryCandidate.workspaceId);
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "删除恢复数据" },
    });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(
      within(dialog).getByRole("button", { name: "删除发现的工作区数据" }),
    ).toBeEnabled();
  });

  it("keeps degraded backup advice persistent and blocks unsafe maintenance", () => {
    const onExportDiagnostics = vi.fn();
    renderPanel({
      replacementPreview: {
        ...replacementPreview,
        sizeEffect: "growing",
      },
      storageProtection: {
        mode: "degraded",
        reserveStatus: "missing",
        destructiveJournalAvailable: false,
      },
      onExportDiagnostics,
    });

    expect(
      screen.getByRole("heading", { name: "Storage protection is degraded" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/download a backup for each important assignment/iu),
    ).toBeInTheDocument();
    expect(screen.getByText("Recovery reserve missing")).toBeInTheDocument();
    expect(
      screen.getByText(/permits only a verified non-growing replacement/iu),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Review replacement" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Review legacy cleanup" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Review whole-workspace deletion" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Export recovery diagnostics" }),
    );
    expect(onExportDiagnostics).toHaveBeenCalledTimes(1);
  });

  it("switches system text to Simplified Chinese without translating user or file content", () => {
    renderPanel();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zh-CN" },
    });

    expect(screen.getByRole("heading", { name: "存储与恢复" })).toBeInTheDocument();
    expect(
      screen.getAllByText("Fictional hydrology field report").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("LumaLane Earth Systems")).toBeInTheDocument();
    expect(screen.getByText("Fictional coastal resilience review")).toBeInTheDocument();
    expect(
      screen.getByText("fictional-coastal-review.rubrictrail.json"),
    ).toBeInTheDocument();
    expect(screen.getByText("建议压缩")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "检查项目删除" })).toBeInTheDocument();
  });
});

describe("workspace lifecycle product policy and responsive boundary", () => {
  it("implements the exact 64/80/96/100 product thresholds", () => {
    expect(deriveWorkspaceRecordPolicy(15, 63)).toBe("normal");
    expect(deriveWorkspaceRecordPolicy(15, 64)).toBe(
      "compaction-recommended",
    );
    expect(deriveWorkspaceRecordPolicy(16, 64)).toBe("warning");
    expect(deriveWorkspaceRecordPolicy(32, 64)).toBe("growth-blocked");
    expect(deriveWorkspaceRecordPolicy(36, 64)).toBe("hard-limit");
    expect(deriveWorkspaceRecordPolicy(37, 64)).toBe("recovery-only");
  });

  it("keeps responsive containment local without hiding document overflow", () => {
    const css = readFileSync(
      join(
        process.cwd(),
        "src",
        "components",
        "multi-assignment-workspace",
        "workspace-lifecycle-panel.module.css",
      ),
      "utf8",
    );
    expect(css).toContain("@media (max-width: 768px)");
    expect(css).toContain("@media (max-width: 390px)");
    expect(css).toContain("@media (max-width: 320px)");
    expect(css).toContain("max-height: min(90vh, 48rem)");
    expect(css).not.toMatch(/overflow-x\s*:\s*hidden/iu);
  });
});
