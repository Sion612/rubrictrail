import { z } from "zod";
import {
  parsePersistedProjectStateValue,
  serializePersistedProjectStateValue,
} from "@/lib/local-state";
import { sha256StoredString, WORKSPACE_DIGEST_PATTERN } from "@/lib/workspace-storage/digest";
import {
  LEGACY_PROJECT_KEYS,
  parseWorkspaceProjectRecordKey,
  WORKSPACE_INDEX_KEY,
  workspaceProjectRecordKey,
  isWorkspaceUuid,
} from "@/lib/workspace-storage/keys";
import {
  PROJECT_MUTATION_MODES,
  WORKSPACE_OPERATION_KINDS,
  WORKSPACE_OPERATION_PHASES,
  type WorkspaceIndexEntryV1,
  type WorkspaceIndexV1,
  type WorkspaceLegacyFingerprints,
  type WorkspaceOperationJournalV1,
  type WorkspacePreferencesV1,
  type WorkspaceProjectRecordV1,
  type WorkspaceProtocolParseResult,
} from "@/lib/workspace-storage/types";

export const WORKSPACE_PROJECT_RECORD_LIMIT = 100;
export const WORKSPACE_PHYSICAL_RECORD_LIMIT = 200;
export const WORKSPACE_JOURNAL_MAX_CODE_UNITS = 196_608;
export const WORKSPACE_TOMBSTONE_WARNING = 64;
export const WORKSPACE_RECORD_WARNING = 80;
export const WORKSPACE_RECORD_GROWTH_BLOCK = 96;

const positiveSafeInteger = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const workspaceUuidSchema = z.string().refine(isWorkspaceUuid, "Expected a lowercase UUID v4");
const digestSchema = z.string().regex(WORKSPACE_DIGEST_PATTERN);
const nullableDigestSchema = digestSchema.nullable();

const legacyFingerprintsSchema = z
  .object({
    record: nullableDigestSchema,
    v3: nullableDigestSchema,
    v2: nullableDigestSchema,
    v1: nullableDigestSchema,
  })
  .strict();

const indexEntrySchema = z
  .object({
    projectId: workspaceUuidSchema,
    kind: z.enum(["active", "tombstone"]),
  })
  .strict();

function isSortedUniqueProjectEntries(entries: readonly WorkspaceIndexEntryV1[]): boolean {
  return entries.every(
    (entry, index) => index === 0 || entries[index - 1].projectId < entry.projectId,
  );
}

const workspaceIndexInputSchema = z
  .object({
    formatVersion: z.literal(1),
    workspaceId: workspaceUuidSchema,
    workspaceGeneration: positiveSafeInteger,
    revision: positiveSafeInteger,
    status: z.enum(["active", "cleared"]),
    projects: z.array(indexEntrySchema).max(WORKSPACE_PROJECT_RECORD_LIMIT),
    legacyFingerprints: legacyFingerprintsSchema,
  })
  .strict()
  .superRefine((index, context) => {
    if (
      index.status === "cleared" &&
      (index.projects.length !== 0 ||
        Object.values(index.legacyFingerprints).some((digest) => digest !== null))
    ) {
      context.addIssue({
        code: "custom",
        message: "A cleared workspace must be empty with null legacy fingerprints",
        path: ["status"],
      });
    }
  });

const workspaceIndexSchema = workspaceIndexInputSchema.superRefine((index, context) => {
  if (!isSortedUniqueProjectEntries(index.projects)) {
    context.addIssue({
      code: "custom",
      message: "Workspace project entries must be unique and lexicographically sorted",
      path: ["projects"],
    });
  }
});

const workspaceProjectRecordShapeSchema = z
  .object({
    formatVersion: z.literal(1),
    workspaceId: workspaceUuidSchema,
    workspaceGeneration: positiveSafeInteger,
    projectId: workspaceUuidSchema,
    revision: positiveSafeInteger,
    value: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("project"), state: z.unknown() }).strict(),
      z.object({ kind: z.literal("tombstone") }).strict(),
    ]),
  })
  .strict();

const workspacePreferencesSchema = z
  .object({
    formatVersion: z.literal(1),
    workspaceId: workspaceUuidSchema,
    workspaceGeneration: positiveSafeInteger,
    lastOpenedProjectId: workspaceUuidSchema.nullable(),
  })
  .strict();

