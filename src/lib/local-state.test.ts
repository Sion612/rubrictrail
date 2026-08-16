import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearProjectState,
  createDefaultProjectState,
  parsePreviousProjectStateValue,
  parsePersistedProjectStateValue,
  PREVIOUS_STORAGE_KEY,
  PROJECT_LOCK_NAME,
  PROJECT_RECORD_KEY,
  purgeProjectState,
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
import {
  createFifoLockManager,
  holdLock,
  installLockManager,
  removeLockManager,
} from "../../tests/web-locks-mock";

const LEGACY_STORAGE_KEY = "proofline.project.v1";

function observedBaseline() {
  return readProjectStateWithStatus().baseline;
}

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
  installLockManager(createFifoLockManager().manager);
});

afterEach(() => {
  removeLockManager();
  vi.restoreAllMocks();
});

describe("local project persistence", () => {
  it("uses one stable coordination name for the durable project record", () => {
    expect(PROJECT_LOCK_NAME).toBe(PROJECT_RECORD_KEY);
  });

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

  it("round-trips a deeply validated uploaded v3 project", async () => {
    const state = uploadedState();

    const writeResult = await writeProjectState(state, observedBaseline());
    expect(writeResult).toEqual(expect.objectContaining({
      ok: true,
      recordValue: expect.any(String),
      revision: 1,
    }));
    if (!writeResult.ok) throw new Error("Expected project state write to succeed");
    expect(readProjectStateWithStatus()).toMatchObject({
      state,
      source: "record",
      recovered: false,
      storedValue: writeResult.recordValue,
      previousStoredValue: null,
      crossVersionConflict: false,
      storageAvailable: true,
    });
    expect(readProjectState()).toEqual(state);
  });

  it("rejects uploaded evidence that names a source outside the saved project", () => {
    const state = uploadedState();
    state.uploadedProject!.criteria[0].evidence = {
      ...state.uploadedProject!.criteria[0].evidence!,
      fileName: "invented-rubric.txt",
    };

    expect(parsePersistedProjectStateValue(state).ok).toBe(false);
  });

  it("preserves optional OCR evidence provenance without changing the state version", () => {
    const state = uploadedState();
    state.uploadedProject!.fileNames = ["rubric.png"];
    state.uploadedProject!.criteria[0].evidence = {
      ...state.uploadedProject!.criteria[0].evidence!,
      fileName: "rubric.png",
      origin: "ocr",
    };

    const parsed = parsePersistedProjectStateValue(state);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.state.version).toBe(3);
      expect(parsed.state.uploadedProject?.criteria[0].evidence?.origin).toBe("ocr");
    }
  });

  it("rejects an invented evidence provenance value", () => {
    const state = uploadedState() as unknown as Record<string, unknown>;
    const project = state.uploadedProject as Record<string, unknown>;
    const [criterion] = project.criteria as Array<Record<string, unknown>>;
    criterion.evidence = {
      ...(criterion.evidence as Record<string, unknown>),
      origin: "remote-ai",
    };

    expect(parsePersistedProjectStateValue(state)).toEqual({
      ok: false,
      reason: "invalid-state",
    });
  });

  it("rejects deceptive control and bidirectional characters in saved filenames", () => {
    const state = uploadedState();
    const deceptiveName = "report\u202Etxt.exe";
    state.uploadedProject!.fileNames = [deceptiveName];
    state.uploadedProject!.criteria[0].evidence = {
      ...state.uploadedProject!.criteria[0].evidence!,
      fileName: deceptiveName,
    };

    expect(parsePersistedProjectStateValue(state).ok).toBe(false);
  });

  it("rejects line breaks, controls, and bidirectional formatting in saved project identity fields", () => {
    for (const [field, value] of [
      ["title", "Strategy Report\nNo existing project will be removed"],
      ["title", "Strategy\u0085Report"],
      ["course", "BUS302\u202Etxt.exe"],
    ] as const) {
      const state = uploadedState();
      state.uploadedProject![field] = value;

      expect(parsePersistedProjectStateValue(state)).toEqual({
        ok: false,
        reason: "invalid-state",
      });
    }
  });

  it("rejects uploaded evidence with only one recorded source label", () => {
    const state = uploadedState();
    state.uploadedProject!.criteria[0].evidence = {
      ...state.uploadedProject!.criteria[0].evidence!,
      fileName: null,
    };

    expect(parsePersistedProjectStateValue(state).ok).toBe(false);
  });

  it("rejects a half-trusted evidence object with no recorded source", () => {
    const state = uploadedState();
    state.uploadedProject!.criteria[0].evidence = {
      ...state.uploadedProject!.criteria[0].evidence!,
      sourceId: null,
      fileName: null,
    };

    expect(parsePersistedProjectStateValue(state).ok).toBe(false);
  });

  it("accepts retained input-index source ids when a middle file was omitted", () => {
    const state = uploadedState();
    state.uploadedProject!.fileNames = ["brief.txt", "rubric.txt"];
    state.uploadedProject!.criteria[0].evidence = {
      ...state.uploadedProject!.criteria[0].evidence!,
      sourceId: "source-3",
      fileName: "rubric.txt",
    };

    expect(parsePersistedProjectStateValue(state).ok).toBe(true);
  });

  it("rejects a non-canonical uploaded evidence source id", () => {
    const state = uploadedState();
    state.uploadedProject!.criteria[0].evidence = {
      ...state.uploadedProject!.criteria[0].evidence!,
      sourceId: "source-01",
    };

    expect(parsePersistedProjectStateValue(state).ok).toBe(false);
  });

  it("rejects source ids outside the persisted file-count boundary", () => {
    const state = uploadedState();
    state.uploadedProject!.criteria[0].evidence = {
      ...state.uploadedProject!.criteria[0].evidence!,
      sourceId: "source-26",
    };

    expect(parsePersistedProjectStateValue(state).ok).toBe(false);
  });

  it("rejects an evidence span shorter than its retained excerpt", () => {
    const state = uploadedState();
    state.uploadedProject!.criteria[0].evidence = {
      ...state.uploadedProject!.criteria[0].evidence!,
      endOffset: 54,
    };

    expect(parsePersistedProjectStateValue(state).ok).toBe(false);
  });

  it("recovers v2 and v3 evidence offsets written with the legacy untrimmed-line span", () => {
    const legacyState = uploadedState();
    legacyState.uploadedProject!.criteria[0].evidence = {
      ...legacyState.uploadedProject!.criteria[0].evidence!,
      endOffset: 57,
    };

    for (const candidate of [legacyState, v2Value(legacyState)]) {
      const parsed = parsePersistedProjectStateValue(candidate);
      expect(parsed).toMatchObject({ ok: true, recovered: true });
      if (!parsed.ok) throw new Error("Expected legacy evidence offsets to recover");
      expect(parsed.state.uploadedProject?.criteria[0].evidence).toMatchObject({
        excerpt: "Analysis | 100%",
        startOffset: 40,
        endOffset: 55,
      });
    }
  });

  it("recovers legacy evidence offsets inside the authoritative project record", () => {
    const legacyState = uploadedState();
    legacyState.uploadedProject!.criteria[0].evidence = {
      ...legacyState.uploadedProject!.criteria[0].evidence!,
      endOffset: 57,
    };
    window.localStorage.setItem(
      PROJECT_RECORD_KEY,
      JSON.stringify({
        formatVersion: 1,
        revision: 1,
        value: { kind: "project", state: legacyState },
        legacyFingerprints: { v3: null, v2: null, v1: null },
      }),
    );

    expect(readProjectStateWithStatus()).toMatchObject({
      source: "record",
      recovered: true,
      state: {
        uploadedProject: {
          criteria: [
            {
              evidence: {
                excerpt: "Analysis | 100%",
                startOffset: 40,
                endOffset: 55,
              },
            },
          ],
        },
      },
    });
  });

  it("rejects one source id that claims two different filenames", () => {
    const state = uploadedState();
    state.uploadedProject!.fileNames = ["brief.txt", "rubric.txt"];
    state.uploadedProject!.criteria.push({
      id: "recommendations-2",
      name: "Recommendations",
      weight: null,
      evidence: {
        sourceId: "source-1",
        fileName: "rubric.txt",
        page: null,
        excerpt: "Recommendations",
        startOffset: 60,
        endOffset: 75,
      },
    });
    state.uploadedProject!.weightingStatus = "incomplete";

    expect(parsePersistedProjectStateValue(state).ok).toBe(false);
  });

  it("round-trips a v3 project whose rubric publishes no weights", async () => {
    const state = unweightedUploadedState();

    const writeResult = await writeProjectState(state, observedBaseline());
    expect(writeResult).toEqual(expect.objectContaining({
      ok: true,
      recordValue: expect.any(String),
      revision: 1,
    }));
    expect(readProjectStateWithStatus()).toMatchObject({
      state,
      source: "record",
      recovered: false,
      storageAvailable: true,
    });
  });

  it("migrates a valid local v2 project while preserving numeric weights", () => {
    const expected = uploadedState();
    const previousRaw = JSON.stringify(v2Value(expected));
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, previousRaw);

    expect(readProjectStateWithStatus()).toMatchObject({
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

  it("accepts retained partial weights only with incomplete status", async () => {
    const state = partiallyWeightedUploadedState();

    expect(await writeProjectState(state, observedBaseline())).toEqual(
      expect.objectContaining({ ok: true, recordValue: expect.any(String) }),
    );

    state.uploadedProject!.weightingStatus = "complete";
    expect(await writeProjectState(state, observedBaseline())).toEqual({
      ok: false,
      reason: "invalid-state",
    });
  });

  it("keeps explicit incomplete semantics even when retained numbers total 100", async () => {
    const state = uploadedState();
    state.uploadedProject!.weightingStatus = "incomplete";

    expect(await writeProjectState(state, observedBaseline())).toEqual(
      expect.objectContaining({ ok: true, recordValue: expect.any(String) }),
    );
  });

  it("requires none status when no criterion has a published percentage", async () => {
    const state = unweightedUploadedState();
    state.uploadedProject!.weightingStatus = "incomplete";

    expect(await writeProjectState(state, observedBaseline())).toEqual({
      ok: false,
      reason: "invalid-state",
    });
  });

  it("does not accept unavailable weights in the v2 format", () => {
    expect(parsePersistedProjectStateValue(v2Value(unweightedUploadedState()))).toEqual({
      ok: false,
      reason: "invalid-state",
    });
  });

  it("recovers to defaults from malformed v3 JSON", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not valid JSON");

    expect(readProjectStateWithStatus()).toMatchObject({
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

    expect(readProjectStateWithStatus()).toMatchObject({
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

    expect(readProjectStateWithStatus()).toMatchObject({
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

    expect(readProjectStateWithStatus()).toMatchObject({
      state: current,
      source: "v3",
      recovered: false,
      storedValue: currentRaw,
      previousStoredValue: previousRaw,
      crossVersionConflict: true,
      storageAvailable: true,
      legacyConflictCandidate: {
        source: "v2",
        state: { targetGrade: 64 },
      },
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

  it("surfaces one divergent proofline v1 candidate beside v3", () => {
    const current = {
      ...createDefaultProjectState(),
      draftText: "CURRENT-V3-DRAFT-5E21",
    };
    const legacyRaw = JSON.stringify({
      sampleLoaded: false,
      draftText: "DIVERGENT-V1-DRAFT-8B46",
    });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    window.localStorage.setItem(LEGACY_STORAGE_KEY, legacyRaw);

    expect(readProjectStateWithStatus()).toMatchObject({
      source: "v3",
      state: { draftText: "CURRENT-V3-DRAFT-5E21" },
      crossVersionConflict: true,
      legacyConflictCandidate: {
        source: "legacy",
        state: { draftText: "DIVERGENT-V1-DRAFT-8B46" },
      },
    });
  });

  it("accepts a canonically equivalent proofline v1 state beside v3", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(createDefaultProjectState()),
    );
    window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({}));

    expect(readProjectStateWithStatus()).toMatchObject({
      source: "v3",
      state: createDefaultProjectState(),
      crossVersionConflict: false,
      legacyConflictCandidate: null,
    });
  });

  it("surfaces one divergent proofline v1 candidate beside v2", () => {
    const previous = {
      ...createDefaultProjectState(),
      draftText: "CURRENT-V2-DRAFT-2C93",
    };
    const legacyRaw = JSON.stringify({
      sampleLoaded: false,
      draftText: "DIVERGENT-V1-FROM-V2-7A14",
    });
    window.localStorage.setItem(
      PREVIOUS_STORAGE_KEY,
      JSON.stringify(v2Value(previous)),
    );
    window.localStorage.setItem(LEGACY_STORAGE_KEY, legacyRaw);

    expect(readProjectStateWithStatus()).toMatchObject({
      source: "v2",
      state: { draftText: "CURRENT-V2-DRAFT-2C93" },
      crossVersionConflict: true,
      legacyConflictCandidate: {
        source: "legacy",
        state: { draftText: "DIVERGENT-V1-FROM-V2-7A14" },
      },
    });
  });

  it("does not guess when both v2 and proofline v1 differ from v3", () => {
    const current = {
      ...createDefaultProjectState(),
      draftText: "PRIMARY-V3-DRAFT-3D18",
    };
    const previous = {
      ...createDefaultProjectState(),
      draftText: "SECONDARY-V2-DRAFT-6F42",
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    window.localStorage.setItem(
      PREVIOUS_STORAGE_KEY,
      JSON.stringify(v2Value(previous)),
    );
    window.localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify({
        sampleLoaded: false,
        draftText: "TERTIARY-V1-DRAFT-9C75",
      }),
    );

    expect(readProjectStateWithStatus()).toMatchObject({
      source: "v3",
      state: { draftText: "PRIMARY-V3-DRAFT-3D18" },
      crossVersionConflict: true,
      legacyConflictCandidate: null,
    });
  });

  it("keeps invalid v3 authoritative but exposes one valid v1 recovery candidate", () => {
    const invalidV3 = "{invalid current v3 bytes";
    window.localStorage.setItem(STORAGE_KEY, invalidV3);
    window.localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify({
        sampleLoaded: false,
        draftText: "VALID-V1-RECOVERY-CANDIDATE-4A68",
      }),
    );

    expect(readProjectStateWithStatus()).toMatchObject({
      source: "default",
      state: createDefaultProjectState(),
      storedValue: invalidV3,
      crossVersionConflict: true,
      legacyConflictCandidate: {
        source: "legacy",
        state: { draftText: "VALID-V1-RECOVERY-CANDIDATE-4A68" },
      },
    });
  });

  it("does not fall back to v2 when current v3 bytes exist but are invalid", () => {
    const malformedV3 = "{not valid JSON";
    const previousRaw = JSON.stringify(v2Value());
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, previousRaw);
    window.localStorage.setItem(STORAGE_KEY, malformedV3);

    expect(readProjectStateWithStatus()).toMatchObject({
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

  it("conditionally writes when the observed record is missing", async () => {
    const result = await writeProjectState(
      createDefaultProjectState(),
      observedBaseline(),
    );

    expect(result).toEqual(
      expect.objectContaining({ ok: true, recordValue: expect.any(String) }),
    );
    if (!result.ok) throw new Error("Expected project state write to succeed");
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(result.recordValue);
  });

  it("serializes two writes from the same baseline so only the first succeeds", async () => {
    const baseline = observedBaseline();
    const firstState = {
      ...createDefaultProjectState(),
      draftText: "FIRST-WRITER-7A31",
    };
    const secondState = {
      ...createDefaultProjectState(),
      draftText: "SECOND-WRITER-2C84",
    };

    const firstWrite = writeProjectState(firstState, baseline);
    const secondWrite = writeProjectState(secondState, baseline);
    const [firstResult, secondResult] = await Promise.all([
      firstWrite,
      secondWrite,
    ]);

    expect(firstResult).toEqual(
      expect.objectContaining({ ok: true, revision: 1 }),
    );
    expect(secondResult).toEqual({ ok: false, reason: "conflict" });
    expect(readProjectStateWithStatus()).toMatchObject({
      source: "record",
      state: { draftText: "FIRST-WRITER-7A31" },
      baseline: { recordStatus: "active", revision: 1 },
    });
  });

  it("lets a queued write win before a clear from the same baseline", async () => {
    const baseline = observedBaseline();
    const winningState = {
      ...createDefaultProjectState(),
      draftText: "WRITE-BEFORE-CLEAR-9F15",
    };

    const write = writeProjectState(winningState, baseline);
    const clear = clearProjectState(baseline);
    const [writeResult, clearResult] = await Promise.all([write, clear]);

    expect(writeResult).toEqual(
      expect.objectContaining({ ok: true, revision: 1 }),
    );
    expect(clearResult).toEqual({ ok: false, reason: "conflict" });
    expect(readProjectStateWithStatus()).toMatchObject({
      source: "record",
      state: { draftText: "WRITE-BEFORE-CLEAR-9F15" },
      baseline: { recordStatus: "active", revision: 1 },
    });
  });

  it("lets a queued clear win before a write from the same baseline", async () => {
    const baseline = observedBaseline();
    const losingState = {
      ...createDefaultProjectState(),
      draftText: "WRITE-AFTER-CLEAR-MUST-LOSE-4D62",
    };

    const clear = clearProjectState(baseline);
    const write = writeProjectState(losingState, baseline);
    const [clearResult, writeResult] = await Promise.all([clear, write]);

    expect(clearResult).toEqual(
      expect.objectContaining({ ok: true, revision: 1 }),
    );
    expect(writeResult).toEqual({ ok: false, reason: "conflict" });
    expect(readProjectStateWithStatus()).toMatchObject({
      source: "record",
      baseline: { recordStatus: "cleared", revision: 1 },
    });
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(
      clearResult.ok ? clearResult.recordValue : null,
    );
  });

  it("uses tombstone revisions to reject an ABA write after clear and recreate", async () => {
    const firstState = {
      ...createDefaultProjectState(),
      draftText: "ABA-SAME-PROJECT-BYTES-13E8",
    };
    const firstWrite = await writeProjectState(firstState, observedBaseline());
    if (!firstWrite.ok) throw new Error("Expected the first ABA write to succeed");

    const clear = await clearProjectState(firstWrite.baseline);
    expect(clear).toEqual(
      expect.objectContaining({ ok: true, revision: 2 }),
    );
    if (!clear.ok) throw new Error("Expected the ABA clear to succeed");
    expect(readProjectStateWithStatus().baseline).toMatchObject({
      recordStatus: "cleared",
      revision: 2,
    });

    const recreate = await writeProjectState(firstState, clear.baseline);
    expect(recreate).toEqual(
      expect.objectContaining({ ok: true, revision: 3 }),
    );
    if (!recreate.ok) throw new Error("Expected the ABA recreate to succeed");

    const staleState = {
      ...firstState,
      draftText: "STALE-ABA-WRITER-MUST-NOT-WIN-6B27",
    };
    expect(await writeProjectState(staleState, firstWrite.baseline)).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(readProjectStateWithStatus()).toMatchObject({
      state: { draftText: "ABA-SAME-PROJECT-BYTES-13E8" },
      baseline: { recordStatus: "active", revision: 3 },
    });
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(
      recreate.recordValue,
    );
  });

  it("fails closed on an invalid record but permits an exact-baseline recovery clear", async () => {
    const invalidRecord = "{not a valid durable project record";
    window.localStorage.setItem(PROJECT_RECORD_KEY, invalidRecord);
    const invalidRead = readProjectStateWithStatus();
    expect(invalidRead).toMatchObject({
      source: "default",
      recovered: true,
      baseline: {
        recordStatus: "invalid",
        recordValue: invalidRecord,
        revision: null,
      },
    });

    expect(
      await writeProjectState(createDefaultProjectState(), invalidRead.baseline),
    ).toEqual({ ok: false, reason: "invalid-record" });
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(invalidRecord);

    const clear = await clearProjectState(invalidRead.baseline);
    expect(clear).toEqual(
      expect.objectContaining({ ok: true, revision: 1 }),
    );
    expect(readProjectStateWithStatus()).toMatchObject({
      source: "record",
      baseline: { recordStatus: "cleared", revision: 1 },
    });
  });

  it("fails closed without Web Locks and does not create record bytes", async () => {
    const baseline = observedBaseline();
    removeLockManager();

    expect(
      await writeProjectState(createDefaultProjectState(), baseline),
    ).toEqual({ ok: false, reason: "coordination-unavailable" });
    expect(await clearProjectState(baseline)).toEqual({
      ok: false,
      reason: "coordination-unavailable",
    });
    expect(await purgeProjectState(baseline)).toEqual({
      ok: false,
      reason: "coordination-unavailable",
    });
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBeNull();
  });

  it("leaves exact record bytes unchanged when lock acquisition rejects", async () => {
    const initial = await writeProjectState(
      createDefaultProjectState(),
      observedBaseline(),
    );
    if (!initial.ok) throw new Error("Expected initial lock-rejection state");
    const exactRecord = initial.recordValue;
    const rejectingManager = {
      request: vi.fn().mockRejectedValue(
        new DOMException("Lock manager unavailable", "SecurityError"),
      ),
      query: vi.fn().mockResolvedValue({ held: [], pending: [] }),
    } as unknown as LockManager;
    installLockManager(rejectingManager);

    expect(
      await writeProjectState(uploadedState(), initial.baseline),
    ).toEqual({ ok: false, reason: "coordination-unavailable" });
    expect(await clearProjectState(initial.baseline)).toEqual({
      ok: false,
      reason: "coordination-unavailable",
    });
    expect(await purgeProjectState(initial.baseline)).toEqual({
      ok: false,
      reason: "coordination-unavailable",
    });
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(exactRecord);
  });

  it("abandons a queued write when its in-memory intent changes while waiting", async () => {
    const initial = await writeProjectState(
      createDefaultProjectState(),
      observedBaseline(),
    );
    if (!initial.ok) throw new Error("Expected intent-guard write fixture");
    const lockManager = createFifoLockManager();
    installLockManager(lockManager.manager);
    const heldLock = holdLock(lockManager.manager, PROJECT_LOCK_NAME);
    await heldLock.entered;
    const exactBefore = initial.recordValue;
    let intentIsCurrent = true;

    const pendingWrite = writeProjectState(
      uploadedState(),
      initial.baseline,
      { intentGuard: () => intentIsCurrent },
    );
    expect(lockManager.pendingCount()).toBe(1);
    intentIsCurrent = false;
    heldLock.release();

    await expect(pendingWrite).resolves.toEqual({
      ok: false,
      reason: "intent-changed",
    });
    await heldLock.done;
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(exactBefore);
  });

  it("abandons a queued purge when its in-memory intent changes while waiting", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(uploadedState()));
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, JSON.stringify(v2Value()));
    window.localStorage.setItem(LEGACY_STORAGE_KEY, "legacy bytes");
    const baseline = observedBaseline();
    const exactBefore = {
      record: window.localStorage.getItem(PROJECT_RECORD_KEY),
      v3: window.localStorage.getItem(STORAGE_KEY),
      v2: window.localStorage.getItem(PREVIOUS_STORAGE_KEY),
      v1: window.localStorage.getItem(LEGACY_STORAGE_KEY),
    };
    const lockManager = createFifoLockManager();
    installLockManager(lockManager.manager);
    const heldLock = holdLock(lockManager.manager, PROJECT_LOCK_NAME);
    await heldLock.entered;
    let intentIsCurrent = true;

    const pendingPurge = purgeProjectState(baseline, {
      intentGuard: () => intentIsCurrent,
    });
    expect(lockManager.pendingCount()).toBe(1);
    intentIsCurrent = false;
    heldLock.release();

    await expect(pendingPurge).resolves.toEqual({
      ok: false,
      reason: "intent-changed",
    });
    await heldLock.done;
    expect({
      record: window.localStorage.getItem(PROJECT_RECORD_KEY),
      v3: window.localStorage.getItem(STORAGE_KEY),
      v2: window.localStorage.getItem(PREVIOUS_STORAGE_KEY),
      v1: window.localStorage.getItem(LEGACY_STORAGE_KEY),
    }).toEqual(exactBefore);
  });

  it("retains superseded v2 bytes and records their lineage after a record write", async () => {
    const previousRaw = JSON.stringify(v2Value());
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, previousRaw);
    window.localStorage.setItem(LEGACY_STORAGE_KEY, "legacy bytes");

    const result = await writeProjectState(
      createDefaultProjectState(),
      observedBaseline(),
    );

    expect(result).toEqual(
      expect.objectContaining({ ok: true, recordValue: expect.any(String) }),
    );
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe(previousRaw);
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBe("legacy bytes");
    expect(JSON.parse(result.ok ? result.recordValue : "{}")).toMatchObject({
      formatVersion: 1,
      revision: 1,
      legacyFingerprints: {
        v2: expect.stringMatching(/^v1:\d+:[0-9a-f]{8}:[0-9a-f]{8}$/),
      },
    });
    expect(readProjectStateWithStatus()).toMatchObject({
      source: "record",
      crossVersionConflict: false,
    });

    const newerV2 = JSON.stringify(v2Value({
      ...uploadedState(),
      targetGrade: 88,
    }));
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, newerV2);
    expect(readProjectStateWithStatus()).toMatchObject({
      source: "record",
      previousStoredValue: newerV2,
      crossVersionConflict: true,
    });
  });

  it("migrates exact legacy v3 bytes without deleting them and rejects later drift", async () => {
    const legacyState = {
      ...createDefaultProjectState(),
      projectKind: "sample" as const,
      draftText: "LEGACY-V3-MIGRATION-BASELINE-18A4",
    };
    const legacyV3Value = JSON.stringify(legacyState);
    window.localStorage.setItem(STORAGE_KEY, legacyV3Value);
    const legacyRead = readProjectStateWithStatus();
    expect(legacyRead).toMatchObject({
      source: "v3",
      state: legacyState,
      baseline: {
        recordStatus: "missing",
        legacyV3Value,
      },
    });

    const migrated = await writeProjectState(legacyRead.state, legacyRead.baseline);
    expect(migrated).toEqual(
      expect.objectContaining({ ok: true, revision: 1 }),
    );
    if (!migrated.ok) throw new Error("Expected legacy v3 migration to succeed");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(legacyV3Value);
    expect(JSON.parse(migrated.recordValue)).toMatchObject({
      formatVersion: 1,
      revision: 1,
      value: { kind: "project", state: legacyState },
      legacyFingerprints: {
        v3: expect.stringMatching(/^v1:\d+:[0-9a-f]{8}:[0-9a-f]{8}$/),
      },
    });

    const newerLegacyV3Value = JSON.stringify({
      ...legacyState,
      draftText: "LEGACY-V3-CHANGED-AFTER-MIGRATION-73D2",
    });
    window.localStorage.setItem(STORAGE_KEY, newerLegacyV3Value);
    const exactRecord = migrated.recordValue;
    expect(
      await writeProjectState(uploadedState(), migrated.baseline),
    ).toEqual({ ok: false, reason: "conflict" });
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(exactRecord);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(newerLegacyV3Value);
    expect(readProjectStateWithStatus()).toMatchObject({
      source: "record",
      crossVersionConflict: true,
      legacyConflictCandidate: {
        source: "v3",
        state: {
          draftText: "LEGACY-V3-CHANGED-AFTER-MIGRATION-73D2",
        },
      },
    });
  });

  it("does not expose an invalid single legacy drift as a loadable candidate", async () => {
    const initial = await writeProjectState(
      createDefaultProjectState(),
      observedBaseline(),
    );
    if (!initial.ok) throw new Error("Expected initial record write to succeed");

    window.localStorage.setItem(STORAGE_KEY, "{not valid JSON");

    expect(readProjectStateWithStatus()).toMatchObject({
      source: "record",
      crossVersionConflict: true,
      legacyConflictCandidate: null,
    });
  });

  it("does not guess a candidate when more than one legacy key drifts", async () => {
    const initial = await writeProjectState(
      createDefaultProjectState(),
      observedBaseline(),
    );
    if (!initial.ok) throw new Error("Expected initial record write to succeed");
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(uploadedState()));
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, JSON.stringify(v2Value()));

    expect(readProjectStateWithStatus()).toMatchObject({
      source: "record",
      crossVersionConflict: true,
      legacyConflictCandidate: null,
    });
  });

  it("fails closed when a v2 project changes before promotion", async () => {
    const observedPrevious = JSON.stringify(v2Value());
    const newerV2 = JSON.stringify(v2Value({
      ...uploadedState(),
      targetGrade: 81,
    }));
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, observedPrevious);
    const read = readProjectStateWithStatus();
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, newerV2);

    expect(await writeProjectState(read.state, read.baseline)).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBeNull();
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe(newerV2);
  });

  it("reports a post-write v2 race and keeps the new record as a visible candidate", async () => {
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
      if (key === PROJECT_RECORD_KEY && !injected) {
        injected = true;
        nativeSetItem.call(this, PREVIOUS_STORAGE_KEY, newerV2);
      }
    });

    expect(await writeProjectState(read.state, read.baseline)).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe(newerV2);
    expect(readProjectStateWithStatus()).toMatchObject({
      source: "record",
      crossVersionConflict: true,
      baseline: { recordStatus: "active", revision: 1 },
    });
  });

  it("refuses to shadow v2 bytes unless their observed revision is supplied", async () => {
    const previousRaw = JSON.stringify(v2Value());
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, previousRaw);
    const staleBaseline = observedBaseline();
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, `${previousRaw} `);

    const result = await writeProjectState(createDefaultProjectState(), staleBaseline);

    expect(result).toEqual({ ok: false, reason: "conflict" });
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBeNull();
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe(`${previousRaw} `);
  });

  it("conditionally writes when the expected record baseline matches", async () => {
    const initialResult = await writeProjectState(
      createDefaultProjectState(),
      observedBaseline(),
    );
    if (!initialResult.ok) throw new Error("Expected initial project state write to succeed");
    const updated = uploadedState();

    const result = await writeProjectState(updated, initialResult.baseline);

    expect(result).toEqual(
      expect.objectContaining({ ok: true, recordValue: expect.any(String), revision: 2 }),
    );
    if (!result.ok) throw new Error("Expected conditional project state write to succeed");
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(result.recordValue);
    expect(result.recordValue).not.toBe(initialResult.recordValue);
  });

  it("rejects a stale expected baseline without changing stored bytes", async () => {
    const initialResult = await writeProjectState(
      createDefaultProjectState(),
      observedBaseline(),
    );
    if (!initialResult.ok) throw new Error("Expected initial project state write to succeed");
    const storedValue = initialResult.recordValue;
    const staleBaseline = { ...initialResult.baseline, revision: 0 };

    expect(await writeProjectState(createDefaultProjectState(), staleBaseline)).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(storedValue);
  });

  it("returns storage-error without writing when the conditional read throws", async () => {
    const baseline = observedBaseline();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    expect(await writeProjectState(createDefaultProjectState(), baseline)).toEqual({
      ok: false,
      reason: "storage-error",
    });
    expect(setItem).not.toHaveBeenCalled();
  });

  it("privacy-purges all legacy project bytes and keeps only a content-free tombstone", async () => {
    const legacyV3 = JSON.stringify({
      ...createDefaultProjectState(),
      draftText: "SENSITIVE-V3-DRAFT-1A72",
    });
    const legacyV2 = JSON.stringify(
      v2Value({
        ...createDefaultProjectState(),
        draftText: "SENSITIVE-V2-DRAFT-5C39",
      }),
    );
    const legacyV1 = JSON.stringify({
      sampleLoaded: false,
      draftText: "SENSITIVE-V1-DRAFT-8E64",
    });
    window.localStorage.setItem(STORAGE_KEY, legacyV3);
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, legacyV2);
    window.localStorage.setItem(LEGACY_STORAGE_KEY, legacyV1);
    const initial = await writeProjectState(
      {
        ...createDefaultProjectState(),
        draftText: "SENSITIVE-AUTHORITATIVE-DRAFT-3B47",
      },
      observedBaseline(),
    );
    if (!initial.ok) throw new Error("Expected purge fixture write to succeed");

    const purged = await purgeProjectState(initial.baseline);

    expect(purged).toEqual(
      expect.objectContaining({ ok: true, revision: 3 }),
    );
    if (!purged.ok) throw new Error("Expected privacy purge to succeed");
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(
      purged.recordValue,
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    expect(JSON.parse(purged.recordValue)).toEqual({
      formatVersion: 1,
      revision: 3,
      value: { kind: "cleared" },
      legacyFingerprints: { v3: null, v2: null, v1: null },
    });
    expect(purged.baseline).toEqual({
      recordStatus: "cleared",
      recordValue: purged.recordValue,
      revision: 3,
      legacyV3Value: null,
      legacyV2Value: null,
      legacyV1Value: null,
    });
    expect(readProjectStateWithStatus()).toMatchObject({
      source: "record",
      state: createDefaultProjectState(),
      crossVersionConflict: false,
      baseline: purged.baseline,
    });
  });

  it("surfaces an old v3 rewrite after purge without restoring it", async () => {
    const initial = await writeProjectState(
      createDefaultProjectState(),
      observedBaseline(),
    );
    if (!initial.ok) throw new Error("Expected rewrite fixture write to succeed");
    const purged = await purgeProjectState(initial.baseline);
    if (!purged.ok) throw new Error("Expected rewrite fixture purge to succeed");
    const oldTabState = {
      ...createDefaultProjectState(),
      draftText: "OLD-TAB-MUST-NOT-RESURRECT-7D25",
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(oldTabState));

    expect(readProjectStateWithStatus()).toMatchObject({
      source: "record",
      state: createDefaultProjectState(),
      crossVersionConflict: true,
      baseline: { recordStatus: "cleared", revision: 3 },
      legacyConflictCandidate: {
        source: "v3",
        state: { draftText: "OLD-TAB-MUST-NOT-RESURRECT-7D25" },
      },
    });
  });

  it("purges an exact invalid-record baseline for explicit error recovery", async () => {
    const invalidRecord = "{invalid authoritative project bytes";
    window.localStorage.setItem(PROJECT_RECORD_KEY, invalidRecord);
    window.localStorage.setItem(STORAGE_KEY, "invalid v3 bytes");
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, "invalid v2 bytes");
    window.localStorage.setItem(LEGACY_STORAGE_KEY, "invalid v1 bytes");
    const baseline = observedBaseline();
    expect(baseline).toMatchObject({
      recordStatus: "invalid",
      recordValue: invalidRecord,
    });

    const purged = await purgeProjectState(baseline);

    expect(purged).toEqual(
      expect.objectContaining({ ok: true, revision: 2 }),
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    expect(readProjectStateWithStatus()).toMatchObject({
      source: "record",
      crossVersionConflict: false,
      baseline: { recordStatus: "cleared", revision: 2 },
    });
  });

  it("serializes purge against a write from the same active baseline", async () => {
    const initial = await writeProjectState(
      createDefaultProjectState(),
      observedBaseline(),
    );
    if (!initial.ok) throw new Error("Expected purge race fixture write");
    const nextState = {
      ...createDefaultProjectState(),
      draftText: "QUEUED-WRITE-MUST-LOSE-6A91",
    };

    const purge = purgeProjectState(initial.baseline);
    const write = writeProjectState(nextState, initial.baseline);
    const [purgeResult, writeResult] = await Promise.all([purge, write]);

    expect(purgeResult).toEqual(
      expect.objectContaining({ ok: true, revision: 3 }),
    );
    expect(writeResult).toEqual({ ok: false, reason: "conflict" });
    expect(readProjectStateWithStatus()).toMatchObject({
      source: "record",
      state: createDefaultProjectState(),
      baseline: { recordStatus: "cleared", revision: 3 },
    });
  });

  it("does not purge any bytes from a stale observed baseline", async () => {
    const observedV2 = JSON.stringify(v2Value());
    const newerV2 = JSON.stringify(
      v2Value({ ...createDefaultProjectState(), targetGrade: 88 }),
    );
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(uploadedState()));
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, observedV2);
    window.localStorage.setItem(LEGACY_STORAGE_KEY, "legacy exact bytes");
    const stale = observedBaseline();
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, newerV2);

    expect(await purgeProjectState(stale)).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe(newerV2);
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBe(
      "legacy exact bytes",
    );
  });

  it("reports a legacy rewrite observed during purge instead of false success", async () => {
    const legacyV3 = JSON.stringify(uploadedState());
    const legacyV2 = JSON.stringify(v2Value());
    window.localStorage.setItem(STORAGE_KEY, legacyV3);
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, legacyV2);
    window.localStorage.setItem(LEGACY_STORAGE_KEY, "legacy bytes");
    const baseline = observedBaseline();
    const nativeRemoveItem = Storage.prototype.removeItem;
    const nativeSetItem = Storage.prototype.setItem;
    let injected = false;
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      nativeRemoveItem.call(this, key);
      if (key === LEGACY_STORAGE_KEY && !injected) {
        injected = true;
        nativeSetItem.call(this, PREVIOUS_STORAGE_KEY, "newer v2 bytes");
      }
    });

    expect(await purgeProjectState(baseline)).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).not.toBeNull();
    expect(readProjectStateWithStatus().baseline.recordStatus).toBe("cleared");
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe(
      "newer v2 bytes",
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(legacyV3);
  });

  it("reports a removal failure and leaves a recoverable guard tombstone", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(uploadedState()));
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, JSON.stringify(v2Value()));
    window.localStorage.setItem(LEGACY_STORAGE_KEY, "legacy bytes");
    const baseline = observedBaseline();
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });

    expect(await purgeProjectState(baseline)).toEqual({
      ok: false,
      reason: "storage-error",
    });
    expect(readProjectStateWithStatus().baseline.recordStatus).toBe("cleared");
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBe("legacy bytes");
  });

  it("conditionally clears only the record baseline this tab observed", async () => {
    const missingBaseline = observedBaseline();
    const initialResult = await writeProjectState(
      createDefaultProjectState(),
      missingBaseline,
    );
    if (!initialResult.ok) throw new Error("Expected initial project state write to succeed");

    expect(await clearProjectState(missingBaseline)).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(
      initialResult.recordValue,
    );

    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, "previous bytes");
    window.localStorage.setItem(LEGACY_STORAGE_KEY, "legacy bytes");
    const current = readProjectStateWithStatus();
    const cleared = await clearProjectState(current.baseline);
    expect(cleared).toEqual(
      expect.objectContaining({ ok: true, recordValue: expect.any(String) }),
    );
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBe(
      cleared.ok ? cleared.recordValue : null,
    );
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe("previous bytes");
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBe("legacy bytes");
    expect(readProjectStateWithStatus().baseline.recordStatus).toBe("cleared");
  });

  it("fails closed when a v2 project changes before a migrated clear", async () => {
    const observedPrevious = JSON.stringify(v2Value());
    const newerV2 = JSON.stringify(v2Value({
      ...uploadedState(),
      targetGrade: 84,
    }));
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, observedPrevious);
    window.localStorage.setItem(LEGACY_STORAGE_KEY, "legacy bytes");
    const read = readProjectStateWithStatus();
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, newerV2);

    expect(await clearProjectState(read.baseline)).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBeNull();
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe(newerV2);
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBe("legacy bytes");
  });

  it("reports a post-clear v2 race and keeps the tombstone candidate", async () => {
    const initialResult = await writeProjectState(
      createDefaultProjectState(),
      observedBaseline(),
    );
    if (!initialResult.ok) throw new Error("Expected initial write to succeed");
    const observedPrevious = JSON.stringify(v2Value());
    const newerV2 = JSON.stringify(v2Value({
      ...uploadedState(),
      targetGrade: 86,
    }));
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, observedPrevious);
    const nativeSetItem = Storage.prototype.setItem;
    let injected = false;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      nativeSetItem.call(this, key, value);
      if (key === PROJECT_RECORD_KEY && !injected) {
        injected = true;
        nativeSetItem.call(this, PREVIOUS_STORAGE_KEY, newerV2);
      }
    });

    const baseline = readProjectStateWithStatus().baseline;
    expect(await clearProjectState(baseline)).toEqual({
      ok: false,
      reason: "conflict",
    });
    const tombstone = window.localStorage.getItem(PROJECT_RECORD_KEY);
    expect(tombstone).not.toBeNull();
    expect(tombstone).not.toBe(initialResult.recordValue);
    expect(JSON.parse(tombstone ?? "{}")).toMatchObject({
      formatVersion: 1,
      revision: 2,
      value: { kind: "cleared" },
    });
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe(newerV2);
    expect(readProjectStateWithStatus()).toMatchObject({
      source: "record",
      crossVersionConflict: true,
      baseline: { recordStatus: "cleared", revision: 2 },
    });
  });

  it("requires the exact observed baseline before clearing a v2-only project", async () => {
    const previousRaw = JSON.stringify(v2Value());
    window.localStorage.setItem(PREVIOUS_STORAGE_KEY, previousRaw);
    const observed = observedBaseline();
    const stale = { ...observed, legacyV2Value: null };

    expect(await clearProjectState(stale)).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe(previousRaw);

    expect(await clearProjectState(observed)).toEqual(
      expect.objectContaining({ ok: true, recordValue: expect.any(String) }),
    );
    expect(window.localStorage.getItem(PREVIOUS_STORAGE_KEY)).toBe(previousRaw);
    expect(readProjectStateWithStatus().baseline.recordStatus).toBe("cleared");
  });

  it("rejects invalid state before writing", async () => {
    const invalid = {
      ...uploadedState(),
      uploadedProject: null,
    } as PersistedProjectState;

    expect(await writeProjectState(invalid, observedBaseline())).toEqual({
      ok: false,
      reason: "invalid-state",
    });
    expect(window.localStorage.getItem(PROJECT_RECORD_KEY)).toBeNull();
  });

  it("rejects uploaded projects outside the bounded planning inputs", async () => {
    const oversized = uploadedState();
    oversized.uploadedProject!.wordCount = 50_001;
    expect(await writeProjectState(oversized, observedBaseline())).toEqual({
      ok: false,
      reason: "invalid-state",
    });

    const tooDistant = uploadedState();
    const maximum = maximumSupportedDueDate();
    tooDistant.uploadedProject!.dueDate = `${Number(maximum.slice(0, 4)) + 1}${maximum.slice(4)}`;
    expect(await writeProjectState(tooDistant, observedBaseline())).toEqual({
      ok: false,
      reason: "invalid-state",
    });

    const futureDated = uploadedState();
    futureDated.uploadedProject!.createdAt = "2099-01-01T00:00:00.000Z";
    expect(await writeProjectState(futureDated, observedBaseline())).toEqual({
      ok: false,
      reason: "invalid-state",
    });
  });

  it("returns an observable failure when browser storage throws", async () => {
    const baseline = observedBaseline();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    expect(await writeProjectState(createDefaultProjectState(), baseline)).toEqual({
      ok: false,
      reason: "storage-error",
    });
  });

  it("rejects self-check text beyond the UI persistence limit", async () => {
    const state = uploadedState();
    state.uploadedCriterionReviews[0].draftText = "x".repeat(
      UPLOADED_REVIEW_MAX_CHARACTERS + 1,
    );
    expect(await writeProjectState(state, observedBaseline())).toEqual({
      ok: false,
      reason: "invalid-state",
    });
  });
});
