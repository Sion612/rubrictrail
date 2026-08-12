import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ErrorPage from "@/app/error";
import {
  createDefaultProjectState,
  LEGACY_STORAGE_KEY,
  PREVIOUS_STORAGE_KEY,
  PROJECT_LOCK_NAME,
  PROJECT_RECORD_KEY,
  readProjectStateWithStatus,
  STORAGE_KEY,
  writeProjectState,
} from "@/lib/local-state";
import {
  createFifoLockManager,
  holdLock,
  installLockManager,
  removeLockManager,
} from "../../tests/web-locks-mock";

let lockManager: LockManager;

async function seedProject() {
  const initial = readProjectStateWithStatus();
  const result = await writeProjectState(
    createDefaultProjectState(),
    initial.baseline,
  );
  if (!result.ok) throw new Error(`Could not seed project: ${result.reason}`);
  return result;
}

beforeEach(() => {
  window.localStorage.clear();
  lockManager = createFifoLockManager().manager;
  installLockManager(lockManager);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  removeLockManager();
  window.localStorage.clear();
});

describe("ErrorPage recovery", () => {
  it("keeps the exact project record when destructive reset is not confirmed", async () => {
    const seeded = await seedProject();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const reloadPage = vi.fn();

    render(
      <ErrorPage
        error={new Error("test failure")}
        reset={vi.fn()}
        reloadPage={reloadPage}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset local project" }));

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("cannot be undone"),
    );
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(
      seeded.recordValue,
    );
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it("refuses to clear a revision changed after the recovery page opened", async () => {
    const seeded = await seedProject();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    const reloadPage = vi.fn();

    render(
      <ErrorPage
        error={new Error("test failure")}
        reset={vi.fn()}
        reloadPage={reloadPage}
      />,
    );
    const external = await writeProjectState(
      { ...createDefaultProjectState(), weeklyHours: 19 },
      seeded.baseline,
    );
    if (!external.ok) throw new Error("Expected the external revision to save");
    fireEvent.click(screen.getByRole("button", { name: "Reset local project" }));

    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        expect.stringContaining("changed after this recovery page opened"),
      ),
    );
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(
      external.recordValue,
    );
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it("does not clear anything when safe tab coordination is unavailable", async () => {
    const seeded = await seedProject();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    const reloadPage = vi.fn();
    render(
      <ErrorPage
        error={new Error("test failure")}
        reset={vi.fn()}
        reloadPage={reloadPage}
      />,
    );
    removeLockManager();

    fireEvent.click(screen.getByRole("button", { name: "Reset local project" }));

    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        expect.stringContaining("cannot coordinate a safe reset across tabs"),
      ),
    );
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(
      seeded.recordValue,
    );
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it("reports an invalid record without replacing its exact bytes", async () => {
    const maxRevisionRecord = JSON.stringify({
      formatVersion: 1,
      revision: Number.MAX_SAFE_INTEGER,
      value: { kind: "cleared" },
      legacyFingerprints: { v3: null, v2: null, v1: null },
    });
    window.localStorage.setItem(PROJECT_RECORD_KEY, maxRevisionRecord);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    const reloadPage = vi.fn();
    render(
      <ErrorPage
        error={new Error("test failure")}
        reset={vi.fn()}
        reloadPage={reloadPage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset local project" }));

    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        expect.stringContaining("cannot accept another safe revision"),
      ),
    );
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(
      maxRevisionRecord,
    );
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it("reports storage failure without claiming a confirmed reset", async () => {
    const seeded = await seedProject();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    const reloadPage = vi.fn();
    const nativeSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === PROJECT_RECORD_KEY) {
        throw new DOMException("Storage unavailable", "QuotaExceededError");
      }
      nativeSetItem.call(this, key, value);
    });
    render(
      <ErrorPage
        error={new Error("test failure")}
        reset={vi.fn()}
        reloadPage={reloadPage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset local project" }));

    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        expect.stringContaining("could not confirm complete deletion"),
      ),
    );
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(
      seeded.recordValue,
    );
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it("disables recovery actions while completing a verified privacy purge", async () => {
    const seeded = await seedProject();
    window.localStorage.setItem(STORAGE_KEY, "retained v3 bytes");
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, "retained v2 bytes");
    window.localStorage.setItem(LEGACY_STORAGE_KEY, "retained legacy bytes");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const reloadPage = vi.fn();
    render(
      <ErrorPage
        error={new Error("test failure")}
        reset={vi.fn()}
        reloadPage={reloadPage}
      />,
    );
    const held = holdLock(lockManager, PROJECT_LOCK_NAME);
    await held.entered;

    fireEvent.click(screen.getByRole("button", { name: "Reset local project" }));

    const resetting = screen.getByRole("button", {
      name: "Resetting local project…",
    });
    expect(resetting).toBeDisabled();
    expect(resetting).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Try again" })).toBeDisabled();

    held.release();
    await held.done;
    await waitFor(() => expect(reloadPage).toHaveBeenCalledOnce());

    expect(JSON.parse(window.localStorage.getItem(PROJECT_RECORD_KEY) ?? "{}")).toMatchObject({
      formatVersion: 1,
      revision: seeded.revision + 2,
      value: { kind: "cleared" },
      legacyFingerprints: { v3: null, v2: null, v1: null },
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });
});
