import {
  digestOptionalStoredString,
  sha256StoredString,
  WORKSPACE_DIGEST_PATTERN,
} from "@/lib/workspace-storage/digest";
import {
  WORKSPACE_INDEX_KEY,
  WORKSPACE_OPERATION_KEY,
  WORKSPACE_RESERVE_KEY,
} from "@/lib/workspace-storage/keys";

export interface WorkspaceStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
  checkpoint?(name: string): void;
}

export type WorkspaceStorageFaultKind =
  | "crash"
  | "quota"
  | "security"
  | "readback-mismatch";

export const WORKSPACE_PROTOCOL_CHECKPOINTS = [
  "journal-phase-update",
  "journal-removal",
  "project-target-write",
  "index-commit",
  "source-cleanup",
  "reserve-removal",
  "reserve-recreation",
] as const;

export type WorkspaceProtocolCheckpoint =
  (typeof WORKSPACE_PROTOCOL_CHECKPOINTS)[number];

export class WorkspaceStorageFault extends Error {
  readonly kind: WorkspaceStorageFaultKind;
  readonly checkpointName: string;

  constructor(kind: WorkspaceStorageFaultKind, checkpointName: string) {
    super(`Injected ${kind} fault at ${checkpointName}`);
    this.name = "WorkspaceStorageFault";
    this.kind = kind;
    this.checkpointName = checkpointName;
  }
}

export class DeterministicFaultController {
  private step = 0;
  private readonly history: string[] = [];
  private faultStep: number | null = null;
  private faultCheckpoint: string | null = null;
  private faultKind: WorkspaceStorageFaultKind = "crash";

  armAtStep(step: number, kind: WorkspaceStorageFaultKind = "crash"): void {
    if (!Number.isSafeInteger(step) || step < 1) {
      throw new TypeError("Fault step must be a positive safe integer");
    }
    this.step = 0;
    this.history.length = 0;
    this.faultStep = step;
    this.faultCheckpoint = null;
    this.faultKind = kind;
  }

  armAtCheckpoint(
    checkpointName: string,
    kind: WorkspaceStorageFaultKind = "crash",
  ): void {
    this.step = 0;
    this.history.length = 0;
    this.faultStep = null;
    this.faultCheckpoint = checkpointName;
    this.faultKind = kind;
  }

  clear(): void {
    this.step = 0;
    this.history.length = 0;
    this.faultStep = null;
    this.faultCheckpoint = null;
  }

  checkpoint(name: string): void {
    this.step += 1;
    this.history.push(name);
    if (this.faultStep === this.step || this.faultCheckpoint === name) {
      throw new WorkspaceStorageFault(this.faultKind, name);
    }
  }

  currentStep(): number {
    return this.step;
  }

  visitedCheckpoints(): readonly string[] {
    return [...this.history];
  }
}

export class MemoryWorkspaceStorageAdapter implements WorkspaceStorageAdapter {
  private readonly values = new Map<string, string>();
  private readonly readOverrides = new Map<string, string | null>();

  constructor(
    initialValues: Readonly<Record<string, string>> = {},
    readonly faults = new DeterministicFaultController(),
  ) {
    for (const [key, value] of Object.entries(initialValues)) {
      this.values.set(key, value);
    }
  }

  checkpoint(name: string): void {
    this.faults.checkpoint(name);
  }

  getItem(key: string): string | null {
    this.checkpoint(`before:getItem:${key}`);
    const value = this.readOverrides.has(key)
      ? (this.readOverrides.get(key) ?? null)
      : (this.values.get(key) ?? null);
    this.checkpoint(`after:getItem:${key}`);
    return value;
  }

  setItem(key: string, value: string): void {
    this.checkpoint(`before:setItem:${key}`);
    this.values.set(key, value);
    this.checkpoint(`after:setItem:${key}`);
  }

  removeItem(key: string): void {
    this.checkpoint(`before:removeItem:${key}`);
    this.values.delete(key);
    this.checkpoint(`after:removeItem:${key}`);
  }

