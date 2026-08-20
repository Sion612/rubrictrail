import { describe, expect, it } from "vitest";
import { sha256StoredString } from "@/lib/workspace-storage/digest";
import {
  generateCollisionCheckedUuid,
  generateSecureWorkspaceUuid,
  isWorkspaceUuid,
  LEGACY_PROJECT_KEYS,
  parseWorkspaceProjectRecordKey,
  recognizeWorkspaceOwnedKey,
  WORKSPACE_INDEX_KEY,
  WORKSPACE_OPERATION_KEY,
  WORKSPACE_PREFERENCES_KEY,
  WORKSPACE_RESERVE_KEY,
  workspaceProjectRecordKey,
} from "@/lib/workspace-storage/keys";
import {
  parseWorkspaceIndex,
  parseWorkspaceJournal,
  parseWorkspacePreferences,
  parseWorkspaceProjectRecord,
  serializeWorkspaceIndex,
  serializeWorkspaceJournal,
  serializeWorkspacePreferences,
  serializeWorkspaceProjectRecord,
  validateWorkspaceJournalDigests,
  workspacePreferenceApplies,
  workspaceProjectRecordMatchesKey,
  WORKSPACE_JOURNAL_MAX_CODE_UNITS,
  WORKSPACE_PROJECT_RECORD_LIMIT,
  WORKSPACE_RECORD_GROWTH_BLOCK,
  WORKSPACE_RECORD_WARNING,
  WORKSPACE_TOMBSTONE_WARNING,
} from "@/lib/workspace-storage/protocol";
import {
  CANONICAL_WORKSPACE_RESERVE,
  parseWorkspaceReserve,
  WORKSPACE_RESERVE_CODE_UNITS,
  WORKSPACE_RESERVE_PADDING_CODE_UNITS,
} from "@/lib/workspace-storage/reserve";
import {
  activeIndex,
  activeProjectRecord,
  canonicalIndexBytes,
  canonicalProjectRecordBytes,
  DIGEST_A,
  DIGEST_B,
  journalFor,
  NULL_LEGACY_FINGERPRINTS,
  PROJECT_A,
  PROJECT_B,
  WS,
  WS_OTHER,
} from "@/lib/workspace-storage/test-fixtures";
import type { ProjectMutationMode, WorkspaceOperationKind } from "@/lib/workspace-storage/types";

describe("workspace protocol identifiers and keys", () => {
  it("accepts only lowercase randomUUID-shaped identifiers", () => {
    expect(isWorkspaceUuid(WS)).toBe(true);
    expect(isWorkspaceUuid(PROJECT_A.toUpperCase())).toBe(false);
    expect(isWorkspaceUuid("11111111-1111-1111-8111-111111111111")).toBe(false);
    expect(generateSecureWorkspaceUuid({ randomUUID: () => WS })).toBe(WS);
    expect(generateSecureWorkspaceUuid({ randomUUID: () => "weak-id" })).toBeNull();
    expect(generateSecureWorkspaceUuid(null)).toBeNull();
  });

  it("fails after eight collisions without a weak fallback", () => {
    let calls = 0;
    const source = { randomUUID: () => (calls += 1, WS) };
    expect(generateCollisionCheckedUuid(() => true, source)).toBeNull();
    expect(calls).toBe(8);
  });

  it("round-trips exact project record keys and rejects lookalikes", () => {
    const key = workspaceProjectRecordKey(WS, 12, PROJECT_A);
    expect(parseWorkspaceProjectRecordKey(key)).toEqual({
      workspaceId: WS,
      workspaceGeneration: 12,
      projectId: PROJECT_A,
    });
    expect(parseWorkspaceProjectRecordKey(`${key}.extra`)).toBeNull();
    expect(parseWorkspaceProjectRecordKey(key.replace(".generation.12.", ".generation.01."))).toBeNull();
  });

  it("recognizes only the exact workspace-owned namespace", () => {
    expect(recognizeWorkspaceOwnedKey(WORKSPACE_INDEX_KEY)).toEqual({ kind: "index" });
    expect(recognizeWorkspaceOwnedKey(WORKSPACE_OPERATION_KEY)).toEqual({ kind: "operation" });
    expect(recognizeWorkspaceOwnedKey(WORKSPACE_RESERVE_KEY)).toEqual({ kind: "reserve" });
    expect(recognizeWorkspaceOwnedKey(WORKSPACE_PREFERENCES_KEY)).toEqual({ kind: "preferences" });
    expect(recognizeWorkspaceOwnedKey(workspaceProjectRecordKey(WS, 1, PROJECT_A))?.kind).toBe("project");
    expect(recognizeWorkspaceOwnedKey("rubrictrail.project.v3")).toBeNull();
    expect(recognizeWorkspaceOwnedKey("rubrictrail.workspace.future.v2")).toBeNull();
  });
});

