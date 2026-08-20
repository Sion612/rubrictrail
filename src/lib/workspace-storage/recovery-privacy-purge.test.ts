import { describe, expect, it } from "vitest";

import { sha256StoredString } from "@/lib/workspace-storage/digest";
import {
  WORKSPACE_INDEX_KEY,
  WORKSPACE_OPERATION_KEY,
  WORKSPACE_RESERVE_KEY,
  workspaceProjectRecordKey,
} from "@/lib/workspace-storage/keys";
import {
  serializeWorkspaceIndex,
  serializeWorkspaceJournal,
} from "@/lib/workspace-storage/protocol";
import {
  classifyWorkspaceRecovery,
  prepareWorkspaceJournal,
} from "@/lib/workspace-storage/recovery";
import { CANONICAL_WORKSPACE_RESERVE } from "@/lib/workspace-storage/reserve";
import { MemoryWorkspaceStorageAdapter } from "@/lib/workspace-storage/storage-adapter";
import {
  activeIndex,
  activeProjectRecord,
  canonicalIndexBytes,
  canonicalProjectRecordBytes,
  NULL_LEGACY_FINGERPRINTS,
  PROJECT_A,
  WS,
} from "@/lib/workspace-storage/test-fixtures";
import type {
  WorkspaceDigest,
  WorkspaceOperationJournalV1,
} from "@/lib/workspace-storage/types";

const PURGE_WORKSPACE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PURGE_OPERATION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

async function digest(raw: string): Promise<WorkspaceDigest> {
  const result = await sha256StoredString(raw);
  if (!result.ok) throw new Error("SHA-256 unavailable in recovery-purge fixture");
  return result.digest;
}

function projectId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

