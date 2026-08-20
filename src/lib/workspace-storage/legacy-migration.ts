import {
  parseLegacyProjectStateValue,
  parsePersistedProjectStateValue,
  parsePreviousProjectStateValue,
  parseProjectStorageRecordValue,
} from "@/lib/local-state";
import type { PersistedProjectState } from "@/lib/ui-types";

export interface SingleProjectMigrationSnapshot {
  recordValue: string | null;
  legacyV3Value: string | null;
  legacyV2Value: string | null;
  legacyV1Value: string | null;
}

export type SingleProjectMigrationSource =
  | { ok: true; kind: "project"; state: PersistedProjectState }
  | { ok: true; kind: "cleared" }
  | { ok: false; reason: "absent" | "invalid" | "conflict" };

function legacyFingerprint(raw: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < raw.length; index += 1) {
    const codeUnit = raw.charCodeAt(index);
    first = Math.imul(first ^ codeUnit, 0x01000193);
    second = Math.imul(second ^ codeUnit, 0x85ebca6b);
    second ^= second >>> 13;
  }
  const hex = (value: number): string => (value >>> 0).toString(16).padStart(8, "0");
  return `v1:${raw.length}:${hex(first)}:${hex(second)}`;
}

function parseV3(raw: string): PersistedProjectState | null {
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
    return parsed.ok ? parsed.state : null;
  } catch {
    return null;
  }
}

function parseV2(raw: string): PersistedProjectState | null {
  const parsed = parsePreviousProjectStateValue(raw);
  return parsed.ok ? parsed.state : null;
}

function canonicalStatesEquivalent(
  left: PersistedProjectState,
  right: PersistedProjectState,
): boolean {
  return JSON.stringify({ ...left, supersededV2Fingerprint: null }) ===
    JSON.stringify({ ...right, supersededV2Fingerprint: null });
}

function alternativeAgrees(
  primary: PersistedProjectState,
  raw: string | null,
  parsed: PersistedProjectState | null,
  superseded = false,
): boolean {
  return (
    raw === null ||
    superseded ||
    (parsed !== null && canonicalStatesEquivalent(primary, parsed))
  );
}

/**
 * Resolves the exact v0.7.1 authority bytes without reading browser globals.
 * Any divergent or invalid higher-priority value fails closed; this function
 * never chooses a migration candidate by time, revision, or key order.
 */
export function resolveSingleProjectMigrationSource(
  snapshot: SingleProjectMigrationSnapshot,
): SingleProjectMigrationSource {
  if (snapshot.recordValue !== null) {
    const record = parseProjectStorageRecordValue(snapshot.recordValue);
    if (!record) return { ok: false, reason: "invalid" };
    const legacyMatches =
      record.record.legacyFingerprints.v3 ===
        (snapshot.legacyV3Value === null ? null : legacyFingerprint(snapshot.legacyV3Value)) &&
      record.record.legacyFingerprints.v2 ===
        (snapshot.legacyV2Value === null ? null : legacyFingerprint(snapshot.legacyV2Value)) &&
      record.record.legacyFingerprints.v1 ===
        (snapshot.legacyV1Value === null ? null : legacyFingerprint(snapshot.legacyV1Value));
    if (!legacyMatches) return { ok: false, reason: "conflict" };
    return record.status === "cleared"
      ? { ok: true, kind: "cleared" }
      : record.state === null
        ? { ok: false, reason: "invalid" }
        : { ok: true, kind: "project", state: record.state };
  }

  const parsedV3 = snapshot.legacyV3Value === null
    ? null
    : parseV3(snapshot.legacyV3Value);
  const parsedV2 = snapshot.legacyV2Value === null ? null : parseV2(snapshot.legacyV2Value);
  const parsedV1 = snapshot.legacyV1Value === null
    ? null
    : parseLegacyProjectStateValue(snapshot.legacyV1Value);

  if (snapshot.legacyV3Value !== null) {
    if (parsedV3 === null) return { ok: false, reason: "invalid" };
    const v2Superseded =
      snapshot.legacyV2Value !== null &&
      parsedV3.supersededV2Fingerprint === legacyFingerprint(snapshot.legacyV2Value);
    if (
      !alternativeAgrees(parsedV3, snapshot.legacyV2Value, parsedV2, v2Superseded) ||
      !alternativeAgrees(parsedV3, snapshot.legacyV1Value, parsedV1)
    ) {
      return { ok: false, reason: "conflict" };
    }
    return { ok: true, kind: "project", state: parsedV3 };
  }

  if (parsedV2 !== null) {
    if (!alternativeAgrees(parsedV2, snapshot.legacyV1Value, parsedV1)) {
      return { ok: false, reason: "conflict" };
    }
    return { ok: true, kind: "project", state: parsedV2 };
  }

  if (parsedV1 !== null) {
    return { ok: true, kind: "project", state: parsedV1 };
  }
  return snapshot.legacyV2Value === null && snapshot.legacyV1Value === null
    ? { ok: false, reason: "absent" }
    : { ok: false, reason: "invalid" };
}
