"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { useBrowserLocalDate } from "@/components/use-browser-local-date";
import { useLocalizedMessages } from "@/components/locale-provider";
import { type NewAssignmentMethod } from "@/components/multi-assignment-workspace/multi-assignment-dashboard";
import { MultiAssignmentWorkspaceShell } from "@/components/multi-assignment-workspace/multi-assignment-workspace-shell";
import { dashboardProjectsFromWorkspaceSnapshot } from "@/components/multi-assignment-workspace/workspace-read-model";
import {
  workspaceActivationEn,
  workspaceActivationZhCN,
} from "@/components/multi-assignment-workspace/workspace-activation-messages";
import type { RubricTrailAppProps } from "@/components/rubrictrail-app";
import type { PersistedProjectState } from "@/lib/ui-types";
import type {
  WorkspaceAuthoritySnapshot,
  WorkspaceExclusiveLockRunner,
} from "@/lib/workspace-storage/coordinator";
import type { WorkspaceRuntimeController } from "@/lib/workspace-storage/runtime-controller";
import type { WorkspaceStorageAdapter } from "@/lib/workspace-storage/storage-adapter";

import type { WorkspaceDeferredOperationsProps } from "./workspace-deferred-operations";
import styles from "./workspace-activation-root.module.css";

const AssignmentApp = dynamic<RubricTrailAppProps>(
  () => import("@/components/rubrictrail-app").then((module) => module.RubricTrailApp),
  { loading: AssignmentLoading, ssr: false },
);

const DeferredWorkspaceOperations = dynamic<WorkspaceDeferredOperationsProps>(
  () =>
    import("./workspace-deferred-operations").then(
      (module) => module.WorkspaceDeferredOperations,
    ),
  { loading: DeferredLoading, ssr: false },
);

type WorkspaceOpenFailure =
  | "lock-unavailable"
  | "lock-failed"
  | "invalid-workspace"
  | "recovery-required"
  | "legacy-conflict"
  | "invalid-legacy"
  | "storage-error"
  | "digest-unavailable"
  | "reserve-degraded"
  | "id-unavailable-or-collided"
  | "commit-incomplete"
  | "unavailable";

export interface ReadyWorkspace {
  controller: WorkspaceRuntimeController;
  snapshot: WorkspaceAuthoritySnapshot;
  storageProtection: "healthy" | "degraded";
}

function AssignmentLoading() {
  const messages = useLocalizedMessages(workspaceActivationEn, workspaceActivationZhCN);
  return (
    <div className={styles.loadingCard} role="status" aria-live="polite">
      <p className={styles.eyebrow}>RubricTrail</p>
      <h1>{messages.loadingTitle}</h1>
      <p>{messages.loadingDescription}</p>
      <div className={styles.loadingLine} aria-hidden="true"><span /></div>
    </div>
  );
}

function DeferredLoading() {
  const messages = useLocalizedMessages(workspaceActivationEn, workspaceActivationZhCN);
  return <p className={styles.managementLoading} role="status">{messages.managementLoading}</p>;
}

function projectState(
  snapshot: WorkspaceAuthoritySnapshot,
  projectId: string,
): PersistedProjectState | null {
  const project = snapshot.projects.find(
    (candidate) => candidate.record.projectId === projectId,
  );
  return project?.record.value.kind === "project" ? project.record.value.state : null;
}

function failureMessage(
  reason: WorkspaceOpenFailure,
  messages: { [Key in keyof typeof workspaceActivationEn]: string },
): string {
  if (reason === "lock-unavailable" || reason === "lock-failed") {
    return messages.lockUnavailable;
  }
  if (reason === "legacy-conflict") return messages.legacyConflict;
  if (reason === "invalid-workspace") return messages.invalidWorkspace;
  if (reason === "recovery-required" || reason === "commit-incomplete") {
    return messages.recoveryRequired;
  }
  if (reason === "invalid-legacy") return messages.invalidLegacy;
  if (reason === "reserve-degraded") return messages.reserveError;
  if (reason === "storage-error" || reason === "digest-unavailable") {
    return messages.storageError;
  }
  return messages.genericError;
}

function browserStorage(): Storage | null {
  try {
    const storage = window.localStorage;
    void storage.length;
    return storage;
  } catch {
    return null;
  }
}