describe("workspace index and project schemas", () => {
  it("serializes active empty and cleared workspaces distinctly", () => {
    expect(serializeWorkspaceIndex(activeIndex({ projects: [] })).ok).toBe(true);
    expect(serializeWorkspaceIndex(activeIndex({ status: "cleared", projects: [] })).ok).toBe(true);
    expect(serializeWorkspaceIndex(activeIndex({
      status: "cleared",
      projects: [],
      legacyFingerprints: { ...NULL_LEGACY_FINGERPRINTS, record: DIGEST_A },
    })).ok).toBe(false);
  });

  it("accepts active current-generation tombstones", () => {
    expect(serializeWorkspaceIndex(activeIndex({ projects: [{ projectId: PROJECT_A, kind: "tombstone" }] }))).toMatchObject({
      ok: true,
      value: { status: "active", projects: [{ projectId: PROJECT_A, kind: "tombstone" }] },
    });
  });

  it("sorts caller entries but rejects unsorted or duplicate stored entries", () => {
    const canonical = serializeWorkspaceIndex(activeIndex({
      projects: [{ projectId: PROJECT_B, kind: "tombstone" }, { projectId: PROJECT_A, kind: "active" }],
    }));
    expect(canonical.ok && canonical.value.projects.map((entry) => entry.projectId)).toEqual([PROJECT_A, PROJECT_B]);
    expect(parseWorkspaceIndex(JSON.stringify({ ...activeIndex(), projects: [
      { projectId: PROJECT_B, kind: "active" }, { projectId: PROJECT_A, kind: "active" },
    ] })).ok).toBe(false);
    expect(parseWorkspaceIndex(JSON.stringify({ ...activeIndex(), projects: [
      { projectId: PROJECT_A, kind: "active" }, { projectId: PROJECT_A, kind: "tombstone" },
    ] })).ok).toBe(false);
  });

  it("rejects extra fields, unsafe integers, unsupported versions, and the 101st entry", () => {
    expect(parseWorkspaceIndex(JSON.stringify({ ...activeIndex(), extra: true })).ok).toBe(false);
    expect(serializeWorkspaceIndex({ ...activeIndex(), extra: true }).ok).toBe(false);
    expect(serializeWorkspaceIndex(activeIndex({ revision: Number.MAX_SAFE_INTEGER + 1 })).ok).toBe(false);
    expect(parseWorkspaceIndex(JSON.stringify({ ...activeIndex(), formatVersion: 2 }))).toMatchObject({ ok: false, reason: "unsupported-version" });
    const entries = Array.from({ length: 101 }, (_, index) => ({
      projectId: `${index.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`, kind: "active" as const,
    }));
    expect(serializeWorkspaceIndex(activeIndex({ projects: entries.slice(0, 100) })).ok).toBe(true);
    expect(serializeWorkspaceIndex(activeIndex({ projects: entries })).ok).toBe(false);
  });

  it("exposes the accepted 64/80/96/100 product policy without claiming quota", () => {
    expect({
      tombstoneWarning: WORKSPACE_TOMBSTONE_WARNING,
      recordWarning: WORKSPACE_RECORD_WARNING,
      growthBlock: WORKSPACE_RECORD_GROWTH_BLOCK,
      hardLimit: WORKSPACE_PROJECT_RECORD_LIMIT,
    }).toEqual({ tombstoneWarning: 64, recordWarning: 80, growthBlock: 96, hardLimit: 100 });
  });

  it("uses exact canonical field order for a cleared index", () => {
    const serialized = serializeWorkspaceIndex(activeIndex({ status: "cleared", projects: [] }));
    expect(serialized.ok && serialized.serialized).toBe(`{"formatVersion":1,"workspaceId":"${WS}","workspaceGeneration":1,"revision":1,"status":"cleared","projects":[],"legacyFingerprints":{"record":null,"v3":null,"v2":null,"v1":null}}`);
  });

  it("round-trips strict project and content-free tombstone records", () => {
    const project = serializeWorkspaceProjectRecord(activeProjectRecord());
    expect(project.ok && parseWorkspaceProjectRecord(project.serialized)).toEqual(project);
    const tombstone = serializeWorkspaceProjectRecord(activeProjectRecord(PROJECT_A, { revision: 2, value: { kind: "tombstone" } }));
    expect(tombstone.ok && tombstone.serialized).not.toContain("draftText");
    expect(tombstone.ok && parseWorkspaceProjectRecord(tombstone.serialized).ok).toBe(true);
  });

  it("rejects extra fields, recovered v2 state, and key/envelope mismatch", () => {
    const record = activeProjectRecord();
    const serialized = serializeWorkspaceProjectRecord(record);
    if (!serialized.ok) throw new Error("fixture record invalid");
    const extra = JSON.parse(serialized.serialized) as Record<string, unknown>;
    extra.extra = true;
    expect(parseWorkspaceProjectRecord(JSON.stringify(extra)).ok).toBe(false);
    expect(serializeWorkspaceProjectRecord({ ...record, extra: true }).ok).toBe(false);
    const v2 = JSON.parse(serialized.serialized) as { value: { kind: "project"; state: Record<string, unknown> } };
    v2.value.state.version = 2;
    delete v2.value.state.supersededV2Fingerprint;
    expect(parseWorkspaceProjectRecord(JSON.stringify(v2)).ok).toBe(false);
    expect(workspaceProjectRecordMatchesKey(workspaceProjectRecordKey(WS_OTHER, 1, PROJECT_A), record)).toBe(false);
  });
});

