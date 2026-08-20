import { describe, expect, it } from "vitest";
import { createDefaultProjectState } from "@/lib/local-state";
import {
  readWorkspaceAuthority,
  type WorkspaceAuthoritySnapshot,
  type WorkspaceExclusiveLockRunner,
} from "@/lib/workspace-storage/coordinator";
import { WorkspacePendingSaveManager } from "@/lib/workspace-storage/coordinator-pending";
import {
  WORKSPACE_INDEX_KEY,
  WORKSPACE_RESERVE_KEY,
  workspaceProjectRecordKey,
} from "@/lib/workspace-storage/keys";
import {
  serializeWorkspaceIndex,
  serializeWorkspaceProjectRecord,
} from "@/lib/workspace-storage/protocol";
import { CANONICAL_WORKSPACE_RESERVE } from "@/lib/workspace-storage/reserve";
import { MemoryWorkspaceStorageAdapter } from "@/lib/workspace-storage/storage-adapter";
import {
  activeIndex,
  activeProjectRecord,
  NULL_LEGACY_FINGERPRINTS,
  PROJECT_A,
  PROJECT_B,
} from "@/lib/workspace-storage/test-fixtures";
import type { PersistedProjectState } from "@/lib/ui-types";

class SerialLockRunner implements WorkspaceExclusiveLockRunner {
  runExclusive<T>(_name: string, operation: () => Promise<T>): Promise<T> {
    return operation();
  }
}

class GatedLockRunner implements WorkspaceExclusiveLockRunner {
  private releaseGate: (() => void) | null = null;
  readonly entered = new Promise<void>((resolve) => {
    this.releaseGate = resolve;
  });

  async runExclusive<T>(_name: string, operation: () => Promise<T>): Promise<T> {
    await this.entered;
    return operation();
  }

  release(): void {
    this.releaseGate?.();
    this.releaseGate = null;
  }
}

function state(label: string): PersistedProjectState {
  return {
    ...createDefaultProjectState(),
    projectKind: "sample",
    draftText: `Fictional ${label}`,
  };
}

async function fixture(projectIds: readonly string[]): Promise<{
  storage: MemoryWorkspaceStorageAdapter;
  snapshot: WorkspaceAuthoritySnapshot;
}> {
  const index = serializeWorkspaceIndex(
    activeIndex({
      projects: projectIds.map((projectId) => ({
        projectId,
        kind: "active" as const,
      })),
      legacyFingerprints: NULL_LEGACY_FINGERPRINTS,
    }),
  );
  if (!index.ok) throw new Error("Invalid test index");
  const values: Record<string, string> = {
    [WORKSPACE_INDEX_KEY]: index.serialized,
    [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
  };
  for (const [position, projectId] of projectIds.entries()) {
    const record = serializeWorkspaceProjectRecord({
      ...activeProjectRecord(projectId),
      value: { kind: "project", state: state(`project-${position}`) },
    });
    if (!record.ok) throw new Error("Invalid test project");
    values[
      workspaceProjectRecordKey(
        index.value.workspaceId,
        index.value.workspaceGeneration,
        projectId,
      )
    ] = record.serialized;
  }
  const storage = new MemoryWorkspaceStorageAdapter(values);
  const authority = await readWorkspaceAuthority(storage);
  if (!authority.ok) throw new Error(authority.reason);
  return { storage, snapshot: authority.snapshot };
}

describe("WorkspacePendingSaveManager membership freeze", () => {
  it("rejects freeze while pending, blocks queues while frozen, and allows explicit cancellation", async () => {
    const { snapshot } = await fixture([PROJECT_A]);
    const manager = new WorkspacePendingSaveManager(snapshot);
    expect(manager.queue(PROJECT_A, state("pending"))).toMatchObject({ ok: true });
    expect(manager.freezeForMembershipChange()).toEqual({
      ok: false,
      reason: "pending-save",
    });

    const drained = new WorkspacePendingSaveManager(snapshot);
    const frozen = drained.freezeForMembershipChange();
    expect(frozen).toMatchObject({ ok: true });
    if (!frozen.ok) return;
    expect(drained.membershipChangeReady()).toBe(false);
    expect(drained.queue(PROJECT_A, state("blocked"))).toEqual({
      ok: false,
      reason: "membership-change-frozen",
    });
    expect(drained.cancelMembershipChange({ token: frozen.lease.token + 1 })).toBe(
      false,
    );
    expect(drained.cancelMembershipChange(frozen.lease)).toBe(true);
    expect(drained.membershipChangeReady()).toBe(true);
    expect(drained.queue(PROJECT_A, state("allowed"))).toMatchObject({ ok: true });
  });

  it("rejects freeze while a project save is genuinely in flight", async () => {
    const { storage, snapshot } = await fixture([PROJECT_A]);
    const manager = new WorkspacePendingSaveManager(snapshot);
    const locks = new GatedLockRunner();
    manager.queue(PROJECT_A, state("in-flight"));
    const saving = manager.flushProject(storage, locks, PROJECT_A);

    expect(manager.freezeForMembershipChange()).toEqual({
      ok: false,
      reason: "save-in-flight",
    });
    locks.release();
    await expect(saving).resolves.toMatchObject({ ok: true });
    expect(manager.membershipChangeReady()).toBe(true);
  });

  it("rebuilds every baseline from the exact membership-change snapshot", async () => {
    const first = await fixture([PROJECT_A]);
    const second = await fixture([PROJECT_A, PROJECT_B]);
    const manager = new WorkspacePendingSaveManager(first.snapshot);
    const frozen = manager.freezeForMembershipChange();
    if (!frozen.ok) throw new Error("Expected a freeze lease");

    expect(
      manager.rebuildAfterMembershipChange(
        { token: frozen.lease.token + 1 },
        second.snapshot,
      ),
    ).toEqual({ ok: false, reason: "invalid-lease" });
    expect(
      manager.rebuildAfterMembershipChange(frozen.lease, second.snapshot),
    ).toEqual({ ok: true });
    expect(manager.membershipChangeReady()).toBe(true);
    expect(manager.baselineFor(PROJECT_A)?.index.raw).toBe(
      second.snapshot.indexRaw,
    );
    expect(manager.baselineFor(PROJECT_B)?.index.raw).toBe(
      second.snapshot.indexRaw,
    );
    expect(manager.queue(PROJECT_A, state("old-project"))).toMatchObject({
      ok: true,
    });
    await expect(
      manager.flushProject(second.storage, new SerialLockRunner(), PROJECT_A),
    ).resolves.toMatchObject({ ok: true, superseded: false });
  });
});
