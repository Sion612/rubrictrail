import type { PersistedProjectState } from "@/lib/ui-types";
import { parseWorkspaceProjectRecordKey } from "@/lib/workspace-storage/keys";
import {
  parseWorkspaceProjectRecord,
  workspaceProjectRecordMatchesKey,
} from "@/lib/workspace-storage/protocol";
import type { WorkspaceStorageAdapter } from "@/lib/workspace-storage/storage-adapter";

export interface WorkspaceReadOnlyProjectBackupCandidate {
  /** Opaque within the UI. It is never written into the portable backup. */
  candidateId: string;
  key: string;
  expectedRaw: string;
  state: PersistedProjectState;
}

export type WorkspaceReadOnlyProjectBackupInspection =
  | {
      ok: true;
      authorityDecision: "not-performed";
      candidates: readonly WorkspaceReadOnlyProjectBackupCandidate[];
      excludedInvalidRecordCount: number;
      tombstoneCount: number;
    }
  | { ok: false; reason: "storage-error" };

export type WorkspaceReadOnlyProjectBackupRevalidation =
  | { ok: true; state: PersistedProjectState }
  | { ok: false; reason: "record-changed" | "storage-error" };

function readableProjectState(
  key: string,
  raw: string,
): PersistedProjectState | "tombstone" | null {
  const keyIdentity = parseWorkspaceProjectRecordKey(key);
  const parsed = parseWorkspaceProjectRecord(raw);
  if (!keyIdentity || !parsed.ok || !workspaceProjectRecordMatchesKey(key, parsed.value)) {
    return null;
  }
  if (parsed.value.value.kind === "tombstone") return "tombstone";
  return parsed.value.value.state.projectKind === "none"
    ? null
    : parsed.value.value.state;
}

/**
 * Discovers individually valid v0.8 project records for portable backup only.
 * This deliberately does not read or write the workspace preference, interpret
 * a journal, select a candidate group, or create namespace authority.
 */
export function inspectWorkspaceReadOnlyProjectBackups(
  storage: WorkspaceStorageAdapter,
): WorkspaceReadOnlyProjectBackupInspection {
  try {
    const candidates: WorkspaceReadOnlyProjectBackupCandidate[] = [];
    let excludedInvalidRecordCount = 0;
    let tombstoneCount = 0;

    for (const key of [...storage.keys()].sort()) {
      if (!parseWorkspaceProjectRecordKey(key)) continue;
      const raw = storage.getItem(key);
      if (raw === null) {
        excludedInvalidRecordCount += 1;
        continue;
      }
      const state = readableProjectState(key, raw);
      if (state === "tombstone") {
        tombstoneCount += 1;
      } else if (state === null) {
        excludedInvalidRecordCount += 1;
      } else {
        candidates.push({ candidateId: key, key, expectedRaw: raw, state });
      }
    }

    return {
      ok: true,
      authorityDecision: "not-performed",
      candidates,
      excludedInvalidRecordCount,
      tombstoneCount,
    };
  } catch {
    return { ok: false, reason: "storage-error" };
  }
}

/** Rechecks the exact bytes immediately before a read-only backup is created. */
export function revalidateWorkspaceReadOnlyProjectBackup(
  storage: WorkspaceStorageAdapter,
  candidate: WorkspaceReadOnlyProjectBackupCandidate,
): WorkspaceReadOnlyProjectBackupRevalidation {
  try {
    const raw = storage.getItem(candidate.key);
    if (raw === null || raw !== candidate.expectedRaw) {
      return { ok: false, reason: "record-changed" };
    }
    const state = readableProjectState(candidate.key, raw);
    return state === null || state === "tombstone"
      ? { ok: false, reason: "record-changed" }
      : { ok: true, state };
  } catch {
    return { ok: false, reason: "storage-error" };
  }
}
