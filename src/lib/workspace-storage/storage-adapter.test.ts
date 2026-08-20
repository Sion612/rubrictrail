import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256StoredString } from "@/lib/workspace-storage/digest";
import {
  BrowserWorkspaceStorageAdapter,
  MemoryWorkspaceStorageAdapter,
  WorkspaceStorageFault,
  readExact,
  recreateWorkspaceReserve,
  removeExact,
  removeWorkspaceCleanupSource,
  removeWorkspaceJournal,
  removeWorkspaceReserve,
  writeExact,
  writeWorkspaceIndexTarget,
  writeWorkspaceJournalPhase,
  writeWorkspaceProjectTarget,
  type WorkspaceStorageAdapter,
} from "@/lib/workspace-storage/storage-adapter";

const JOURNAL_KEY = "rubrictrail.workspace.operation.v1";
const INDEX_KEY = "rubrictrail.workspace.index.v1";
const RESERVE_KEY = "rubrictrail.workspace.reserve.v1";

async function digest(value: string): Promise<string> {
  const result = await sha256StoredString(value);
  if (!result.ok) throw new Error("Digest unavailable for a fictional test fixture");
  return result.digest;
}

afterEach(() => vi.unstubAllGlobals());

describe("browser workspace storage adapter", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it("delegates reads, writes, removals, and sorted enumeration to Storage", () => {
    const adapter = new BrowserWorkspaceStorageAdapter(window.localStorage);

    adapter.setItem("fixture.z", "fictional-z");
    adapter.setItem("fixture.a", "fictional-a");
    expect(adapter.getItem("fixture.a")).toBe("fictional-a");
    expect(adapter.getItem("fixture.missing")).toBeNull();
    expect(adapter.keys()).toEqual(["fixture.a", "fixture.z"]);

    adapter.removeItem("fixture.a");
    expect(adapter.getItem("fixture.a")).toBeNull();
    expect(adapter.keys()).toEqual(["fixture.z"]);
  });
});

