import { beforeEach, describe, expect, it, vi } from "vitest";

const lifecycleMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  deleteProject: vi.fn(),
  cleanupLegacy: vi.fn(),
  deleteWorkspace: vi.fn(),
  purgeRecovery: vi.fn(),
  resume: vi.fn(),
}));
const generationMocks = vi.hoisted(() => ({
  rotate: vi.fn(),
  recover: vi.fn(),
  resume: vi.fn(),
}));

vi.mock("@/lib/workspace-storage/lifecycle", () => ({
  replaceWorkspaceProject: lifecycleMocks.replace,
  deleteWorkspaceProject: lifecycleMocks.deleteProject,
  cleanupWorkspaceLegacyData: lifecycleMocks.cleanupLegacy,
  deleteEntireWorkspace: lifecycleMocks.deleteWorkspace,
  purgeWorkspaceRecoveryData: lifecycleMocks.purgeRecovery,
  resumeWorkspaceLifecycleOperation: lifecycleMocks.resume,
}));

vi.mock("@/lib/workspace-storage/rotation-recovery", () => ({
  rotateWorkspaceGeneration: generationMocks.rotate,
  recoverWorkspaceIndex: generationMocks.recover,
  resumeWorkspaceGenerationOperation: generationMocks.resume,
}));

import { createDefaultProjectState } from "@/lib/local-state";
import {
  captureWorkspaceIndexIntent,
  captureWorkspaceRecoveryPurgeIntent,
  captureWorkspaceRecoverySelectionIntent,
  captureWorkspaceSelectedProjectIntent,
  deriveWorkspaceLegacyDriftChoices,
  executeWorkspaceProductionLifecycleCommand,
  resumeWorkspaceProductionLifecycle,
  type WorkspaceLiveIntentState,
  type WorkspacePendingSaveFreezeLease,
  type WorkspaceProductionLifecycleDependencies,
} from "@/lib/workspace-storage/production-lifecycle-orchestrator";
import { WORKSPACE_OPERATION_KEY } from "@/lib/workspace-storage/keys";
import { serializeWorkspaceJournal } from "@/lib/workspace-storage/protocol";
import { MemoryWorkspaceStorageAdapter } from "@/lib/workspace-storage/storage-adapter";
import {
  PROJECT_A,
  WS,
  activeIndex,
  activeProjectRecord,
  canonicalIndexBytes,
  canonicalProjectRecordBytes,
  journalFor,
} from "@/lib/workspace-storage/test-fixtures";
import type { WorkspaceAuthoritySnapshot } from "@/lib/workspace-storage/coordinator";
import type { WorkspaceIndexRecoverySelection } from "@/lib/workspace-storage/rotation-recovery";

async function authoritySnapshot(): Promise<WorkspaceAuthoritySnapshot> {
  const index = await canonicalIndexBytes(activeIndex());
  const project = await canonicalProjectRecordBytes(activeProjectRecord());
  return {
    index: index.value,
    indexRaw: index.serialized,
    indexDigest: index.digest,
    projects: [
      {
        key: "rubrictrail.workspace.11111111-1111-4111-8111-111111111111.generation.1.project.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.v1",
        raw: project.serialized,
        digest: project.digest,
        record: project.value,
      },
    ],
  };
}

function freezeHarness() {
  let held = true;
  let drained = true;
  let completions = 0;
  const lease: WorkspacePendingSaveFreezeLease = {
    isHeld: () => held,
    pendingSavesDrained: () => drained,
    release: () => {
      completions += 1;
      held = false;
    },
    adoptSnapshot: () => {
      completions += 1;
      held = false;
      return true;
    },
    cancel: () => {
      completions += 1;
      held = false;
      return true;
    },
  };
  return {
    controller: { tryFreeze: () => lease },
    lease,
    setHeld: (value: boolean) => {
      held = value;
    },
    setDrained: (value: boolean) => {
      drained = value;
    },
    releases: () => completions,
  };
}

