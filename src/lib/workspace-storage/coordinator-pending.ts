import { serializePersistedProjectStateValue } from "@/lib/local-state";
import {
  saveWorkspaceProject,
  workspaceProjectBaseline,
  type WorkspaceAuthoritySnapshot,
  type WorkspaceExclusiveLockRunner,
  type WorkspaceProjectBaseline,
  type WorkspaceProjectSaveResult,
} from "@/lib/workspace-storage/coordinator";
import type { WorkspaceStorageAdapter } from "@/lib/workspace-storage/storage-adapter";
import type { PersistedProjectState } from "@/lib/ui-types";

interface WorkspacePendingSave {
  token: number;
  state: PersistedProjectState;
}

interface WorkspacePendingSaveEntry {
  baseline: WorkspaceProjectBaseline;
  pending: WorkspacePendingSave | null;
  inFlight: Promise<WorkspaceProjectSaveResult> | null;
}

export type WorkspacePendingSaveQueueResult =
  | { ok: true; token: number }
  | {
      ok: false;
      reason: "project-not-active" | "invalid-state" | "token-exhausted";
    };

export type WorkspacePendingSaveFlushResult =
  | WorkspaceProjectSaveResult
  | { ok: false; reason: "no-pending-save" | "save-in-flight" };

/**
 * Current-tab-only autosave bookkeeping. Entries and baselines are keyed by
 * project ID, so completing A can neither clear B nor reuse B's baseline. A
 * successful revision that is superseded while awaiting storage advances that
 * project's baseline but deliberately leaves the newer pending state queued.
 * Membership-changing create/restore operations must first require
 * `membershipChangeReady()`, then reconstruct this manager from the returned
 * authoritative snapshot. That reconstruction is safe only because no pending
 * or in-flight entry can be dropped at that boundary.
 */
export class WorkspacePendingSaveManager {
  private readonly entries = new Map<string, WorkspacePendingSaveEntry>();
  private nextToken = 1;

  constructor(snapshot: WorkspaceAuthoritySnapshot) {
    for (const project of snapshot.projects) {
      const baseline = workspaceProjectBaseline(
        snapshot,
        project.record.projectId,
      );
      if (baseline) {
        this.entries.set(project.record.projectId, {
          baseline,
          pending: null,
          inFlight: null,
        });
      }
    }
  }

  queue(
    projectId: string,
    state: PersistedProjectState,
  ): WorkspacePendingSaveQueueResult {
    const entry = this.entries.get(projectId);
    if (!entry) return { ok: false, reason: "project-not-active" };
    if (state.projectKind === "none") {
      return { ok: false, reason: "invalid-state" };
    }
    const canonical = serializePersistedProjectStateValue(state);
    if (!canonical.ok || canonical.recovered) {
      return { ok: false, reason: "invalid-state" };
    }
    if (this.nextToken >= Number.MAX_SAFE_INTEGER) {
      return { ok: false, reason: "token-exhausted" };
    }
    const token = this.nextToken;
    this.nextToken += 1;
    entry.pending = { token, state: canonical.state };
    return { ok: true, token };
  }

  hasPending(projectId: string): boolean {
    return (this.entries.get(projectId)?.pending ?? null) !== null;
  }

  pendingProjectIds(): string[] {
    return [...this.entries.entries()]
      .filter(([, entry]) => entry.pending !== null)
      .map(([projectId]) => projectId)
      .sort();
  }

  membershipChangeReady(): boolean {
    return [...this.entries.values()].every(
      (entry) => entry.pending === null && entry.inFlight === null,
    );
  }

  baselineFor(projectId: string): WorkspaceProjectBaseline | null {
    const baseline = this.entries.get(projectId)?.baseline;
    return baseline ? { ...baseline, index: { ...baseline.index } } : null;
  }

  async flushProject(
    storage: WorkspaceStorageAdapter,
    locks: WorkspaceExclusiveLockRunner | null,
    projectId: string,
  ): Promise<WorkspacePendingSaveFlushResult> {
    const entry = this.entries.get(projectId);
    if (!entry?.pending) return { ok: false, reason: "no-pending-save" };
    if (entry.inFlight) return { ok: false, reason: "save-in-flight" };

    const captured = entry.pending;
    const operation = saveWorkspaceProject(storage, locks, {
      baseline: entry.baseline,
      nextState: captured.state,
      intentStillCurrent: () => entry.pending?.token === captured.token,
    });
    entry.inFlight = operation;
    try {
      const result = await operation;
      if (result.ok) {
        const nextBaseline = workspaceProjectBaseline(result.snapshot, projectId);
        if (nextBaseline) {
          entry.baseline = nextBaseline;
          if (entry.pending?.token === captured.token && !result.superseded) {
            entry.pending = null;
          }
        }
      }
      return result;
    } finally {
      if (entry.inFlight === operation) entry.inFlight = null;
    }
  }
}
