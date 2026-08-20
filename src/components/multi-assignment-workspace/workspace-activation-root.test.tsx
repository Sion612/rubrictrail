import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";
import {
  WORKSPACE_INDEX_KEY,
  WORKSPACE_PREFERENCES_KEY,
  WORKSPACE_RESERVE_KEY,
  recognizeWorkspaceOwnedKey,
  workspaceProjectRecordKey,
} from "@/lib/workspace-storage/keys";
import { DEFAULT_PLAN_TASK_TEMPLATES } from "@/lib/plan";
import {
  parseWorkspaceProjectRecord,
  serializeWorkspaceProjectRecord,
} from "@/lib/workspace-storage/protocol";
import {
  activeProjectRecord,
  PROJECT_A,
  PROJECT_B,
  WS,
} from "@/lib/workspace-storage/test-fixtures";

import { WorkspaceActivationRoot } from "./workspace-activation-root";

let lockAvailable = true;

function installWebLocks() {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: vi.fn(
        async <T,>(
          name: string,
          _options: LockOptions,
          callback: (lock: Lock | null) => T | PromiseLike<T>,
        ) => callback(lockAvailable ? ({ name, mode: "exclusive" } as Lock) : null),
      ),
    },
  });
}

function renderActivation() {
  return render(
    <LocaleProvider>
      <WorkspaceActivationRoot />
    </LocaleProvider>,
  );
}

function activeWorkspaceRecordBytes(): string {
  const record = serializeWorkspaceProjectRecord(activeProjectRecord());
  if (!record.ok) throw new Error("fixture project record is invalid");
  return record.serialized;
}

function projectRecordKeys(): string[] {
  return Array.from({ length: window.localStorage.length }, (_, index) =>
    window.localStorage.key(index),
  ).filter((key): key is string =>
    key !== null && recognizeWorkspaceOwnedKey(key)?.kind === "project",
  );
}