describe("workspace preferences, reserve, digest, and journal", () => {
  it("keeps preferences non-authoritative and rejects stale or dangling selections", () => {
    const preference = serializeWorkspacePreferences({ formatVersion: 1, workspaceId: WS, workspaceGeneration: 1, lastOpenedProjectId: PROJECT_A });
    expect(preference.ok && parseWorkspacePreferences(preference.serialized)).toEqual(preference);
    if (!preference.ok) throw new Error("preference fixture invalid");
    expect(workspacePreferenceApplies(preference.value, activeIndex())).toBe(true);
    expect(workspacePreferenceApplies({ ...preference.value, workspaceGeneration: 2 }, activeIndex())).toBe(false);
    expect(workspacePreferenceApplies({ ...preference.value, lastOpenedProjectId: PROJECT_B }, activeIndex())).toBe(false);
  });

  it("rejects malformed and extra preference fields while accepting a null selection", () => {
    expect(serializeWorkspacePreferences({ formatVersion: 1, workspaceId: WS, workspaceGeneration: 1, lastOpenedProjectId: null }).ok).toBe(true);
    expect(parseWorkspacePreferences(JSON.stringify({ formatVersion: 1, workspaceId: WS, workspaceGeneration: 1, lastOpenedProjectId: null, authoritative: true })).ok).toBe(false);
    expect(serializeWorkspacePreferences({ formatVersion: 1, workspaceId: WS, workspaceGeneration: 1, lastOpenedProjectId: null, authoritative: true }).ok).toBe(false);
  });

  it("creates the exact data-free 262,144-code-unit reserve", () => {
    expect(CANONICAL_WORKSPACE_RESERVE.length).toBe(WORKSPACE_RESERVE_CODE_UNITS);
    expect(parseWorkspaceReserve(CANONICAL_WORKSPACE_RESERVE)?.padding).toHaveLength(WORKSPACE_RESERVE_PADDING_CODE_UNITS);
    expect(parseWorkspaceReserve(CANONICAL_WORKSPACE_RESERVE.slice(0, -1))).toBeNull();
    expect(parseWorkspaceReserve(CANONICAL_WORKSPACE_RESERVE.replace(/0/, "1"))).toBeNull();
  });

  it("computes exact SHA-256 fixtures over UTF-8 and fails closed without subtle crypto", async () => {
    await expect(sha256StoredString("abc")).resolves.toEqual({ ok: true, digest: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" });
    await expect(sha256StoredString("你好")).resolves.toEqual({ ok: true, digest: "670d9743542cae3ea7ebe36af56bd53648b0a1126162e78d81a32934a711302e" });
    await expect(sha256StoredString("abc", {})).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("changes the digest for one changed byte and reserves null for an absent key", async () => {
    const first = await sha256StoredString("fictional-state-A");
    const second = await sha256StoredString("fictional-state-B");
    expect(first.ok && second.ok && first.digest).not.toBe(second.ok && second.digest);
    expect(first.ok && first.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts every operation kind and every mutation mode with canonical arrays", async () => {
    const kinds: WorkspaceOperationKind[] = ["migrate-single-project", "create-project", "delete-project", "restore-as-new", "replace-project", "legacy-cleanup", "recover-index", "delete-workspace", "rotate-workspace-generation"];
    const modes = new Set<ProjectMutationMode>();
    for (const kind of kinds) {
      const journal = await journalFor(kind);
      journal.projectMutations.forEach((mutation) => modes.add(mutation.mode));
      const serialized = serializeWorkspaceJournal(journal);
      expect(serialized.ok, kind).toBe(true);
      if (!serialized.ok) continue;
      expect(parseWorkspaceJournal(serialized.serialized).ok, kind).toBe(true);
      await expect(validateWorkspaceJournalDigests(serialized.value)).resolves.toEqual({ ok: true });
    }
    expect([...modes].sort()).toEqual(["create", "delete", "replace", "rewrite-generation"]);
  });

  it("accepts every advisory phase without changing journal authority semantics", async () => {
    for (const phase of ["prepared", "records-writing", "records-written", "index-committed", "cleanup-pending"] as const) {
      expect(serializeWorkspaceJournal(await journalFor("create-project", phase)).ok, phase).toBe(true);
    }
  });

  it("sorts caller journal arrays but rejects non-canonical stored ordering", async () => {
    const journal = await journalFor("delete-workspace");
    journal.legacyExpectedDigests.v3 = DIGEST_B;
    journal.cleanup = [
      ...journal.cleanup,
      { key: LEGACY_PROJECT_KEYS.v3, expectedDigest: DIGEST_B },
    ];
    const canonical = serializeWorkspaceJournal(journal);
    expect(canonical.ok).toBe(true);
    if (!canonical.ok) return;
    expect(canonical.value.cleanup.map((entry) => entry.key)).toEqual([
      LEGACY_PROJECT_KEYS.record,
      LEGACY_PROJECT_KEYS.v3,
      workspaceProjectRecordKey(WS, 1, PROJECT_A),
    ]);
    expect(parseWorkspaceJournal(JSON.stringify({ ...canonical.value, cleanup: [...canonical.value.cleanup].reverse() })).ok).toBe(false);
  });

  it("keeps project payloads out of every journal kind", async () => {
    for (const kind of ["migrate-single-project", "create-project", "delete-project", "restore-as-new", "replace-project", "legacy-cleanup", "recover-index", "delete-workspace", "rotate-workspace-generation"] as const) {
      const serialized = serializeWorkspaceJournal(await journalFor(kind));
      expect(serialized.ok, kind).toBe(true);
      if (serialized.ok) expect(serialized.serialized, kind).not.toMatch(/(?:draftText|uploadedProject|course|title|excerpt|student)/u);
    }
  });

  it("strictly limits data-free legacy-resolution markers to matching operations", async () => {
    const marker = {
      confirmationToken: DIGEST_B,
      candidateSource: "record" as const,
    };
    const restore = await journalFor("restore-as-new");
    const markedTarget = await canonicalIndexBytes(
      activeIndex({
        revision: 2,
        projects: [
          { projectId: PROJECT_A, kind: "active" },
          { projectId: PROJECT_B, kind: "active" },
        ],
        legacyFingerprints: {
          ...NULL_LEGACY_FINGERPRINTS,
          record: DIGEST_A,
        },
      }),
    );
    const marked = serializeWorkspaceJournal({
      ...restore,
      targetIndex: {
        key: WORKSPACE_INDEX_KEY,
        serializedValue: markedTarget.serialized,
        targetDigest: markedTarget.digest,
      },
      legacyExpectedDigests: {
        ...NULL_LEGACY_FINGERPRINTS,
        record: DIGEST_A,
      },
      legacyResolution: marker,
    });
    expect(marked.ok).toBe(true);
    if (marked.ok) {
      expect(marked.serialized).toContain('"candidateSource":"record"');
      expect(marked.serialized).not.toMatch(/draftText|projectState|student/u);
    }
    const create = await journalFor("create-project");
    expect(serializeWorkspaceJournal({ ...create, legacyResolution: marker }).ok).toBe(
      false,
    );
    expect(
      serializeWorkspaceJournal({
        ...restore,
        targetIndex: {
          key: WORKSPACE_INDEX_KEY,
          serializedValue: markedTarget.serialized,
          targetDigest: markedTarget.digest,
        },
        legacyExpectedDigests: {
          ...NULL_LEGACY_FINGERPRINTS,
          record: DIGEST_A,
        },
        legacyResolution: { ...marker, candidateSource: null },
      }).ok,
    ).toBe(false);
    expect(
      serializeWorkspaceJournal({
        ...restore,
        targetIndex: {
          key: WORKSPACE_INDEX_KEY,
          serializedValue: markedTarget.serialized,
          targetDigest: markedTarget.digest,
        },
        legacyExpectedDigests: {
          ...NULL_LEGACY_FINGERPRINTS,
          record: DIGEST_A,
        },
        legacyResolution: { ...marker, candidateSource: "v1" },
      }).ok,
    ).toBe(false);
    const cleanup = await journalFor("legacy-cleanup");
    expect(serializeWorkspaceJournal({ ...cleanup, legacyResolution: marker }).ok).toBe(
      false,
    );
    expect(
      serializeWorkspaceJournal({
        ...cleanup,
        legacyResolution: { ...marker, candidateSource: null },
      }).ok,
    ).toBe(true);
    const deletion = await journalFor("delete-workspace");
    const repurgeTarget = await canonicalIndexBytes(
      activeIndex({
        workspaceGeneration: 1,
        revision: 1,
        status: "cleared",
        projects: [],
        legacyFingerprints: NULL_LEGACY_FINGERPRINTS,
      }),
    );
    expect(
      serializeWorkspaceJournal({
        ...deletion,
        sourceGeneration: null,
        targetGeneration: 1,
        targetIndex: {
          key: WORKSPACE_INDEX_KEY,
          serializedValue: repurgeTarget.serialized,
          targetDigest: repurgeTarget.digest,
        },
        legacyResolution: { ...marker, candidateSource: null },
      }).ok,
    ).toBe(true);
    expect(
      serializeWorkspaceJournal({
        ...deletion,
        legacyResolution: { ...marker, candidateSource: null },
      }).ok,
    ).toBe(false);
  });

  it("rejects mutation membership that contradicts the target index", async () => {
    const journal = await journalFor("delete-project");
    const target = serializeWorkspaceIndex(activeIndex({ revision: 2 }));
    if (!target.ok) throw new Error("target fixture invalid");
    const digest = await sha256StoredString(target.serialized);
    if (!digest.ok) throw new Error("digest unavailable");
    expect(serializeWorkspaceJournal({ ...journal, targetIndex: { key: WORKSPACE_INDEX_KEY, serializedValue: target.serialized, targetDigest: digest.digest } }).ok).toBe(false);
  });

  it("rejects a migration whose base index is non-null", async () => {
    const journal = await journalFor("migrate-single-project");
    expect(serializeWorkspaceJournal({ ...journal, baseIndex: { key: WORKSPACE_INDEX_KEY, expectedDigest: DIGEST_A } }).ok).toBe(false);
  });

  it("rejects a migration without an exact legacy fingerprint", async () => {
    const journal = await journalFor("migrate-single-project");
    const target = serializeWorkspaceIndex(activeIndex({ revision: 1 }));
    if (!target.ok) throw new Error("target fixture invalid");
    const digest = await sha256StoredString(target.serialized);
    if (!digest.ok) throw new Error("digest unavailable");
    expect(serializeWorkspaceJournal({
      ...journal,
      targetIndex: { key: WORKSPACE_INDEX_KEY, serializedValue: target.serialized, targetDigest: digest.digest },
      legacyExpectedDigests: NULL_LEGACY_FINGERPRINTS,
    }).ok).toBe(false);
  });

  it("rejects cleanup outside its operation allowlist, overlap, and mismatched legacy digests", async () => {
    const create = await journalFor("create-project");
    expect(serializeWorkspaceJournal({ ...create, cleanup: [{ key: LEGACY_PROJECT_KEYS.record, expectedDigest: DIGEST_A }] }).ok).toBe(false);
    const legacy = await journalFor("legacy-cleanup");
    expect(serializeWorkspaceJournal({ ...legacy, cleanup: [{ key: LEGACY_PROJECT_KEYS.record, expectedDigest: DIGEST_B }] }).ok).toBe(false);
    const rotate = await journalFor("rotate-workspace-generation");
    const mutation = rotate.projectMutations[0];
    expect(serializeWorkspaceJournal({ ...rotate, cleanup: [{ key: mutation.sourceRecord!.key, expectedDigest: mutation.sourceRecord!.expectedDigest }] }).ok).toBe(false);
  });

  it("allows foreign project cleanup only for explicit whole-workspace deletion", async () => {
    const foreignRecord = await canonicalProjectRecordBytes(activeProjectRecord(PROJECT_B, {
      workspaceId: WS_OTHER,
    }));
    const foreignKey = workspaceProjectRecordKey(WS_OTHER, 1, PROJECT_B);
    const deletion = await journalFor("delete-workspace");
    expect(serializeWorkspaceJournal({
      ...deletion,
      cleanup: [
        ...deletion.cleanup,
        { key: foreignKey, expectedDigest: foreignRecord.digest },
      ],
    }).ok).toBe(true);

    for (const kind of [
      "migrate-single-project",
      "create-project",
      "delete-project",
      "restore-as-new",
      "replace-project",
      "legacy-cleanup",
      "recover-index",
      "rotate-workspace-generation",
    ] as const) {
      const journal = await journalFor(kind);
      expect(serializeWorkspaceJournal({
        ...journal,
        cleanup: [...journal.cleanup, { key: foreignKey, expectedDigest: foreignRecord.digest }],
      }).ok, kind).toBe(false);
    }
  });

  it("rejects generation operations with a target tombstone or incomplete mutation bijection", async () => {
    const rotate = await journalFor("rotate-workspace-generation");
    const tombstoneTarget = serializeWorkspaceIndex(activeIndex({ workspaceGeneration: 2, revision: 2, projects: [{ projectId: PROJECT_A, kind: "tombstone" }] }));
    if (!tombstoneTarget.ok) throw new Error("target fixture invalid");
    const tombstoneDigest = await sha256StoredString(tombstoneTarget.serialized);
    if (!tombstoneDigest.ok) throw new Error("digest unavailable");
    expect(serializeWorkspaceJournal({ ...rotate, targetIndex: { key: WORKSPACE_INDEX_KEY, serializedValue: tombstoneTarget.serialized, targetDigest: tombstoneDigest.digest } }).ok).toBe(false);
    const recover = await journalFor("recover-index");
    expect(serializeWorkspaceJournal({ ...recover, projectMutations: [] }).ok).toBe(false);

    const emptyRecoveredIndex = await canonicalIndexBytes(
      activeIndex({ workspaceGeneration: 2, revision: 2, projects: [] }),
    );
    expect(serializeWorkspaceJournal({
      ...recover,
      targetIndex: {
        key: WORKSPACE_INDEX_KEY,
        serializedValue: emptyRecoveredIndex.serialized,
        targetDigest: emptyRecoveredIndex.digest,
      },
      projectMutations: [],
      cleanup: [],
    }).ok).toBe(false);
  });

  it("rejects extra fields, wrong target digest, malformed cleanup, and oversized bytes", async () => {
    const journal = await journalFor("create-project");
    const serialized = serializeWorkspaceJournal(journal);
    if (!serialized.ok) throw new Error("journal fixture invalid");
    const extra = JSON.parse(serialized.serialized) as Record<string, unknown>;
    extra.projectState = { fictional: true };
    expect(parseWorkspaceJournal(JSON.stringify(extra)).ok).toBe(false);
    expect(serializeWorkspaceJournal({ ...journal, projectState: { fictional: true } }).ok).toBe(false);
    await expect(validateWorkspaceJournalDigests({ ...journal, targetIndex: { ...journal.targetIndex, targetDigest: DIGEST_A } })).resolves.toEqual({ ok: false, reason: "invalid" });
    expect(serializeWorkspaceJournal({ ...journal, cleanup: [{ key: "rubrictrail.unowned", expectedDigest: DIGEST_A }] }).ok).toBe(false);
    expect(parseWorkspaceJournal("x".repeat(WORKSPACE_JOURNAL_MAX_CODE_UNITS + 1))).toEqual({ ok: false, reason: "too-large" });
  });

  it("rejects a legacy-cleanup target with ambiguous fingerprints", async () => {
    const journal = await journalFor("legacy-cleanup");
    const target = serializeWorkspaceIndex(activeIndex({ revision: 2, legacyFingerprints: { ...NULL_LEGACY_FINGERPRINTS, record: DIGEST_A } }));
    if (!target.ok) throw new Error("target fixture invalid");
    const digest = await sha256StoredString(target.serialized);
    if (!digest.ok) throw new Error("digest unavailable");
    expect(serializeWorkspaceJournal({ ...journal, targetIndex: { key: WORKSPACE_INDEX_KEY, serializedValue: target.serialized, targetDigest: digest.digest } }).ok).toBe(false);
  });
});
