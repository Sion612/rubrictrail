import { describe, expect, it } from "vitest";
import {
  createDefaultProjectState,
  parseLegacyProjectStateValue,
  parsePersistedProjectStateValue,
  parsePreviousProjectStateValue,
  parseProjectStorageRecordValue,
} from "@/lib/local-state";
import {
  LEGACY_ACTIVE_RECORD_RAW,
} from "@/lib/workspace-storage/test-fixtures";
import { resolveSingleProjectMigrationSource } from "@/lib/workspace-storage/legacy-migration";

function snapshot(overrides: Partial<Parameters<typeof resolveSingleProjectMigrationSource>[0]> = {}) {
  return {
    recordValue: null,
    legacyV3Value: null,
    legacyV2Value: null,
    legacyV1Value: null,
    ...overrides,
  };
}

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

function v3Raw(overrides: Partial<ReturnType<typeof createDefaultProjectState>> = {}): string {
  return JSON.stringify({ ...createDefaultProjectState(), ...overrides });
}

function v2Raw(overrides: Record<string, unknown> = {}): string {
  const { supersededV2Fingerprint, ...state } = createDefaultProjectState();
  void supersededV2Fingerprint;
  return JSON.stringify({ ...state, version: 2, ...overrides });
}

function v1Raw(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    sampleLoaded: false,
    view: "overview",
    draftText: "fictional legacy draft",
    completedTaskIds: [],
    weeklyHours: 10,
    targetGrade: 70,
    selectedSectionId: "analysis-and-recommendations",
    readinessChecks: [],
    ...overrides,
  });
}

function clearedRecordRaw(): string {
  return JSON.stringify({
    formatVersion: 1,
    revision: 2,
    value: { kind: "cleared" },
    legacyFingerprints: { v3: null, v2: null, v1: null },
  });
}

describe("resolveSingleProjectMigrationSource", () => {
  it("uses a valid active v0.7.1 record as exact authority without altering source bytes", () => {
    const input = snapshot({ recordValue: LEGACY_ACTIVE_RECORD_RAW });
    const before = structuredClone(input);
    const parsed = parseProjectStorageRecordValue(LEGACY_ACTIVE_RECORD_RAW);
    if (!parsed || parsed.status !== "active" || parsed.state === null) {
      throw new Error("active record fixture must be valid");
    }

    expect(resolveSingleProjectMigrationSource(input)).toEqual({
      ok: true,
      kind: "project",
      state: parsed.state,
    });
    expect(input).toEqual(before);
    expect(input.recordValue).toBe(LEGACY_ACTIVE_RECORD_RAW);
  });

  it("uses a valid cleared v0.7.1 record as exact authority", () => {
    const raw = clearedRecordRaw();
    expect(parseProjectStorageRecordValue(raw)?.status).toBe("cleared");
    expect(resolveSingleProjectMigrationSource(snapshot({ recordValue: raw }))).toEqual({
      ok: true,
      kind: "cleared",
    });
  });

  it("fails closed for an invalid record or a record whose exact legacy baseline changed", () => {
    expect(resolveSingleProjectMigrationSource(snapshot({ recordValue: "not-json" }))).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(resolveSingleProjectMigrationSource(snapshot({
      recordValue: LEGACY_ACTIVE_RECORD_RAW,
      legacyV3Value: v3Raw(),
    }))).toEqual({ ok: false, reason: "conflict" });
  });

  it("uses v3 when no record exists and leaves all source strings intact", () => {
    const raw = v3Raw({ draftText: "fictional v3 draft" });
    const input = snapshot({ legacyV3Value: raw });
    const before = structuredClone(input);
    const parsed = parsePersistedProjectStateValue(JSON.parse(raw));
    if (!parsed.ok) throw new Error("v3 fixture must be valid");

    expect(resolveSingleProjectMigrationSource(input)).toEqual({
      ok: true,
      kind: "project",
      state: parsed.state,
    });
    expect(input).toEqual(before);
  });

  it("accepts a divergent v2 only when the v3 state names its exact superseded fingerprint", () => {
    const v2 = v2Raw({ draftText: "fictional older v2 draft" });
    const rawV3 = v3Raw({
      draftText: "fictional current v3 draft",
      supersededV2Fingerprint: legacyFingerprint(v2),
    });
    const parsedV3 = parsePersistedProjectStateValue(JSON.parse(rawV3));
    if (!parsedV3.ok) throw new Error("v3 fixture must be valid");

    expect(resolveSingleProjectMigrationSource(snapshot({
      legacyV3Value: rawV3,
      legacyV2Value: v2,
    }))).toEqual({ ok: true, kind: "project", state: parsedV3.state });
  });

  it("rejects divergent v3/v2 values and an invalid present v3 before considering lower-priority keys", () => {
    expect(resolveSingleProjectMigrationSource(snapshot({
      legacyV3Value: v3Raw({ draftText: "fictional v3" }),
      legacyV2Value: v2Raw({ draftText: "fictional v2" }),
    }))).toEqual({ ok: false, reason: "conflict" });
    expect(resolveSingleProjectMigrationSource(snapshot({
      legacyV3Value: "invalid-v3",
      legacyV2Value: v2Raw(),
    }))).toEqual({ ok: false, reason: "invalid" });
  });

  it("uses v2 when v3 is absent and rejects a divergent valid v1 alternative", () => {
    const rawV2 = v2Raw({ draftText: "fictional v2 authority" });
    const parsedV2 = parsePreviousProjectStateValue(rawV2);
    if (!parsedV2.ok) throw new Error("v2 fixture must be valid");
    expect(resolveSingleProjectMigrationSource(snapshot({ legacyV2Value: rawV2 }))).toEqual({
      ok: true,
      kind: "project",
      state: parsedV2.state,
    });
    expect(resolveSingleProjectMigrationSource(snapshot({
      legacyV2Value: rawV2,
      legacyV1Value: v1Raw({ draftText: "fictional v1 conflict" }),
    }))).toEqual({ ok: false, reason: "conflict" });
  });

  it("uses v1 only when it is the sole valid authority", () => {
    const raw = v1Raw();
    const parsed = parseLegacyProjectStateValue(raw);
    if (parsed === null) throw new Error("v1 fixture must be valid");
    expect(resolveSingleProjectMigrationSource(snapshot({ legacyV1Value: raw }))).toEqual({
      ok: true,
      kind: "project",
      state: parsed,
    });
  });

  it("distinguishes absent storage from invalid present storage", () => {
    expect(resolveSingleProjectMigrationSource(snapshot())).toEqual({ ok: false, reason: "absent" });
    expect(resolveSingleProjectMigrationSource(snapshot({ legacyV2Value: "invalid-v2" }))).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(resolveSingleProjectMigrationSource(snapshot({ legacyV1Value: "invalid-v1" }))).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