  keys(): string[] {
    this.checkpoint("before:keys");
    const result = [...this.values.keys()].sort();
    this.checkpoint("after:keys");
    return result;
  }

  setReadOverride(key: string, value: string | null): void {
    this.readOverrides.set(key, value);
  }

  clearReadOverride(key: string): void {
    this.readOverrides.delete(key);
  }

  snapshot(): Readonly<Record<string, string>> {
    return Object.fromEntries(
      [...this.values.entries()].sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    );
  }
}

export class BrowserWorkspaceStorageAdapter implements WorkspaceStorageAdapter {
  constructor(private readonly storage: Storage) {}

  getItem(key: string): string | null {
    return this.storage.getItem(key);
  }

  setItem(key: string, value: string): void {
    this.storage.setItem(key, value);
  }

  removeItem(key: string): void {
    this.storage.removeItem(key);
  }

  keys(): string[] {
    const keys: string[] = [];
    for (let index = 0; index < this.storage.length; index += 1) {
      const key = this.storage.key(index);
      if (key !== null) keys.push(key);
    }
    return keys.sort();
  }
}

export type ExactStorageMutationResult =
  | { ok: true }
  | { ok: false; reason: "storage-error" | "readback-mismatch" };

export function readExact(
  storage: WorkspaceStorageAdapter,
  key: string,
): { ok: true; value: string | null } | { ok: false; reason: "storage-error" } {
  try {
    const value = storage.getItem(key);
    storage.checkpoint?.(`readback:${key}`);
    return { ok: true, value };
  } catch (error) {
    if (error instanceof WorkspaceStorageFault && error.kind === "crash") {
      throw error;
    }
    return { ok: false, reason: "storage-error" };
  }
}

function mutationFailure(error: unknown): ExactStorageMutationResult {
  if (error instanceof WorkspaceStorageFault) {
    if (error.kind === "crash") throw error;
    if (error.kind === "readback-mismatch") {
      return { ok: false, reason: "readback-mismatch" };
    }
  }
  return { ok: false, reason: "storage-error" };
}

export function writeExact(
  storage: WorkspaceStorageAdapter,
  key: string,
  value: string,
): ExactStorageMutationResult {
  try {
    storage.setItem(key, value);
    storage.checkpoint?.(`after-write:${key}`);
  } catch (error) {
    return mutationFailure(error);
  }
  const readback = readExact(storage, key);
  if (!readback.ok) return readback;
  return readback.value === value
    ? { ok: true }
    : { ok: false, reason: "readback-mismatch" };
}

export function removeExact(
  storage: WorkspaceStorageAdapter,
  key: string,
): ExactStorageMutationResult {
  try {
    storage.removeItem(key);
    storage.checkpoint?.(`after-remove:${key}`);
  } catch (error) {
    return mutationFailure(error);
  }
  const readback = readExact(storage, key);
  if (!readback.ok) return readback;
  return readback.value === null
    ? { ok: true }
    : { ok: false, reason: "readback-mismatch" };
}

export function workspaceProtocolCheckpoint(
  storage: WorkspaceStorageAdapter,
  checkpoint: WorkspaceProtocolCheckpoint,
): void {
  storage.checkpoint?.(checkpoint);
}

export interface WorkspaceDigestWriteGuard {
  expectedBeforeDigest: string | null;
  targetDigest: string;
  /** Evaluated synchronously after the final awaited baseline read. */
  commitStillAuthorized?: () => boolean;
}

export interface WorkspaceDigestRemoveGuard {
  expectedBeforeDigest: string;
  /** Evaluated synchronously after the final awaited baseline read. */
  commitStillAuthorized?: () => boolean;
}

export type WorkspaceDigestMutationResult =
  | { ok: true; state: "applied" | "already-target" }
  | {
      ok: false;
      reason:
        | "invalid-digest"
        | "digest-unavailable"
        | "storage-error"
        | "baseline-mismatch"
        | "commit-cancelled"
        | "target-digest-mismatch"
        | "readback-mismatch";
    };

interface WorkspaceDigestSnapshot {
  raw: string | null;
  digest: string | null;
}

