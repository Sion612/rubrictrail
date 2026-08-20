import { describe, expect, it } from "vitest";

import {
  createDefaultProjectState,
  parseProjectStorageRecordValue,
} from "@/lib/local-state";
import {
  captureWorkspaceSelectedProjectIntent,
  resumeWorkspaceProductionLifecycle,
  type WorkspacePendingSaveFreezeController,
} from "@/lib/workspace-storage/production-lifecycle-orchestrator";
import {
  inspectWorkspaceLegacyDrift,
  isClearedWorkspaceLegacyRepurgeJournal,
  resumeClearedWorkspaceLegacyRepurge,
  resolveWorkspaceLegacyDrift,
} from "@/lib/workspace-storage/production-legacy-drift";
import {
  inspectWorkspaceRecoveryPrivacyPurge,
  purgeWorkspaceRecoveryData,
} from "@/lib/workspace-storage/lifecycle";
import {
  LEGACY_PROJECT_KEYS,
  WORKSPACE_INDEX_KEY,
  WORKSPACE_OPERATION_KEY,
  WORKSPACE_RESERVE_KEY,
  parseWorkspaceProjectRecordKey,
  workspaceProjectRecordKey,
} from "@/lib/workspace-storage/keys";
import {
  parseWorkspaceIndex,
  parseWorkspaceJournal,
  parseWorkspaceProjectRecord,
} from "@/lib/workspace-storage/protocol";
import { CANONICAL_WORKSPACE_RESERVE } from "@/lib/workspace-storage/reserve";
import { MemoryWorkspaceStorageAdapter } from "@/lib/workspace-storage/storage-adapter";
import {
  OPERATION,
  PROJECT_A,
  PROJECT_B,
  WS,
  activeIndex,
  activeProjectRecord,
  canonicalIndexBytes,
  canonicalProjectRecordBytes,
} from "@/lib/workspace-storage/test-fixtures";
import { sha256StoredString } from "@/lib/workspace-storage/digest";
import { bootstrapWorkspaceRuntime } from "@/lib/workspace-storage/runtime-controller";
import type {
  WorkspaceAuthoritySnapshot,
  WorkspaceExclusiveLockRunner,
} from "@/lib/workspace-storage/coordinator";

function projectState(draftText: string) {
  return {
    ...createDefaultProjectState(),
    projectKind: "sample" as const,
    draftText,
  };
}

function legacyRecord(draftText: string, revision: number): string {
  return JSON.stringify({
    formatVersion: 1,
    revision,
    value: { kind: "project", state: projectState(draftText) },
    legacyFingerprints: { v3: null, v2: null, v1: null },
  });
}

interface DriftFixture {
  storage: MemoryWorkspaceStorageAdapter;
  snapshotBeforeDriftAcceptance: WorkspaceAuthoritySnapshot;
  oldLegacyRaw: string;
  currentLegacyRaw: string;
  projectKey: string;
}

interface ClearedDriftFixture {
  storage: MemoryWorkspaceStorageAdapter;
  indexRaw: string;
  legacyRaw: string;
  staleProjectKey: string;
}

