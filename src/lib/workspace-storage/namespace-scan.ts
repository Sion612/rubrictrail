import {
  generateCollisionCheckedUuid,
  parseWorkspaceProjectRecordKey,
  WORKSPACE_INDEX_KEY,
  WORKSPACE_OPERATION_KEY,
} from "@/lib/workspace-storage/keys";
import {
  parseWorkspaceIndex,
  parseWorkspaceJournal,
  parseWorkspaceProjectRecord,
  workspaceProjectRecordMatchesKey,
  WORKSPACE_PROJECT_RECORD_LIMIT,
  validateWorkspaceJournalDigests,
} from "@/lib/workspace-storage/protocol";
import type { WorkspaceStorageAdapter } from "@/lib/workspace-storage/storage-adapter";
import type { SecureUuidSource } from "@/lib/workspace-storage/keys";
import type { WorkspaceProjectRecordV1 } from "@/lib/workspace-storage/types";

export type WorkspaceScannedRecord =
  | {
      key: string;
      status: "active" | "tombstone";
      record: WorkspaceProjectRecordV1;
    }
  | { key: string; status: "invalid" | "quarantined"; record: null };

export interface WorkspaceNamespaceCandidateGroup {
  workspaceId: string;
  workspaceGeneration: number;
  records: WorkspaceScannedRecord[];
  activeCount: number;
  tombstoneCount: number;
  invalidCount: number;
  quarantinedCount: number;
  overLimit: boolean;
  coherent: boolean;
}

export interface WorkspaceNamespaceScanResult {
  authority: "none";
  requiresExplicitSelection: true;
  groups: WorkspaceNamespaceCandidateGroup[];
  ignoredKeys: string[];
  journalState: "absent" | "present-unresolved" | "invalid";
  physicalProjectRecordCount: number;
  growthBlocked: boolean;
}

export type WorkspaceNamespaceScanOutcome =
  | { ok: true; result: WorkspaceNamespaceScanResult }
  | { ok: false; reason: "storage-error" };

export function scanWorkspaceNamespace(
  storage: WorkspaceStorageAdapter,
): WorkspaceNamespaceScanOutcome {
  try {
    const groups = new Map<string, WorkspaceNamespaceCandidateGroup>();
    const ignoredKeys: string[] = [];
    let physicalProjectRecordCount = 0;
    const journalRaw = storage.getItem(WORKSPACE_OPERATION_KEY);
    const journalState =
      journalRaw === null
        ? "absent"
        : parseWorkspaceJournal(journalRaw).ok
          ? "present-unresolved"
          : "invalid";

    for (const key of storage.keys()) {
      const keyIdentity = parseWorkspaceProjectRecordKey(key);
      if (!keyIdentity) {
        ignoredKeys.push(key);
        continue;
      }
      physicalProjectRecordCount += 1;
      const groupKey = `${keyIdentity.workspaceId}:${keyIdentity.workspaceGeneration}`;
      let group = groups.get(groupKey);
      if (!group) {
        group = {
          workspaceId: keyIdentity.workspaceId,
          workspaceGeneration: keyIdentity.workspaceGeneration,
          records: [],
          activeCount: 0,
          tombstoneCount: 0,
          invalidCount: 0,
          quarantinedCount: 0,
          overLimit: false,
          coherent: true,
        };
        groups.set(groupKey, group);
      }

      const raw = storage.getItem(key);
      const parsed = raw === null ? null : parseWorkspaceProjectRecord(raw);
      if (!parsed?.ok) {
        group.records.push({ key, status: "invalid", record: null });
        group.invalidCount += 1;
        group.coherent = false;
        continue;
      }
      if (!workspaceProjectRecordMatchesKey(key, parsed.value)) {
        group.records.push({ key, status: "quarantined", record: null });
        group.quarantinedCount += 1;
        group.coherent = false;
        continue;
      }
      const status = parsed.value.value.kind === "project" ? "active" : "tombstone";
      group.records.push({ key, status, record: parsed.value });
      if (status === "active") group.activeCount += 1;
      else group.tombstoneCount += 1;
    }

    const orderedGroups = [...groups.values()]
      .map((group) => {
        group.records.sort((left, right) =>
          left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
        );
        group.overLimit = group.records.length > WORKSPACE_PROJECT_RECORD_LIMIT;
        if (group.overLimit || journalState !== "absent") group.coherent = false;
        return group;
      })
      .sort((left, right) => {
        const leftIdentity = `${left.workspaceId}:${left.workspaceGeneration}`;
        const rightIdentity = `${right.workspaceId}:${right.workspaceGeneration}`;
        return leftIdentity < rightIdentity ? -1 : leftIdentity > rightIdentity ? 1 : 0;
      });

    return {
      ok: true,
      result: {
        authority: "none",
        requiresExplicitSelection: true,
        groups: orderedGroups,
        ignoredKeys: ignoredKeys.sort(),
        journalState,
        physicalProjectRecordCount,
        growthBlocked: physicalProjectRecordCount >= WORKSPACE_PROJECT_RECORD_LIMIT,
      },
    };
  } catch {
    return { ok: false, reason: "storage-error" };
  }
}

export type WorkspaceProjectIdGenerationResult =
  | { ok: true; projectId: string }
  | {
      ok: false;
      reason:
        | "storage-error"
        | "invalid-index"
        | "invalid-journal"
        | "digest-unavailable"
        | "uuid-unavailable-or-collided";
    };

export async function generateWorkspaceProjectId(
  storage: WorkspaceStorageAdapter,
  source?: SecureUuidSource | null,
): Promise<WorkspaceProjectIdGenerationResult> {
  try {
    const collisions = new Set<string>();
    for (const key of storage.keys()) {
      const identity = parseWorkspaceProjectRecordKey(key);
      if (identity) collisions.add(identity.projectId);
    }

    const indexRaw = storage.getItem(WORKSPACE_INDEX_KEY);
    if (indexRaw !== null) {
      const index = parseWorkspaceIndex(indexRaw);
      if (!index.ok) return { ok: false, reason: "invalid-index" };
      index.value.projects.forEach((entry) => collisions.add(entry.projectId));
    }

    const journalRaw = storage.getItem(WORKSPACE_OPERATION_KEY);
    if (journalRaw !== null) {
      const journal = parseWorkspaceJournal(journalRaw);
      if (!journal.ok) return { ok: false, reason: "invalid-journal" };
      const digests = await validateWorkspaceJournalDigests(journal.value);
      if (!digests.ok) {
        return {
          ok: false,
          reason:
            digests.reason === "digest-unavailable"
              ? "digest-unavailable"
              : "invalid-journal",
        };
      }
      journal.value.projectMutations.forEach((mutation) =>
        collisions.add(mutation.projectId),
      );
      const targetIndex = parseWorkspaceIndex(journal.value.targetIndex.serializedValue);
      if (!targetIndex.ok) return { ok: false, reason: "invalid-journal" };
      targetIndex.value.projects.forEach((entry) => collisions.add(entry.projectId));
      journal.value.cleanup.forEach((entry) => {
        const identity = parseWorkspaceProjectRecordKey(entry.key);
        if (identity) collisions.add(identity.projectId);
      });
    }

    const projectId = generateCollisionCheckedUuid(
      (candidate) => collisions.has(candidate),
      source,
    );
    return projectId
      ? { ok: true, projectId }
      : { ok: false, reason: "uuid-unavailable-or-collided" };
  } catch {
    return { ok: false, reason: "storage-error" };
  }
}
