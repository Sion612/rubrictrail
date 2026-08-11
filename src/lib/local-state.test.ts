import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearProjectState,
  createDefaultProjectState,
  parsePreviousProjectStateValue,
  parsePersistedProjectStateValue,
  PREVIOUS_STORAGE_KEY,
  readProjectState,
  readProjectStateWithStatus,
  STORAGE_KEY,
  writeProjectState,
} from "@/lib/local-state";
import {
  maximumSupportedDueDate,
  UPLOADED_REVIEW_MAX_CHARACTERS,
} from "@/lib/uploaded-project";
import type { PersistedProjectState, UploadedProject } from "@/lib/ui-types";

const LEGACY_STORAGE_KEY = "proofline.project.v1";

function uploadedProject(): UploadedProject {
  return {
    id: "uploaded-1",
    title: "Strategy Report",
    course: "BUS302",
    dueDate: "2026-09-24",
    wordCount: 2_500,
    citationStyle: "APA 7",
    fileNames: ["brief.txt"],
    extractedWordCount: 120,
    weightingStatus: "complete",
    criteria: [
      {
        id: "analysis-1",
        name: "Analysis",
        weight: 100,
        evidence: {
          sourceId: "source-1",
          fileName: "brief.txt",
          page: null,
          excerpt: "Analysis | 100%",
          startOffset: 40,
          endOffset: 55,
        },
      },
    ],
    createdAt: "2026-08-12T00:00:00.000Z",
  };
}

function uploadedState(): PersistedProjectState {
  return {
    ...createDefaultProjectState(),
    projectKind: "uploaded",
    uploadedProject: uploadedProject(),
    draftText: "",
    uploadedCriterionReviews: [
      {
        criterionId: "analysis-1",
        draftText: "A source-linked analysis paragraph.",
        evidenceVisible: true,
        linkExplained: true,
        sourceTraceable: true,
        updatedAt: "2026-08-12T00:00:00.000Z",
      },
    ],
  };
}

function v2Value(state: PersistedProjectState = uploadedState()): Record<string, unknown> {
  const v2State: Record<string, unknown> = { ...state };
  delete v2State.supersededV2Fingerprint;
  const uploadedProject = state.uploadedProject;
  delete v2State.uploadedProject;
  let v2UploadedProject: Record<string, unknown> | null = null;
  if (uploadedProject) {
    const project: Record<string, unknown> = { ...uploadedProject };
    delete project.weightingStatus;
    v2UploadedProject = project;
  }
  return { ...v2State, version: 2, uploadedProject: v2UploadedProject };
}

function unweightedUploadedState(): PersistedProjectState {
  const state = uploadedState();
  state.uploadedProject = {
    ...state.uploadedProject!,
    weightingStatus: "none",
    criteria: [
      {
        ...state.uploadedProject!.criteria[0],
        weight: null,
      },
      {
        id: "evidence-1",
        name: "Use of evidence",
        weight: null,
        evidence: null,
      },
    ],
  };
  return state;
}

