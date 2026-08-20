import { createDefaultProjectState } from "@/lib/local-state";
import { sha256StoredString } from "@/lib/workspace-storage/digest";
import { LEGACY_PROJECT_KEYS, WORKSPACE_INDEX_KEY, workspaceProjectRecordKey } from "@/lib/workspace-storage/keys";
import {
  serializeWorkspaceIndex,
  serializeWorkspaceProjectRecord,
} from "@/lib/workspace-storage/protocol";
import type {
  ProjectMutationMode,
  WorkspaceIndexV1,
  WorkspaceLegacyFingerprints,
  WorkspaceOperationJournalV1,
  WorkspaceOperationKind,
  WorkspaceProjectRecordV1,
} from "@/lib/workspace-storage/types";

export const WS = "11111111-1111-4111-8111-111111111111";
export const WS_OTHER = "22222222-2222-4222-8222-222222222222";
export const PROJECT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const PROJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const OPERATION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const DIGEST_A = "a".repeat(64);
export const DIGEST_B = "b".repeat(64);
export const DIGEST_C = "c".repeat(64);

export const NULL_LEGACY_FINGERPRINTS: WorkspaceLegacyFingerprints = {
  record: null,
  v3: null,
  v2: null,
  v1: null,
};

function activeSampleProjectState() {
  return {
    ...createDefaultProjectState(),
    projectKind: "sample" as const,
  };
}

/** A strictly valid v0.7.1 active record, retained only as deterministic test input. */
export const LEGACY_ACTIVE_RECORD_RAW = JSON.stringify({
  formatVersion: 1,
  revision: 1,
  value: { kind: "project", state: activeSampleProjectState() },
  legacyFingerprints: { v3: null, v2: null, v1: null },
});

export function activeIndex(
  overrides: Partial<WorkspaceIndexV1> = {},
): WorkspaceIndexV1 {
  return {
    formatVersion: 1,
    workspaceId: WS,
    workspaceGeneration: 1,
    revision: 1,
    status: "active",
    projects: [{ projectId: PROJECT_A, kind: "active" }],
    legacyFingerprints: NULL_LEGACY_FINGERPRINTS,
    ...overrides,
  };
}

export function activeProjectRecord(
  projectId = PROJECT_A,
  overrides: Partial<WorkspaceProjectRecordV1> = {},
): WorkspaceProjectRecordV1 {
  return {
    formatVersion: 1,
    workspaceId: WS,
    workspaceGeneration: 1,
    projectId,
    revision: 1,
    value: { kind: "project", state: activeSampleProjectState() },
    ...overrides,
  };
}

export async function canonicalIndexBytes(index: WorkspaceIndexV1): Promise<{
  value: WorkspaceIndexV1;
  serialized: string;
  digest: string;
}> {
  const serialized = serializeWorkspaceIndex(index);
  if (!serialized.ok) throw new Error("fixture workspace index is invalid");
  const digest = await sha256StoredString(serialized.serialized);
  if (!digest.ok) throw new Error("fixture workspace index digest is unavailable");
  return { value: serialized.value, serialized: serialized.serialized, digest: digest.digest };
}

export async function canonicalProjectRecordBytes(record: WorkspaceProjectRecordV1): Promise<{
  value: WorkspaceProjectRecordV1;
  serialized: string;
  digest: string;
}> {
  const serialized = serializeWorkspaceProjectRecord(record);
  if (!serialized.ok) throw new Error("fixture project record is invalid");
  const digest = await sha256StoredString(serialized.serialized);
  if (!digest.ok) throw new Error("fixture project record digest is unavailable");
  return { value: serialized.value, serialized: serialized.serialized, digest: digest.digest };
}

function modeForKind(kind: WorkspaceOperationKind): ProjectMutationMode | null {
  if (["migrate-single-project", "create-project", "restore-as-new"].includes(kind)) {
    return "create";
  }
  if (kind === "replace-project") return "replace";
  if (kind === "delete-project") return "delete";
  if (["recover-index", "rotate-workspace-generation"].includes(kind)) {
    return "rewrite-generation";
  }
  return null;
}

function requiresLegacyCleanup(kind: WorkspaceOperationKind): boolean {
  return kind === "legacy-cleanup" || kind === "delete-workspace";
}

function requiresLegacyFingerprint(kind: WorkspaceOperationKind): boolean {
  return kind === "migrate-single-project" || requiresLegacyCleanup(kind);
}

/**
 * A schema-valid journal whose index and project-record digests are always
 * computed from canonical stored bytes. Recovery tests may replace its baseline
 * values deliberately, but must not use opaque index or project-record strings.
 */