function successfulLifecycle(snapshot: WorkspaceAuthoritySnapshot) {
  return {
    ok: true as const,
    snapshot,
    storageProtection: "healthy" as const,
    preferenceCleaned: true,
    changed: true,
  };
}

function dependencies(
  storage: MemoryWorkspaceStorageAdapter,
  live: { value: WorkspaceLiveIntentState },
  freeze = freezeHarness(),
): WorkspaceProductionLifecycleDependencies {
  return {
    storage,
    locks: { runExclusive: async (_name, operation) => operation() },
    intents: { read: () => live.value },
    pendingSaves: freeze.controller,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("production lifecycle intent snapshots", () => {
  it("captures frozen exact index and selected-project baselines", async () => {
    const snapshot = await authoritySnapshot();
    const workspace = captureWorkspaceIndexIntent(snapshot, "workspace-1");
    const selected = captureWorkspaceSelectedProjectIntent(
      snapshot,
      "workspace-1",
      PROJECT_A,
      "project-1",
    );

    expect(workspace).not.toBeNull();
    expect(selected).not.toBeNull();
    expect(Object.isFrozen(workspace)).toBe(true);
    expect(Object.isFrozen(workspace?.baseline)).toBe(true);
    expect(Object.isFrozen(selected?.baseline)).toBe(true);
    expect(Object.isFrozen(selected?.baseline.index)).toBe(true);
    expect(selected?.baseline.raw).toBe(snapshot.projects[0]?.raw);
  });

  it("rejects empty tokens and inactive project IDs", async () => {
    const snapshot = await authoritySnapshot();
    expect(captureWorkspaceIndexIntent(snapshot, "")).toBeNull();
    expect(
      captureWorkspaceSelectedProjectIntent(
        snapshot,
        "workspace",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "project",
      ),
    ).toBeNull();
  });
});

describe("executeWorkspaceProductionLifecycleCommand", () => {
  it("passes an exact selected baseline and live guards to replace", async () => {
    const snapshot = await authoritySnapshot();
    const intent = captureWorkspaceSelectedProjectIntent(
      snapshot,
      "workspace-1",
      PROJECT_A,
      "project-1",
    );
    if (!intent) throw new Error("fixture selected intent is missing");
    const live = {
      value: {
        snapshot,
        workspaceIntentToken: "workspace-1",
        selectedProjectId: PROJECT_A,
        selectedProjectIntentToken: "project-1",
        recoveryIntentToken: null,
      },
    };
    const freeze = freezeHarness();
    lifecycleMocks.replace.mockImplementation(
      async (_storage, _locks, request: {
        baseline: typeof intent.baseline;
        intentStillCurrent(): boolean;
        pendingSavesDrained(): boolean;
      }) => {
        expect(request.baseline).toEqual(intent.baseline);
        expect(request.intentStillCurrent()).toBe(true);
        expect(request.pendingSavesDrained()).toBe(true);
        live.value = { ...live.value, selectedProjectIntentToken: "project-2" };
        expect(request.intentStillCurrent()).toBe(false);
        return { ok: false, reason: "intent-stale" };
      },
    );

    const result = await executeWorkspaceProductionLifecycleCommand(
      dependencies(new MemoryWorkspaceStorageAdapter(), live, freeze),
      {
        kind: "replace-selected",
        intent,
        backup: {
          state: { ...createDefaultProjectState(), projectKind: "sample" },
        },
      },
    );

    expect(result).toEqual({
      ok: false,
      reason: "intent-stale",
      pendingFreezeRetained: true,
    });
    expect(freeze.releases()).toBe(0);
  });

  it("rejects a changed selection before invoking a core mutation", async () => {
    const snapshot = await authoritySnapshot();
    const intent = captureWorkspaceSelectedProjectIntent(
      snapshot,
      "workspace-1",
      PROJECT_A,
      "project-1",
    );
    if (!intent) throw new Error("fixture selected intent is missing");
    const live = {
      value: {
        snapshot,
        workspaceIntentToken: "workspace-1",
        selectedProjectId: null,
        selectedProjectIntentToken: null,
        recoveryIntentToken: null,
      },
    };
    const freeze = freezeHarness();

    const result = await executeWorkspaceProductionLifecycleCommand(
      dependencies(new MemoryWorkspaceStorageAdapter(), live, freeze),
      { kind: "delete-selected", intent },
    );

    expect(result).toEqual({
      ok: false,
      reason: "intent-stale",
      pendingFreezeRetained: false,
    });
    expect(lifecycleMocks.deleteProject).not.toHaveBeenCalled();
    expect(freeze.releases()).toBe(1);
  });

  it("rejects an unavailable or undrained freeze without calling core", async () => {
    const snapshot = await authoritySnapshot();
    const intent = captureWorkspaceIndexIntent(snapshot, "workspace-1");
    if (!intent) throw new Error("fixture workspace intent is missing");
    const live = {
      value: {
        snapshot,
        workspaceIntentToken: "workspace-1",
        selectedProjectId: PROJECT_A,
        selectedProjectIntentToken: "project-1",
        recoveryIntentToken: null,
      },
    };
    const unavailable = dependencies(new MemoryWorkspaceStorageAdapter(), live);
    unavailable.pendingSaves = { tryFreeze: () => null };
    expect(
      await executeWorkspaceProductionLifecycleCommand(unavailable, {
        kind: "delete-workspace",
        intent,
      }),
    ).toEqual({
      ok: false,
      reason: "pending-save",
      pendingFreezeRetained: false,
    });

    const freeze = freezeHarness();
    freeze.setDrained(false);
    expect(
      await executeWorkspaceProductionLifecycleCommand(
        dependencies(new MemoryWorkspaceStorageAdapter(), live, freeze),
        { kind: "legacy-cleanup", intent },
      ),
    ).toEqual({
      ok: false,
      reason: "pending-save",
      pendingFreezeRetained: false,
    });
    expect(lifecycleMocks.deleteWorkspace).not.toHaveBeenCalled();
    expect(lifecycleMocks.cleanupLegacy).not.toHaveBeenCalled();
    expect(freeze.releases()).toBe(1);
  });

  it("dispatches every non-selected core operation with a held freeze", async () => {
    const snapshot = await authoritySnapshot();
    const workspaceIntent = captureWorkspaceIndexIntent(snapshot, "workspace-1");
    if (!workspaceIntent) throw new Error("fixture workspace intent is missing");
    const selection: WorkspaceIndexRecoverySelection = {
      workspaceId: WS,
      sourceGeneration: 1,
      observedIndexRaw: null,
      observedIndexDigest: null,
      legacyExpectedDigests: { record: null, v3: null, v2: null, v1: null },
      records: [],
    };
    const recoveryIntent = captureWorkspaceRecoverySelectionIntent(
      selection,
      "recovery-1",
    );
    const purgeIntent = captureWorkspaceRecoveryPurgeIntent(
      {
        indexDigest: null,
        ownedProjectDigests: [],
        legacyDigests: { record: null, v3: null, v2: null, v1: null },
      },
      "recovery-1",
    );
    if (!recoveryIntent || !purgeIntent) throw new Error("fixture recovery intent missing");
    const live = {
      value: {
        snapshot,
        workspaceIntentToken: "workspace-1",
        selectedProjectId: PROJECT_A,
        selectedProjectIntentToken: "project-1",
        recoveryIntentToken: "recovery-1",
      },
    };
    lifecycleMocks.cleanupLegacy.mockResolvedValue(successfulLifecycle(snapshot));
    lifecycleMocks.deleteWorkspace.mockResolvedValue(successfulLifecycle(snapshot));
    lifecycleMocks.purgeRecovery.mockResolvedValue(successfulLifecycle(snapshot));
    generationMocks.rotate.mockResolvedValue({
      ok: true,
      status: "committed",
      kind: "rotate-workspace-generation",
      snapshot,
    });
    generationMocks.recover.mockResolvedValue({
      ok: true,
      status: "committed-degraded",
      kind: "recover-index",
      snapshot,
    });

    const commands = [
      { kind: "legacy-cleanup" as const, intent: workspaceIntent },
      { kind: "delete-workspace" as const, intent: workspaceIntent },
      { kind: "rotate-workspace-generation" as const, intent: workspaceIntent },
      { kind: "recover-index" as const, intent: recoveryIntent },
      { kind: "delete-workspace-recovery" as const, intent: purgeIntent },
    ];
    const results = [];
    for (const command of commands) {
      results.push(
        await executeWorkspaceProductionLifecycleCommand(
          dependencies(new MemoryWorkspaceStorageAdapter(), live),
          command,
        ),
      );
    }

    expect(results.every((result) => result.ok)).toBe(true);
    expect(results[3]).toMatchObject({ storageProtection: "degraded" });
    expect(lifecycleMocks.cleanupLegacy).toHaveBeenCalledOnce();
    expect(lifecycleMocks.deleteWorkspace).toHaveBeenCalledOnce();
    expect(lifecycleMocks.purgeRecovery).toHaveBeenCalledOnce();
    expect(generationMocks.rotate).toHaveBeenCalledOnce();
    expect(generationMocks.recover).toHaveBeenCalledOnce();
  });

  it("retains the freeze when a core adapter unexpectedly throws", async () => {
    const snapshot = await authoritySnapshot();
    const intent = captureWorkspaceIndexIntent(snapshot, "workspace-1");
    if (!intent) throw new Error("fixture workspace intent is missing");
    const live = {
      value: {
        snapshot,
        workspaceIntentToken: "workspace-1",
        selectedProjectId: null,
        selectedProjectIntentToken: null,
        recoveryIntentToken: null,
      },
    };
    const freeze = freezeHarness();
    lifecycleMocks.deleteWorkspace.mockRejectedValue(new Error("fixture"));

    const result = await executeWorkspaceProductionLifecycleCommand(
      dependencies(new MemoryWorkspaceStorageAdapter(), live, freeze),
      { kind: "delete-workspace", intent },
    );

    expect(result).toEqual({
      ok: false,
      reason: "orchestration-failed",
      pendingFreezeRetained: true,
    });
    expect(freeze.releases()).toBe(0);
  });

  it("does not cancel a committed lease when the host cannot adopt the snapshot", async () => {
    const snapshot = await authoritySnapshot();
    const intent = captureWorkspaceIndexIntent(snapshot, "workspace-1");
    if (!intent) throw new Error("fixture workspace intent is missing");
    const live = {
      value: {
        snapshot,
        workspaceIntentToken: "workspace-1",
        selectedProjectId: PROJECT_A,
        selectedProjectIntentToken: "project-1",
        recoveryIntentToken: null,
      },
    };
    let held = true;
    let released = false;
    lifecycleMocks.cleanupLegacy.mockResolvedValue(successfulLifecycle(snapshot));
    const deps = dependencies(new MemoryWorkspaceStorageAdapter(), live);
    deps.pendingSaves = {
      tryFreeze: () => ({
        isHeld: () => held,
        pendingSavesDrained: () => held,
        release: () => {
          released = true;
          held = false;
        },
      }),
    };

    const result = await executeWorkspaceProductionLifecycleCommand(deps, {
      kind: "legacy-cleanup",
      intent,
    });

    expect(result).toMatchObject({
      ok: true,
      pendingState: "rebuild-required",
    });
    expect(released).toBe(false);
    expect(held).toBe(true);
  });
});

describe("resumeWorkspaceProductionLifecycle", () => {
  it("routes lifecycle and generation journals without accepting UI payload", async () => {
    const snapshot = await authoritySnapshot();
    lifecycleMocks.resume.mockResolvedValue(successfulLifecycle(snapshot));
    generationMocks.resume.mockResolvedValue({
      ok: true,
      status: "committed",
      kind: "rotate-workspace-generation",
      snapshot,
    });

    const deleteJournal = serializeWorkspaceJournal(await journalFor("delete-project"));
    const rotateJournal = serializeWorkspaceJournal(
      await journalFor("rotate-workspace-generation"),
    );
    if (!deleteJournal.ok || !rotateJournal.ok) throw new Error("invalid fixture journal");
    const lifecycleStorage = new MemoryWorkspaceStorageAdapter({
      [WORKSPACE_OPERATION_KEY]: deleteJournal.serialized,
    });
    const generationStorage = new MemoryWorkspaceStorageAdapter({
      [WORKSPACE_OPERATION_KEY]: rotateJournal.serialized,
    });
    const locks = { runExclusive: async <T,>(_name: string, operation: () => Promise<T>) => operation() };

    const lifecycle = await resumeWorkspaceProductionLifecycle({
      storage: lifecycleStorage,
      locks,
      pendingSaves: freezeHarness().controller,
    });
    const generation = await resumeWorkspaceProductionLifecycle({
      storage: generationStorage,
      locks,
      pendingSaves: freezeHarness().controller,
    });

    expect(lifecycle).toMatchObject({ ok: true, kind: "delete-selected" });
    expect(generation).toMatchObject({
      ok: true,
      kind: "rotate-workspace-generation",
    });
    expect(lifecycleMocks.resume).toHaveBeenCalledOnce();
    expect(generationMocks.resume).toHaveBeenCalledOnce();
  });

  it("leaves create/migration journals untouched for their owning orchestrator", async () => {
    const createJournal = serializeWorkspaceJournal(await journalFor("create-project"));
    if (!createJournal.ok) throw new Error("invalid fixture journal");
    const storage = new MemoryWorkspaceStorageAdapter({
      [WORKSPACE_OPERATION_KEY]: createJournal.serialized,
    });

    const result = await resumeWorkspaceProductionLifecycle({
      storage,
      locks: { runExclusive: async (_name, operation) => operation() },
      pendingSaves: freezeHarness().controller,
    });

    expect(result).toEqual({
      ok: false,
      reason: "unsupported-operation",
      pendingFreezeRetained: false,
    });
    expect(storage.getItem(WORKSPACE_OPERATION_KEY)).toBe(createJournal.serialized);
    expect(lifecycleMocks.resume).not.toHaveBeenCalled();
    expect(generationMocks.resume).not.toHaveBeenCalled();
  });
});

describe("legacy drift choice read model", () => {
  it("never makes project-content actions available without a parsed candidate", () => {
    expect(
      deriveWorkspaceLegacyDriftChoices({
        projectCandidateAvailable: false,
        selectedProjectId: null,
      }),
    ).toEqual([
      {
        kind: "import-as-new",
        available: false,
        unavailableReason: "candidate-unavailable",
      },
      {
        kind: "replace-selected",
        available: false,
        unavailableReason: "candidate-unavailable",
      },
      { kind: "accept-new-baseline", available: true, unavailableReason: null },
      { kind: "privacy-cleanup", available: true, unavailableReason: null },
    ]);
  });

  it("requires an explicit selected project only for replacement", () => {
    const choices = deriveWorkspaceLegacyDriftChoices({
      projectCandidateAvailable: true,
      selectedProjectId: null,
    });
    expect(choices[0]).toMatchObject({ kind: "import-as-new", available: true });
    expect(choices[1]).toEqual({
      kind: "replace-selected",
      available: false,
      unavailableReason: "selected-project-required",
    });
  });

  it("offers only privacy cleanup when old legacy bytes reappear after workspace clearing", () => {
    expect(
      deriveWorkspaceLegacyDriftChoices({
        workspaceStatus: "cleared",
        projectCandidateAvailable: true,
        selectedProjectId: PROJECT_A,
      }),
    ).toEqual([
      {
        kind: "import-as-new",
        available: false,
        unavailableReason: "workspace-not-active",
      },
      {
        kind: "replace-selected",
        available: false,
        unavailableReason: "workspace-not-active",
      },
      {
        kind: "accept-new-baseline",
        available: false,
        unavailableReason: "workspace-not-active",
      },
      { kind: "privacy-cleanup", available: true, unavailableReason: null },
    ]);
  });
});