describe("digest-guarded semantic storage mutations", () => {
  it("writes from an exact absent/null baseline and recognizes an exact durable target", async () => {
    const storage = new MemoryWorkspaceStorageAdapter();
    const serializedTarget = "fictional-project-target";
    const guard = {
      expectedBeforeDigest: null,
      targetDigest: await digest(serializedTarget),
    };

    await expect(
      writeWorkspaceProjectTarget(storage, "fixture.project", serializedTarget, guard),
    ).resolves.toEqual({ ok: true, state: "applied" });
    await expect(
      writeWorkspaceProjectTarget(storage, "fixture.project", serializedTarget, guard),
    ).resolves.toEqual({ ok: true, state: "already-target" });
    expect(storage.snapshot()).toEqual({ "fixture.project": serializedTarget });
  });

  it("updates a journal phase only from its exact non-null baseline", async () => {
    const prepared = "fictional-journal-prepared";
    const recordsWriting = "fictional-journal-records-writing";
    const guard = {
      expectedBeforeDigest: await digest(prepared),
      targetDigest: await digest(recordsWriting),
    };
    const exactStorage = new MemoryWorkspaceStorageAdapter({
      [JOURNAL_KEY]: prepared,
    });
    await expect(
      writeWorkspaceJournalPhase(exactStorage, recordsWriting, guard),
    ).resolves.toEqual({ ok: true, state: "applied" });
    await expect(
      writeWorkspaceJournalPhase(exactStorage, recordsWriting, guard),
    ).resolves.toEqual({ ok: true, state: "already-target" });

    const thirdValue = "fictional-journal-third-value";
    const thirdStorage = new MemoryWorkspaceStorageAdapter({
      [JOURNAL_KEY]: thirdValue,
    });
    await expect(
      writeWorkspaceJournalPhase(thirdStorage, recordsWriting, guard),
    ).resolves.toEqual({ ok: false, reason: "baseline-mismatch" });
    expect(thirdStorage.snapshot()).toEqual({ [JOURNAL_KEY]: thirdValue });
  });

  it("fails closed on a third-value baseline without changing stored bytes", async () => {
    const expectedBefore = "fictional-expected-before";
    const thirdValue = "fictional-third-value";
    const serializedTarget = "fictional-target";
    const storage = new MemoryWorkspaceStorageAdapter({
      "fixture.project": thirdValue,
    });

    await expect(
      writeWorkspaceProjectTarget(storage, "fixture.project", serializedTarget, {
        expectedBeforeDigest: await digest(expectedBefore),
        targetDigest: await digest(serializedTarget),
      }),
    ).resolves.toEqual({ ok: false, reason: "baseline-mismatch" });
    expect(storage.snapshot()).toEqual({ "fixture.project": thirdValue });
  });

  it("rechecks the exact baseline bytes immediately before mutation", async () => {
    const expectedBefore = "fictional-expected-before";
    const interveningValue = "fictional-intervening-value";
    const serializedTarget = "fictional-target";
    let readCount = 0;
    let writeCount = 0;
    const storage: WorkspaceStorageAdapter = {
      getItem: () => {
        readCount += 1;
        return readCount === 1 ? expectedBefore : interveningValue;
      },
      setItem: () => {
        writeCount += 1;
      },
      removeItem: () => undefined,
      keys: () => [],
    };

    await expect(
      writeWorkspaceProjectTarget(storage, "fixture.project", serializedTarget, {
        expectedBeforeDigest: await digest(expectedBefore),
        targetDigest: await digest(serializedTarget),
      }),
    ).resolves.toEqual({ ok: false, reason: "baseline-mismatch" });
    expect(readCount).toBe(2);
    expect(writeCount).toBe(0);
  });

  it("rechecks commit authorization after the final awaited baseline confirmation", async () => {
    let writeAuthorized = true;
    let writeReads = 0;
    const writeBacking = new MemoryWorkspaceStorageAdapter();
    const writeStorage: WorkspaceStorageAdapter = {
      getItem(key) {
        writeReads += 1;
        const value = writeBacking.getItem(key);
        if (writeReads === 2) writeAuthorized = false;
        return value;
      },
      setItem: (key, value) => writeBacking.setItem(key, value),
      removeItem: (key) => writeBacking.removeItem(key),
      keys: () => writeBacking.keys(),
    };
    const target = "fictional-authorized-target";
    await expect(
      writeWorkspaceProjectTarget(writeStorage, "fixture.project", target, {
        expectedBeforeDigest: null,
        targetDigest: await digest(target),
        commitStillAuthorized: () => writeAuthorized,
      }),
    ).resolves.toEqual({ ok: false, reason: "commit-cancelled" });
    expect(writeBacking.snapshot()).toEqual({});

    let removeAuthorized = true;
    let removeReads = 0;
    const source = "fictional-authorized-source";
    const removeBacking = new MemoryWorkspaceStorageAdapter({
      "fixture.source": source,
    });
    const removeStorage: WorkspaceStorageAdapter = {
      getItem(key) {
        removeReads += 1;
        const value = removeBacking.getItem(key);
        if (removeReads === 2) removeAuthorized = false;
        return value;
      },
      setItem: (key, value) => removeBacking.setItem(key, value),
      removeItem: (key) => removeBacking.removeItem(key),
      keys: () => removeBacking.keys(),
    };
    await expect(
      removeWorkspaceCleanupSource(removeStorage, "fixture.source", {
        expectedBeforeDigest: await digest(source),
        commitStillAuthorized: () => removeAuthorized,
      }),
    ).resolves.toEqual({ ok: false, reason: "commit-cancelled" });
    expect(removeBacking.snapshot()).toEqual({ "fixture.source": source });
  });

  it("rejects malformed or mismatching target digests before mutation", async () => {
    const storage = new MemoryWorkspaceStorageAdapter();

    await expect(
      writeWorkspaceIndexTarget(storage, "fictional-index", {
        expectedBeforeDigest: null,
        targetDigest: "not-a-digest",
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid-digest" });
    await expect(
      writeWorkspaceIndexTarget(storage, "fictional-index", {
        expectedBeforeDigest: null,
        targetDigest: "a".repeat(64),
      }),
    ).resolves.toEqual({ ok: false, reason: "target-digest-mismatch" });
    expect(storage.snapshot()).toEqual({});
  });

  it("fails closed when the digest primitive is unavailable", async () => {
    const storage = new MemoryWorkspaceStorageAdapter();
    vi.stubGlobal("crypto", {});

    await expect(
      writeWorkspaceJournalPhase(storage, "fictional-journal", {
        expectedBeforeDigest: null,
        targetDigest: "a".repeat(64),
      }),
    ).resolves.toEqual({ ok: false, reason: "digest-unavailable" });
    expect(storage.snapshot()).toEqual({});
  });

  it("fails closed before cleanup when the digest primitive is unavailable", async () => {
    const source = "fictional-cleanup-source";
    const expectedBeforeDigest = await digest(source);
    const storage = new MemoryWorkspaceStorageAdapter({
      "fixture.source": source,
    });
    vi.stubGlobal("crypto", {});

    await expect(
      removeWorkspaceCleanupSource(storage, "fixture.source", {
        expectedBeforeDigest,
      }),
    ).resolves.toEqual({ ok: false, reason: "digest-unavailable" });
    expect(storage.snapshot()).toEqual({ "fixture.source": source });
  });

  it("detects a post-write readback mismatch without exposing either value", async () => {
    const backing = new MemoryWorkspaceStorageAdapter();
    let targetWasWritten = false;
    const storage: WorkspaceStorageAdapter = {
      getItem: (key) =>
        targetWasWritten && key === "fixture.project"
          ? "fictional-readback-third-value"
          : backing.getItem(key),
      setItem: (key, value) => {
        backing.setItem(key, value);
        targetWasWritten = true;
      },
      removeItem: (key) => backing.removeItem(key),
      keys: () => backing.keys(),
    };
    const serializedTarget = "fictional-project-target";

    await expect(
      writeWorkspaceProjectTarget(storage, "fixture.project", serializedTarget, {
        expectedBeforeDigest: null,
        targetDigest: await digest(serializedTarget),
      }),
    ).resolves.toEqual({ ok: false, reason: "readback-mismatch" });
    expect(backing.snapshot()).toEqual({ "fixture.project": serializedTarget });
  });

  it("removes only an exact digest and treats an already-absent key as complete", async () => {
    const source = "fictional-cleanup-source";
    const guard = { expectedBeforeDigest: await digest(source) };
    const storage = new MemoryWorkspaceStorageAdapter({
      "fixture.source": source,
    });

    await expect(
      removeWorkspaceCleanupSource(storage, "fixture.source", guard),
    ).resolves.toEqual({ ok: true, state: "applied" });
    await expect(
      removeWorkspaceCleanupSource(storage, "fixture.source", guard),
    ).resolves.toEqual({ ok: true, state: "already-target" });
    expect(storage.snapshot()).toEqual({});
  });

  it("preserves a cleanup third value", async () => {
    const thirdValue = "fictional-cleanup-third-value";
    const storage = new MemoryWorkspaceStorageAdapter({
      "fixture.source": thirdValue,
    });

    await expect(
      removeWorkspaceCleanupSource(storage, "fixture.source", {
        expectedBeforeDigest: await digest("fictional-expected-source"),
      }),
    ).resolves.toEqual({ ok: false, reason: "baseline-mismatch" });
    expect(storage.snapshot()).toEqual({ "fixture.source": thirdValue });
  });

  it("removes only the exact classified journal and preserves a third value", async () => {
    const journal = "fictional-classified-journal";
    const guard = { expectedBeforeDigest: await digest(journal) };
    const exactStorage = new MemoryWorkspaceStorageAdapter({
      [JOURNAL_KEY]: journal,
    });

    await expect(removeWorkspaceJournal(exactStorage, guard)).resolves.toEqual({
      ok: true,
      state: "applied",
    });
    expect(exactStorage.snapshot()).toEqual({});

    const thirdValue = "fictional-third-journal";
    const thirdStorage = new MemoryWorkspaceStorageAdapter({
      [JOURNAL_KEY]: thirdValue,
    });
    await expect(removeWorkspaceJournal(thirdStorage, guard)).resolves.toEqual({
      ok: false,
      reason: "baseline-mismatch",
    });
    expect(thirdStorage.snapshot()).toEqual({ [JOURNAL_KEY]: thirdValue });
  });

  it("detects a post-remove readback mismatch without exposing the value", async () => {
    const source = "fictional-cleanup-source";
    const backing = new MemoryWorkspaceStorageAdapter({
      "fixture.source": source,
    });
    let removed = false;
    const storage: WorkspaceStorageAdapter = {
      getItem: (key) =>
        removed && key === "fixture.source"
          ? "fictional-readback-third-value"
          : backing.getItem(key),
      setItem: (key, value) => backing.setItem(key, value),
      removeItem: (key) => {
        backing.removeItem(key);
        removed = true;
      },
      keys: () => backing.keys(),
    };

    const result = await removeWorkspaceCleanupSource(storage, "fixture.source", {
      expectedBeforeDigest: await digest(source),
    });
    expect(result).toEqual({ ok: false, reason: "readback-mismatch" });
    expect(JSON.stringify(result)).not.toContain("fictional");
    expect(backing.snapshot()).toEqual({});
  });
});

describe("deterministic workspace storage faults", () => {
  it("returns a bounded storage error for an injected quota failure", () => {
    const storage = new MemoryWorkspaceStorageAdapter();
    storage.faults.armAtCheckpoint("before:setItem:fixture", "quota");

    expect(writeExact(storage, "fixture", "fictional-private-value")).toEqual({
      ok: false,
      reason: "storage-error",
    });
    expect(storage.snapshot()).toEqual({});
    expect(storage.faults.visitedCheckpoints()).toEqual(["before:setItem:fixture"]);
  });

  it("returns a bounded storage error for an injected SecurityError boundary", () => {
    const storage = new MemoryWorkspaceStorageAdapter({ fixture: "preserve-me" });
    storage.faults.armAtCheckpoint("before:removeItem:fixture", "security");

    expect(removeExact(storage, "fixture")).toEqual({
      ok: false,
      reason: "storage-error",
    });
    expect(storage.snapshot()).toEqual({ fixture: "preserve-me" });
  });

  it("detects an exact readback mismatch without trusting setItem success", () => {
    const storage = new MemoryWorkspaceStorageAdapter();
    storage.setReadOverride("fixture", "different-value");

    expect(writeExact(storage, "fixture", "target-value")).toEqual({
      ok: false,
      reason: "readback-mismatch",
    });
    expect(storage.snapshot()).toEqual({ fixture: "target-value" });
  });

  it("distinguishes injected readback failures from injected crashes", () => {
    const failedRead = new MemoryWorkspaceStorageAdapter({ fixture: "value" });
    failedRead.faults.armAtCheckpoint("before:getItem:fixture", "security");
    expect(readExact(failedRead, "fixture")).toEqual({
      ok: false,
      reason: "storage-error",
    });

    const crashedReadback = new MemoryWorkspaceStorageAdapter();
    crashedReadback.faults.armAtCheckpoint("readback:fixture", "crash");
    expect(() => writeExact(crashedReadback, "fixture", "durable-before-crash")).toThrow(
      expect.objectContaining({
        kind: "crash",
        checkpointName: "readback:fixture",
      }),
    );
    expect(crashedReadback.snapshot()).toEqual({
      fixture: "durable-before-crash",
    });
  });

  it("reproduces a crash by deterministic step number and preserves its durable boundary", () => {
    const storage = new MemoryWorkspaceStorageAdapter();
    storage.faults.armAtStep(2, "crash");

    expect(() => storage.setItem("fixture", "durable-at-step-two")).toThrow(
      expect.objectContaining({
        kind: "crash",
        checkpointName: "after:setItem:fixture",
      }),
    );
    expect(storage.snapshot()).toEqual({ fixture: "durable-at-step-two" });
  });

  it("never includes a stored value in fault diagnostics", () => {
    const storage = new MemoryWorkspaceStorageAdapter();
    const privateFixture = "fictional-private-coursework";
    storage.faults.armAtCheckpoint("before:setItem:fixture", "crash");

    let observed: unknown;
    try {
      storage.setItem("fixture", privateFixture);
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(WorkspaceStorageFault);
    if (!(observed instanceof Error)) throw new Error("Expected a redacted storage fault");
    expect(observed.message).not.toContain(privateFixture);
  });

  it("injects every semantic crash only after its exact storage mutation is durable", async () => {
    const journal = "fictional-journal";
    const project = "fictional-project";
    const index = "fictional-index";
    const source = "fictional-source";
    const [journalDigest, projectDigest, indexDigest, sourceDigest] =
      await Promise.all(
        [journal, project, index, source].map((value) => digest(value)),
      );
    const cases: Array<{
      checkpoint: string;
      initial?: Record<string, string>;
      mutate(storage: MemoryWorkspaceStorageAdapter): unknown | Promise<unknown>;
      expected: Record<string, string>;
    }> = [
      {
        checkpoint: "journal-phase-update",
        mutate: (storage) =>
          writeWorkspaceJournalPhase(storage, journal, {
            expectedBeforeDigest: null,
            targetDigest: journalDigest,
          }),
        expected: { [JOURNAL_KEY]: journal },
      },
      {
        checkpoint: "journal-removal",
        initial: { [JOURNAL_KEY]: journal },
        mutate: (storage) =>
          removeWorkspaceJournal(storage, {
            expectedBeforeDigest: journalDigest,
          }),
        expected: {},
      },
      {
        checkpoint: "project-target-write",
        mutate: (storage) =>
          writeWorkspaceProjectTarget(storage, "fixture.project", project, {
            expectedBeforeDigest: null,
            targetDigest: projectDigest,
          }),
        expected: { "fixture.project": project },
      },
      {
        checkpoint: "index-commit",
        mutate: (storage) =>
          writeWorkspaceIndexTarget(storage, index, {
            expectedBeforeDigest: null,
            targetDigest: indexDigest,
          }),
        expected: { [INDEX_KEY]: index },
      },
      {
        checkpoint: "source-cleanup",
        initial: { "fixture.source": source },
        mutate: (storage) =>
          removeWorkspaceCleanupSource(storage, "fixture.source", {
            expectedBeforeDigest: sourceDigest,
          }),
        expected: {},
      },
      {
        checkpoint: "reserve-removal",
        initial: { [RESERVE_KEY]: "fictional-reserve" },
        mutate: (storage) => removeWorkspaceReserve(storage),
        expected: {},
      },
      {
        checkpoint: "reserve-recreation",
        mutate: (storage) => recreateWorkspaceReserve(storage, "fictional-reserve"),
        expected: { [RESERVE_KEY]: "fictional-reserve" },
      },
    ];

    for (const testCase of cases) {
      const storage = new MemoryWorkspaceStorageAdapter(testCase.initial);
      storage.faults.armAtCheckpoint(testCase.checkpoint, "crash");

      await expect(async () => testCase.mutate(storage), testCase.checkpoint).rejects.toMatchObject(
        expect.objectContaining({
          kind: "crash",
          checkpointName: testCase.checkpoint,
        }),
      );
      expect(storage.snapshot(), testCase.checkpoint).toEqual(testCase.expected);
    }
  });
});
