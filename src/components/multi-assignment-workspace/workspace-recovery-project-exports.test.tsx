import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";
import { workspaceProjectRecordKey } from "@/lib/workspace-storage/keys";
import { serializeWorkspaceProjectRecord } from "@/lib/workspace-storage/protocol";
import { MemoryWorkspaceStorageAdapter } from "@/lib/workspace-storage/storage-adapter";
import {
  activeProjectRecord,
  PROJECT_A,
  WS,
} from "@/lib/workspace-storage/test-fixtures";

import { WorkspaceRecoveryProjectExports } from "./workspace-recovery-project-exports";

function recordBytes(): string {
  const serialized = serializeWorkspaceProjectRecord(activeProjectRecord());
  if (!serialized.ok) throw new Error("fixture project record is invalid");
  return serialized.serialized;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorkspaceRecoveryProjectExports", () => {
  it("downloads a portable backup without mutating storage or exposing workspace IDs", async () => {
    const key = workspaceProjectRecordKey(WS, 1, PROJECT_A);
    const invalidKey = workspaceProjectRecordKey(
      WS,
      1,
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );
    const storage = new MemoryWorkspaceStorageAdapter({
      [key]: recordBytes(),
      [invalidKey]: "invalid",
    });
    const before = storage.snapshot();
    const NativeBlob = globalThis.Blob;
    let backupJson = "";
    class CapturingBlob extends NativeBlob {
      constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
        super(parts, options);
        backupJson = parts.join("");
      }
    }
    vi.stubGlobal("Blob", CapturingBlob);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:recovery-backup");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(
      <LocaleProvider>
        <WorkspaceRecoveryProjectExports storage={storage} onNotice={vi.fn()} />
      </LocaleProvider>,
    );

    expect(await screen.findByText(/1 invalid or mismatched/u)).toBeVisible();
    fireEvent.click(screen.getByRole("button", {
      name: "Download backup for RubricTrail sample project, readable record 1",
    }));

    await waitFor(() => expect(backupJson).not.toBe(""));
    expect(JSON.parse(backupJson)).toMatchObject({
      format: "rubrictrail-project",
      formatVersion: 1,
      project: { projectKind: "sample" },
    });
    expect(backupJson).not.toContain(WS);
    expect(backupJson).not.toContain(PROJECT_A);
    expect(storage.snapshot()).toEqual(before);
  });

  it("fails visibly rather than exporting when exact candidate bytes changed", async () => {
    const key = workspaceProjectRecordKey(WS, 1, PROJECT_A);
    const storage = new MemoryWorkspaceStorageAdapter({ [key]: recordBytes() });
    const onNotice = vi.fn();
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:unused");

    render(
      <LocaleProvider>
        <WorkspaceRecoveryProjectExports storage={storage} onNotice={onNotice} />
      </LocaleProvider>,
    );
    const download = await screen.findByRole("button", { name: /Download backup for/u });
    storage.setItem(key, "changed-after-inspection");
    fireEvent.click(download);

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(
      expect.stringMatching(/changed before export/u),
    ));
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("reports unreadable storage without inventing a candidate", async () => {
    const storage = new MemoryWorkspaceStorageAdapter();
    storage.faults.armAtCheckpoint("before:keys", "security");

    render(
      <LocaleProvider>
        <WorkspaceRecoveryProjectExports storage={storage} onNotice={vi.fn()} />
      </LocaleProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be read safely/u,
    );
    expect(screen.queryByRole("button", { name: /Download backup for/u })).toBeNull();
  });
});