const journalProjectMutationSchema = z
  .object({
    mode: z.enum(PROJECT_MUTATION_MODES),
    projectId: workspaceUuidSchema,
    sourceRecord: z
      .object({ key: z.string(), expectedDigest: digestSchema })
      .strict()
      .nullable(),
    targetRecord: z
      .object({
        key: z.string(),
        expectedBeforeDigest: nullableDigestSchema,
        targetDigest: digestSchema,
      })
      .strict(),
    sourceCleanup: z
      .object({ key: z.string(), expectedDigest: digestSchema })
      .strict()
      .nullable(),
  })
  .strict();

const journalCleanupSchema = z
  .object({ key: z.string(), expectedDigest: digestSchema })
  .strict();

const workspaceJournalShapeSchema = z
  .object({
    formatVersion: z.literal(1),
    operationId: workspaceUuidSchema,
    kind: z.enum(WORKSPACE_OPERATION_KINDS),
    workspaceId: workspaceUuidSchema,
    sourceGeneration: positiveSafeInteger.nullable(),
    targetGeneration: positiveSafeInteger,
    phase: z.enum(WORKSPACE_OPERATION_PHASES),
    baseIndex: z
      .object({ key: z.literal(WORKSPACE_INDEX_KEY), expectedDigest: nullableDigestSchema })
      .strict(),
    targetIndex: z
      .object({
        key: z.literal(WORKSPACE_INDEX_KEY),
        serializedValue: z.string(),
        targetDigest: digestSchema,
      })
      .strict(),
    legacyExpectedDigests: legacyFingerprintsSchema,
    projectMutations: z.array(journalProjectMutationSchema).max(WORKSPACE_PROJECT_RECORD_LIMIT),
    // A recovery-only privacy purge can encounter more than the normal
    // 200-record coherent-namespace ceiling.  The canonical journal byte
    // limit below remains the hard bound; a fixed entry-count ceiling would
    // otherwise make those workspaces permanently impossible to clear.
    cleanup: z.array(journalCleanupSchema),
  })
  .strict();