beforeEach(() => {
  window.localStorage.clear();
  lockAvailable = true;
  installWebLocks();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("WorkspaceActivationRoot", () => {
  it("creates an authoritative empty workspace before showing My assignments", async () => {
    renderActivation();

    expect(
      await screen.findByRole("heading", { name: "My assignments" }),
    ).toBeVisible();
    expect(window.localStorage.getItem(WORKSPACE_INDEX_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(WORKSPACE_RESERVE_KEY)).not.toBeNull();
    expect(screen.getByRole("button", { name: "New assignment" })).toBeVisible();
  });

  it("creates the fictional sample as an isolated assignment and preserves it across remount", async () => {
    const first = renderActivation();
    await screen.findByRole("heading", { name: "My assignments" });
    fireEvent.click(screen.getByRole("button", { name: "New assignment" }));
    fireEvent.click(await screen.findByRole("button", { name: "Try the fictional sample" }));
    fireEvent.click(await screen.findByTestId("try-sample"));

    expect(
      await screen.findByRole("heading", {
        name: "Reducing Collection Delays at LumaLane Market",
      }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "All assignments" }));
    expect(await screen.findByText("1 assignment", { exact: true })).toBeVisible();

    first.unmount();
    renderActivation();
    expect(await screen.findByRole("heading", { name: "My assignments" })).toBeVisible();
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "Reducing Collection Delays at LumaLane Market",
      }),
    ).toBeVisible();
  });

  it("keeps the open assignment stable for non-authoritative or unrelated-project storage events", async () => {
    renderActivation();
    await screen.findByRole("heading", { name: "My assignments" });
    fireEvent.click(screen.getByRole("button", { name: "New assignment" }));
    fireEvent.click(await screen.findByRole("button", { name: "Try the fictional sample" }));
    fireEvent.click(await screen.findByTestId("try-sample"));

    const assignmentHeading = await screen.findByRole("heading", {
      name: "Reducing Collection Delays at LumaLane Market",
    });
    for (const key of [WORKSPACE_PREFERENCES_KEY, WORKSPACE_RESERVE_KEY]) {
      window.dispatchEvent(new StorageEvent("storage", {
        key,
        newValue: window.localStorage.getItem(key),
        storageArea: window.localStorage,
      }));
    }
    window.dispatchEvent(new StorageEvent("storage", {
      key: workspaceProjectRecordKey(WS, 1, PROJECT_B),
      newValue: null,
      storageArea: window.localStorage,
    }));

    await waitFor(() => {
      expect(assignmentHeading).toBeVisible();
      expect(screen.getByRole("button", { name: "All assignments" })).toBeVisible();
      expect(screen.queryByRole("heading", { name: "My assignments" })).toBeNull();
    });
  });

  it("refreshes an ignored unrelated-project change only after returning to the Dashboard", async () => {
    renderActivation();
    await screen.findByRole("heading", { name: "My assignments" });
    fireEvent.click(screen.getByRole("button", { name: "New assignment" }));
    fireEvent.click(await screen.findByRole("button", { name: "Try the fictional sample" }));
    fireEvent.click(await screen.findByTestId("try-sample"));
    await screen.findByRole("heading", { name: "Reducing Collection Delays at LumaLane Market" });
    const firstProjectKey = projectRecordKeys()[0];
    if (!firstProjectKey) throw new Error("Expected the first project record");

    fireEvent.click(screen.getByRole("button", { name: "All assignments" }));
    await screen.findByRole("heading", { name: "My assignments" });
    fireEvent.click(screen.getByRole("button", { name: "New assignment" }));
    fireEvent.click(await screen.findByRole("button", { name: "Try the fictional sample" }));
    fireEvent.click(await screen.findByTestId("try-sample"));
    const openHeading = await screen.findByRole("heading", {
      name: "Reducing Collection Delays at LumaLane Market",
    });

    const raw = window.localStorage.getItem(firstProjectKey);
    if (raw === null) throw new Error("Expected the first project record bytes");
    const parsed = parseWorkspaceProjectRecord(raw);
    if (!parsed.ok || parsed.value.value.kind !== "project") {
      throw new Error("Expected a valid active project record");
    }
    const updated = serializeWorkspaceProjectRecord({
      ...parsed.value,
      revision: parsed.value.revision + 1,
      value: {
        kind: "project",
        state: {
          ...parsed.value.value.state,
          completedTaskIds: DEFAULT_PLAN_TASK_TEMPLATES.map((task) => task.id),
        },
      },
    });
    if (!updated.ok) throw new Error("Expected the external project update to serialize");
    window.localStorage.setItem(firstProjectKey, updated.serialized);
    window.dispatchEvent(new StorageEvent("storage", {
      key: firstProjectKey,
      newValue: updated.serialized,
      storageArea: window.localStorage,
    }));

    await waitFor(() => {
      expect(openHeading).toBeVisible();
      expect(screen.queryByRole("heading", { name: "My assignments" })).toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: "All assignments" }));
    expect(await screen.findByText("100% complete", { exact: true })).toBeVisible();
  });

  it("opens the real lifecycle panel from the production Dashboard", async () => {
    renderActivation();
    await screen.findByRole("heading", { name: "My assignments" });
    fireEvent.click(screen.getByRole("button", { name: "Manage local workspace" }));

    expect(
      await screen.findByRole("heading", { name: "Storage & recovery" }),
    ).toBeVisible();
    expect(screen.getByText("Recovery reserve ready")).toBeVisible();
  });

  it("does not leave a pending assignment when its flush is blocked", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderActivation();
    await screen.findByRole("heading", { name: "My assignments" });
    fireEvent.click(screen.getByRole("button", { name: "New assignment" }));
    fireEvent.click(await screen.findByRole("button", { name: "Try the fictional sample" }));
    fireEvent.click(await screen.findByTestId("try-sample"));
    await screen.findByRole("heading", {
      name: "Reducing Collection Delays at LumaLane Market",
    });
    await screen.findByRole("button", { name: "Use my assignment" });

    fireEvent.click(screen.getAllByText("Rubric")[0]!.closest("button")!);
    lockAvailable = false;
    fireEvent.click(screen.getByRole("button", { name: "Use my assignment" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Use my assignment" })).toBeVisible();
      expect(
        screen.getByRole("heading", {
          name: "Reducing Collection Delays at LumaLane Market",
        }),
      ).toBeVisible();
    });
  });

  it("fails closed without Web Locks and does not create an empty replacement", async () => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
    renderActivation();

    expect(
      await screen.findByRole("heading", {
        name: "RubricTrail stopped before choosing a workspace",
      }),
    ).toBeVisible();
    expect(screen.getByText(/does not provide the Web Lock/u)).toBeVisible();
    await waitFor(() => expect(window.localStorage.getItem(WORKSPACE_INDEX_KEY)).toBeNull());
  });

  it("offers read-only v0.8 backup export without Web Locks or unlocked writes", async () => {
    const key = workspaceProjectRecordKey(WS, 1, PROJECT_A);
    const record = activeWorkspaceRecordBytes();
    window.localStorage.setItem(key, record);
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });

    renderActivation();

    expect(
      await screen.findByRole("heading", { name: "Download readable project backups" }),
    ).toBeVisible();
    expect(await screen.findByRole("button", {
      name: "Download backup for RubricTrail sample project, readable record 1",
    })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Recover selected group/u })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete discovered workspace data/u })).toBeNull();
    expect(window.localStorage.getItem(key)).toBe(record);
    expect(window.localStorage.getItem(WORKSPACE_INDEX_KEY)).toBeNull();
    expect(window.localStorage.getItem(WORKSPACE_PREFERENCES_KEY)).toBeNull();
  });

  it("places validated backup exports before recovery mutation choices", async () => {
    const key = workspaceProjectRecordKey(WS, 1, PROJECT_A);
    window.localStorage.setItem(key, activeWorkspaceRecordBytes());

    renderActivation();

    const exportsHeading = await screen.findByRole("heading", {
      name: "Download readable project backups",
    });
    const lifecycleHeading = await screen.findByRole("heading", {
      name: "Storage & recovery",
    });
    expect(
      exportsHeading.compareDocumentPosition(lifecycleHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole("button", {
      name: "Download backup for RubricTrail sample project, readable record 1",
    })).toBeVisible();
    expect(screen.getByRole("button", { name: "Select a recovery candidate" })).toBeVisible();
  });
});
