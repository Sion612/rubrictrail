import {
  parseLegacyProjectStateValue,
  parsePersistedProjectStateValue,
  parsePreviousProjectStateValue,
  parseProjectStorageRecordValue,
} from "@/lib/local-state";
import type { PersistedProjectState } from "@/lib/ui-types";
import {
  readWorkspaceAuthority,
  workspaceProjectBaseline,
  type WorkspaceAuthoritySnapshot,
  type WorkspaceCoordinatorMutationFailureReason,
  type WorkspaceExclusiveLockRunner,
  type WorkspaceProjectSnapshot,
} from "@/lib/workspace-storage/coordinator";
import {
  resumeWorkspaceLifecycleOperation,
  type WorkspaceLifecycleFailureReason,
  type WorkspaceLifecycleResult,
} from "@/lib/workspace-storage/lifecycle";
import {
  digestOptionalStoredString,
  sha256StoredString,
} from "@/lib/workspace-storage/digest";
import {
  LEGACY_PROJECT_KEYS,
  generateCollisionCheckedUuid,
  generateSecureWorkspaceUuid,
  parseWorkspaceProjectRecordKey,
  WORKSPACE_INDEX_KEY,
  WORKSPACE_LOCK_NAME,
  WORKSPACE_OPERATION_KEY,
  WORKSPACE_PREFERENCES_KEY,
  WORKSPACE_RESERVE_KEY,
  workspaceProjectRecordKey,
  type SecureUuidSource,
} from "@/lib/workspace-storage/keys";
import {
  parseWorkspaceIndex,
  parseWorkspaceJournal,
  parseWorkspacePreferences,
  parseWorkspaceProjectRecord,
  serializeWorkspaceIndex,
  serializeWorkspaceJournal,
  serializeWorkspaceProjectRecord,
  validateWorkspaceJournalDigests,
  WORKSPACE_RECORD_GROWTH_BLOCK,
  workspaceProjectRecordMatchesKey,
} from "@/lib/workspace-storage/protocol";
import { scanWorkspaceNamespace } from "@/lib/workspace-storage/namespace-scan";
import {
  prepareWorkspaceJournal,
  type WorkspaceJournalPreparationResult,
} from "@/lib/workspace-storage/recovery";
import {
  CANONICAL_WORKSPACE_RESERVE,
  classifyWorkspaceReserve,
} from "@/lib/workspace-storage/reserve";
import type {
  WorkspacePendingSaveFreezeController,
  WorkspacePendingSaveFreezeLease,
  WorkspaceSelectedProjectIntentSnapshot,
} from "@/lib/workspace-storage/production-lifecycle-orchestrator";
import {
  readExact,
  recreateWorkspaceReserve,
  removeExact,
  removeWorkspaceCleanupSource,
  removeWorkspaceJournal,
  removeWorkspaceReserve,
  writeWorkspaceIndexTarget,
  writeWorkspaceJournalPhase,
  type WorkspaceStorageAdapter,
} from "@/lib/workspace-storage/storage-adapter";
import type {
  WorkspaceIndexV1,
  WorkspaceLegacyFingerprints,
  WorkspaceOperationJournalV1,
  WorkspaceOperationPhase,
} from "@/lib/workspace-storage/types";
import { resumeWorkspaceCreationOperation } from "@/lib/workspace-storage/runtime-controller";

const LEGACY_NAMES = ["record", "v3", "v2", "v1"] as const;

export type WorkspaceLegacyDriftCandidateSource = (typeof LEGACY_NAMES)[number];

export interface WorkspaceLegacyDriftCandidate {
  candidateId: string;
  source: WorkspaceLegacyDriftCandidateSource;
  /** Parsed local state for display only. Execution reparses exact current bytes. */
  state: PersistedProjectState;
}

interface WorkspaceLegacyRawValue {
  raw: string | null;
  digest: string | null;
}

interface WorkspaceLegacyDriftExactInspection {
  snapshot: WorkspaceAuthoritySnapshot;
  ownedProjects: ReadonlyArray<{ key: string; raw: string; digest: string }>;
  legacy: Readonly<Record<WorkspaceLegacyDriftCandidateSource, WorkspaceLegacyRawValue>>;
  candidates: readonly WorkspaceLegacyDriftCandidate[];
  confirmationToken: string;
}

export type WorkspaceLegacyDriftInspectionResult =
  | {
      ok: true;
      confirmationToken: string;
      workspaceId: string;
      workspaceGeneration: number;
      indexRevision: number;
      workspaceStatus: WorkspaceIndexV1["status"];
      candidates: readonly WorkspaceLegacyDriftCandidate[];
      changedSources: readonly WorkspaceLegacyDriftCandidateSource[];
    }
  | {
      ok: false;
      reason:
        | "no-legacy-drift"
        | "recovery-required"
        | "invalid-authority"
        | "concurrent-change"
        | "digest-unavailable"
        | "storage-error";
    };

function callbackIsTrue(callback: () => boolean): boolean {
  try {
    return callback();
  } catch {
    return false;
  }
}

function leaseIsDrained(lease: WorkspacePendingSaveFreezeLease): boolean {
  try {
    return lease.isHeld() && lease.pendingSavesDrained();
  } catch {
    return false;
  }
}

function parseV3Project(raw: string): PersistedProjectState | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (
      typeof value !== "object" ||
      value === null ||
      !("version" in value) ||
      value.version !== 3
    ) {
      return null;
    }
    const parsed = parsePersistedProjectStateValue(value);
    return parsed.ok && parsed.state.projectKind !== "none"
      ? parsed.state
      : null;
  } catch {
    return null;
  }
}

function parseLegacyCandidate(
  source: WorkspaceLegacyDriftCandidateSource,
  raw: string,
): PersistedProjectState | null {
  if (source === "record") {
    const parsed = parseProjectStorageRecordValue(raw);
    return parsed?.status === "active" &&
      parsed.state !== null &&
      parsed.state.projectKind !== "none"
      ? parsed.state
      : null;
  }
  if (source === "v3") return parseV3Project(raw);
  if (source === "v2") {
    const parsed = parsePreviousProjectStateValue(raw);
    return parsed.ok && parsed.state.projectKind !== "none"
      ? parsed.state
      : null;
  }
  const state = parseLegacyProjectStateValue(raw);
  return state?.projectKind === "none" ? null : state;
}

function exactRawStillPresent(
  storage: WorkspaceStorageAdapter,
  key: string,
  expected: string | null,
): boolean {
  try {
    return storage.getItem(key) === expected;
  } catch {
    return false;
  }
}