export async function journalFor(
  kind: WorkspaceOperationKind,
  phase: WorkspaceOperationJournalV1["phase"] = "prepared",
): Promise<WorkspaceOperationJournalV1> {
  const mode = modeForKind(kind);
  const targetGeneration =
    kind === "recover-index" ||
    kind === "rotate-workspace-generation" ||
    kind === "delete-workspace"
      ? 2
      : 1;
  const legacyDigestResult = await sha256StoredString(LEGACY_ACTIVE_RECORD_RAW);
  if (!legacyDigestResult.ok) throw new Error("fixture legacy digest is unavailable");
  const legacyFingerprints = requiresLegacyFingerprint(kind)
    ? { ...NULL_LEGACY_FINGERPRINTS, record: legacyDigestResult.digest }
    : { ...NULL_LEGACY_FINGERPRINTS };

  const base = kind === "migrate-single-project" || kind === "recover-index"
    ? null
    : await canonicalIndexBytes(activeIndex({ legacyFingerprints }));
  const targetIndex = await canonicalIndexBytes(
    kind === "migrate-single-project"
      ? activeIndex({ revision: 1, legacyFingerprints })
      : kind === "create-project" || kind === "restore-as-new"
        ? activeIndex({
            revision: 2,
            projects: [
              { projectId: PROJECT_A, kind: "active" },
              { projectId: PROJECT_B, kind: "active" },
            ],
          })
        : kind === "delete-project"
          ? activeIndex({ revision: 2, projects: [{ projectId: PROJECT_A, kind: "tombstone" }] })
          : kind === "legacy-cleanup"
            ? activeIndex({ revision: 2, legacyFingerprints: NULL_LEGACY_FINGERPRINTS })
            : kind === "delete-workspace"
              ? activeIndex({
                  workspaceGeneration: 2,
                  revision: 2,
                  status: "cleared",
                  projects: [],
                  legacyFingerprints: NULL_LEGACY_FINGERPRINTS,
                })
              : kind === "replace-project"
                ? activeIndex()
                : activeIndex({ workspaceGeneration: 2, revision: 2 }),
  );

  const targetProjectId = mode === "create" && kind !== "migrate-single-project"
    ? PROJECT_B
    : PROJECT_A;
  const targetProject = await canonicalProjectRecordBytes(
    activeProjectRecord(targetProjectId, {
      workspaceGeneration: targetGeneration,
      revision:
        kind === "replace-project" ||
        kind === "delete-project" ||
        mode === "rewrite-generation"
          ? 2
          : 1,
      value: kind === "delete-project"
        ? { kind: "tombstone" }
        : { kind: "project", state: activeSampleProjectState() },
    }),
  );
  const beforeProject = await canonicalProjectRecordBytes(activeProjectRecord(PROJECT_A));
  const sourceProject = await canonicalProjectRecordBytes(activeProjectRecord(PROJECT_A));
  const targetKey = workspaceProjectRecordKey(WS, targetGeneration, targetProjectId);
  const sourceKey = workspaceProjectRecordKey(WS, 1, PROJECT_A);
  const projectMutations = mode === null
    ? []
    : [{
        mode,
        projectId: targetProjectId,
        sourceRecord: mode === "rewrite-generation"
          ? { key: sourceKey, expectedDigest: sourceProject.digest }
          : null,
        targetRecord: {
          key: targetKey,
          expectedBeforeDigest: mode === "create" || mode === "rewrite-generation"
            ? null
            : beforeProject.digest,
          targetDigest: targetProject.digest,
        },
        sourceCleanup: mode === "rewrite-generation"
          ? { key: sourceKey, expectedDigest: sourceProject.digest }
          : null,
      }];
  const cleanup = kind === "delete-workspace"
    ? [
        { key: sourceKey, expectedDigest: beforeProject.digest },
        { key: LEGACY_PROJECT_KEYS.record, expectedDigest: legacyDigestResult.digest },
      ]
    : requiresLegacyCleanup(kind)
      ? [{ key: LEGACY_PROJECT_KEYS.record, expectedDigest: legacyDigestResult.digest }]
      : [];

  return {
    formatVersion: 1,
    operationId: OPERATION,
    kind,
    workspaceId: WS,
    sourceGeneration: kind === "migrate-single-project" ? null : 1,
    targetGeneration,
    phase,
    baseIndex: { key: WORKSPACE_INDEX_KEY, expectedDigest: base?.digest ?? null },
    targetIndex: {
      key: WORKSPACE_INDEX_KEY,
      serializedValue: targetIndex.serialized,
      targetDigest: targetIndex.digest,
    },
    legacyExpectedDigests: legacyFingerprints,
    projectMutations,
    cleanup,
  };
}