async function driftFixture(
  storageFactory: (
    initial: Readonly<Record<string, string>>,
  ) => MemoryWorkspaceStorageAdapter = (initial) =>
    new MemoryWorkspaceStorageAdapter(initial),
): Promise<DriftFixture> {
  const oldLegacyRaw = legacyRecord("old tab baseline", 1);
  const currentLegacyRaw = legacyRecord("new content from old tab", 2);
  const oldDigest = await sha256StoredString(oldLegacyRaw);
  if (!oldDigest.ok) throw new Error("legacy digest unavailable");
  const index = await canonicalIndexBytes(
    activeIndex({
      legacyFingerprints: {
        record: oldDigest.digest,
        v3: null,
        v2: null,
        v1: null,
      },
    }),
  );
  const project = await canonicalProjectRecordBytes(activeProjectRecord());
  const projectKey = workspaceProjectRecordKey(WS, 1, PROJECT_A);
  const storage = storageFactory({
    [WORKSPACE_INDEX_KEY]: index.serialized,
    [projectKey]: project.serialized,
    [LEGACY_PROJECT_KEYS.record]: currentLegacyRaw,
    [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
  });
  return {
    storage,
    oldLegacyRaw,
    currentLegacyRaw,
    projectKey,
    snapshotBeforeDriftAcceptance: {
      index: index.value,
      indexRaw: index.serialized,
      indexDigest: index.digest,
      projects: [
        {
          key: projectKey,
          raw: project.serialized,
          digest: project.digest,
          record: project.value,
        },
      ],
    },
  };
}

async function clearedDriftFixture(
  storageFactory: (
    initial: Readonly<Record<string, string>>,
  ) => MemoryWorkspaceStorageAdapter = (initial) =>
    new MemoryWorkspaceStorageAdapter(initial),
): Promise<ClearedDriftFixture> {
  const index = await canonicalIndexBytes(
    activeIndex({
      workspaceGeneration: 4,
      revision: 9,
      status: "cleared",
      projects: [],
      legacyFingerprints: { record: null, v3: null, v2: null, v1: null },
    }),
  );
  const legacyRaw = legacyRecord("old tab rewrite after privacy deletion", 7);
  const staleProject = await canonicalProjectRecordBytes(
    activeProjectRecord(PROJECT_B, {
      workspaceGeneration: 3,
      value: { kind: "project", state: projectState("stale owned record") },
    }),
  );
  const staleProjectKey = workspaceProjectRecordKey(WS, 3, PROJECT_B);
  return {
    storage: storageFactory({
      [WORKSPACE_INDEX_KEY]: index.serialized,
      [staleProjectKey]: staleProject.serialized,
      [LEGACY_PROJECT_KEYS.record]: legacyRaw,
      [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
      "rubrictrail.unrelated.theme": "dark",
    }),
    indexRaw: index.serialized,
    legacyRaw,
    staleProjectKey,
  };
}

function freezeController(): {
  controller: WorkspacePendingSaveFreezeController;
  releases(): number;
} {
  let held = true;
  let releases = 0;
  return {
    controller: {
      tryFreeze: () => ({
        isHeld: () => held,
        pendingSavesDrained: () => true,
        release: () => {
          held = false;
          releases += 1;
        },
        adoptSnapshot: () => {
          held = false;
          releases += 1;
          return true;
        },
        cancel: () => {
          held = false;
          releases += 1;
          return true;
        },
      }),
    },
    releases: () => releases,
  };
}

const locks: WorkspaceExclusiveLockRunner = {
  runExclusive: async (_name, operation) => operation(),
};

function uuidSource(values: readonly string[]) {
  let index = 0;
  return {
    randomUUID: () => values[index++] ?? "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  };
}

async function requiredInspection(storage: MemoryWorkspaceStorageAdapter) {
  const inspection = await inspectWorkspaceLegacyDrift(storage);
  if (!inspection.ok) throw new Error(`fixture inspection failed: ${inspection.reason}`);
  return inspection;
}

describe("inspectWorkspaceLegacyDrift", () => {
  it("binds a parsed old-tab candidate to an exact confirmation token", async () => {
    const fixture = await driftFixture();

    const first = await requiredInspection(fixture.storage);
    const second = await requiredInspection(fixture.storage);

    expect(first.confirmationToken).toMatch(/^[0-9a-f]{64}$/);
    expect(second.confirmationToken).toBe(first.confirmationToken);
    expect(first.changedSources).toEqual(["record"]);
    expect(first.candidates).toHaveLength(1);
    expect(first.candidates[0]).toMatchObject({
      source: "record",
      candidateId: `record:${await (async () => {
        const digest = await sha256StoredString(fixture.currentLegacyRaw);
        if (!digest.ok) throw new Error("digest unavailable");
        return digest.digest;
      })()}`,
    });
    expect(first.candidates[0]?.state.draftText).toBe("new content from old tab");
  });

  it("does not invent a project candidate for invalid changed bytes", async () => {
    const fixture = await driftFixture();
    fixture.storage.setItem(LEGACY_PROJECT_KEYS.record, "not-json");

    const inspection = await requiredInspection(fixture.storage);

    expect(inspection.changedSources).toEqual(["record"]);
    expect(inspection.candidates).toEqual([]);
  });

  it("fails closed when a journal or invalid referenced record exists", async () => {
    const fixture = await driftFixture();
    fixture.storage.setItem(WORKSPACE_OPERATION_KEY, "not-a-journal");
    await expect(inspectWorkspaceLegacyDrift(fixture.storage)).resolves.toEqual({
      ok: false,
      reason: "recovery-required",
    });

    fixture.storage.removeItem(WORKSPACE_OPERATION_KEY);
    fixture.storage.setItem(fixture.projectKey, "invalid-project");
    await expect(inspectWorkspaceLegacyDrift(fixture.storage)).resolves.toEqual({
      ok: false,
      reason: "invalid-authority",
    });
  });
});

describe("resolveWorkspaceLegacyDrift", () => {
  it("accepts only the exact current fingerprints with one index CAS", async () => {
    const fixture = await driftFixture();
    const inspection = await requiredInspection(fixture.storage);
    const projectBefore = fixture.storage.getItem(fixture.projectKey);
    const freeze = freezeController();

    const result = await resolveWorkspaceLegacyDrift(
      { storage: fixture.storage, locks, pendingSaves: freeze.controller },
      {
        confirmationToken: inspection.confirmationToken,
        action: { kind: "accept-current-baseline" },
        confirmationStillCurrent: () => true,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      action: "accept-current-baseline",
      baselineAccepted: true,
    });
    const indexRaw = fixture.storage.getItem(WORKSPACE_INDEX_KEY);
    const index = indexRaw === null ? null : parseWorkspaceIndex(indexRaw);
    const currentDigest = await sha256StoredString(fixture.currentLegacyRaw);
    expect(index && index.ok && index.value.revision).toBe(2);
    expect(index && index.ok && index.value.legacyFingerprints.record).toBe(
      currentDigest.ok ? currentDigest.digest : "unavailable",
    );
    expect(fixture.storage.getItem(fixture.projectKey)).toBe(projectBefore);
    expect(fixture.storage.getItem(LEGACY_PROJECT_KEYS.record)).toBe(
      fixture.currentLegacyRaw,
    );
    expect(freeze.releases()).toBe(1);
  });

  it("rejects a stale confirmation without changing index or project bytes", async () => {
    const fixture = await driftFixture();
    const inspection = await requiredInspection(fixture.storage);
    const indexBefore = fixture.storage.getItem(WORKSPACE_INDEX_KEY);
    const projectBefore = fixture.storage.getItem(fixture.projectKey);
    fixture.storage.setItem(
      LEGACY_PROJECT_KEYS.record,
      legacyRecord("third value", 3),
    );

    const result = await resolveWorkspaceLegacyDrift(
      {
        storage: fixture.storage,
        locks,
        pendingSaves: freezeController().controller,
      },
      {
        confirmationToken: inspection.confirmationToken,
        action: { kind: "accept-current-baseline" },
        confirmationStillCurrent: () => true,
      },
    );

    expect(result).toEqual({
      ok: false,
      reason: "intent-stale",
      baselineAccepted: false,
      pendingFreezeRetained: false,
    });
    expect(fixture.storage.getItem(WORKSPACE_INDEX_KEY)).toBe(indexBefore);
    expect(fixture.storage.getItem(fixture.projectKey)).toBe(projectBefore);
  });

  it("permits the non-growing fingerprint CAS without a reserve and reports degraded", async () => {
    const fixture = await driftFixture();
    fixture.storage.removeItem(WORKSPACE_RESERVE_KEY);
    const inspection = await requiredInspection(fixture.storage);

    const result = await resolveWorkspaceLegacyDrift(
      {
        storage: fixture.storage,
        locks,
        pendingSaves: freezeController().controller,
      },
      {
        confirmationToken: inspection.confirmationToken,
        action: { kind: "accept-current-baseline" },
        confirmationStillCurrent: () => true,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      baselineAccepted: true,
      storageProtection: "degraded",
    });
  });

  it("imports a confirmed candidate as a new project through one compound journal", async () => {
    const fixture = await driftFixture();
    const inspection = await requiredInspection(fixture.storage);
    const candidate = inspection.candidates[0];
    if (!candidate) throw new Error("fixture candidate missing");
    const projectBefore = fixture.storage.getItem(fixture.projectKey);

    const result = await resolveWorkspaceLegacyDrift(
      {
        storage: fixture.storage,
        locks,
        pendingSaves: freezeController().controller,
      },
      {
        confirmationToken: inspection.confirmationToken,
        action: { kind: "import-as-new", candidateId: candidate.candidateId },
        confirmationStillCurrent: () => true,
        uuidSource: uuidSource([PROJECT_B, OPERATION]),
      },
    );

    expect(result).toMatchObject({
      ok: true,
      action: "import-as-new",
      baselineAccepted: true,
      projectId: PROJECT_B,
    });
    expect(fixture.storage.getItem(fixture.projectKey)).toBe(projectBefore);
    const importedRaw = fixture.storage.getItem(
      workspaceProjectRecordKey(WS, 1, PROJECT_B),
    );
    const imported = importedRaw === null ? null : parseWorkspaceProjectRecord(importedRaw);
    expect(
      imported &&
        imported.ok &&
        imported.value.value.kind === "project" &&
        imported.value.value.state.draftText,
    ).toBe("new content from old tab");
    const indexRaw = fixture.storage.getItem(WORKSPACE_INDEX_KEY);
    const index = indexRaw === null ? null : parseWorkspaceIndex(indexRaw);
    expect(index && index.ok && index.value.projects).toEqual([
      { projectId: PROJECT_A, kind: "active" },
      { projectId: PROJECT_B, kind: "active" },
    ]);
  });

  it("recovers a journal-only legacy import without storing project content in the journal", async () => {
    const fixture = await driftFixture();
    const inspection = await requiredInspection(fixture.storage);
    const candidate = inspection.candidates[0];
    if (!candidate) throw new Error("fixture candidate missing");
    fixture.storage.faults.armAtCheckpoint("project-target-write", "crash");

    const interrupted = await resolveWorkspaceLegacyDrift(
      {
        storage: fixture.storage,
        locks,
        pendingSaves: freezeController().controller,
      },
      {
        confirmationToken: inspection.confirmationToken,
        action: { kind: "import-as-new", candidateId: candidate.candidateId },
        confirmationStillCurrent: () => true,
        uuidSource: uuidSource([PROJECT_B, OPERATION]),
      },
    );

    expect(interrupted).toMatchObject({ ok: false, baselineAccepted: true });
    const journal = fixture.storage.getItem(WORKSPACE_OPERATION_KEY);
    expect(journal).not.toBeNull();
    expect(journal).not.toContain("new content from old tab");
    expect(journal).not.toContain(fixture.currentLegacyRaw);

    fixture.storage.faults.clear();
    const recovered = await bootstrapWorkspaceRuntime(fixture.storage, locks);
    expect(recovered).toMatchObject({
      ok: true,
      origin: "recovered-restore",
    });
    expect(fixture.storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    const importedRaw = fixture.storage.getItem(
      workspaceProjectRecordKey(WS, 1, PROJECT_B),
    );
    const imported = importedRaw
      ? parseWorkspaceProjectRecord(importedRaw)
      : null;
    expect(
      imported?.ok &&
        imported.value.value.kind === "project" &&
        imported.value.value.state.draftText,
    ).toBe("new content from old tab");
  });

  it("replaces only the explicitly captured selected project", async () => {
    const fixture = await driftFixture();
    const inspection = await requiredInspection(fixture.storage);
    const candidate = inspection.candidates[0];
    const selectedIntent = captureWorkspaceSelectedProjectIntent(
      fixture.snapshotBeforeDriftAcceptance,
      "workspace-intent",
      PROJECT_A,
      "project-intent",
    );
    if (!candidate || !selectedIntent) throw new Error("fixture intent missing");

    const result = await resolveWorkspaceLegacyDrift(
      {
        storage: fixture.storage,
        locks,
        pendingSaves: freezeController().controller,
      },
      {
        confirmationToken: inspection.confirmationToken,
        action: {
          kind: "replace-selected",
          candidateId: candidate.candidateId,
          selectedIntent,
          selectedIntentStillCurrent: () => true,
        },
        confirmationStillCurrent: () => true,
        uuidSource: uuidSource([OPERATION]),
      },
    );

    expect(result).toMatchObject({
      ok: true,
      action: "replace-selected",
      baselineAccepted: true,
    });
    const projectRaw = fixture.storage.getItem(fixture.projectKey);
    const project = projectRaw === null ? null : parseWorkspaceProjectRecord(projectRaw);
    expect(project && project.ok && project.value.revision).toBe(2);
    expect(
      project &&
        project.ok &&
        project.value.value.kind === "project" &&
        project.value.value.state.draftText,
    ).toBe("new content from old tab");
    expect(
      fixture.storage
        .keys()
        .filter((key) => parseWorkspaceProjectRecordKey(key) !== null),
    ).toEqual([fixture.projectKey]);
  });

  it("production-resumes a journal-only legacy replacement after a crash", async () => {
    const fixture = await driftFixture();
    const inspection = await requiredInspection(fixture.storage);
    const candidate = inspection.candidates[0];
    const selectedIntent = captureWorkspaceSelectedProjectIntent(
      fixture.snapshotBeforeDriftAcceptance,
      "workspace-intent",
      PROJECT_A,
      "project-intent",
    );
    if (!candidate || !selectedIntent) throw new Error("fixture intent missing");
    fixture.storage.faults.armAtCheckpoint("project-target-write", "crash");

    const interrupted = await resolveWorkspaceLegacyDrift(
      {
        storage: fixture.storage,
        locks,
        pendingSaves: freezeController().controller,
      },
      {
        confirmationToken: inspection.confirmationToken,
        action: {
          kind: "replace-selected",
          candidateId: candidate.candidateId,
          selectedIntent,
          selectedIntentStillCurrent: () => true,
        },
        confirmationStillCurrent: () => true,
        uuidSource: uuidSource([OPERATION]),
      },
    );
    expect(interrupted).toMatchObject({ ok: false, baselineAccepted: true });
    expect(fixture.storage.getItem(WORKSPACE_OPERATION_KEY)).not.toBeNull();

    fixture.storage.faults.clear();
    const resumed = await resumeWorkspaceProductionLifecycle({
      storage: fixture.storage,
      locks,
      pendingSaves: freezeController().controller,
    });
    expect(resumed).toMatchObject({
      ok: true,
      kind: "replace-selected",
      pendingState: "synchronized",
    });
    expect(fixture.storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    const projectRaw = fixture.storage.getItem(fixture.projectKey);
    const project = projectRaw ? parseWorkspaceProjectRecord(projectRaw) : null;
    expect(
      project?.ok &&
        project.value.value.kind === "project" &&
        project.value.value.state.draftText,
    ).toBe("new content from old tab");
  });

  it("rejects a stale selected intent before accepting the drift baseline", async () => {
    const fixture = await driftFixture();
    const inspection = await requiredInspection(fixture.storage);
    const candidate = inspection.candidates[0];
    const selectedIntent = captureWorkspaceSelectedProjectIntent(
      fixture.snapshotBeforeDriftAcceptance,
      "workspace-intent",
      PROJECT_A,
      "project-intent",
    );
    if (!candidate || !selectedIntent) throw new Error("fixture intent missing");
    const indexBefore = fixture.storage.getItem(WORKSPACE_INDEX_KEY);

    const result = await resolveWorkspaceLegacyDrift(
      {
        storage: fixture.storage,
        locks,
        pendingSaves: freezeController().controller,
      },
      {
        confirmationToken: inspection.confirmationToken,
        action: {
          kind: "replace-selected",
          candidateId: candidate.candidateId,
          selectedIntent,
          selectedIntentStillCurrent: () => false,
        },
        confirmationStillCurrent: () => true,
      },
    );

    expect(result).toEqual({
      ok: false,
      reason: "intent-stale",
      baselineAccepted: false,
      pendingFreezeRetained: false,
    });
    expect(fixture.storage.getItem(WORKSPACE_INDEX_KEY)).toBe(indexBefore);
  });

  it("privacy-cleans only the exact confirmed legacy values through the journal", async () => {
    const fixture = await driftFixture();
    const inspection = await requiredInspection(fixture.storage);

    const result = await resolveWorkspaceLegacyDrift(
      {
        storage: fixture.storage,
        locks,
        pendingSaves: freezeController().controller,
      },
      {
        confirmationToken: inspection.confirmationToken,
        action: { kind: "privacy-cleanup" },
        confirmationStillCurrent: () => true,
        uuidSource: uuidSource([OPERATION]),
      },
    );

    expect(result).toMatchObject({
      ok: true,
      action: "privacy-cleanup",
      baselineAccepted: true,
    });
    expect(fixture.storage.getItem(LEGACY_PROJECT_KEYS.record)).toBeNull();
    expect(fixture.storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    expect(fixture.storage.getItem(WORKSPACE_RESERVE_KEY)).toBe(
      CANONICAL_WORKSPACE_RESERVE,
    );
    const indexRaw = fixture.storage.getItem(WORKSPACE_INDEX_KEY);
    const index = indexRaw === null ? null : parseWorkspaceIndex(indexRaw);
    expect(index && index.ok && index.value.revision).toBe(2);
    expect(index && index.ok && index.value.legacyFingerprints).toEqual({
      record: null,
      v3: null,
      v2: null,
      v1: null,
    });
  });

  it.each(["import-as-new", "replace-selected", "privacy-cleanup"] as const)(
    "keeps drift visible when %s cannot make its journal durable",
    async (kind) => {
      const fixture = await driftFixture();
      const inspection = await requiredInspection(fixture.storage);
      const candidate = inspection.candidates[0];
      const selectedIntent = captureWorkspaceSelectedProjectIntent(
        fixture.snapshotBeforeDriftAcceptance,
        "workspace-intent",
        PROJECT_A,
        "project-intent",
      );
      if (!candidate || !selectedIntent) throw new Error("fixture intent missing");
      const indexBefore = fixture.storage.getItem(WORKSPACE_INDEX_KEY);
      fixture.storage.faults.armAtCheckpoint(
        `before:setItem:${WORKSPACE_OPERATION_KEY}`,
        "quota",
      );

      const action =
        kind === "import-as-new"
          ? ({ kind, candidateId: candidate.candidateId } as const)
          : kind === "replace-selected"
            ? ({
                kind,
                candidateId: candidate.candidateId,
                selectedIntent,
                selectedIntentStillCurrent: () => true,
              } as const)
            : ({ kind } as const);
      const result = await resolveWorkspaceLegacyDrift(
        {
          storage: fixture.storage,
          locks,
          pendingSaves: freezeController().controller,
        },
        {
          confirmationToken: inspection.confirmationToken,
          action,
          confirmationStillCurrent: () => true,
          uuidSource:
            kind === "import-as-new"
              ? uuidSource([PROJECT_B, OPERATION])
              : uuidSource([OPERATION]),
        },
      );

      expect(result).toMatchObject({ ok: false, baselineAccepted: false });
      fixture.storage.faults.clear();
      expect(fixture.storage.getItem(WORKSPACE_INDEX_KEY)).toBe(indexBefore);
      expect(fixture.storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
      await expect(inspectWorkspaceLegacyDrift(fixture.storage)).resolves.toMatchObject({
        ok: true,
        confirmationToken: inspection.confirmationToken,
      });
    },
  );

  it("keeps an import choice visible when the global lock cannot be acquired", async () => {
    const fixture = await driftFixture();
    const inspection = await requiredInspection(fixture.storage);
    const candidate = inspection.candidates[0];
    if (!candidate) throw new Error("fixture candidate missing");
    const indexBefore = fixture.storage.getItem(WORKSPACE_INDEX_KEY);

    const result = await resolveWorkspaceLegacyDrift(
      {
        storage: fixture.storage,
        locks: {
          runExclusive: async () => {
            throw new Error("lock unavailable");
          },
        },
        pendingSaves: freezeController().controller,
      },
      {
        confirmationToken: inspection.confirmationToken,
        action: { kind: "import-as-new", candidateId: candidate.candidateId },
        confirmationStillCurrent: () => true,
        uuidSource: uuidSource([PROJECT_B, OPERATION]),
      },
    );

    expect(result).toMatchObject({ ok: false, baselineAccepted: false });
    expect(fixture.storage.getItem(WORKSPACE_INDEX_KEY)).toBe(indexBefore);
    expect(fixture.storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    await expect(inspectWorkspaceLegacyDrift(fixture.storage)).resolves.toMatchObject({
      ok: true,
      confirmationToken: inspection.confirmationToken,
    });
  });

  it("retains the compound journal when a third legacy value appears after journaling", async () => {
    const thirdRaw = legacyRecord("third value after journaling", 3);
    class InjectAfterJournalStorage extends MemoryWorkspaceStorageAdapter {
      private injected = false;

      override getItem(key: string): string | null {
        const value = super.getItem(key);
        if (key === WORKSPACE_OPERATION_KEY && value !== null && !this.injected) {
          this.injected = true;
          super.setItem(LEGACY_PROJECT_KEYS.record, thirdRaw);
        }
        return value;
      }
    }
    const fixture = await driftFixture(
      (initial) => new InjectAfterJournalStorage(initial),
    );
    const inspection = await requiredInspection(fixture.storage);
    const indexBefore = fixture.storage.getItem(WORKSPACE_INDEX_KEY);

    const result = await resolveWorkspaceLegacyDrift(
      {
        storage: fixture.storage,
        locks,
        pendingSaves: freezeController().controller,
      },
      {
        confirmationToken: inspection.confirmationToken,
        action: { kind: "privacy-cleanup" },
        confirmationStillCurrent: () => true,
        uuidSource: uuidSource([OPERATION]),
      },
    );

    expect(result).toMatchObject({
      ok: false,
      baselineAccepted: true,
    });
    expect(fixture.storage.getItem(WORKSPACE_INDEX_KEY)).toBe(indexBefore);
    expect(fixture.storage.getItem(LEGACY_PROJECT_KEYS.record)).toBe(thirdRaw);
    expect(fixture.storage.getItem(WORKSPACE_OPERATION_KEY)).not.toBeNull();
    await expect(inspectWorkspaceLegacyDrift(fixture.storage)).resolves.toEqual({
      ok: false,
      reason: "recovery-required",
    });
    expect(fixture.storage.getItem(fixture.projectKey)).toBe(
      fixture.snapshotBeforeDriftAcceptance.projects[0]?.raw,
    );
  });

  it("does not accept drift without Web Locks or a valid candidate selection", async () => {
    const fixture = await driftFixture();
    const inspection = await requiredInspection(fixture.storage);
    const indexBefore = fixture.storage.getItem(WORKSPACE_INDEX_KEY);

    const noLock = await resolveWorkspaceLegacyDrift(
      {
        storage: fixture.storage,
        locks: null,
        pendingSaves: freezeController().controller,
      },
      {
        confirmationToken: inspection.confirmationToken,
        action: { kind: "accept-current-baseline" },
        confirmationStillCurrent: () => true,
      },
    );
    expect(noLock).toEqual({
      ok: false,
      reason: "lock-unavailable",
      baselineAccepted: false,
      pendingFreezeRetained: false,
    });

    const badCandidate = await resolveWorkspaceLegacyDrift(
      {
        storage: fixture.storage,
        locks,
        pendingSaves: freezeController().controller,
      },
      {
        confirmationToken: inspection.confirmationToken,
        action: { kind: "import-as-new", candidateId: "record:missing" },
        confirmationStillCurrent: () => true,
      },
    );
    expect(badCandidate).toEqual({
      ok: false,
      reason: "candidate-unavailable",
      baselineAccepted: false,
      pendingFreezeRetained: false,
    });
    expect(fixture.storage.getItem(WORKSPACE_INDEX_KEY)).toBe(indexBefore);
  });

  it("re-purges an already-cleared workspace after an old v0.7 tab rewrites legacy bytes", async () => {
    const fixture = await clearedDriftFixture();
    const inspection = await requiredInspection(fixture.storage);
    const freeze = freezeController();
    expect(inspection.workspaceStatus).toBe("cleared");

    const result = await resolveWorkspaceLegacyDrift(
      { storage: fixture.storage, locks, pendingSaves: freeze.controller },
      {
        confirmationToken: inspection.confirmationToken,
        action: { kind: "privacy-cleanup" },
        confirmationStillCurrent: () => true,
        uuidSource: uuidSource([OPERATION, PROJECT_A]),
      },
    );

    expect(result).toMatchObject({
      ok: true,
      action: "privacy-cleanup",
      baselineAccepted: true,
      pendingState: "synchronized",
    });
    const indexRaw = fixture.storage.getItem(WORKSPACE_INDEX_KEY);
    const index = indexRaw === null ? null : parseWorkspaceIndex(indexRaw);
    expect(index && index.ok && index.value).toMatchObject({
      workspaceId: PROJECT_A,
      workspaceGeneration: 1,
      revision: 1,
      status: "cleared",
      projects: [],
      legacyFingerprints: { record: null, v3: null, v2: null, v1: null },
    });
    expect(fixture.storage.getItem(LEGACY_PROJECT_KEYS.record)).toBeNull();
    expect(fixture.storage.getItem(fixture.staleProjectKey)).toBeNull();
    expect(fixture.storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    expect(fixture.storage.getItem(WORKSPACE_RESERVE_KEY)).toBe(
      CANONICAL_WORKSPACE_RESERVE,
    );
    expect(fixture.storage.getItem("rubrictrail.unrelated.theme")).toBe("dark");
    expect(freeze.releases()).toBe(1);
  });

  it("never accepts non-null legacy fingerprints into a cleared index", async () => {
    const fixture = await clearedDriftFixture();
    const inspection = await requiredInspection(fixture.storage);
    const freeze = freezeController();

    const result = await resolveWorkspaceLegacyDrift(
      { storage: fixture.storage, locks, pendingSaves: freeze.controller },
      {
        confirmationToken: inspection.confirmationToken,
        action: { kind: "accept-current-baseline" },
        confirmationStillCurrent: () => true,
      },
    );

    expect(result).toEqual({
      ok: false,
      reason: "workspace-not-active",
      baselineAccepted: false,
      pendingFreezeRetained: false,
    });
    expect(fixture.storage.getItem(WORKSPACE_INDEX_KEY)).toBe(fixture.indexRaw);
    expect(fixture.storage.getItem(LEGACY_PROJECT_KEYS.record)).toBe(
      fixture.legacyRaw,
    );
    expect(fixture.storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
  });

  it("rolls forward an exact partial cleared-workspace re-purge after a crash", async () => {
    const fixture = await clearedDriftFixture();
    const inspection = await requiredInspection(fixture.storage);
    const freeze = freezeController();
    fixture.storage.faults.armAtCheckpoint("source-cleanup", "crash");

    const interrupted = await resolveWorkspaceLegacyDrift(
      { storage: fixture.storage, locks, pendingSaves: freeze.controller },
      {
        confirmationToken: inspection.confirmationToken,
        action: { kind: "privacy-cleanup" },
        confirmationStillCurrent: () => true,
        uuidSource: uuidSource([OPERATION, PROJECT_A]),
      },
    );
    expect(interrupted).toMatchObject({ ok: false, reason: "lock-failed" });
    const interruptedJournal = fixture.storage.getItem(WORKSPACE_OPERATION_KEY);
    expect(interruptedJournal).not.toBeNull();
    const parsedInterrupted = interruptedJournal
      ? parseWorkspaceJournal(interruptedJournal)
      : null;
    expect(
      parsedInterrupted?.ok &&
        isClearedWorkspaceLegacyRepurgeJournal(parsedInterrupted.value),
    ).toBe(true);
    if (parsedInterrupted?.ok) {
      expect(
        isClearedWorkspaceLegacyRepurgeJournal({
          ...parsedInterrupted.value,
          sourceGeneration: 1,
        }),
      ).toBe(false);
    }

    fixture.storage.faults.clear();
    const resumed = await resumeWorkspaceProductionLifecycle({
      storage: fixture.storage,
      locks,
      pendingSaves: freezeController().controller,
    });
    expect(resumed.ok ? "ok" : resumed.reason).toBe("ok");
    expect(resumed).toMatchObject({
      ok: true,
      kind: "delete-workspace",
      changed: true,
      storageProtection: "healthy",
    });
    expect(fixture.storage.getItem(LEGACY_PROJECT_KEYS.record)).toBeNull();
    expect(fixture.storage.getItem(fixture.staleProjectKey)).toBeNull();
    expect(fixture.storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
  });

  it("routes a corrupt-index recovery purge with legacy bytes through generic production recovery", async () => {
    const corruptIndex = '{"corrupt":true}';
    const legacyRaw = legacyRecord("fictional recovery cleanup", 3);
    const storage = new MemoryWorkspaceStorageAdapter({
      [WORKSPACE_INDEX_KEY]: corruptIndex,
      [LEGACY_PROJECT_KEYS.record]: legacyRaw,
      [WORKSPACE_RESERVE_KEY]: CANONICAL_WORKSPACE_RESERVE,
    });
    const inspected = await inspectWorkspaceRecoveryPrivacyPurge(storage);
    if (!inspected.ok) throw new Error("Recovery purge preview unavailable");
    storage.faults.armAtCheckpoint("journal-phase-update", "crash");

    const interrupted = await purgeWorkspaceRecoveryData(storage, locks, {
      baseline: inspected.baseline,
      intentStillCurrent: () => true,
      pendingSavesDrained: () => true,
      uuidSource: uuidSource([OPERATION, PROJECT_A]),
    });
    expect(interrupted).toEqual({ ok: false, reason: "lock-failed" });
    expect(storage.getItem(WORKSPACE_INDEX_KEY)).toBe(corruptIndex);
    const rawJournal = storage.getItem(WORKSPACE_OPERATION_KEY);
    expect(rawJournal).not.toBeNull();
    const parsedJournal = rawJournal ? parseWorkspaceJournal(rawJournal) : null;
    expect(parsedJournal?.ok).toBe(true);
    if (parsedJournal?.ok) {
      expect(parsedJournal.value.legacyResolution).toBeUndefined();
      expect(isClearedWorkspaceLegacyRepurgeJournal(parsedJournal.value)).toBe(false);
    }

    storage.faults.clear();
    await expect(bootstrapWorkspaceRuntime(storage, locks)).resolves.toEqual({
      ok: false,
      reason: "recovery-required",
    });
    const resumed = await resumeWorkspaceProductionLifecycle({
      storage,
      locks,
      pendingSaves: freezeController().controller,
    });
    expect(resumed).toMatchObject({
      ok: true,
      kind: "delete-workspace",
      changed: true,
      storageProtection: "healthy",
    });
    expect(storage.getItem(LEGACY_PROJECT_KEYS.record)).toBeNull();
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBeNull();
    const indexRaw = storage.getItem(WORKSPACE_INDEX_KEY);
    const index = indexRaw ? parseWorkspaceIndex(indexRaw) : null;
    expect(index?.ok && index.value.status).toBe("cleared");
    await expect(bootstrapWorkspaceRuntime(storage, locks)).resolves.toMatchObject({
      ok: true,
    });
  });

  it("retains the journal and original cleared index when a third legacy value appears after journaling", async () => {
    const thirdRaw = legacyRecord("third old-tab value", 8);
    class InjectAfterJournalStorage extends MemoryWorkspaceStorageAdapter {
      private injected = false;

      override getItem(key: string): string | null {
        const value = super.getItem(key);
        if (key === WORKSPACE_OPERATION_KEY && value !== null && !this.injected) {
          this.injected = true;
          super.setItem(LEGACY_PROJECT_KEYS.record, thirdRaw);
        }
        return value;
      }
    }
    const fixture = await clearedDriftFixture(
      (initial) => new InjectAfterJournalStorage(initial),
    );
    const inspection = await requiredInspection(fixture.storage);
    const freeze = freezeController();

    const result = await resolveWorkspaceLegacyDrift(
      { storage: fixture.storage, locks, pendingSaves: freeze.controller },
      {
        confirmationToken: inspection.confirmationToken,
        action: { kind: "privacy-cleanup" },
        confirmationStillCurrent: () => true,
        uuidSource: uuidSource([OPERATION, PROJECT_A]),
      },
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "recovery-required",
      baselineAccepted: false,
      pendingFreezeRetained: true,
    });
    expect(fixture.storage.getItem(WORKSPACE_INDEX_KEY)).toBe(fixture.indexRaw);
    expect(fixture.storage.getItem(LEGACY_PROJECT_KEYS.record)).toBe(thirdRaw);
    expect(fixture.storage.getItem(WORKSPACE_OPERATION_KEY)).not.toBeNull();
    await expect(
      resumeClearedWorkspaceLegacyRepurge(fixture.storage, locks),
    ).resolves.toEqual({ ok: false, reason: "recovery-required" });
    expect(fixture.storage.getItem(WORKSPACE_INDEX_KEY)).toBe(fixture.indexRaw);
    expect(fixture.storage.getItem(LEGACY_PROJECT_KEYS.record)).toBe(thirdRaw);
  });

  it("parses the retained old record as fictional project-only test data", async () => {
    const fixture = await driftFixture();
    const parsed = parseProjectStorageRecordValue(fixture.currentLegacyRaw);
    expect(parsed?.state?.draftText).toBe("new content from old tab");
    expect(fixture.oldLegacyRaw).not.toBe(fixture.currentLegacyRaw);
  });
});