function discoveredOwnedProjectKeys(storage: WorkspaceStorageAdapter): string[] | null {
  try {
    return storage
      .keys()
      .filter((key) => parseWorkspaceProjectRecordKey(key) !== null)
      .sort();
  } catch {
    return null;
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function inspectionStillExact(
  storage: WorkspaceStorageAdapter,
  inspection: WorkspaceLegacyDriftExactInspection,
): boolean {
  if (!exactRawStillPresent(storage, WORKSPACE_OPERATION_KEY, null)) return false;
  if (
    !exactRawStillPresent(
      storage,
      WORKSPACE_INDEX_KEY,
      inspection.snapshot.indexRaw,
    )
  ) {
    return false;
  }
  const keys = discoveredOwnedProjectKeys(storage);
  if (
    keys === null ||
    !sameStrings(
      keys,
      inspection.ownedProjects.map((project) => project.key),
    )
  ) {
    return false;
  }
  for (const project of inspection.ownedProjects) {
    if (!exactRawStillPresent(storage, project.key, project.raw)) return false;
  }
  return LEGACY_NAMES.every((name) =>
    exactRawStillPresent(
      storage,
      LEGACY_PROJECT_KEYS[name],
      inspection.legacy[name].raw,
    ),
  );
}

async function inspectWorkspaceLegacyDriftExact(
  storage: WorkspaceStorageAdapter,
): Promise<
  | { ok: true; inspection: WorkspaceLegacyDriftExactInspection }
  | Exclude<WorkspaceLegacyDriftInspectionResult, { ok: true }>
> {
  try {
    const journal = readExact(storage, WORKSPACE_OPERATION_KEY);
    if (!journal.ok) return { ok: false, reason: "storage-error" };
    if (journal.value !== null) {
      return { ok: false, reason: "recovery-required" };
    }

    const indexRead = readExact(storage, WORKSPACE_INDEX_KEY);
    if (!indexRead.ok) return { ok: false, reason: "storage-error" };
    if (indexRead.value === null) {
      return { ok: false, reason: "invalid-authority" };
    }
    const index = parseWorkspaceIndex(indexRead.value);
    if (!index.ok) return { ok: false, reason: "invalid-authority" };
    const indexDigest = await sha256StoredString(indexRead.value);
    if (!indexDigest.ok) return { ok: false, reason: "digest-unavailable" };

    const projects: WorkspaceProjectSnapshot[] = [];
    for (const entry of index.value.projects) {
      const key = workspaceProjectRecordKey(
        index.value.workspaceId,
        index.value.workspaceGeneration,
        entry.projectId,
      );
      const read = readExact(storage, key);
      if (!read.ok) return { ok: false, reason: "storage-error" };
      if (read.value === null) {
        return { ok: false, reason: "invalid-authority" };
      }
      const parsed = parseWorkspaceProjectRecord(read.value);
      if (
        !parsed.ok ||
        !workspaceProjectRecordMatchesKey(key, parsed.value) ||
        (entry.kind === "active") !== (parsed.value.value.kind === "project") ||
        (entry.kind === "active" &&
          parsed.value.value.kind === "project" &&
          parsed.value.value.state.projectKind === "none")
      ) {
        return { ok: false, reason: "invalid-authority" };
      }
      const digest = await sha256StoredString(read.value);
      if (!digest.ok) return { ok: false, reason: "digest-unavailable" };
      projects.push({ key, raw: read.value, digest: digest.digest, record: parsed.value });
    }

    const ownedKeys = discoveredOwnedProjectKeys(storage);
    if (ownedKeys === null) return { ok: false, reason: "storage-error" };
    const ownedProjects: Array<{ key: string; raw: string; digest: string }> = [];
    for (const key of ownedKeys) {
      const read = readExact(storage, key);
      if (!read.ok || read.value === null) {
        return { ok: false, reason: read.ok ? "concurrent-change" : "storage-error" };
      }
      const digest = await sha256StoredString(read.value);
      if (!digest.ok) return { ok: false, reason: "digest-unavailable" };
      ownedProjects.push({ key, raw: read.value, digest: digest.digest });
    }

    const legacy = {} as Record<
      WorkspaceLegacyDriftCandidateSource,
      WorkspaceLegacyRawValue
    >;
    for (const name of LEGACY_NAMES) {
      const read = readExact(storage, LEGACY_PROJECT_KEYS[name]);
      if (!read.ok) return { ok: false, reason: "storage-error" };
      const digest = await digestOptionalStoredString(read.value);
      if (!digest.ok) return { ok: false, reason: "digest-unavailable" };
      legacy[name] = { raw: read.value, digest: digest.digest };
    }

    const changedSources = LEGACY_NAMES.filter(
      (name) => legacy[name].digest !== index.value.legacyFingerprints[name],
    );
    if (changedSources.length === 0) {
      return { ok: false, reason: "no-legacy-drift" };
    }

    const candidates = changedSources.flatMap((source) => {
      const current = legacy[source];
      if (current.raw === null || current.digest === null) return [];
      const state = parseLegacyCandidate(source, current.raw);
      return state
        ? [{ candidateId: `${source}:${current.digest}`, source, state }]
        : [];
    });
    const tokenInput = JSON.stringify({
      formatVersion: 1,
      indexDigest: indexDigest.digest,
      ownedProjectDigests: ownedProjects.map((project) => ({
        key: project.key,
        digest: project.digest,
      })),
      legacyDigests: {
        record: legacy.record.digest,
        v3: legacy.v3.digest,
        v2: legacy.v2.digest,
        v1: legacy.v1.digest,
      },
    });
    const token = await sha256StoredString(tokenInput);
    if (!token.ok) return { ok: false, reason: "digest-unavailable" };

    const snapshot: WorkspaceAuthoritySnapshot = {
      index: index.value,
      indexRaw: indexRead.value,
      indexDigest: indexDigest.digest,
      projects,
    };
    const inspection: WorkspaceLegacyDriftExactInspection = {
      snapshot,
      ownedProjects,
      legacy,
      candidates,
      confirmationToken: token.digest,
    };
    if (!inspectionStillExact(storage, inspection)) {
      return { ok: false, reason: "concurrent-change" };
    }
    return { ok: true, inspection };
  } catch {
    return { ok: false, reason: "storage-error" };
  }
}

export async function inspectWorkspaceLegacyDrift(
  storage: WorkspaceStorageAdapter,
): Promise<WorkspaceLegacyDriftInspectionResult> {
  const exact = await inspectWorkspaceLegacyDriftExact(storage);
  if (!exact.ok) return exact;
  const { inspection } = exact;
  return {
    ok: true,
    confirmationToken: inspection.confirmationToken,
    workspaceId: inspection.snapshot.index.workspaceId,
    workspaceGeneration: inspection.snapshot.index.workspaceGeneration,
    indexRevision: inspection.snapshot.index.revision,
    workspaceStatus: inspection.snapshot.index.status,
    candidates: inspection.candidates,
    changedSources: LEGACY_NAMES.filter(
      (name) =>
        inspection.legacy[name].digest !==
        inspection.snapshot.index.legacyFingerprints[name],
    ),
  };
}

export type WorkspaceLegacyDriftResolutionAction =
  | { kind: "accept-current-baseline" }
  | { kind: "import-as-new"; candidateId: string }
  | {
      kind: "replace-selected";
      candidateId: string;
      selectedIntent: WorkspaceSelectedProjectIntentSnapshot;
      selectedIntentStillCurrent: () => boolean;
    }
  | { kind: "privacy-cleanup" };

export interface WorkspaceLegacyDriftResolutionRequest {
  confirmationToken: string;
  action: WorkspaceLegacyDriftResolutionAction;
  confirmationStillCurrent: () => boolean;
  uuidSource?: SecureUuidSource | null;
}

export interface WorkspaceLegacyDriftResolutionDependencies {
  storage: WorkspaceStorageAdapter;
  locks: WorkspaceExclusiveLockRunner | null;
  pendingSaves: WorkspacePendingSaveFreezeController;
}

export type WorkspaceLegacyDriftResolutionFailureReason =
  | WorkspaceCoordinatorMutationFailureReason
  | WorkspaceLifecycleFailureReason
  | "selection-stale"
  | "candidate-unavailable"
  | "no-legacy-drift"
  | "recovery-required"
  | "invalid-authority"
  | "concurrent-change"
  | "operation-failed";

function resolutionIntentIsCurrent(
  request: WorkspaceLegacyDriftResolutionRequest,
): boolean {
  return (
    callbackIsTrue(request.confirmationStillCurrent) &&
    (request.action.kind !== "replace-selected" ||
      callbackIsTrue(request.action.selectedIntentStillCurrent))
  );
}

type WorkspaceLegacyDriftResolutionCoreResult =
  | {
      ok: true;
      action: WorkspaceLegacyDriftResolutionAction["kind"];
      snapshot: WorkspaceAuthoritySnapshot;
      baselineAccepted: true;
      storageProtection: "healthy" | "degraded";
      projectId?: string;
    }
  | {
      ok: false;
      reason: WorkspaceLegacyDriftResolutionFailureReason;
      /**
       * True means either the standalone fingerprint CAS committed or the
       * compound resolution journal became durable before a later step failed.
       */
      baselineAccepted: boolean;
      snapshot?: WorkspaceAuthoritySnapshot;
    };

export type WorkspaceLegacyDriftResolutionResult =
  | (Extract<WorkspaceLegacyDriftResolutionCoreResult, { ok: true }> & {
      pendingState: "synchronized" | "rebuild-required";
    })
  | (Extract<WorkspaceLegacyDriftResolutionCoreResult, { ok: false }> & {
      pendingFreezeRetained: boolean;
    });

function currentLegacyFingerprints(
  inspection: WorkspaceLegacyDriftExactInspection,
): WorkspaceLegacyFingerprints {
  return {
    record: inspection.legacy.record.digest,
    v3: inspection.legacy.v3.digest,
    v2: inspection.legacy.v2.digest,
    v1: inspection.legacy.v1.digest,
  };
}

function currentStorageProtection(
  storage: WorkspaceStorageAdapter,
): "healthy" | "degraded" {
  const reserve = readExact(storage, WORKSPACE_RESERVE_KEY);
  return reserve.ok && classifyWorkspaceReserve(reserve.value) === "valid"
    ? "healthy"
    : "degraded";
}

function mapInspectionFailure(
  result: Exclude<WorkspaceLegacyDriftInspectionResult, { ok: true }>,
): Extract<WorkspaceLegacyDriftResolutionCoreResult, { ok: false }> {
  return {
    ok: false,
    reason: result.reason,
    baselineAccepted: false,
  };
}

async function acceptCurrentLegacyBaseline(
  dependencies: WorkspaceLegacyDriftResolutionDependencies,
  request: WorkspaceLegacyDriftResolutionRequest,
  lease: WorkspacePendingSaveFreezeLease,
): Promise<WorkspaceLegacyDriftResolutionCoreResult> {
  if (!dependencies.locks) {
    return { ok: false, reason: "lock-unavailable", baselineAccepted: false };
  }
  try {
    return await dependencies.locks.runExclusive(WORKSPACE_LOCK_NAME, async () => {
      const inspected = await inspectWorkspaceLegacyDriftExact(dependencies.storage);
      if (!inspected.ok) return mapInspectionFailure(inspected);
      const exact = inspected.inspection;
      if (exact.confirmationToken !== request.confirmationToken) {
        return { ok: false, reason: "intent-stale", baselineAccepted: false };
      }
      if (
        !leaseIsDrained(lease) ||
        !resolutionIntentIsCurrent(request)
      ) {
        return {
          ok: false,
          reason: leaseIsDrained(lease) ? "intent-stale" : "pending-save",
          baselineAccepted: false,
        };
      }
      if (exact.snapshot.index.revision >= Number.MAX_SAFE_INTEGER) {
        return { ok: false, reason: "invalid-authority", baselineAccepted: false };
      }
      const serialized = serializeWorkspaceIndex({
        ...exact.snapshot.index,
        revision: exact.snapshot.index.revision + 1,
        legacyFingerprints: currentLegacyFingerprints(exact),
      });
      if (!serialized.ok) {
        return { ok: false, reason: "invalid-authority", baselineAccepted: false };
      }
      const targetDigest = await sha256StoredString(serialized.serialized);
      if (!targetDigest.ok) {
        return { ok: false, reason: "digest-unavailable", baselineAccepted: false };
      }
      const written = await writeWorkspaceIndexTarget(
        dependencies.storage,
        serialized.serialized,
        {
          expectedBeforeDigest: exact.snapshot.indexDigest,
          targetDigest: targetDigest.digest,
          commitStillAuthorized: () =>
            leaseIsDrained(lease) &&
            resolutionIntentIsCurrent(request) &&
            inspectionStillExact(dependencies.storage, exact),
        },
      );
      if (!written.ok) {
        return {
          ok: false,
          reason:
            written.reason === "commit-cancelled"
              ? "intent-stale"
              : written.reason === "digest-unavailable"
                ? "digest-unavailable"
                : written.reason === "baseline-mismatch"
                  ? "workspace-conflict"
                  : written.reason === "storage-error"
                    ? "storage-error"
                    : "commit-incomplete",
          baselineAccepted: false,
        };
      }
      const snapshot: WorkspaceAuthoritySnapshot = {
        index: serialized.value,
        indexRaw: serialized.serialized,
        indexDigest: targetDigest.digest,
        projects: exact.snapshot.projects,
      };
      return {
        ok: true,
        action: request.action.kind,
        snapshot,
        baselineAccepted: true,
        storageProtection: currentStorageProtection(dependencies.storage),
      };
    });
  } catch {
    return { ok: false, reason: "lock-failed", baselineAccepted: false };
  }
}

function selectedProjectMatchesInspection(
  selected: WorkspaceSelectedProjectIntentSnapshot,
  inspection: WorkspaceLegacyDriftExactInspection,
): boolean {
  const captured = selected.baseline;
  const current = workspaceProjectBaseline(
    inspection.snapshot,
    captured.projectId,
  );
  return (
    current !== null &&
    selected.workspace.baseline.raw === inspection.snapshot.indexRaw &&
    selected.workspace.baseline.digest === inspection.snapshot.indexDigest &&
    current.projectRevision === captured.projectRevision &&
    current.raw === captured.raw &&
    current.digest === captured.digest
  );
}

function failedAfterDurableResolution(
  reason: WorkspaceLegacyDriftResolutionFailureReason,
  snapshot: WorkspaceAuthoritySnapshot,
): WorkspaceLegacyDriftResolutionCoreResult {
  return {
    ok: false,
    reason,
    baselineAccepted: true,
    snapshot,
  };
}

function preparationFailureReason(
  prepared: Exclude<WorkspaceJournalPreparationResult, { ok: true }>,
): WorkspaceLegacyDriftResolutionFailureReason {
  if (prepared.reason === "invalid-reserve") return "reserve-degraded";
  if (prepared.reason === "baseline-conflict") return "legacy-conflict";
  if (prepared.reason === "third-value-journal") return "recovery-required";
  if (
    prepared.reason === "invalid-journal" ||
    prepared.reason === "invalid-target-record" ||
    prepared.reason === "reserve-policy"
  ) {
    return "invalid-request";
  }
  return "storage-error";
}

interface PreparedActiveLegacyResolution {
  journal: WorkspaceOperationJournalV1;
  targetRecords: Readonly<Record<string, string>>;
  releaseReserve: boolean;
  projectId?: string;
}

async function buildActiveLegacyResolutionJournal(
  storage: WorkspaceStorageAdapter,
  inspection: WorkspaceLegacyDriftExactInspection,
  request: WorkspaceLegacyDriftResolutionRequest,
  candidate: WorkspaceLegacyDriftCandidate | null,
): Promise<
  | { ok: true; prepared: PreparedActiveLegacyResolution }
  | { ok: false; reason: WorkspaceLegacyDriftResolutionFailureReason }
> {
  if (
    inspection.snapshot.index.status !== "active" ||
    inspection.snapshot.index.revision >= Number.MAX_SAFE_INTEGER
  ) {
    return { ok: false, reason: "workspace-not-active" };
  }
  const currentFingerprints = currentLegacyFingerprints(inspection);

  if (request.action.kind === "import-as-new") {
    if (!candidate) return { ok: false, reason: "candidate-unavailable" };
    const namespace = scanWorkspaceNamespace(storage);
    if (!namespace.ok) return { ok: false, reason: "storage-error" };
    if (namespace.result.journalState !== "absent") {
      return { ok: false, reason: "recovery-required" };
    }
    if (
      namespace.result.growthBlocked ||
      inspection.snapshot.index.projects.length >= WORKSPACE_RECORD_GROWTH_BLOCK
    ) {
      return { ok: false, reason: "growth-blocked-physical" };
    }
    const extantIds = new Set(
      inspection.ownedProjects.flatMap((entry) => {
        const identity = parseWorkspaceProjectRecordKey(entry.key);
        return identity ? [identity.projectId] : [];
      }),
    );
    const projectId = generateCollisionCheckedUuid(
      (value) => extantIds.has(value),
      request.uuidSource,
    );
    const operationId = generateSecureWorkspaceUuid(request.uuidSource);
    if (projectId === null || operationId === null) {
      return { ok: false, reason: "id-unavailable-or-collided" };
    }
    const projectKey = workspaceProjectRecordKey(
      inspection.snapshot.index.workspaceId,
      inspection.snapshot.index.workspaceGeneration,
      projectId,
    );
    const project = serializeWorkspaceProjectRecord({
      formatVersion: 1,
      workspaceId: inspection.snapshot.index.workspaceId,
      workspaceGeneration: inspection.snapshot.index.workspaceGeneration,
      projectId,
      revision: 1,
      value: { kind: "project", state: candidate.state },
    });
    if (!project.ok) return { ok: false, reason: "invalid-request" };
    const projectDigest = await sha256StoredString(project.serialized);
    if (!projectDigest.ok) return { ok: false, reason: "digest-unavailable" };
    const targetIndex = serializeWorkspaceIndex({
      ...inspection.snapshot.index,
      revision: inspection.snapshot.index.revision + 1,
      legacyFingerprints: currentFingerprints,
      projects: [
        ...inspection.snapshot.index.projects,
        { projectId, kind: "active" as const },
      ],
    });
    if (!targetIndex.ok) return { ok: false, reason: "invalid-request" };
    const targetDigest = await sha256StoredString(targetIndex.serialized);
    if (!targetDigest.ok) return { ok: false, reason: "digest-unavailable" };
    return {
      ok: true,
      prepared: {
        journal: {
          formatVersion: 1,
          operationId,
          kind: "restore-as-new",
          workspaceId: inspection.snapshot.index.workspaceId,
          sourceGeneration: inspection.snapshot.index.workspaceGeneration,
          targetGeneration: inspection.snapshot.index.workspaceGeneration,
          phase: "prepared",
          baseIndex: {
            key: WORKSPACE_INDEX_KEY,
            expectedDigest: inspection.snapshot.indexDigest,
          },
          targetIndex: {
            key: WORKSPACE_INDEX_KEY,
            serializedValue: targetIndex.serialized,
            targetDigest: targetDigest.digest,
          },
          legacyExpectedDigests: currentFingerprints,
          legacyResolution: {
            confirmationToken: inspection.confirmationToken,
            candidateSource: candidate.source,
          },
          projectMutations: [
            {
              mode: "create",
              projectId,
              sourceRecord: null,
              targetRecord: {
                key: projectKey,
                expectedBeforeDigest: null,
                targetDigest: projectDigest.digest,
              },
              sourceCleanup: null,
            },
          ],
          cleanup: [],
        },
        targetRecords: { [projectKey]: project.serialized },
        releaseReserve: false,
        projectId,
      },
    };
  }

  if (request.action.kind === "replace-selected") {
    if (!candidate) return { ok: false, reason: "candidate-unavailable" };
    const selectedIntent = request.action.selectedIntent;
    const selected = inspection.snapshot.projects.find(
      (entry) =>
        entry.record.projectId === selectedIntent.baseline.projectId,
    );
    if (
      !selected ||
      selected.record.value.kind !== "project" ||
      selected.record.revision >= Number.MAX_SAFE_INTEGER
    ) {
      return { ok: false, reason: "project-conflict" };
    }
    const operationId = generateSecureWorkspaceUuid(request.uuidSource);
    if (operationId === null) {
      return { ok: false, reason: "id-unavailable-or-collided" };
    }
    const project = serializeWorkspaceProjectRecord({
      ...selected.record,
      revision: selected.record.revision + 1,
      value: { kind: "project", state: candidate.state },
    });
    if (!project.ok) return { ok: false, reason: "invalid-request" };
    const projectDigest = await sha256StoredString(project.serialized);
    if (!projectDigest.ok) return { ok: false, reason: "digest-unavailable" };
    const targetIndex = serializeWorkspaceIndex({
      ...inspection.snapshot.index,
      revision: inspection.snapshot.index.revision + 1,
      legacyFingerprints: currentFingerprints,
    });
    if (!targetIndex.ok) return { ok: false, reason: "invalid-request" };
    const targetDigest = await sha256StoredString(targetIndex.serialized);
    if (!targetDigest.ok) return { ok: false, reason: "digest-unavailable" };
    return {
      ok: true,
      prepared: {
        journal: {
          formatVersion: 1,
          operationId,
          kind: "replace-project",
          workspaceId: inspection.snapshot.index.workspaceId,
          sourceGeneration: inspection.snapshot.index.workspaceGeneration,
          targetGeneration: inspection.snapshot.index.workspaceGeneration,
          phase: "prepared",
          baseIndex: {
            key: WORKSPACE_INDEX_KEY,
            expectedDigest: inspection.snapshot.indexDigest,
          },
          targetIndex: {
            key: WORKSPACE_INDEX_KEY,
            serializedValue: targetIndex.serialized,
            targetDigest: targetDigest.digest,
          },
          legacyExpectedDigests: currentFingerprints,
          legacyResolution: {
            confirmationToken: inspection.confirmationToken,
            candidateSource: candidate.source,
          },
          projectMutations: [
            {
              mode: "replace",
              projectId: selected.record.projectId,
              sourceRecord: null,
              targetRecord: {
                key: selected.key,
                expectedBeforeDigest: selected.digest,
                targetDigest: projectDigest.digest,
              },
              sourceCleanup: null,
            },
          ],
          cleanup: [],
        },
        targetRecords: { [selected.key]: project.serialized },
        releaseReserve: project.serialized.length <= selected.raw.length,
      },
    };
  }

  if (request.action.kind !== "privacy-cleanup") {
    return { ok: false, reason: "invalid-request" };
  }
  const operationId = generateSecureWorkspaceUuid(request.uuidSource);
  if (operationId === null) {
    return { ok: false, reason: "id-unavailable-or-collided" };
  }
  const targetIndex = serializeWorkspaceIndex({
    ...inspection.snapshot.index,
    revision: inspection.snapshot.index.revision + 1,
    legacyFingerprints: { record: null, v3: null, v2: null, v1: null },
  });
  if (!targetIndex.ok) return { ok: false, reason: "invalid-request" };
  const targetDigest = await sha256StoredString(targetIndex.serialized);
  if (!targetDigest.ok) return { ok: false, reason: "digest-unavailable" };
  return {
    ok: true,
    prepared: {
      journal: {
        formatVersion: 1,
        operationId,
        kind: "legacy-cleanup",
        workspaceId: inspection.snapshot.index.workspaceId,
        sourceGeneration: inspection.snapshot.index.workspaceGeneration,
        targetGeneration: inspection.snapshot.index.workspaceGeneration,
        phase: "prepared",
        baseIndex: {
          key: WORKSPACE_INDEX_KEY,
          expectedDigest: inspection.snapshot.indexDigest,
        },
        targetIndex: {
          key: WORKSPACE_INDEX_KEY,
          serializedValue: targetIndex.serialized,
          targetDigest: targetDigest.digest,
        },
        legacyExpectedDigests: currentFingerprints,
        legacyResolution: {
          confirmationToken: inspection.confirmationToken,
          candidateSource: null,
        },
        projectMutations: [],
        cleanup: LEGACY_NAMES.flatMap((name) => {
          const digest = currentFingerprints[name];
          return digest === null
            ? []
            : [{ key: LEGACY_PROJECT_KEYS[name], expectedDigest: digest }];
        }),
      },
      targetRecords: {},
      releaseReserve: true,
    },
  };
}

const ALREADY_HELD_WORKSPACE_LOCK: WorkspaceExclusiveLockRunner = {
  runExclusive: async (name, operation) => {
    if (name !== WORKSPACE_LOCK_NAME) throw new Error("Unexpected nested lock");
    return operation();
  },
};

async function executeActiveLegacyResolution(
  dependencies: WorkspaceLegacyDriftResolutionDependencies,
  request: WorkspaceLegacyDriftResolutionRequest,
  lease: WorkspacePendingSaveFreezeLease,
): Promise<WorkspaceLegacyDriftResolutionCoreResult> {
  if (!dependencies.locks) {
    return { ok: false, reason: "lock-unavailable", baselineAccepted: false };
  }
  let durableSnapshot: WorkspaceAuthoritySnapshot | null = null;
  try {
    return await dependencies.locks.runExclusive(WORKSPACE_LOCK_NAME, async () => {
      const inspected = await inspectWorkspaceLegacyDriftExact(dependencies.storage);
      if (!inspected.ok) return mapInspectionFailure(inspected);
      const exact = inspected.inspection;
      if (exact.confirmationToken !== request.confirmationToken) {
        return { ok: false, reason: "intent-stale", baselineAccepted: false };
      }
      if (!leaseIsDrained(lease) || !resolutionIntentIsCurrent(request)) {
        return {
          ok: false,
          reason: leaseIsDrained(lease) ? "intent-stale" : "pending-save",
          baselineAccepted: false,
        };
      }
      const candidateId =
        request.action.kind === "import-as-new" ||
        request.action.kind === "replace-selected"
          ? request.action.candidateId
          : null;
      const candidate =
        candidateId === null
          ? null
          : exact.candidates.find((entry) => entry.candidateId === candidateId) ??
            null;
      if (candidateId !== null && candidate === null) {
        return { ok: false, reason: "candidate-unavailable", baselineAccepted: false };
      }
      if (
        request.action.kind === "replace-selected" &&
        !selectedProjectMatchesInspection(request.action.selectedIntent, exact)
      ) {
        return { ok: false, reason: "selection-stale", baselineAccepted: false };
      }
      const built = await buildActiveLegacyResolutionJournal(
        dependencies.storage,
        exact,
        request,
        candidate,
      );
      if (!built.ok) {
        return { ok: false, reason: built.reason, baselineAccepted: false };
      }
      if (!leaseIsDrained(lease) || !resolutionIntentIsCurrent(request)) {
        return {
          ok: false,
          reason: leaseIsDrained(lease) ? "intent-stale" : "pending-save",
          baselineAccepted: false,
        };
      }
      const prepared = await prepareWorkspaceJournal(
        dependencies.storage,
        built.prepared.journal,
        {
          releaseReserve: built.prepared.releaseReserve,
          targetRecords: built.prepared.targetRecords,
        },
      );
      if (!prepared.ok) {
        return {
          ok: false,
          reason: preparationFailureReason(prepared),
          baselineAccepted: false,
        };
      }
      durableSnapshot = exact.snapshot;

      const result =
        built.prepared.journal.kind === "restore-as-new"
          ? await resumeWorkspaceCreationOperation(
              dependencies.storage,
              ALREADY_HELD_WORKSPACE_LOCK,
            )
          : await resumeWorkspaceLifecycleOperation(
              dependencies.storage,
              ALREADY_HELD_WORKSPACE_LOCK,
            );
      if (!result.ok) {
        return failedAfterDurableResolution(
          result.reason === "invalid-workspace" ||
            result.reason === "invalid-legacy"
            ? "operation-failed"
            : result.reason,
          exact.snapshot,
        );
      }
      return {
        ok: true,
        action: request.action.kind,
        snapshot: result.snapshot,
        baselineAccepted: true,
        storageProtection: result.storageProtection,
        ...(built.prepared.projectId
          ? { projectId: built.prepared.projectId }
          : {}),
      };
    });
  } catch {
    return durableSnapshot
      ? failedAfterDurableResolution("operation-failed", durableSnapshot)
      : { ok: false, reason: "operation-failed", baselineAccepted: false };
  }
}

interface ClearedLegacyRepurgeCursor {
  value: WorkspaceOperationJournalV1;
  serialized: string;
  digest: string;
}

interface ClearedLegacyRepurgeState {
  cursor: ClearedLegacyRepurgeCursor;
  indexState: "base" | "target";
  indexRaw: string;
  cleanupRaw: ReadonlyMap<string, string | null>;
  ownedProjectKeys: readonly string[];
}

interface ClearedLegacyRepurgeExecution {
  result: WorkspaceLifecycleResult;
  domainMutationStarted: boolean;
}

const OPERATION_PHASES: readonly WorkspaceOperationPhase[] = [
  "prepared",
  "records-writing",
  "records-written",
  "index-committed",
  "cleanup-pending",
];

function repurgePhaseAtLeast(
  actual: WorkspaceOperationPhase,
  expected: WorkspaceOperationPhase,
): boolean {
  return OPERATION_PHASES.indexOf(actual) >= OPERATION_PHASES.indexOf(expected);
}

function allFingerprintsAreNull(fingerprints: WorkspaceLegacyFingerprints): boolean {
  return Object.values(fingerprints).every((digest) => digest === null);
}

export function isClearedWorkspaceLegacyRepurgeJournal(
  journal: WorkspaceOperationJournalV1,
): boolean {
  if (
    journal.kind !== "delete-workspace" ||
    journal.sourceGeneration !== null ||
    journal.targetGeneration !== 1 ||
    journal.baseIndex.expectedDigest === null ||
    journal.legacyResolution?.candidateSource !== null ||
    journal.projectMutations.length !== 0 ||
    !Object.values(journal.legacyExpectedDigests).some((digest) => digest !== null)
  ) {
    return false;
  }
  const target = parseWorkspaceIndex(journal.targetIndex.serializedValue);
  return (
    target.ok &&
    target.value.status === "cleared" &&
    target.value.workspaceId === journal.workspaceId &&
    target.value.workspaceGeneration === 1 &&
    target.value.revision === 1 &&
    target.value.projects.length === 0 &&
    allFingerprintsAreNull(target.value.legacyFingerprints)
  );
}

async function clearedRepurgeMarkerMatchesJournal(
  journal: WorkspaceOperationJournalV1,
): Promise<boolean> {
  const marker = journal.legacyResolution;
  if (marker?.candidateSource !== null) return false;
  const tokenInput = JSON.stringify({
    formatVersion: 1,
    indexDigest: journal.baseIndex.expectedDigest,
    ownedProjectDigests: journal.cleanup
      .filter((entry) => parseWorkspaceProjectRecordKey(entry.key) !== null)
      .map((entry) => ({ key: entry.key, digest: entry.expectedDigest }))
      .sort((left, right) =>
        left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
      ),
    legacyDigests: {
      record: journal.legacyExpectedDigests.record,
      v3: journal.legacyExpectedDigests.v3,
      v2: journal.legacyExpectedDigests.v2,
      v1: journal.legacyExpectedDigests.v1,
    },
  });
  const expected = await sha256StoredString(tokenInput);
  return expected.ok && expected.digest === marker.confirmationToken;
}

function repurgeFailure(
  reason: WorkspaceLifecycleFailureReason,
  domainMutationStarted = false,
): ClearedLegacyRepurgeExecution {
  return { result: { ok: false, reason }, domainMutationStarted };
}

async function digestRawValue(
  raw: string | null,
): Promise<string | null | "unavailable"> {
  const digest = await digestOptionalStoredString(raw);
  return digest.ok ? digest.digest : "unavailable";
}

async function captureClearedLegacyRepurgeState(
  storage: WorkspaceStorageAdapter,
  cursor: ClearedLegacyRepurgeCursor,
): Promise<
  | { ok: true; state: ClearedLegacyRepurgeState }
  | { ok: false; reason: WorkspaceLifecycleFailureReason }
> {
  if (
    !isClearedWorkspaceLegacyRepurgeJournal(cursor.value) ||
    !(await clearedRepurgeMarkerMatchesJournal(cursor.value))
  ) {
    return { ok: false, reason: "unsupported-operation" };
  }
  if (!(await validateWorkspaceJournalDigests(cursor.value)).ok) {
    return { ok: false, reason: "recovery-required" };
  }
  const journalRead = readExact(storage, WORKSPACE_OPERATION_KEY);
  const indexRead = readExact(storage, WORKSPACE_INDEX_KEY);
  if (!journalRead.ok || !indexRead.ok) return { ok: false, reason: "storage-error" };
  if (journalRead.value !== cursor.serialized || indexRead.value === null) {
    return { ok: false, reason: "recovery-required" };
  }
  const indexDigest = await digestRawValue(indexRead.value);
  if (indexDigest === "unavailable") {
    return { ok: false, reason: "digest-unavailable" };
  }
  const indexState =
    indexDigest === cursor.value.baseIndex.expectedDigest
      ? "base"
      : indexDigest === cursor.value.targetIndex.targetDigest &&
          indexRead.value === cursor.value.targetIndex.serializedValue
        ? "target"
        : null;
  if (indexState === null) return { ok: false, reason: "recovery-required" };

  if (indexState === "base") {
    const base = parseWorkspaceIndex(indexRead.value);
    if (
      !base.ok ||
      base.value.status !== "cleared" ||
      base.value.projects.length !== 0 ||
      !allFingerprintsAreNull(base.value.legacyFingerprints)
    ) {
      return { ok: false, reason: "recovery-required" };
    }
    if (
      cursor.value.phase === "index-committed" ||
      cursor.value.phase === "cleanup-pending"
    ) {
      return { ok: false, reason: "recovery-required" };
    }
  }

  const cleanupProjectKeys = cursor.value.cleanup
    .filter((entry) => parseWorkspaceProjectRecordKey(entry.key) !== null)
    .map((entry) => entry.key)
    .sort();
  const ownedProjectKeys = discoveredOwnedProjectKeys(storage);
  if (
    ownedProjectKeys === null ||
    (indexState === "base"
      ? !sameStrings(ownedProjectKeys, cleanupProjectKeys)
      : ownedProjectKeys.some((key) => !cleanupProjectKeys.includes(key)))
  ) {
    return { ok: false, reason: "recovery-required" };
  }

  const cleanupRaw = new Map<string, string | null>();
  for (const entry of cursor.value.cleanup) {
    const read = readExact(storage, entry.key);
    if (!read.ok) return { ok: false, reason: "storage-error" };
    const digest = await digestRawValue(read.value);
    if (digest === "unavailable") {
      return { ok: false, reason: "digest-unavailable" };
    }
    if (
      (read.value === null && indexState === "base") ||
      (read.value !== null && digest !== entry.expectedDigest)
    ) {
      return { ok: false, reason: "recovery-required" };
    }
    cleanupRaw.set(entry.key, read.value);
  }

  for (const name of LEGACY_NAMES) {
    const expected = cursor.value.legacyExpectedDigests[name];
    const cleanup = cursor.value.cleanup.find(
      (entry) => entry.key === LEGACY_PROJECT_KEYS[name],
    );
    const raw = readExact(storage, LEGACY_PROJECT_KEYS[name]);
    if (!raw.ok) return { ok: false, reason: "storage-error" };
    if (
      (expected === null && (cleanup !== undefined || raw.value !== null)) ||
      (expected !== null &&
        (cleanup?.expectedDigest !== expected ||
          (raw.value === null && indexState === "base")))
    ) {
      return { ok: false, reason: "recovery-required" };
    }
  }

  return {
    ok: true,
    state: {
      cursor,
      indexState,
      indexRaw: indexRead.value,
      cleanupRaw,
      ownedProjectKeys,
    },
  };
}

function repurgeStateStillExact(
  storage: WorkspaceStorageAdapter,
  state: ClearedLegacyRepurgeState,
): boolean {
  if (
    !exactRawStillPresent(storage, WORKSPACE_OPERATION_KEY, state.cursor.serialized) ||
    !exactRawStillPresent(storage, WORKSPACE_INDEX_KEY, state.indexRaw)
  ) {
    return false;
  }
  const owned = discoveredOwnedProjectKeys(storage);
  if (owned === null || !sameStrings(owned, state.ownedProjectKeys)) return false;
  for (const [key, raw] of state.cleanupRaw) {
    if (!exactRawStillPresent(storage, key, raw)) return false;
  }
  for (const name of LEGACY_NAMES) {
    if (
      !state.cleanupRaw.has(LEGACY_PROJECT_KEYS[name]) &&
      !exactRawStillPresent(storage, LEGACY_PROJECT_KEYS[name], null)
    ) {
      return false;
    }
  }
  return true;
}

async function advanceRepurgeJournal(
  storage: WorkspaceStorageAdapter,
  cursor: ClearedLegacyRepurgeCursor,
  phase: WorkspaceOperationPhase,
): Promise<ClearedLegacyRepurgeCursor | null> {
  if (repurgePhaseAtLeast(cursor.value.phase, phase)) {
    return cursor;
  }
  const next = serializeWorkspaceJournal({ ...cursor.value, phase });
  if (!next.ok) return null;
  const digest = await sha256StoredString(next.serialized);
  if (!digest.ok) return null;
  const state = await captureClearedLegacyRepurgeState(storage, cursor);
  if (!state.ok) return null;
  const written = await writeWorkspaceJournalPhase(storage, next.serialized, {
    expectedBeforeDigest: cursor.digest,
    targetDigest: digest.digest,
    commitStillAuthorized: () => repurgeStateStillExact(storage, state.state),
  });
  return written.ok
    ? { value: next.value, serialized: next.serialized, digest: digest.digest }
    : null;
}

function bestEffortRemoveWorkspacePreference(storage: WorkspaceStorageAdapter): boolean {
  try {
    const raw = storage.getItem(WORKSPACE_PREFERENCES_KEY);
    if (raw === null) return true;
    // Invalid preferences are also owned best-effort state and are safe to drop
    // after an explicit whole-workspace privacy deletion.
    parseWorkspacePreferences(raw);
    if (storage.getItem(WORKSPACE_PREFERENCES_KEY) !== raw) return false;
    return removeExact(storage, WORKSPACE_PREFERENCES_KEY).ok;
  } catch {
    return false;
  }
}

function repurgeFinishedExactly(
  storage: WorkspaceStorageAdapter,
  cursor: ClearedLegacyRepurgeCursor,
): boolean {
  if (
    !exactRawStillPresent(storage, WORKSPACE_OPERATION_KEY, cursor.serialized) ||
    !exactRawStillPresent(
      storage,
      WORKSPACE_INDEX_KEY,
      cursor.value.targetIndex.serializedValue,
    )
  ) {
    return false;
  }
  const owned = discoveredOwnedProjectKeys(storage);
  return (
    owned !== null &&
    owned.length === 0 &&
    LEGACY_NAMES.every((name) =>
      exactRawStillPresent(storage, LEGACY_PROJECT_KEYS[name], null),
    )
  );
}

async function cancelPreparedRepurge(
  storage: WorkspaceStorageAdapter,
  state: ClearedLegacyRepurgeState,
): Promise<"cancelled" | "retained" | "degraded"> {
  if (state.indexState !== "base" || !repurgeStateStillExact(storage, state)) {
    return "retained";
  }
  const removed = await removeWorkspaceJournal(storage, {
    expectedBeforeDigest: state.cursor.digest,
    commitStillAuthorized: () => repurgeStateStillExact(storage, state),
  });
  if (!removed.ok) return "retained";
  return recreateWorkspaceReserve(storage, CANONICAL_WORKSPACE_RESERVE).ok
    ? "cancelled"
    : "degraded";
}

async function executeClearedLegacyRepurgeWithinLock(
  storage: WorkspaceStorageAdapter,
  initialCursor: ClearedLegacyRepurgeCursor,
  commitStillAuthorized?: () => boolean,
): Promise<ClearedLegacyRepurgeExecution> {
  let captured = await captureClearedLegacyRepurgeState(storage, initialCursor);
  if (!captured.ok) return repurgeFailure(captured.reason);
  let current = initialCursor;

  if (captured.state.indexState === "base") {
    current = (await advanceRepurgeJournal(storage, current, "records-writing")) ?? current;
    if (!repurgePhaseAtLeast(current.value.phase, "records-writing")) {
      return repurgeFailure("commit-incomplete");
    }
    current = (await advanceRepurgeJournal(storage, current, "records-written")) ?? current;
    if (!repurgePhaseAtLeast(current.value.phase, "records-written")) {
      return repurgeFailure("commit-incomplete");
    }
    captured = await captureClearedLegacyRepurgeState(storage, current);
    if (!captured.ok) return repurgeFailure(captured.reason);
    const authorization =
      commitStillAuthorized === undefined || callbackIsTrue(commitStillAuthorized);
    if (!authorization) {
      const cancellation = await cancelPreparedRepurge(storage, captured.state);
      return repurgeFailure(
        cancellation === "cancelled"
          ? "intent-stale"
          : cancellation === "degraded"
            ? "reserve-degraded"
            : "commit-incomplete",
      );
    }
    const stateBeforeIndex = captured.state;
    const written = await writeWorkspaceIndexTarget(
      storage,
      current.value.targetIndex.serializedValue,
      {
        expectedBeforeDigest: current.value.baseIndex.expectedDigest,
        targetDigest: current.value.targetIndex.targetDigest,
        commitStillAuthorized: () =>
          (commitStillAuthorized === undefined ||
            callbackIsTrue(commitStillAuthorized)) &&
          repurgeStateStillExact(storage, stateBeforeIndex),
      },
    );
    if (!written.ok) {
      if (written.reason === "commit-cancelled") {
        const cancellation = await cancelPreparedRepurge(storage, stateBeforeIndex);
        return repurgeFailure(
          cancellation === "cancelled"
            ? "intent-stale"
            : cancellation === "degraded"
              ? "reserve-degraded"
              : "commit-incomplete",
        );
      }
      return repurgeFailure("commit-incomplete");
    }
  }

  current = (await advanceRepurgeJournal(storage, current, "index-committed")) ?? current;
  if (!repurgePhaseAtLeast(current.value.phase, "index-committed")) {
    return repurgeFailure("commit-incomplete", true);
  }
  current = (await advanceRepurgeJournal(storage, current, "cleanup-pending")) ?? current;
  if (!repurgePhaseAtLeast(current.value.phase, "cleanup-pending")) {
    return repurgeFailure("commit-incomplete", true);
  }

  captured = await captureClearedLegacyRepurgeState(storage, current);
  if (!captured.ok || captured.state.indexState !== "target") {
    return repurgeFailure(captured.ok ? "recovery-required" : captured.reason, true);
  }
  for (const cleanup of current.value.cleanup) {
    const removed = await removeWorkspaceCleanupSource(storage, cleanup.key, {
      expectedBeforeDigest: cleanup.expectedDigest,
    });
    if (!removed.ok) return repurgeFailure("commit-incomplete", true);
  }
  if (!repurgeFinishedExactly(storage, current)) {
    return repurgeFailure("commit-incomplete", true);
  }
  const preferenceCleaned = bestEffortRemoveWorkspacePreference(storage);
  const journalRemoved = await removeWorkspaceJournal(storage, {
    expectedBeforeDigest: current.digest,
    commitStillAuthorized: () => repurgeFinishedExactly(storage, current),
  });
  if (!journalRemoved.ok) return repurgeFailure("commit-incomplete", true);
  const reserveHealthy = recreateWorkspaceReserve(
    storage,
    CANONICAL_WORKSPACE_RESERVE,
  ).ok;
  const authority = await readWorkspaceAuthority(storage);
  if (!authority.ok) {
    return repurgeFailure(
      authority.reason === "legacy-conflict" ? "legacy-conflict" : "commit-incomplete",
      true,
    );
  }
  return {
    result: {
      ok: true,
      snapshot: authority.snapshot,
      storageProtection: reserveHealthy ? "healthy" : "degraded",
      preferenceCleaned,
      changed: true,
    },
    domainMutationStarted: true,
  };
}

async function prepareClearedLegacyRepurgeJournal(
  storage: WorkspaceStorageAdapter,
  inspection: WorkspaceLegacyDriftExactInspection,
  uuidSource: SecureUuidSource | null | undefined,
  commitStillAuthorized: () => boolean,
): Promise<
  | { ok: true; cursor: ClearedLegacyRepurgeCursor }
  | { ok: false; reason: WorkspaceLifecycleFailureReason }
> {
  if (
    inspection.snapshot.index.status !== "cleared" ||
    inspection.snapshot.index.projects.length !== 0 ||
    !allFingerprintsAreNull(inspection.snapshot.index.legacyFingerprints)
  ) {
    return { ok: false, reason: "invalid-request" };
  }
  const operationId = generateSecureWorkspaceUuid(uuidSource);
  if (operationId === null) {
    return { ok: false, reason: "id-unavailable-or-collided" };
  }
  const extantWorkspaceIds = new Set<string>([
    inspection.snapshot.index.workspaceId,
    ...inspection.ownedProjects.flatMap((entry) => {
      const identity = parseWorkspaceProjectRecordKey(entry.key);
      return identity ? [identity.workspaceId] : [];
    }),
  ]);
  const targetWorkspaceId = generateCollisionCheckedUuid(
    (candidate) => extantWorkspaceIds.has(candidate),
    uuidSource,
  );
  if (targetWorkspaceId === null) {
    return { ok: false, reason: "id-unavailable-or-collided" };
  }
  const target = serializeWorkspaceIndex({
    formatVersion: 1,
    workspaceId: targetWorkspaceId,
    workspaceGeneration: 1,
    revision: 1,
    status: "cleared",
    projects: [],
    legacyFingerprints: { record: null, v3: null, v2: null, v1: null },
  });
  if (!target.ok) return { ok: false, reason: "invalid-request" };
  const targetDigest = await sha256StoredString(target.serialized);
  if (!targetDigest.ok) return { ok: false, reason: "digest-unavailable" };
  const legacyExpectedDigests = currentLegacyFingerprints(inspection);
  const cleanup = [
    ...inspection.ownedProjects.map((entry) => ({
      key: entry.key,
      expectedDigest: entry.digest,
    })),
    ...LEGACY_NAMES.flatMap((name) => {
      const expectedDigest = legacyExpectedDigests[name];
      return expectedDigest === null
        ? []
        : [{ key: LEGACY_PROJECT_KEYS[name], expectedDigest }];
    }),
  ];
  const journalValue: WorkspaceOperationJournalV1 = {
    formatVersion: 1,
    operationId,
    kind: "delete-workspace",
    workspaceId: targetWorkspaceId,
    sourceGeneration: null,
    targetGeneration: 1,
    phase: "prepared",
    baseIndex: {
      key: WORKSPACE_INDEX_KEY,
      expectedDigest: inspection.snapshot.indexDigest,
    },
    targetIndex: {
      key: WORKSPACE_INDEX_KEY,
      serializedValue: target.serialized,
      targetDigest: targetDigest.digest,
    },
        legacyExpectedDigests,
        legacyResolution: {
          confirmationToken: inspection.confirmationToken,
          candidateSource: null,
        },
        projectMutations: [],
    cleanup,
  };
  const serialized = serializeWorkspaceJournal(journalValue);
  if (!serialized.ok || !(await validateWorkspaceJournalDigests(journalValue)).ok) {
    return { ok: false, reason: "invalid-request" };
  }
  const journalDigest = await sha256StoredString(serialized.serialized);
  if (!journalDigest.ok) return { ok: false, reason: "digest-unavailable" };
  const journalBefore = readExact(storage, WORKSPACE_OPERATION_KEY);
  const reserve = readExact(storage, WORKSPACE_RESERVE_KEY);
  if (!journalBefore.ok || !reserve.ok) return { ok: false, reason: "storage-error" };
  if (journalBefore.value !== null) return { ok: false, reason: "recovery-required" };
  if (classifyWorkspaceReserve(reserve.value) !== "valid") {
    return { ok: false, reason: "reserve-degraded" };
  }
  const reserveRemoved = removeWorkspaceReserve(storage);
  if (!reserveRemoved.ok) return { ok: false, reason: "reserve-degraded" };
  const written = await writeWorkspaceJournalPhase(storage, serialized.serialized, {
    expectedBeforeDigest: null,
    targetDigest: journalDigest.digest,
    commitStillAuthorized: () =>
      callbackIsTrue(commitStillAuthorized) && inspectionStillExact(storage, inspection),
  });
  const observed = readExact(storage, WORKSPACE_OPERATION_KEY);
  if (observed.ok && observed.value === serialized.serialized) {
    return {
      ok: true,
      cursor: {
        value: serialized.value,
        serialized: serialized.serialized,
        digest: journalDigest.digest,
      },
    };
  }
  const reserveRestored = recreateWorkspaceReserve(
    storage,
    CANONICAL_WORKSPACE_RESERVE,
  ).ok;
  if (!observed.ok) return { ok: false, reason: "storage-error" };
  if (observed.value !== null) return { ok: false, reason: "recovery-required" };
  return {
    ok: false,
    reason: reserveRestored
      ? !written.ok && written.reason === "commit-cancelled"
        ? "intent-stale"
        : "storage-error"
      : "reserve-degraded",
  };
}

async function cleanupClearedWorkspaceLegacyData(
  dependencies: WorkspaceLegacyDriftResolutionDependencies,
  request: WorkspaceLegacyDriftResolutionRequest,
  lease: WorkspacePendingSaveFreezeLease,
  inspection: WorkspaceLegacyDriftExactInspection,
): Promise<WorkspaceLegacyDriftResolutionCoreResult> {
  if (!dependencies.locks) {
    return { ok: false, reason: "lock-unavailable", baselineAccepted: false };
  }
  try {
    return await dependencies.locks.runExclusive(WORKSPACE_LOCK_NAME, async () => {
      const exact = await inspectWorkspaceLegacyDriftExact(dependencies.storage);
      if (!exact.ok) return mapInspectionFailure(exact);
      if (
        exact.inspection.confirmationToken !== inspection.confirmationToken ||
        exact.inspection.confirmationToken !== request.confirmationToken
      ) {
        return { ok: false, reason: "intent-stale", baselineAccepted: false };
      }
      const authorization = (): boolean =>
        leaseIsDrained(lease) && resolutionIntentIsCurrent(request);
      if (!authorization()) {
        return {
          ok: false,
          reason: leaseIsDrained(lease) ? "intent-stale" : "pending-save",
          baselineAccepted: false,
        };
      }
      const prepared = await prepareClearedLegacyRepurgeJournal(
        dependencies.storage,
        exact.inspection,
        request.uuidSource,
        authorization,
      );
      if (!prepared.ok) {
        return { ok: false, reason: prepared.reason, baselineAccepted: false };
      }
      const execution = await executeClearedLegacyRepurgeWithinLock(
        dependencies.storage,
        prepared.cursor,
        authorization,
      );
      return execution.result.ok
        ? {
            ok: true,
            action: "privacy-cleanup",
            snapshot: execution.result.snapshot,
            baselineAccepted: true,
            storageProtection: execution.result.storageProtection,
          }
        : {
            ok: false,
            reason: execution.result.reason,
            baselineAccepted: execution.domainMutationStarted,
          };
    });
  } catch {
    return { ok: false, reason: "lock-failed", baselineAccepted: false };
  }
}

/**
 * Resumes the sourceGeneration=null delete journal used when an old v0.7 tab
 * rewrites legacy bytes after an already-cleared workspace. The ordinary core
 * preparation deliberately rejects a schema-valid cleared index as recovery
 * input, so this narrow adapter validates that exact base/target state itself.
 */
export async function resumeClearedWorkspaceLegacyRepurge(
  storage: WorkspaceStorageAdapter,
  locks: WorkspaceExclusiveLockRunner | null,
): Promise<WorkspaceLifecycleResult> {
  if (!locks) return { ok: false, reason: "lock-unavailable" };
  try {
    return await locks.runExclusive(WORKSPACE_LOCK_NAME, async () => {
      const raw = readExact(storage, WORKSPACE_OPERATION_KEY);
      if (!raw.ok) return { ok: false, reason: "storage-error" };
      if (raw.value === null) return { ok: false, reason: "no-operation" };
      const parsed = parseWorkspaceJournal(raw.value);
      if (!parsed.ok || !isClearedWorkspaceLegacyRepurgeJournal(parsed.value)) {
        return { ok: false, reason: "unsupported-operation" };
      }
      const digest = await sha256StoredString(raw.value);
      if (!digest.ok) return { ok: false, reason: "digest-unavailable" };
      const execution = await executeClearedLegacyRepurgeWithinLock(storage, {
        value: parsed.value,
        serialized: raw.value,
        digest: digest.digest,
      });
      return execution.result;
    });
  } catch {
    return { ok: false, reason: "lock-failed" };
  }
}

/**
 * Resolves an exact old-tab drift choice. Accept-current-baseline is a one-key
 * exact CAS. Import, replace, and cleanup use one compound operation journal,
 * made durable before any authoritative mutation, so a later failure cannot
 * silently consume the confirmed choice.
 */
async function resolveWorkspaceLegacyDriftWithLease(
  dependencies: WorkspaceLegacyDriftResolutionDependencies,
  request: WorkspaceLegacyDriftResolutionRequest,
  lease: WorkspacePendingSaveFreezeLease,
): Promise<WorkspaceLegacyDriftResolutionCoreResult> {
  try {
    if (
      !leaseIsDrained(lease) ||
      !resolutionIntentIsCurrent(request)
    ) {
      return {
        ok: false,
        reason: leaseIsDrained(lease) ? "intent-stale" : "pending-save",
        baselineAccepted: false,
      };
    }

    const preview = await inspectWorkspaceLegacyDriftExact(dependencies.storage);
    if (!preview.ok) return mapInspectionFailure(preview);
    if (preview.inspection.confirmationToken !== request.confirmationToken) {
      return { ok: false, reason: "intent-stale", baselineAccepted: false };
    }
    const candidateId =
      request.action.kind === "import-as-new" ||
      request.action.kind === "replace-selected"
        ? request.action.candidateId
        : null;
    const candidate =
      candidateId !== null
        ? preview.inspection.candidates.find(
            (entry) => entry.candidateId === candidateId,
          ) ?? null
        : null;
    if (
      (request.action.kind === "import-as-new" ||
        request.action.kind === "replace-selected") &&
      candidate === null
    ) {
      return { ok: false, reason: "candidate-unavailable", baselineAccepted: false };
    }
    if (
      (request.action.kind === "import-as-new" ||
        request.action.kind === "replace-selected") &&
      preview.inspection.snapshot.index.status !== "active"
    ) {
      return { ok: false, reason: "workspace-not-active", baselineAccepted: false };
    }
    if (
      request.action.kind === "replace-selected" &&
      !selectedProjectMatchesInspection(
        request.action.selectedIntent,
        preview.inspection,
      )
    ) {
      return { ok: false, reason: "selection-stale", baselineAccepted: false };
    }

    if (preview.inspection.snapshot.index.status === "cleared") {
      if (request.action.kind !== "privacy-cleanup") {
        return {
          ok: false,
          reason: "workspace-not-active",
          baselineAccepted: false,
        };
      }
      return cleanupClearedWorkspaceLegacyData(
        dependencies,
        request,
        lease,
        preview.inspection,
      );
    }

    return request.action.kind === "accept-current-baseline"
      ? acceptCurrentLegacyBaseline(dependencies, request, lease)
      : executeActiveLegacyResolution(dependencies, request, lease);
  } catch {
    return { ok: false, reason: "operation-failed", baselineAccepted: false };
  }
}

function legacyLeaseIsHeld(lease: WorkspacePendingSaveFreezeLease): boolean {
  try {
    return lease.isHeld();
  } catch {
    return true;
  }
}

function cancelLegacyLease(lease: WorkspacePendingSaveFreezeLease): boolean {
  try {
    if (lease.cancel?.()) return false;
    if (!lease.cancel) {
      lease.release();
      return legacyLeaseIsHeld(lease);
    }
  } catch {
    // Fall through to the observable held state.
  }
  return legacyLeaseIsHeld(lease);
}

function adoptLegacySnapshot(
  lease: WorkspacePendingSaveFreezeLease,
  snapshot: WorkspaceAuthoritySnapshot,
): "synchronized" | "rebuild-required" {
  try {
    return lease.adoptSnapshot?.(snapshot)
      ? "synchronized"
      : "rebuild-required";
  } catch {
    return "rebuild-required";
  }
}

function legacyFailureCanCancelBeforeMutation(
  result: Extract<WorkspaceLegacyDriftResolutionCoreResult, { ok: false }>,
): boolean {
  return (
    !result.baselineAccepted &&
    [
      "pending-save",
      "intent-stale",
      "selection-stale",
      "candidate-unavailable",
      "no-legacy-drift",
      "lock-unavailable",
      "workspace-not-active",
    ].includes(result.reason)
  );
}

export async function resolveWorkspaceLegacyDrift(
  dependencies: WorkspaceLegacyDriftResolutionDependencies,
  request: WorkspaceLegacyDriftResolutionRequest,
): Promise<WorkspaceLegacyDriftResolutionResult> {
  let lease: WorkspacePendingSaveFreezeLease | null;
  try {
    lease = dependencies.pendingSaves.tryFreeze();
  } catch {
    return {
      ok: false,
      reason: "pending-save",
      baselineAccepted: false,
      pendingFreezeRetained: false,
    };
  }
  if (!lease) {
    return {
      ok: false,
      reason: "pending-save",
      baselineAccepted: false,
      pendingFreezeRetained: false,
    };
  }

  const result = await resolveWorkspaceLegacyDriftWithLease(
    dependencies,
    request,
    lease,
  );
  if (result.ok) {
    return {
      ...result,
      pendingState: adoptLegacySnapshot(lease, result.snapshot),
    };
  }
  return {
    ...result,
    pendingFreezeRetained: legacyFailureCanCancelBeforeMutation(result)
      ? cancelLegacyLease(lease)
      : legacyLeaseIsHeld(lease),
  };
}