function validateJournalSemantics(
  journal: z.infer<typeof workspaceJournalShapeSchema>,
  context: z.RefinementCtx,
  requireCanonicalOrder: boolean,
): void {
  if (requireCanonicalOrder) {
    const mutations = journal.projectMutations;
    if (
      mutations.some(
        (mutation, index) =>
          index > 0 &&
          `${mutations[index - 1].projectId}\u0000${mutations[index - 1].targetRecord.key}` >=
            `${mutation.projectId}\u0000${mutation.targetRecord.key}`,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Journal project mutations must be unique and sorted",
        path: ["projectMutations"],
      });
    }
    if (
      journal.cleanup.some(
        (entry, index) => index > 0 && journal.cleanup[index - 1].key >= entry.key,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Journal cleanup keys must be unique and sorted",
        path: ["cleanup"],
      });
    }
  }

  journal.projectMutations.forEach((mutation, index) => {
      const targetIdentity = parseWorkspaceProjectRecordKey(mutation.targetRecord.key);
      if (
        !targetIdentity ||
        targetIdentity.workspaceId !== journal.workspaceId ||
        targetIdentity.workspaceGeneration !== journal.targetGeneration ||
        targetIdentity.projectId !== mutation.projectId
      ) {
        context.addIssue({
          code: "custom",
          message: "Journal target record identity does not match the operation",
          path: ["projectMutations", index, "targetRecord", "key"],
        });
      }

      if (mutation.mode === "rewrite-generation") {
        const sourceIdentity = mutation.sourceRecord
          ? parseWorkspaceProjectRecordKey(mutation.sourceRecord.key)
          : null;
        if (
          journal.sourceGeneration === null ||
          !sourceIdentity ||
          sourceIdentity.workspaceId !== journal.workspaceId ||
          sourceIdentity.workspaceGeneration !== journal.sourceGeneration ||
          sourceIdentity.projectId !== mutation.projectId ||
          mutation.sourceCleanup?.key !== mutation.sourceRecord?.key ||
          mutation.sourceCleanup?.expectedDigest !== mutation.sourceRecord?.expectedDigest ||
          mutation.targetRecord.expectedBeforeDigest !== null
        ) {
          context.addIssue({
            code: "custom",
            message: "Generation rewrites require exact matching source and cleanup records",
            path: ["projectMutations", index],
          });
        }
      } else if (mutation.sourceRecord !== null || mutation.sourceCleanup !== null) {
        context.addIssue({
          code: "custom",
          message: "Same-generation mutations cannot name a source cleanup record",
          path: ["projectMutations", index],
        });
      }

      if (mutation.mode === "create" && mutation.targetRecord.expectedBeforeDigest !== null) {
        context.addIssue({
          code: "custom",
          message: "Create mutations require an absent target key",
          path: ["projectMutations", index, "targetRecord", "expectedBeforeDigest"],
        });
      }
      if (
        (mutation.mode === "replace" || mutation.mode === "delete") &&
        mutation.targetRecord.expectedBeforeDigest === null
      ) {
        context.addIssue({
          code: "custom",
          message: "Replace and delete mutations require an exact prior target digest",
          path: ["projectMutations", index, "targetRecord", "expectedBeforeDigest"],
        });
      }
  });

  const modes = journal.projectMutations.map((mutation) => mutation.mode);
  const expectedModes: Partial<Record<(typeof WORKSPACE_OPERATION_KINDS)[number], string[]>> = {
    "create-project": ["create"],
    "restore-as-new": ["create"],
    "replace-project": ["replace"],
    "delete-project": ["delete"],
  };
  const expected = expectedModes[journal.kind];
  if (expected && (modes.length !== 1 || !expected.includes(modes[0]))) {
    context.addIssue({
      code: "custom",
      message: "Journal operation kind does not match its project mutation",
      path: ["kind"],
    });
  }
  if (
    (journal.kind === "rotate-workspace-generation" || journal.kind === "recover-index") &&
    modes.some((mode) => mode !== "rewrite-generation")
  ) {
    context.addIssue({
      code: "custom",
      message: "Generation operations require rewrite-generation mutations",
      path: ["projectMutations"],
    });
  }
  if (
    (journal.kind === "legacy-cleanup" || journal.kind === "delete-workspace") &&
    modes.length !== 0
  ) {
    context.addIssue({
      code: "custom",
      message: "Cleanup operations cannot contain project payload mutations",
      path: ["projectMutations"],
    });
  }
}

const workspaceJournalInputSchema = workspaceJournalShapeSchema.superRefine(
  (journal, context) => validateJournalSemantics(journal, context, false),
);

const workspaceJournalSchema = workspaceJournalShapeSchema.superRefine(
  (journal, context) => validateJournalSemantics(journal, context, true),
);