function commitIsStillAuthorized(
  guard: WorkspaceDigestWriteGuard | WorkspaceDigestRemoveGuard,
): boolean {
  if (!guard.commitStillAuthorized) return true;
  try {
    return guard.commitStillAuthorized();
  } catch {
    return false;
  }
}

async function readDigestSnapshot(
  storage: WorkspaceStorageAdapter,
  key: string,
): Promise<
  | { ok: true; snapshot: WorkspaceDigestSnapshot }
  | { ok: false; reason: "storage-error" | "digest-unavailable" }
> {
  const read = readExact(storage, key);
  if (!read.ok) return { ok: false, reason: "storage-error" };
  const digest = await digestOptionalStoredString(read.value);
  if (!digest.ok) return { ok: false, reason: "digest-unavailable" };
  return {
    ok: true,
    snapshot: { raw: read.value, digest: digest.digest },
  };
}

function exactMutationFailure(
  result: Extract<ExactStorageMutationResult, { ok: false }>,
): Extract<WorkspaceDigestMutationResult, { ok: false }> {
  return {
    ok: false,
    reason: result.reason,
  };
}

async function confirmDigestSnapshot(
  storage: WorkspaceStorageAdapter,
  key: string,
  snapshot: WorkspaceDigestSnapshot,
): Promise<
  | { ok: true }
  | { ok: false; reason: "storage-error" | "baseline-mismatch" }
> {
  const confirmed = readExact(storage, key);
  if (!confirmed.ok) return { ok: false, reason: "storage-error" };
  return confirmed.value === snapshot.raw
    ? { ok: true }
    : { ok: false, reason: "baseline-mismatch" };
}

async function writeWithDigestGuard(
  storage: WorkspaceStorageAdapter,
  key: string,
  serializedTarget: string,
  guard: WorkspaceDigestWriteGuard,
  checkpoint: WorkspaceProtocolCheckpoint,
): Promise<WorkspaceDigestMutationResult> {
  if (
    (guard.expectedBeforeDigest !== null &&
      !WORKSPACE_DIGEST_PATTERN.test(guard.expectedBeforeDigest)) ||
    !WORKSPACE_DIGEST_PATTERN.test(guard.targetDigest)
  ) {
    return { ok: false, reason: "invalid-digest" };
  }

  const computedTarget = await sha256StoredString(serializedTarget);
  if (!computedTarget.ok) return { ok: false, reason: "digest-unavailable" };
  if (computedTarget.digest !== guard.targetDigest) {
    return { ok: false, reason: "target-digest-mismatch" };
  }

  const before = await readDigestSnapshot(storage, key);
  if (!before.ok) return before;
  if (before.snapshot.digest === guard.targetDigest) {
    if (before.snapshot.raw !== serializedTarget) {
      return { ok: false, reason: "baseline-mismatch" };
    }
    const confirmed = await confirmDigestSnapshot(storage, key, before.snapshot);
    if (!confirmed.ok) return confirmed;
    workspaceProtocolCheckpoint(storage, checkpoint);
    return { ok: true, state: "already-target" };
  }
  if (before.snapshot.digest !== guard.expectedBeforeDigest) {
    return { ok: false, reason: "baseline-mismatch" };
  }

  const confirmed = await confirmDigestSnapshot(storage, key, before.snapshot);
  if (!confirmed.ok) return confirmed;
  if (!commitIsStillAuthorized(guard)) {
    return { ok: false, reason: "commit-cancelled" };
  }

  // This is an exact compare-and-verify guard, not a multi-key transaction.
  // Callers still coordinate mutations with the workspace Web Lock.
  const written = writeExact(storage, key, serializedTarget);
  if (!written.ok) return exactMutationFailure(written);
  const after = await readDigestSnapshot(storage, key);
  if (!after.ok) return after;
  if (
    after.snapshot.raw !== serializedTarget ||
    after.snapshot.digest !== guard.targetDigest
  ) {
    return { ok: false, reason: "readback-mismatch" };
  }
  workspaceProtocolCheckpoint(storage, checkpoint);
  return { ok: true, state: "applied" };
}

