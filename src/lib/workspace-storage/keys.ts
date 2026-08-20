export const WORKSPACE_INDEX_KEY = "rubrictrail.workspace.index.v1";
export const WORKSPACE_OPERATION_KEY = "rubrictrail.workspace.operation.v1";
export const WORKSPACE_RESERVE_KEY = "rubrictrail.workspace.reserve.v1";
export const WORKSPACE_PREFERENCES_KEY = "rubrictrail.workspace.preferences.v1";

export const LEGACY_PROJECT_KEYS = {
  record: "rubrictrail.project.store.v1",
  v3: "rubrictrail.project.v3",
  v2: "rubrictrail.project.v2",
  v1: "proofline.project.v1",
} as const;

export const WORKSPACE_LOCK_NAME = LEGACY_PROJECT_KEYS.record;

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROJECT_RECORD_KEY_PATTERN =
  /^rubrictrail\.workspace\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.generation\.([1-9]\d*)\.project\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.v1$/;

export interface WorkspaceProjectKeyIdentity {
  workspaceId: string;
  workspaceGeneration: number;
  projectId: string;
}

export function isWorkspaceUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_V4_PATTERN.test(value);
}

export function workspaceProjectRecordKey(
  workspaceId: string,
  workspaceGeneration: number,
  projectId: string,
): string {
  if (
    !isWorkspaceUuid(workspaceId) ||
    !Number.isSafeInteger(workspaceGeneration) ||
    workspaceGeneration < 1 ||
    !isWorkspaceUuid(projectId)
  ) {
    throw new TypeError("Invalid workspace project key identity");
  }
  return `rubrictrail.workspace.${workspaceId}.generation.${workspaceGeneration}.project.${projectId}.v1`;
}

export function parseWorkspaceProjectRecordKey(
  key: string,
): WorkspaceProjectKeyIdentity | null {
  const match = PROJECT_RECORD_KEY_PATTERN.exec(key);
  if (!match) return null;
  const workspaceGeneration = Number(match[2]);
  if (!Number.isSafeInteger(workspaceGeneration) || workspaceGeneration < 1) {
    return null;
  }
  return {
    workspaceId: match[1],
    workspaceGeneration,
    projectId: match[3],
  };
}

export type WorkspaceOwnedKeyKind =
  | "index"
  | "operation"
  | "reserve"
  | "preferences"
  | "project";

export function recognizeWorkspaceOwnedKey(
  key: string,
): { kind: WorkspaceOwnedKeyKind; project?: WorkspaceProjectKeyIdentity } | null {
  if (key === WORKSPACE_INDEX_KEY) return { kind: "index" };
  if (key === WORKSPACE_OPERATION_KEY) return { kind: "operation" };
  if (key === WORKSPACE_RESERVE_KEY) return { kind: "reserve" };
  if (key === WORKSPACE_PREFERENCES_KEY) return { kind: "preferences" };
  const project = parseWorkspaceProjectRecordKey(key);
  return project ? { kind: "project", project } : null;
}

export interface SecureUuidSource {
  randomUUID(): string;
}

export function generateSecureWorkspaceUuid(
  source: SecureUuidSource | null | undefined = globalThis.crypto,
): string | null {
  if (!source || typeof source.randomUUID !== "function") return null;
  try {
    const value = source.randomUUID();
    return isWorkspaceUuid(value) ? value : null;
  } catch {
    return null;
  }
}

export function generateCollisionCheckedUuid(
  isCollision: (candidate: string) => boolean,
  source: SecureUuidSource | null | undefined = globalThis.crypto,
): string | null {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = generateSecureWorkspaceUuid(source);
    if (candidate === null) return null;
    if (!isCollision(candidate)) return candidate;
  }
  return null;
}