function jsonValue(raw: string): unknown | undefined {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function sortedIndexEntries(entries: readonly WorkspaceIndexEntryV1[]): WorkspaceIndexEntryV1[] {
  return entries
    .map((entry) => ({ projectId: entry.projectId, kind: entry.kind }))
    .sort((left, right) =>
      left.projectId < right.projectId ? -1 : left.projectId > right.projectId ? 1 : 0,
    );
}

function orderedLegacyFingerprints(
  fingerprints: WorkspaceLegacyFingerprints,
): WorkspaceLegacyFingerprints {
  return {
    record: fingerprints.record,
    v3: fingerprints.v3,
    v2: fingerprints.v2,
    v1: fingerprints.v1,
  };
}

export function serializeWorkspaceIndex(input: unknown): WorkspaceProtocolParseResult<WorkspaceIndexV1> {
  const validatedInput = workspaceIndexInputSchema.safeParse(input);
  if (!validatedInput.success) return { ok: false, reason: "invalid" };
  const ordered: WorkspaceIndexV1 = {
    formatVersion: 1,
    workspaceId: validatedInput.data.workspaceId,
    workspaceGeneration: validatedInput.data.workspaceGeneration,
    revision: validatedInput.data.revision,
    status: validatedInput.data.status,
    projects: sortedIndexEntries(validatedInput.data.projects),
    legacyFingerprints: orderedLegacyFingerprints(validatedInput.data.legacyFingerprints),
  };
  const parsed = workspaceIndexSchema.safeParse(ordered);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  return { ok: true, value: parsed.data, serialized: JSON.stringify(parsed.data) };
}

export function parseWorkspaceIndex(raw: string): WorkspaceProtocolParseResult<WorkspaceIndexV1> {
  const value = jsonValue(raw);
  if (value === undefined) return { ok: false, reason: "invalid" };
  if (
    typeof value === "object" &&
    value !== null &&
    "formatVersion" in value &&
    (value as { formatVersion?: unknown }).formatVersion !== 1
  ) {
    return { ok: false, reason: "unsupported-version" };
  }
  const parsed = workspaceIndexSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const canonical = serializeWorkspaceIndex(parsed.data);
  if (!canonical.ok || canonical.serialized !== raw) {
    return { ok: false, reason: "invalid" };
  }
  return canonical;
}

function canonicalProjectRecord(input: unknown): WorkspaceProjectRecordV1 | null {
  const base = workspaceProjectRecordShapeSchema.safeParse(input);
  if (!base.success) return null;
  if (base.data.value.kind === "tombstone") {
    return {
      formatVersion: 1,
      workspaceId: base.data.workspaceId,
      workspaceGeneration: base.data.workspaceGeneration,
      projectId: base.data.projectId,
      revision: base.data.revision,
      value: { kind: "tombstone" },
    };
  }
  const state = parsePersistedProjectStateValue(base.data.value.state);
  if (!state.ok || state.state.version !== 3 || state.recovered) return null;
  const serializedState = serializePersistedProjectStateValue(state.state);
  if (!serializedState.ok || serializedState.recovered) return null;
  return {
    formatVersion: 1,
    workspaceId: base.data.workspaceId,
    workspaceGeneration: base.data.workspaceGeneration,
    projectId: base.data.projectId,
    revision: base.data.revision,
    value: { kind: "project", state: serializedState.state },
  };
}

export function serializeWorkspaceProjectRecord(
  input: unknown,
): WorkspaceProtocolParseResult<WorkspaceProjectRecordV1> {
  const value = canonicalProjectRecord(input);
  if (!value) return { ok: false, reason: "invalid" };
  return { ok: true, value, serialized: JSON.stringify(value) };
}

export function parseWorkspaceProjectRecord(
  raw: string,
): WorkspaceProtocolParseResult<WorkspaceProjectRecordV1> {
  const input = jsonValue(raw);
  if (input === undefined) return { ok: false, reason: "invalid" };
  const shape = workspaceProjectRecordShapeSchema.safeParse(input);
  if (!shape.success) return { ok: false, reason: "invalid" };
  const canonical = serializeWorkspaceProjectRecord(shape.data);
  if (!canonical.ok || canonical.serialized !== raw) {
    return { ok: false, reason: "invalid" };
  }
  return canonical;
}

export function workspaceProjectRecordMatchesKey(
  key: string,
  record: WorkspaceProjectRecordV1,
): boolean {
  return key === workspaceProjectRecordKey(
    record.workspaceId,
    record.workspaceGeneration,
    record.projectId,
  );
}

export function serializeWorkspacePreferences(
  input: unknown,
): WorkspaceProtocolParseResult<WorkspacePreferencesV1> {
  const validatedInput = workspacePreferencesSchema.safeParse(input);
  if (!validatedInput.success) return { ok: false, reason: "invalid" };
  const ordered: WorkspacePreferencesV1 = {
    formatVersion: 1,
    workspaceId: validatedInput.data.workspaceId,
    workspaceGeneration: validatedInput.data.workspaceGeneration,
    lastOpenedProjectId: validatedInput.data.lastOpenedProjectId,
  };
  const parsed = workspacePreferencesSchema.safeParse(ordered);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  return { ok: true, value: parsed.data, serialized: JSON.stringify(parsed.data) };
}

export function parseWorkspacePreferences(
  raw: string,
): WorkspaceProtocolParseResult<WorkspacePreferencesV1> {
  const parsed = workspacePreferencesSchema.safeParse(jsonValue(raw));
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const canonical = serializeWorkspacePreferences(parsed.data);
  return canonical.ok && canonical.serialized === raw
    ? canonical
    : { ok: false, reason: "invalid" };
}

export function workspacePreferenceApplies(
  preference: WorkspacePreferencesV1,
  index: WorkspaceIndexV1,
): boolean {
  return (
    preference.workspaceId === index.workspaceId &&
    preference.workspaceGeneration === index.workspaceGeneration &&
    (preference.lastOpenedProjectId === null ||
      index.projects.some(
        (entry) =>
          entry.kind === "active" && entry.projectId === preference.lastOpenedProjectId,
      ))
  );
}

function orderedJournal(input: WorkspaceOperationJournalV1): WorkspaceOperationJournalV1 {
  return {
    formatVersion: 1,
    operationId: input.operationId,
    kind: input.kind,
    workspaceId: input.workspaceId,
    sourceGeneration: input.sourceGeneration,
    targetGeneration: input.targetGeneration,
    phase: input.phase,
    baseIndex: {
      key: WORKSPACE_INDEX_KEY,
      expectedDigest: input.baseIndex.expectedDigest,
    },
    targetIndex: {
      key: WORKSPACE_INDEX_KEY,
      serializedValue: input.targetIndex.serializedValue,
      targetDigest: input.targetIndex.targetDigest,
    },
    legacyExpectedDigests: orderedLegacyFingerprints(input.legacyExpectedDigests),
    projectMutations: input.projectMutations
      .map((mutation) => ({
        mode: mutation.mode,
        projectId: mutation.projectId,
        sourceRecord: mutation.sourceRecord
          ? {
              key: mutation.sourceRecord.key,
              expectedDigest: mutation.sourceRecord.expectedDigest,
            }
          : null,
        targetRecord: {
          key: mutation.targetRecord.key,
          expectedBeforeDigest: mutation.targetRecord.expectedBeforeDigest,
          targetDigest: mutation.targetRecord.targetDigest,
        },
        sourceCleanup: mutation.sourceCleanup
          ? {
              key: mutation.sourceCleanup.key,
              expectedDigest: mutation.sourceCleanup.expectedDigest,
            }
          : null,
      }))
      .sort((left, right) =>
        `${left.projectId}\u0000${left.targetRecord.key}` <
        `${right.projectId}\u0000${right.targetRecord.key}`
          ? -1
          : `${left.projectId}\u0000${left.targetRecord.key}` >
              `${right.projectId}\u0000${right.targetRecord.key}`
            ? 1
            : 0,
      ),
    cleanup: input.cleanup
      .map((entry) => ({ key: entry.key, expectedDigest: entry.expectedDigest }))
      .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)),
  };
}