async function recoveryPurgeFixture(options: {
  baseIndexRaw: string | null;
  projectCount: number;
}): Promise<{
  journal: WorkspaceOperationJournalV1;
  serializedJournal: string;
  storage: MemoryWorkspaceStorageAdapter;
  targetIndexRaw: string;
}> {
  const target = serializeWorkspaceIndex({
    formatVersion: 1,
    workspaceId: PURGE_WORKSPACE_ID,
    workspaceGeneration: 1,
    revision: 1,
    status: "cleared",
    projects: [],
    legacyFingerprints: NULL_LEGACY_FINGERPRINTS,
  });
  if (!target.ok) throw new Error("Recovery-purge target index fixture is invalid");

  const initial: Record<string, string> = {
    [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
  };
  if (options.baseIndexRaw !== null) initial[WORKSPACE_INDEX_KEY] = options.baseIndexRaw;

  const cleanup: WorkspaceOperationJournalV1["cleanup"] = [];
  for (let index = 1; index <= options.projectCount; index += 1) {
    const key = workspaceProjectRecordKey(WS, 1, projectId(index));
    const raw = `untrusted-owned-project-value-${index}`;
    initial[key] = raw;
    cleanup.push({ key, expectedDigest: await digest(raw) });
  }

  const journal: WorkspaceOperationJournalV1 = {
    formatVersion: 1,
    operationId: PURGE_OPERATION_ID,
    kind: "delete-workspace",
    workspaceId: PURGE_WORKSPACE_ID,
    sourceGeneration: null,
    targetGeneration: 1,
    phase: "prepared",
    baseIndex: {
      key: WORKSPACE_INDEX_KEY,
      expectedDigest:
        options.baseIndexRaw === null ? null : await digest(options.baseIndexRaw),
    },
    targetIndex: {
      key: WORKSPACE_INDEX_KEY,
      serializedValue: target.serialized,
      targetDigest: await digest(target.serialized),
    },
    legacyExpectedDigests: NULL_LEGACY_FINGERPRINTS,
    projectMutations: [],
    cleanup,
  };
  const serialized = serializeWorkspaceJournal(journal);
  if (!serialized.ok) throw new Error("Recovery-purge journal fixture is invalid");
  return {
    journal,
    serializedJournal: serialized.serialized,
    storage: new MemoryWorkspaceStorageAdapter(initial),
    targetIndexRaw: target.serialized,
  };
}

describe("recovery-only workspace privacy purge", () => {
  it("prepares from a missing index and captures more than 200 exact owned records", async () => {
    const fixture = await recoveryPurgeFixture({
      baseIndexRaw: null,
      projectCount: 205,
    });

    expect(fixture.journal.cleanup).toHaveLength(205);
    expect(fixture.serializedJournal.length).toBeLessThan(196_608);
    const prepared = await prepareWorkspaceJournal(fixture.storage, fixture.journal, {
      releaseReserve: true,
      targetRecords: {},
    });

    expect(prepared).toMatchObject({ ok: true, status: "prepared" });
    expect(fixture.storage.getItem(WORKSPACE_OPERATION_KEY)).toBe(
      fixture.serializedJournal,
    );
    await expect(
      classifyWorkspaceRecovery(fixture.storage, fixture.serializedJournal),
    ).resolves.toMatchObject({
      kind: "delete-workspace",
      status: "cancel-or-roll-forward",
    });
  });

  it("prepares from a corrupt index but refuses to replace valid authority", async () => {
    const corrupt = await recoveryPurgeFixture({
      baseIndexRaw: "{\"corrupt\":true}",
      projectCount: 1,
    });
    await expect(
      prepareWorkspaceJournal(corrupt.storage, corrupt.journal, {
        releaseReserve: true,
        targetRecords: {},
      }),
    ).resolves.toMatchObject({ ok: true, status: "prepared" });

    const project = await canonicalProjectRecordBytes(
      activeProjectRecord(PROJECT_A, { workspaceId: PURGE_WORKSPACE_ID }),
    );
    const projectKey = workspaceProjectRecordKey(PURGE_WORKSPACE_ID, 1, PROJECT_A);
    const index = await canonicalIndexBytes(
      activeIndex({ workspaceId: PURGE_WORKSPACE_ID }),
    );
    const valid = await recoveryPurgeFixture({
      baseIndexRaw: index.serialized,
      projectCount: 0,
    });
    valid.journal.baseIndex.expectedDigest = index.digest;
    valid.journal.cleanup = [
      { key: projectKey, expectedDigest: project.digest },
    ];
    const serialized = serializeWorkspaceJournal(valid.journal);
    if (!serialized.ok) {
      throw new Error(`Valid-authority purge fixture is invalid: ${serialized.reason}`);
    }
    valid.storage.setItem(projectKey, project.serialized);

    await expect(
      prepareWorkspaceJournal(valid.storage, valid.journal, {
        releaseReserve: true,
        targetRecords: {},
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "baseline-conflict",
      status: "quarantine",
    });
  });

  it("keeps partial cleanup recoverable and rejects any newly discovered key", async () => {
    const fixture = await recoveryPurgeFixture({
      baseIndexRaw: null,
      projectCount: 2,
    });
    fixture.storage.setItem(WORKSPACE_OPERATION_KEY, fixture.serializedJournal);
    fixture.storage.setItem(WORKSPACE_INDEX_KEY, fixture.targetIndexRaw);
    fixture.storage.removeItem(fixture.journal.cleanup[0].key);

    await expect(
      classifyWorkspaceRecovery(fixture.storage, fixture.serializedJournal),
    ).resolves.toMatchObject({ status: "finish-cleanup" });

    const unexpectedKey = workspaceProjectRecordKey(WS, 1, projectId(999));
    fixture.storage.setItem(unexpectedKey, "new-third-value");
    await expect(
      classifyWorkspaceRecovery(fixture.storage, fixture.serializedJournal),
    ).resolves.toMatchObject({
      reason: "invalid-owned-record",
      status: "quarantine",
    });
  });
});