function partiallyWeightedUploadedState(): PersistedProjectState {
  const state = unweightedUploadedState();
  state.uploadedProject = {
    ...state.uploadedProject!,
    weightingStatus: "incomplete",
    criteria: [
      {
        ...state.uploadedProject!.criteria[0],
        weight: 60,
      },
      state.uploadedProject!.criteria[1],
    ],
  };
  return state;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("local project persistence", () => {
  it("reports unsupported versions separately from malformed state", () => {
    expect(parsePersistedProjectStateValue({ version: 4 })).toEqual({
      ok: false,
      reason: "unsupported-version",
    });
    expect(parsePersistedProjectStateValue({ version: "3" })).toEqual({
      ok: false,
      reason: "invalid-state",
    });
  });

  it("round-trips a deeply validated uploaded v3 project", () => {
    const state = uploadedState();

    const writeResult = writeProjectState(state);
    expect(writeResult).toEqual({ ok: true, serialized: expect.any(String) });
    if (!writeResult.ok) throw new Error("Expected project state write to succeed");
    expect(readProjectStateWithStatus()).toEqual({
      state,
      source: "v3",
      recovered: false,
      storedValue: writeResult.serialized,
      previousStoredValue: null,
      crossVersionConflict: false,
      storageAvailable: true,
    });
    expect(readProjectState()).toEqual(state);
  });

  it("round-trips a v3 project whose rubric publishes no weights", () => {
    const state = unweightedUploadedState();

    const writeResult = writeProjectState(state);
    expect(writeResult).toEqual({ ok: true, serialized: expect.any(String) });
    expect(readProjectStateWithStatus()).toMatchObject({
      state,
      source: "v3",
      recovered: false,
      storageAvailable: true,
    });
  });

  it("migrates a valid local v2 project while preserving numeric weights", () => {
    const expected = uploadedState();
    const previousRaw = JSON.stringify(v2Value(expected));
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, previousRaw);

    expect(readProjectStateWithStatus()).toEqual({
      state: expected,
      source: "v2",
      recovered: true,
      storedValue: null,
      previousStoredValue: previousRaw,
      crossVersionConflict: false,
      storageAvailable: true,
    });
    expect(readProjectStateWithStatus().state.uploadedProject?.criteria[0].weight).toBe(
      100,
    );
  });

  it("parses a v2 backup as recovered v3 state", () => {
    const expected = uploadedState();
    const raw = JSON.stringify(v2Value(expected));

    expect(parsePersistedProjectStateValue(v2Value(expected))).toEqual({
      ok: true,
      state: expected,
      recovered: true,
    });
    expect(parsePreviousProjectStateValue(raw)).toEqual({
      ok: true,
      state: expected,
      recovered: true,
    });
    expect(parsePreviousProjectStateValue(JSON.stringify(expected))).toEqual({
      ok: false,
      reason: "unsupported-version",
    });
  });

  it("accepts retained partial weights only with incomplete status", () => {
    const state = partiallyWeightedUploadedState();

    expect(writeProjectState(state)).toEqual({
      ok: true,
      serialized: expect.any(String),
    });

    state.uploadedProject!.weightingStatus = "complete";
    expect(writeProjectState(state)).toEqual({ ok: false, reason: "invalid-state" });
  });

  it("keeps explicit incomplete semantics even when retained numbers total 100", () => {
    const state = uploadedState();
    state.uploadedProject!.weightingStatus = "incomplete";

    expect(writeProjectState(state)).toEqual({
      ok: true,
      serialized: expect.any(String),
    });
  });

  it("requires none status when no criterion has a published percentage", () => {
    const state = unweightedUploadedState();
    state.uploadedProject!.weightingStatus = "incomplete";

    expect(writeProjectState(state)).toEqual({ ok: false, reason: "invalid-state" });
  });

  it("does not accept unavailable weights in the v2 format", () => {
    expect(parsePersistedProjectStateValue(v2Value(unweightedUploadedState()))).toEqual({
      ok: false,
      reason: "invalid-state",
    });
  });

  it("recovers to defaults from malformed v3 JSON", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not valid JSON");

    expect(readProjectStateWithStatus()).toEqual({
      state: createDefaultProjectState(),
      source: "default",
      recovered: true,
      storedValue: "{not valid JSON",
      previousStoredValue: null,
      crossVersionConflict: false,
      storageAvailable: true,
    });
  });

  it("rejects structurally invalid nested uploaded data", () => {
    const state = uploadedState() as unknown as Record<string, unknown>;
    const project = state.uploadedProject as UploadedProject;
    project.criteria[0].evidence = {
      ...project.criteria[0].evidence!,
      page: -1,
    };
    const storedValue = JSON.stringify(state);
    window.localStorage.setItem(STORAGE_KEY, storedValue);

    expect(readProjectStateWithStatus()).toEqual({
      state: createDefaultProjectState(),
      source: "default",
      recovered: true,
      storedValue,
      previousStoredValue: null,
      crossVersionConflict: false,
      storageAvailable: true,
    });
  });

  it("continues to a valid legacy project when v2 is structurally invalid", () => {
    const invalidV2 = JSON.stringify({
      version: 2,
      projectKind: "uploaded",
      uploadedProject: null,
    });
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, invalidV2);
    window.localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify({
        sampleLoaded: true,
        view: "draft",
        completedTaskIds: ["p1", "removed-task"],
        weeklyHours: 8,
        targetGrade: 75,
        draftText: "My retained legacy draft",
        selectedSectionId: "analysis-and-recommendations",
        readinessChecks: ["sources"],
      }),
    );

    const result = readProjectStateWithStatus();
    expect(result.source).toBe("legacy");
    expect(result.recovered).toBe(true);
    expect(result.storedValue).toBeNull();
    expect(result.previousStoredValue).toBe(invalidV2);
    expect(result.storageAvailable).toBe(true);
    expect(result.state).toMatchObject({
      projectKind: "sample",
      view: "draft",
      completedTaskIds: ["p1"],
      weeklyHours: 8,
      targetGrade: 75,
      draftText: "My retained legacy draft",
      selectedSectionId: "analysis-recommendations",
    });
  });

  it("repairs obsolete v3 task ids without discarding the project", () => {
    const state = {
      ...createDefaultProjectState(),
      projectKind: "sample" as const,
      completedTaskIds: ["p1", "removed-task"],
      readinessChecks: ["sources", "removed-check"],
    };
    const storedValue = JSON.stringify(state);
    window.localStorage.setItem(STORAGE_KEY, storedValue);

    expect(readProjectStateWithStatus()).toEqual({
      state: {
        ...state,
        completedTaskIds: ["p1"],
        readinessChecks: ["sources"],
      },
      source: "v3",
      recovered: true,
      storedValue,
      previousStoredValue: null,
      crossVersionConflict: false,
      storageAvailable: true,
    });
  });

  it("reports a missing current storage value as null", () => {
    const result = readProjectStateWithStatus();
    expect(result.storedValue).toBeNull();
    expect(result.storageAvailable).toBe(true);
  });

  it("reports divergent v3 and v2 bytes as a cold-start conflict", () => {
    const current = uploadedState();
    current.targetGrade = 82;
    const currentRaw = JSON.stringify(current);
    const previous = uploadedState();
    previous.targetGrade = 64;
    const previousRaw = JSON.stringify(v2Value(previous));
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, previousRaw);
    window.localStorage.setItem(STORAGE_KEY, currentRaw);

    expect(readProjectStateWithStatus()).toEqual({
      state: current,
      source: "v3",
      recovered: false,
      storedValue: currentRaw,
      previousStoredValue: previousRaw,
      crossVersionConflict: true,
      storageAvailable: true,
    });
  });

  it("accepts equivalent v3 and migrated v2 states without a lineage marker", () => {
    const state = uploadedState();
    const currentRaw = JSON.stringify(state);
    const previousRaw = JSON.stringify(v2Value(state));
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, previousRaw);
    window.localStorage.setItem(STORAGE_KEY, currentRaw);

    expect(readProjectStateWithStatus()).toMatchObject({
      source: "v3",
      state,
      previousStoredValue: previousRaw,
      crossVersionConflict: false,
    });
  });

  it("does not fall back to v2 when current v3 bytes exist but are invalid", () => {
    const malformedV3 = "{not valid JSON";
    const previousRaw = JSON.stringify(v2Value());
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, previousRaw);
    window.localStorage.setItem(STORAGE_KEY, malformedV3);

    expect(readProjectStateWithStatus()).toEqual({
      state: createDefaultProjectState(),
      source: "default",
      recovered: true,
      storedValue: malformedV3,
      previousStoredValue: previousRaw,
      crossVersionConflict: true,
      storageAvailable: true,
    });
  });

  it("distinguishes an unavailable storage read from a missing project", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });

    expect(readProjectStateWithStatus()).toMatchObject({
      source: "default",
      recovered: true,
      storedValue: null,
      storageAvailable: false,
    });
  });

  it("conditionally writes when the expected storage value is null", () => {
    const result = writeProjectState(createDefaultProjectState(), null);

    expect(result).toEqual({ ok: true, serialized: expect.any(String) });
    if (!result.ok) throw new Error("Expected project state write to succeed");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(result.serialized);
  });

  it("retains superseded v2 bytes and records their lineage after a v3 write", () => {
    const previousRaw = JSON.stringify(v2Value());
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, previousRaw);
    window.localStorage.setItem(LEGACY_STORAGE_KEY, "legacy bytes");

    const result = writeProjectState(createDefaultProjectState(), null, previousRaw);

    expect(result).toEqual({ ok: true, serialized: expect.any(String) });
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe(previousRaw);
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    expect(JSON.parse(result.ok ? result.serialized : "{}")).toMatchObject({
      supersededV2Fingerprint: expect.stringMatching(
        /^v1:\d+:[0-9a-f]{8}:[0-9a-f]{8}$/,
      ),
    });
    expect(readProjectStateWithStatus()).toMatchObject({
      source: "v3",
      previousStoredValue: previousRaw,
      crossVersionConflict: false,
    });

    const newerV2 = JSON.stringify(v2Value({
      ...uploadedState(),
      targetGrade: 88,
    }));
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, newerV2);
    expect(readProjectStateWithStatus()).toMatchObject({
      source: "v3",
      previousStoredValue: newerV2,
      crossVersionConflict: true,
    });
  });

  it("fails closed when a v2 project changes before promotion", () => {
    const observedPrevious = JSON.stringify(v2Value());
    const newerV2 = JSON.stringify(v2Value({
      ...uploadedState(),
      targetGrade: 81,
    }));
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, observedPrevious);
    const read = readProjectStateWithStatus();
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, newerV2);

    expect(
      writeProjectState(read.state, read.storedValue, read.previousStoredValue),
    ).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe(newerV2);
  });

  it("rolls back its v3 write when v2 changes during promotion", () => {
    const observedPrevious = JSON.stringify(v2Value());
    const newerV2 = JSON.stringify(v2Value({
      ...uploadedState(),
      targetGrade: 83,
    }));
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, observedPrevious);
    const read = readProjectStateWithStatus();
    const nativeSetItem = Storage.prototype.setItem;
    let injected = false;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      nativeSetItem.call(this, key, value);
      if (key === STORAGE_KEY && !injected) {
        injected = true;
        nativeSetItem.call(this, PREVIOUS_STORAGE_KEY, newerV2);
      }
    });

    expect(
      writeProjectState(read.state, read.storedValue, read.previousStoredValue),
    ).toEqual({ ok: false, reason: "conflict" });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe(newerV2);
  });

  it("refuses to shadow v2 bytes unless their observed revision is supplied", () => {
    const previousRaw = JSON.stringify(v2Value());
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, previousRaw);

    const result = writeProjectState(createDefaultProjectState(), null);

    expect(result).toEqual({ ok: false, reason: "conflict" });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe(previousRaw);
  });

  it("conditionally writes when the expected storage value matches", () => {
    const initialResult = writeProjectState(createDefaultProjectState());
    if (!initialResult.ok) throw new Error("Expected initial project state write to succeed");
    const updated = uploadedState();

    const result = writeProjectState(updated, initialResult.serialized);

    expect(result).toEqual({ ok: true, serialized: expect.any(String) });
    if (!result.ok) throw new Error("Expected conditional project state write to succeed");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(result.serialized);
    expect(result.serialized).not.toBe(initialResult.serialized);
  });

  it("rejects a stale expected value without changing stored bytes", () => {
    const storedValue = '{"sentinel":"preserve exact bytes"}';
    window.localStorage.setItem(STORAGE_KEY, storedValue);

    expect(writeProjectState(createDefaultProjectState(), "stale value")).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(storedValue);
  });

  it("returns storage-error without writing when the conditional read throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    expect(writeProjectState(createDefaultProjectState(), null)).toEqual({
      ok: false,
      reason: "storage-error",
    });
    expect(setItem).not.toHaveBeenCalled();
  });

  it("conditionally clears only the storage value this tab observed", () => {
    const initialResult = writeProjectState(createDefaultProjectState());
    if (!initialResult.ok) throw new Error("Expected initial project state write to succeed");

    expect(clearProjectState("stale value")).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(initialResult.serialized);

    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, "previous bytes");
    window.localStorage.setItem(LEGACY_STORAGE_KEY, "legacy bytes");
    expect(clearProjectState(initialResult.serialized, "previous bytes")).toEqual({
      ok: true,
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });

  it("fails closed when a v2 project changes before a migrated clear", () => {
    const observedPrevious = JSON.stringify(v2Value());
    const newerV2 = JSON.stringify(v2Value({
      ...uploadedState(),
      targetGrade: 84,
    }));
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, observedPrevious);
    window.localStorage.setItem(LEGACY_STORAGE_KEY, "legacy bytes");
    const read = readProjectStateWithStatus();
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, newerV2);

    expect(
      clearProjectState(read.storedValue, read.previousStoredValue),
    ).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe(newerV2);
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBe("legacy bytes");
  });

  it("restores v3 and preserves newer v2 bytes when clear detects a race", () => {
    const initialResult = writeProjectState(createDefaultProjectState());
    if (!initialResult.ok) throw new Error("Expected initial write to succeed");
    const observedPrevious = JSON.stringify(v2Value());
    const newerV2 = JSON.stringify(v2Value({
      ...uploadedState(),
      targetGrade: 86,
    }));
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, observedPrevious);
    const nativeRemoveItem = Storage.prototype.removeItem;
    const nativeSetItem = Storage.prototype.setItem;
    let injected = false;
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      nativeRemoveItem.call(this, key);
      if (key === STORAGE_KEY && !injected) {
        injected = true;
        nativeSetItem.call(this, PREVIOUS_STORAGE_KEY, newerV2);
      }
    });

    expect(
      clearProjectState(initialResult.serialized, observedPrevious),
    ).toEqual({ ok: false, reason: "conflict" });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(initialResult.serialized);
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe(newerV2);
  });

  it("requires both observed baselines before clearing a v2-only project", () => {
    const previousRaw = JSON.stringify(v2Value());
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, previousRaw);

    expect(clearProjectState(null)).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe(previousRaw);

    expect(clearProjectState(null, previousRaw)).toEqual({ ok: true });
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBeNull();
  });

  it("rejects invalid state before writing", () => {
    const invalid = {
      ...uploadedState(),
      uploadedProject: null,
    } as PersistedProjectState;

    expect(writeProjectState(invalid)).toEqual({ ok: false, reason: "invalid-state" });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("rejects uploaded projects outside the bounded planning inputs", () => {
    const oversized = uploadedState();
    oversized.uploadedProject!.wordCount = 50_001;
    expect(writeProjectState(oversized)).toEqual({
      ok: false,
      reason: "invalid-state",
    });

    const tooDistant = uploadedState();
    const maximum = maximumSupportedDueDate();
    tooDistant.uploadedProject!.dueDate = `${Number(maximum.slice(0, 4)) + 1}${maximum.slice(4)}`;
    expect(writeProjectState(tooDistant)).toEqual({
      ok: false,
      reason: "invalid-state",
    });

    const futureDated = uploadedState();
    futureDated.uploadedProject!.createdAt = "2099-01-01T00:00:00.000Z";
    expect(writeProjectState(futureDated)).toEqual({
      ok: false,
      reason: "invalid-state",
    });
  });

  it("returns an observable failure when browser storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    expect(writeProjectState(createDefaultProjectState())).toEqual({
      ok: false,
      reason: "storage-error",
    });
  });

  it("rejects self-check text beyond the UI persistence limit", () => {
    const state = uploadedState();
    state.uploadedCriterionReviews[0].draftText = "x".repeat(
      UPLOADED_REVIEW_MAX_CHARACTERS + 1,
    );
    expect(writeProjectState(state)).toEqual({
      ok: false,
      reason: "invalid-state",
    });
  });
});