function journalReferencesAllowedCleanupKey(key: string): boolean {
  return (
    parseWorkspaceProjectRecordKey(key) !== null ||
    Object.values(LEGACY_PROJECT_KEYS).includes(
      key as (typeof LEGACY_PROJECT_KEYS)[keyof typeof LEGACY_PROJECT_KEYS],
    )
  );
}

function journalSemanticsAreValid(journal: WorkspaceOperationJournalV1): boolean {
  const targetIndex = parseWorkspaceIndex(journal.targetIndex.serializedValue);
  const recoveryPrivacyPurge =
    journal.kind === "delete-workspace" && journal.sourceGeneration === null;
  const legacyKeys = new Set<string>(Object.values(LEGACY_PROJECT_KEYS));
  const targetRecordKeys = new Set(
    journal.projectMutations.map((mutation) => mutation.targetRecord.key),
  );
  const sourceRecordKeys = new Set(
    journal.projectMutations.flatMap((mutation) =>
      mutation.sourceRecord ? [mutation.sourceRecord.key] : [],
    ),
  );
  const projectCleanupIdentities = journal.cleanup.flatMap((entry) => {
    const identity = parseWorkspaceProjectRecordKey(entry.key);
    return identity ? [identity] : [];
  });
  const legacyCleanupKeys = journal.cleanup
    .filter((entry) => legacyKeys.has(entry.key))
    .map((entry) => entry.key);
  if (
    !targetIndex.ok ||
    targetIndex.value.workspaceId !== journal.workspaceId ||
    targetIndex.value.workspaceGeneration !== journal.targetGeneration ||
    journal.cleanup.some(
      (entry) => targetRecordKeys.has(entry.key) || sourceRecordKeys.has(entry.key),
    ) ||
    journal.cleanup.some((entry) => {
      if (!journalReferencesAllowedCleanupKey(entry.key)) return true;
      const identity = parseWorkspaceProjectRecordKey(entry.key);
      return (
        identity !== null &&
        journal.kind !== "delete-workspace" &&
        identity.workspaceId !== journal.workspaceId
      );
    })
  ) {
    return false;
  }
  if (journal.kind !== "delete-workspace" && targetIndex.value.status !== "active") {
    return false;
  }
  if (
    journal.kind === "migrate-single-project"
      ? journal.sourceGeneration !== null ||
        journal.targetGeneration !== 1 ||
        journal.baseIndex.expectedDigest !== null ||
        targetIndex.value.revision !== 1
      : recoveryPrivacyPurge
        ? journal.targetGeneration !== 1 || targetIndex.value.revision !== 1
        : journal.sourceGeneration === null
  ) {
    return false;
  }
  if (
    journal.kind !== "migrate-single-project" &&
    journal.kind !== "recover-index" &&
    !recoveryPrivacyPurge &&
    journal.baseIndex.expectedDigest === null
  ) {
    return false;
  }
  if (
    recoveryPrivacyPurge
  ) {
    if (journal.targetGeneration !== 1) return false;
  } else if (
    journal.kind !== "migrate-single-project" &&
    ["recover-index", "delete-workspace", "rotate-workspace-generation"].includes(
      journal.kind,
    )
  ) {
    if (journal.targetGeneration !== (journal.sourceGeneration ?? 0) + 1) {
      return false;
    }
  } else if (
    journal.kind !== "migrate-single-project" &&
    journal.sourceGeneration !== journal.targetGeneration
  ) {
    return false;
  }

  for (const mutation of journal.projectMutations) {
    const targetEntry = targetIndex.value.projects.find(
      (entry) => entry.projectId === mutation.projectId,
    );
    if (
      !targetEntry ||
      (mutation.mode === "delete"
        ? targetEntry.kind !== "tombstone"
        : targetEntry.kind !== "active")
    ) {
      return false;
    }
  }

  const expectedLegacyCleanup = Object.entries(LEGACY_PROJECT_KEYS)
    .filter(([name]) => journal.legacyExpectedDigests[name as keyof WorkspaceLegacyFingerprints] !== null)
    .map(([, key]) => key)
    .sort();
  const actualLegacyCleanup = journal.cleanup
    .filter((entry) => legacyKeys.has(entry.key))
    .map((entry) => entry.key)
    .sort();
  const legacyCleanupDigestsMatch = journal.cleanup
    .filter((entry) => legacyKeys.has(entry.key))
    .every((entry) => {
      const legacyName = Object.entries(LEGACY_PROJECT_KEYS).find(
        ([, key]) => key === entry.key,
      )?.[0] as keyof WorkspaceLegacyFingerprints | undefined;
      return (
        legacyName !== undefined &&
        journal.legacyExpectedDigests[legacyName] !== null &&
        entry.expectedDigest === journal.legacyExpectedDigests[legacyName]
      );
    });
  if (journal.kind === "legacy-cleanup") {
    return (
      projectCleanupIdentities.length === 0 &&
      Object.values(targetIndex.value.legacyFingerprints).every(
        (digest) => digest === null,
      ) &&
      JSON.stringify(actualLegacyCleanup) === JSON.stringify(expectedLegacyCleanup) &&
      legacyCleanupDigestsMatch
    );
  }
  if (journal.kind === "delete-workspace") {
    return (
      targetIndex.value.status === "cleared" &&
      JSON.stringify(actualLegacyCleanup) === JSON.stringify(expectedLegacyCleanup) &&
      legacyCleanupDigestsMatch
    );
  }
  if (
    [
      "migrate-single-project",
      "create-project",
      "restore-as-new",
      "replace-project",
      "delete-project",
    ].includes(journal.kind) &&
    journal.cleanup.length !== 0
  ) {
    return false;
  }
  if (
    (journal.kind === "rotate-workspace-generation" ||
      journal.kind === "recover-index") &&
    (legacyCleanupKeys.length !== 0 ||
      projectCleanupIdentities.some(
        (identity) => identity.workspaceGeneration !== journal.sourceGeneration,
      ))
  ) {
    return false;
  }
  if (journal.kind === "migrate-single-project") {
    const targetIds = targetIndex.value.projects.map((entry) => entry.projectId);
    const mutationIds = journal.projectMutations.map((mutation) => mutation.projectId);
    if (
      Object.values(journal.legacyExpectedDigests).every((digest) => digest === null) ||
      journal.projectMutations.length > 1 ||
      journal.projectMutations.some((mutation) => mutation.mode !== "create") ||
      targetIndex.value.projects.some((entry) => entry.kind !== "active") ||
      JSON.stringify(targetIds) !== JSON.stringify(mutationIds)
    ) {
      return false;
    }
  }
  if (
    journal.kind === "rotate-workspace-generation" ||
    journal.kind === "recover-index"
  ) {
    const targetIds = targetIndex.value.projects.map((entry) => entry.projectId);
    const mutationIds = journal.projectMutations.map((mutation) => mutation.projectId);
    if (
      targetIndex.value.projects.some((entry) => entry.kind !== "active") ||
      JSON.stringify(targetIds) !== JSON.stringify(mutationIds)
    ) {
      return false;
    }
  }
  if (
    journal.kind === "recover-index" &&
    journal.projectMutations.length === 0 &&
    projectCleanupIdentities.length === 0
  ) {
    // Namespace recovery must name a real discovered source group. With no
    // active or tombstone record there is no candidate group to select, so an
    // arbitrary empty workspace identity must not become authority.
    return false;
  }
  const generationCleanupAllowed =
    journal.kind === "rotate-workspace-generation" || journal.kind === "recover-index";
  return (
    (generationCleanupAllowed || journal.cleanup.length === 0) &&
    JSON.stringify(targetIndex.value.legacyFingerprints) ===
    JSON.stringify(journal.legacyExpectedDigests)
  );
}

