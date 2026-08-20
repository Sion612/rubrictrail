import type { PersistedProjectState } from "@/lib/ui-types";

export const WORKSPACE_OPERATION_KINDS = [
  "migrate-single-project",
  "create-project",
  "delete-project",
  "restore-as-new",
  "replace-project",
  "legacy-cleanup",
  "recover-index",
  "delete-workspace",
  "rotate-workspace-generation",
] as const;

export const PROJECT_MUTATION_MODES = [
  "create",
  "replace",
  "delete",
  "rewrite-generation",
] as const;

export const WORKSPACE_OPERATION_PHASES = [
  "prepared",
  "records-writing",
  "records-written",
  "index-committed",
  "cleanup-pending",
] as const;

export type WorkspaceOperationKind = (typeof WORKSPACE_OPERATION_KINDS)[number];
export type ProjectMutationMode = (typeof PROJECT_MUTATION_MODES)[number];
export type WorkspaceOperationPhase = (typeof WORKSPACE_OPERATION_PHASES)[number];
export type WorkspaceDigest = string;

export interface WorkspaceLegacyFingerprints {
  record: WorkspaceDigest | null;
  v3: WorkspaceDigest | null;
  v2: WorkspaceDigest | null;
  v1: WorkspaceDigest | null;
}

export type WorkspaceLegacySourceName = "record" | "v3" | "v2" | "v1";

/**
 * Marks a user-confirmed legacy-drift resolution that is represented by the
 * ordinary workspace operation journal. Project bytes are deliberately not
 * retained here: recovery deterministically rebuilds them from the named,
 * exact-digest legacy source while it still exists.
 */
export interface WorkspaceJournalLegacyResolutionV1 {
  confirmationToken: WorkspaceDigest;
  candidateSource: WorkspaceLegacySourceName | null;
}

export interface WorkspaceIndexEntryV1 {
  projectId: string;
  kind: "active" | "tombstone";
}

export interface WorkspaceIndexV1 {
  formatVersion: 1;
  workspaceId: string;
  workspaceGeneration: number;
  revision: number;
  status: "active" | "cleared";
  projects: WorkspaceIndexEntryV1[];
  legacyFingerprints: WorkspaceLegacyFingerprints;
}

export interface WorkspaceProjectRecordV1 {
  formatVersion: 1;
  workspaceId: string;
  workspaceGeneration: number;
  projectId: string;
  revision: number;
  value:
    | { kind: "project"; state: PersistedProjectState }
    | { kind: "tombstone" };
}

export interface WorkspacePreferencesV1 {
  formatVersion: 1;
  workspaceId: string;
  workspaceGeneration: number;
  lastOpenedProjectId: string | null;
}

export interface WorkspaceReserveV1 {
  formatVersion: 1;
  padding: string;
}

export interface WorkspaceJournalProjectMutationV1 {
  mode: ProjectMutationMode;
  projectId: string;
  sourceRecord: {
    key: string;
    expectedDigest: WorkspaceDigest;
  } | null;
  targetRecord: {
    key: string;
    expectedBeforeDigest: WorkspaceDigest | null;
    targetDigest: WorkspaceDigest;
  };
  sourceCleanup: {
    key: string;
    expectedDigest: WorkspaceDigest;
  } | null;
}

export interface WorkspaceOperationJournalV1 {
  formatVersion: 1;
  operationId: string;
  kind: WorkspaceOperationKind;
  workspaceId: string;
  sourceGeneration: number | null;
  targetGeneration: number;
  phase: WorkspaceOperationPhase;
  baseIndex: {
    key: "rubrictrail.workspace.index.v1";
    expectedDigest: WorkspaceDigest | null;
  };
  targetIndex: {
    key: "rubrictrail.workspace.index.v1";
    serializedValue: string;
    targetDigest: WorkspaceDigest;
  };
  legacyExpectedDigests: WorkspaceLegacyFingerprints;
  legacyResolution?: WorkspaceJournalLegacyResolutionV1;
  projectMutations: WorkspaceJournalProjectMutationV1[];
  cleanup: Array<{
    key: string;
    expectedDigest: WorkspaceDigest;
  }>;
}

export type WorkspaceProtocolParseResult<T> =
  | { ok: true; value: T; serialized: string }
  | { ok: false; reason: "invalid" | "unsupported-version" | "too-large" };
