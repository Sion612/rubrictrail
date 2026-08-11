import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearProjectState,
  createDefaultProjectState,
  parsePersistedProjectStateValue,
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

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("local project persistence", () => {
  it("reports unsupported versions separately from malformed state", () => {
    expect(parsePersistedProjectStateValue({ version: 3 })).toEqual({
      ok: false,
      reason: "unsupported-version",
    });
    expect(parsePersistedProjectStateValue({ version: "2" })).toEqual({
      ok: false,
      reason: "invalid-state",
    });
  });

  it("round-trips a deeply validated uploaded v2 project", () => {
    const state = uploadedState();

    const writeResult = writeProjectState(state);
    expect(writeResult).toEqual({ ok: true, serialized: expect.any(String) });
    if (!writeResult.ok) throw new Error("Expected project state write to succeed");
    expect(readProjectStateWithStatus()).toEqual({
      state,
      source: "v2",
      recovered: false,
      storedValue: writeResult.serialized,
      storageAvailable: true,
    });
    expect(readProjectState()).toEqual(state);
  });

  it("recovers to defaults from malformed v2 JSON", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not valid JSON");

    expect(readProjectStateWithStatus()).toEqual({
      state: createDefaultProjectState(),
      source: "default",
      recovered: true,
      storedValue: "{not valid JSON",
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
      storageAvailable: true,
    });
  });

  it("continues to a valid legacy project when v2 is structurally invalid", () => {
    const invalidV2 = JSON.stringify({
      version: 2,
      projectKind: "uploaded",
      uploadedProject: null,
    });
    window.localStorage.setItem(STORAGE_KEY, invalidV2);
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
    expect(result.storedValue).toBe(invalidV2);
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

  it("repairs obsolete v2 task ids without discarding the project", () => {
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
      source: "v2",
      recovered: true,
      storedValue,
      storageAvailable: true,
    });
  });

  it("reports a missing current storage value as null", () => {
    const result = readProjectStateWithStatus();
    expect(result.storedValue).toBeNull();
    expect(result.storageAvailable).toBe(true);
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

    expect(clearProjectState(initialResult.serialized)).toEqual({ ok: true });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
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