export function serializeWorkspaceJournal(
  input: unknown,
): WorkspaceProtocolParseResult<WorkspaceOperationJournalV1> {
  const validatedInput = workspaceJournalInputSchema.safeParse(input);
  if (!validatedInput.success) return { ok: false, reason: "invalid" };
  const ordered = orderedJournal(validatedInput.data);
  const parsed = workspaceJournalSchema.safeParse(ordered);
  if (!parsed.success || !journalSemanticsAreValid(parsed.data)) {
    return { ok: false, reason: "invalid" };
  }
  const serialized = JSON.stringify(parsed.data);
  if (serialized.length > WORKSPACE_JOURNAL_MAX_CODE_UNITS) {
    return { ok: false, reason: "too-large" };
  }
  return { ok: true, value: parsed.data, serialized };
}

export function parseWorkspaceJournal(
  raw: string,
): WorkspaceProtocolParseResult<WorkspaceOperationJournalV1> {
  if (raw.length > WORKSPACE_JOURNAL_MAX_CODE_UNITS) {
    return { ok: false, reason: "too-large" };
  }
  const input = jsonValue(raw);
  if (input === undefined) return { ok: false, reason: "invalid" };
  const parsed = workspaceJournalSchema.safeParse(input);
  if (!parsed.success || !journalSemanticsAreValid(parsed.data)) {
    return { ok: false, reason: "invalid" };
  }
  const canonical = serializeWorkspaceJournal(parsed.data);
  return canonical.ok && canonical.serialized === raw
    ? canonical
    : { ok: false, reason: "invalid" };
}

export async function validateWorkspaceJournalDigests(
  journal: WorkspaceOperationJournalV1,
): Promise<{ ok: true } | { ok: false; reason: "invalid" | "digest-unavailable" }> {
  const parsed = serializeWorkspaceJournal(journal);
  if (!parsed.ok) return { ok: false, reason: "invalid" };
  const targetDigest = await sha256StoredString(journal.targetIndex.serializedValue);
  if (!targetDigest.ok) return { ok: false, reason: "digest-unavailable" };
  return targetDigest.digest === journal.targetIndex.targetDigest
    ? { ok: true }
    : { ok: false, reason: "invalid" };
}