async function removeWithDigestGuard(
  storage: WorkspaceStorageAdapter,
  key: string,
  guard: WorkspaceDigestRemoveGuard,
  checkpoint: WorkspaceProtocolCheckpoint,
): Promise<WorkspaceDigestMutationResult> {
  if (!WORKSPACE_DIGEST_PATTERN.test(guard.expectedBeforeDigest)) {
    return { ok: false, reason: "invalid-digest" };
  }

  const before = await readDigestSnapshot(storage, key);
  if (!before.ok) return before;
  if (before.snapshot.raw === null) {
    const confirmed = await confirmDigestSnapshot(storage, key, before.snapshot);
    if (!confirmed.ok) return confirmed;
    workspaceProtocolCheckpoint(storage, checkpoint);
    return { ok: true, state: "already-target" };
  }
  if (before.snapshot.digest !== guard.expectedBeforeDigest) {
    return { ok: false, reason: "baseline-mismatch" };
  }

  const confirmed = await confirmDigestSnapshot(storage, key, before.snapshot);
  if (!confirmed.ok) return confirmed;
  if (!commitIsStillAuthorized(guard)) {
    return { ok: false, reason: "commit-cancelled" };
  }
  const removed = removeExact(storage, key);
  if (!removed.ok) return exactMutationFailure(removed);
  const after = await readDigestSnapshot(storage, key);
  if (!after.ok) return after;
  if (after.snapshot.raw !== null || after.snapshot.digest !== null) {
    return { ok: false, reason: "readback-mismatch" };
  }
  workspaceProtocolCheckpoint(storage, checkpoint);
  return { ok: true, state: "applied" };
}

export function writeWorkspaceJournalPhase(
  storage: WorkspaceStorageAdapter,
  serializedJournal: string,
  guard: WorkspaceDigestWriteGuard,
): Promise<WorkspaceDigestMutationResult> {
  return writeWithDigestGuard(
    storage,
    WORKSPACE_OPERATION_KEY,
    serializedJournal,
    guard,
    "journal-phase-update",
  );
}

export function removeWorkspaceJournal(
  storage: WorkspaceStorageAdapter,
  guard: WorkspaceDigestRemoveGuard,
): Promise<WorkspaceDigestMutationResult> {
  return removeWithDigestGuard(
    storage,
    WORKSPACE_OPERATION_KEY,
    guard,
    "journal-removal",
  );
}

export function writeWorkspaceProjectTarget(
  storage: WorkspaceStorageAdapter,
  key: string,
  serializedRecord: string,
  guard: WorkspaceDigestWriteGuard,
): Promise<WorkspaceDigestMutationResult> {
  return writeWithDigestGuard(
    storage,
    key,
    serializedRecord,
    guard,
    "project-target-write",
  );
}

export function writeWorkspaceIndexTarget(
  storage: WorkspaceStorageAdapter,
  serializedIndex: string,
  guard: WorkspaceDigestWriteGuard,
): Promise<WorkspaceDigestMutationResult> {
  return writeWithDigestGuard(
    storage,
    WORKSPACE_INDEX_KEY,
    serializedIndex,
    guard,
    "index-commit",
  );
}

export function removeWorkspaceCleanupSource(
  storage: WorkspaceStorageAdapter,
  key: string,
  guard: WorkspaceDigestRemoveGuard,
): Promise<WorkspaceDigestMutationResult> {
  return removeWithDigestGuard(storage, key, guard, "source-cleanup");
}

export function removeWorkspaceReserve(
  storage: WorkspaceStorageAdapter,
): ExactStorageMutationResult {
  const result = removeExact(storage, WORKSPACE_RESERVE_KEY);
  if (result.ok) workspaceProtocolCheckpoint(storage, "reserve-removal");
  return result;
}

export function recreateWorkspaceReserve(
  storage: WorkspaceStorageAdapter,
  serializedReserve: string,
): ExactStorageMutationResult {
  const result = writeExact(storage, WORKSPACE_RESERVE_KEY, serializedReserve);
  if (result.ok) workspaceProtocolCheckpoint(storage, "reserve-recreation");
  return result;
}