export function WorkspaceActivationRoot() {
  const currentDate = useBrowserLocalDate();
  const messages = useLocalizedMessages(workspaceActivationEn, workspaceActivationZhCN);
  const [ready, setReady] = useState<ReadyWorkspace | null>(null);
  const [failure, setFailure] = useState<WorkspaceOpenFailure | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [creationMethod, setCreationMethod] = useState<NewAssignmentMethod | null>(null);
  const [pendingProjectIds, setPendingProjectIds] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [managementOpen, setManagementOpen] = useState(false);
  const [legacyDriftDetected, setLegacyDriftDetected] = useState(false);
  const [authorityEpoch, setAuthorityEpoch] = useState(0);
  const [runtimeContext, setRuntimeContext] = useState<{
    storage: WorkspaceStorageAdapter;
    locks: WorkspaceExclusiveLockRunner | null;
  } | null>(null);
  const storageRef = useRef<WorkspaceStorageAdapter | null>(null);
  const locksRef = useRef<WorkspaceExclusiveLockRunner | null>(null);
  const readyRef = useRef<ReadyWorkspace | null>(null);
  const selectedProjectIdRef = useRef<string | null>(null);
  const legacyDriftRef = useRef(false);
  const openRequestGenerationRef = useRef(0);

  useEffect(() => { readyRef.current = ready; }, [ready]);
  useEffect(() => { selectedProjectIdRef.current = selectedProjectId; }, [selectedProjectId]);
  useEffect(() => { legacyDriftRef.current = legacyDriftDetected; }, [legacyDriftDetected]);

  const applyReady = useCallback((next: ReadyWorkspace) => {
    readyRef.current = next;
    setReady(next);
    setPendingProjectIds(next.controller.pendingProjectIds());
    setFailure(null);
  }, []);

  const updateSelectedProject = useCallback((projectId: string | null) => {
    selectedProjectIdRef.current = projectId;
    setSelectedProjectId(projectId);
    if (projectId === null) setCreationMethod(null);
  }, []);

  const markAuthorityProjectReplaced = useCallback((projectId: string) => {
    if (selectedProjectIdRef.current === projectId) {
      setAuthorityEpoch((current) => current + 1);
    }
  }, []);

  const clearLegacyDrift = useCallback(() => {
    legacyDriftRef.current = false;
    setLegacyDriftDetected(false);
  }, []);

  const openWorkspace = useCallback(async () => {
    const requestGeneration = ++openRequestGenerationRef.current;
    const requestIsCurrent = () => openRequestGenerationRef.current === requestGeneration;
    setFailure(null);
    setReady(null);
    setRuntimeContext(null);
    readyRef.current = null;
    setLegacyDriftDetected(false);
    legacyDriftRef.current = false;
    const nativeStorage = browserStorage();
    if (!nativeStorage) {
      setFailure("unavailable");
      return;
    }
    try {
      const [{ BrowserWorkspaceStorageAdapter }, coordinator, runtime] = await Promise.all([
        import("@/lib/workspace-storage/storage-adapter"),
        import("@/lib/workspace-storage/coordinator"),
        import("@/lib/workspace-storage/runtime-controller"),
      ]);
      if (!requestIsCurrent()) return;
      const storage = new BrowserWorkspaceStorageAdapter(nativeStorage);
      const locks = coordinator.createBrowserWorkspaceLockRunner(
        typeof navigator === "undefined" ? null : navigator.locks,
      );
      storageRef.current = storage;
      locksRef.current = locks;
      setRuntimeContext({ storage, locks });
      let result = await runtime.bootstrapWorkspaceRuntime(storage, locks);
      if (!requestIsCurrent()) return;
      if (!result.ok && result.reason === "recovery-required" && locks) {
        const [lifecycle, deferred] = await Promise.all([
          import("@/lib/workspace-storage/production-lifecycle-orchestrator"),
          import("./workspace-deferred-operations"),
        ]);
        if (!requestIsCurrent()) return;
        const resumed = await lifecycle.resumeWorkspaceProductionLifecycle({
          storage,
          locks,
          pendingSaves: deferred.detachedPendingFreeze(),
        });
        if (!requestIsCurrent()) return;
        if (resumed.ok) {
          result = await runtime.bootstrapWorkspaceRuntime(storage, locks);
          if (!requestIsCurrent()) return;
        }
      }
      if (!result.ok) {
        if (result.reason === "legacy-conflict") {
          legacyDriftRef.current = true;
          setLegacyDriftDetected(true);
        }
        setFailure(result.reason);
        return;
      }
      applyReady({
        controller: result.controller,
        snapshot: result.controller.authoritySnapshot(),
        storageProtection: result.storageProtection,
      });
      updateSelectedProject(null);
      setCreationMethod(null);
      clearLegacyDrift();
    } catch {
      if (requestIsCurrent()) setFailure("storage-error");
    }
  }, [applyReady, clearLegacyDrift, updateSelectedProject]);

  useEffect(() => {
    const timer = window.setTimeout(() => void openWorkspace(), 0);
    return () => window.clearTimeout(timer);
  }, [openWorkspace]);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      const storage = storageRef.current;
      if (!storage || (event.storageArea && event.storageArea !== window.localStorage)) return;
      void (async () => {
        const keys = await import("@/lib/workspace-storage/keys");
        const relevantLegacy =
          event.key === null || Object.values(keys.LEGACY_PROJECT_KEYS).includes(
            event.key as (typeof keys.LEGACY_PROJECT_KEYS)[keyof typeof keys.LEGACY_PROJECT_KEYS],
          );
        if (relevantLegacy) {
          const driftModule = await import("@/lib/workspace-storage/production-legacy-drift");
          const drift = await driftModule.inspectWorkspaceLegacyDrift(storage);
          if (drift.ok) {
            legacyDriftRef.current = true;
            setLegacyDriftDetected(true);
            setNotice(messages.legacyConflict);
            return;
          }
        }
        const recognizedWorkspaceKey = event.key === null
          ? null
          : keys.recognizeWorkspaceOwnedKey(event.key);
        const relevantWorkspace =
          event.key === null ||
          recognizedWorkspaceKey?.kind === "index" ||
          recognizedWorkspaceKey?.kind === "operation" ||
          recognizedWorkspaceKey?.kind === "project";
        if (!relevantWorkspace) return;
        if (
          recognizedWorkspaceKey?.kind === "project" &&
          selectedProjectIdRef.current !== null &&
          recognizedWorkspaceKey.project?.projectId !== selectedProjectIdRef.current
        ) {
          return;
        }
        const current = readyRef.current;
        if (current && current.controller.pendingProjectIds().length > 0) {
          setNotice(messages.saveBlocked);
          return;
        }
        await openWorkspace();
      })();
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [messages.legacyConflict, messages.saveBlocked, openWorkspace]);

  const flushProject = useCallback(async (projectId: string) => {
    const current = readyRef.current;
    if (!current) return "failed" as const;
    const result = await current.controller.flushProject(projectId);
    setPendingProjectIds(current.controller.pendingProjectIds());
    if (result.ok) {
      applyReady({ ...current, snapshot: current.controller.authoritySnapshot() });
      return "saved" as const;
    }
    if (result.reason === "no-pending-save") return "saved" as const;
    setNotice(messages.saveFailed);
    return result.reason === "save-in-flight" ? "blocked" as const : "failed" as const;
  }, [applyReady, messages.saveFailed]);

  const queueProjectChange = useCallback((projectId: string, next: PersistedProjectState) => {
    const current = readyRef.current;
    if (!current || legacyDriftRef.current) {
      setNotice(messages.legacyConflict);
      return false;
    }
    const result = current.controller.queueProjectSave(projectId, next);
    setPendingProjectIds(current.controller.pendingProjectIds());
    if (result.ok) return true;
    setNotice(messages.saveBlocked);
    return false;
  }, [messages.legacyConflict, messages.saveBlocked]);

  const selectProject = useCallback(async (projectId: string): Promise<boolean> => {
    const current = readyRef.current;
    if (!current) return false;
    const prior = selectedProjectIdRef.current;
    if (prior && current.controller.pendingProjectIds().includes(prior)) {
      const flushed = await flushProject(prior);
      if (flushed !== "saved") return false;
    }
    const switched = current.controller.switchProject(projectId);
    if (!switched.ok) return false;
    selectedProjectIdRef.current = projectId;
    setSelectedProjectId(projectId);
    setCreationMethod(null);
    return true;
  }, [flushProject]);

  const showDashboard = useCallback(async () => {
    const prior = selectedProjectIdRef.current;
    if (prior && readyRef.current?.controller.pendingProjectIds().includes(prior)) {
      const flushed = await flushProject(prior);
      if (flushed !== "saved") return;
    }
    await openWorkspace();
  }, [flushProject, openWorkspace]);

  const startNewAssignment = useCallback(async (method: NewAssignmentMethod) => {
    const prior = selectedProjectIdRef.current;
    if (prior && readyRef.current?.controller.pendingProjectIds().includes(prior)) {
      const flushed = await flushProject(prior);
      if (flushed !== "saved") return;
    }
    updateSelectedProject(null);
    setCreationMethod(method);
    setNotice(null);
  }, [flushProject, updateSelectedProject]);

  const createProject = useCallback(async (
    state: PersistedProjectState,
    source: "intake" | "backup" | "sample",
  ): Promise<boolean> => {
    const current = readyRef.current;
    if (!current || legacyDriftRef.current) {
      setNotice(messages.legacyConflict);
      return false;
    }
    const result = source === "backup"
      ? await current.controller.restoreAsNew(state)
      : await current.controller.createProject(state);
    if (!result.ok) {
      setPendingProjectIds(current.controller.pendingProjectIds());
      setNotice(messages.createFailed);
      return false;
    }
    applyReady({ ...current, snapshot: result.snapshot });
    selectedProjectIdRef.current = result.projectId;
    setSelectedProjectId(result.projectId);
    setCreationMethod(null);
    return true;
  }, [applyReady, messages.createFailed, messages.legacyConflict]);

  const runSelectedLifecycle = useCallback(async (
    kind: "replace-selected" | "delete-selected",
    backup?: PersistedProjectState,
  ): Promise<boolean> => {
    const current = readyRef.current;
    const selected = selectedProjectIdRef.current;
    const storage = storageRef.current;
    const locks = locksRef.current;
    if (!current || !selected || !storage || !locks || legacyDriftRef.current) {
      if (legacyDriftRef.current) setNotice(messages.legacyConflict);
      return false;
    }
    if (current.controller.pendingProjectIds().includes(selected)) {
      const flushed = await flushProject(selected);
      if (flushed !== "saved") return false;
    }
    const deferred = await import("./workspace-deferred-operations");
    const result = await deferred.executeSelectedWorkspaceLifecycle({
      kind,
      backup,
      ready: current,
      selectedProjectId: selected,
      storage,
      locks,
      readReady: () => readyRef.current,
      readSelectedProjectId: () => selectedProjectIdRef.current,
    });
    if (!result.ok) {
      setNotice(kind === "replace-selected" ? messages.replaceFailed : messages.saveFailed);
      return false;
    }
    applyReady(result.ready);
    if (kind === "replace-selected") markAuthorityProjectReplaced(selected);
    updateSelectedProject(result.selectedProjectId);
    return true;
  }, [
    applyReady,
    flushProject,
    messages.legacyConflict,
    messages.replaceFailed,
    messages.saveFailed,
    markAuthorityProjectReplaced,
    updateSelectedProject,
  ]);

  const exportLegacyProject = useCallback(async () => {
    try {
      const [{ readProjectStateWithStatus }, backup] = await Promise.all([
        import("@/lib/local-state"),
        import("@/lib/project-backup"),
      ]);
      const result = readProjectStateWithStatus();
      if (result.state.projectKind === "none") throw new Error("empty legacy project");
      const exportedAt = new Date().toISOString();
      const url = URL.createObjectURL(new Blob([
        backup.serializeProjectBackup(result.state, exportedAt),
      ], { type: "application/json;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = backup.projectBackupFileName(result.state, exportedAt);
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      setNotice(messages.exportFailed);
    }
  }, [messages.exportFailed]);

  const dashboardProjects = useMemo(
    () => ready ? dashboardProjectsFromWorkspaceSnapshot(ready.snapshot) : [],
    [ready],
  );

  if (!ready) {
    if (!failure) {
      return (
        <main className={styles.loading} aria-label={messages.loadingLabel}>
          <AssignmentLoading />
        </main>
      );
    }
    return (
      <main className={styles.recovery}>
        <section className={styles.recoveryCard} role="alert">
          <div className={styles.toolbar}><LanguageSwitcher compact /></div>
          <p className={styles.eyebrow}>RubricTrail</p>
          <h1>{messages.recoveryTitle}</h1>
          <p>{messages.recoveryDescription}</p>
          <p><strong>{failureMessage(failure, messages)}</strong></p>
          {notice ? <p className={styles.warning} role="status">{notice}</p> : null}
          <div className={styles.actions}>
            <button type="button" onClick={() => void openWorkspace()}>{messages.retry}</button>
            <button type="button" onClick={() => void exportLegacyProject()}>{messages.exportLegacy}</button>
          </div>
          {runtimeContext && legacyDriftDetected ? (
            <DeferredWorkspaceOperations
              mode="legacy-recovery"
              storage={runtimeContext.storage}
              locks={runtimeContext.locks}
              ready={ready}
              selectedProjectId={selectedProjectId}
              onApplyReady={applyReady}
              onAuthorityProjectReplaced={markAuthorityProjectReplaced}
              onSelectedProjectChange={updateSelectedProject}
              onLegacyResolved={clearLegacyDrift}
              onNotice={setNotice}
              onReopen={openWorkspace}
            />
          ) : null}
        </section>
        {runtimeContext && !legacyDriftDetected ? (
          <DeferredWorkspaceOperations
            mode={
              failure === "invalid-workspace" ||
              failure === "recovery-required" ||
              failure === "commit-incomplete"
                ? "recovery"
                : "read-only-recovery"
            }
            storage={runtimeContext.storage}
            locks={runtimeContext.locks}
            ready={ready}
            selectedProjectId={selectedProjectId}
            onApplyReady={applyReady}
            onAuthorityProjectReplaced={markAuthorityProjectReplaced}
            onSelectedProjectChange={updateSelectedProject}
            onLegacyResolved={clearLegacyDrift}
            onNotice={setNotice}
            onReopen={openWorkspace}
          />
        ) : null}
      </main>
    );
  }

  const selectedState = selectedProjectId ? projectState(ready.snapshot, selectedProjectId) : null;
  const intakeMode = creationMethod === "paste" ? "paste" : "files";

  return (
    <main className={styles.root}>
      {ready.storageProtection === "degraded" ? (
        <p className={styles.warning} role="alert">
          <strong>{messages.degradedTitle}.</strong> {messages.degradedDescription}
        </p>
      ) : null}
      {notice ? <p className={styles.warning} role="status">{notice}</p> : null}
      {runtimeContext && legacyDriftDetected ? (
        <DeferredWorkspaceOperations
          mode="legacy-active"
          storage={runtimeContext.storage}
          locks={runtimeContext.locks}
          ready={ready}
          selectedProjectId={selectedProjectId}
          onApplyReady={applyReady}
          onAuthorityProjectReplaced={markAuthorityProjectReplaced}
          onSelectedProjectChange={updateSelectedProject}
          onLegacyResolved={clearLegacyDrift}
          onNotice={setNotice}
          onReopen={openWorkspace}
        />
      ) : null}
      <MultiAssignmentWorkspaceShell
        projects={dashboardProjects}
        currentDate={currentDate}
        selectedProjectId={selectedProjectId}
        creationMethod={creationMethod}
        pendingProjectIds={pendingProjectIds}
        onNewAssignment={startNewAssignment}
        onSelectionRequested={selectProject}
        onDashboardShown={() => void showDashboard()}
        renderAssignment={(project) => {
          const state = selectedState ?? project.state;
          return (
            <AssignmentApp
              key={`${project.projectId}:${authorityEpoch}`}
              workspaceSession={{
                mode: "existing",
                projectId: project.projectId,
                authorityEpoch,
                project: state,
                onProjectChange: (next) => queueProjectChange(project.projectId, next),
                onFlush: () => flushProject(project.projectId),
                onReplaceProject: (next) => runSelectedLifecycle("replace-selected", next),
                onRequestManagement: () => setManagementOpen(true),
                onStartOwnProject: () => void startNewAssignment("upload"),
              }}
            />
          );
        }}
        renderNewAssignment={(method) => (
          <AssignmentApp
            key={`new:${method}`}
            workspaceSession={{
              mode: "new",
              initialIntakeMode: intakeMode,
              initialRestoreMode: method === "restore",
              onCreateProject: createProject,
            }}
          />
        )}
      />
      <div className={styles.utility}>
        <button
          type="button"
          aria-expanded={managementOpen}
          onClick={() => setManagementOpen((current) => !current)}
        >
          {managementOpen ? messages.closeManagement : messages.manageWorkspace}
        </button>
      </div>
      {managementOpen && runtimeContext && !legacyDriftDetected ? (
        <DeferredWorkspaceOperations
          mode="management"
          storage={runtimeContext.storage}
          locks={runtimeContext.locks}
          ready={ready}
          selectedProjectId={selectedProjectId}
          onApplyReady={applyReady}
          onAuthorityProjectReplaced={markAuthorityProjectReplaced}
          onSelectedProjectChange={updateSelectedProject}
          onLegacyResolved={clearLegacyDrift}
          onNotice={setNotice}
          onReopen={openWorkspace}
        />
      ) : null}
    </main>
  );
}
