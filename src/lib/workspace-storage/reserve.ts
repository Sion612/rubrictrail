import type { WorkspaceReserveV1 } from "@/lib/workspace-storage/types";

export const WORKSPACE_RESERVE_CODE_UNITS = 262_144;
export const WORKSPACE_RESERVE_PADDING_CODE_UNITS = 262_112;

const RESERVE_PREFIX = '{"formatVersion":1,"padding":"';
const RESERVE_SUFFIX = '"}';

export function serializeWorkspaceReserve(): string {
  const serialized = `${RESERVE_PREFIX}${"0".repeat(
    WORKSPACE_RESERVE_PADDING_CODE_UNITS,
  )}${RESERVE_SUFFIX}`;
  if (serialized.length !== WORKSPACE_RESERVE_CODE_UNITS) {
    throw new Error("Workspace reserve serialization invariant failed");
  }
  return serialized;
}

export const CANONICAL_WORKSPACE_RESERVE = serializeWorkspaceReserve();

export function parseWorkspaceReserve(raw: string): WorkspaceReserveV1 | null {
  if (
    raw.length !== WORKSPACE_RESERVE_CODE_UNITS ||
    raw !== CANONICAL_WORKSPACE_RESERVE
  ) {
    return null;
  }
  return {
    formatVersion: 1,
    padding: "0".repeat(WORKSPACE_RESERVE_PADDING_CODE_UNITS),
  };
}

export type WorkspaceReserveState = "valid" | "missing" | "invalid";

export function classifyWorkspaceReserve(raw: string | null): WorkspaceReserveState {
  if (raw === null) return "missing";
  return parseWorkspaceReserve(raw) ? "valid" : "invalid";
}
