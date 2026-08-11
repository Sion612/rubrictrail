import { describe, expect, it, vi } from "vitest";
import { createDefaultProjectState } from "@/lib/local-state";
import {
  MAX_PROJECT_BACKUP_BYTES,
  MAX_PROJECT_BACKUP_CHARACTERS,
  parseProjectBackupText,
  projectBackupFileName,
  ProjectBackupError,
  readProjectBackupFile,
  serializeProjectBackup,
} from "@/lib/project-backup";
import { SAMPLE_DRAFT_CHECK } from "@/lib/sample-data";
import type { PersistedProjectState, UploadedProject } from "@/lib/ui-types";

function uploadedProject(): UploadedProject {
  return {
    id: "uploaded-1",
    title: "供应链 Strategy / Report",
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
  };
}

function sampleState(): PersistedProjectState {
  return {
    ...createDefaultProjectState(),
    projectKind: "sample",
    view: "draft",
    visitedViews: ["overview", "draft"],
    completedTaskIds: ["p1"],
    draftResult: SAMPLE_DRAFT_CHECK,
    checkedDraftText: createDefaultProjectState().draftText,
  };
}

function expectBackupError(action: () => unknown, code: ProjectBackupError["code"]) {
  try {
    action();
    throw new Error("Expected a project backup error");
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectBackupError);
    expect((error as ProjectBackupError).code).toBe(code);
  }
}

describe("RubricTrail project backups", () => {
  it("round-trips sample and uploaded projects through the versioned envelope", () => {
    for (const state of [sampleState(), uploadedState()]) {
      const serialized = serializeProjectBackup(
        state,
        "2026-08-12T08:00:00.000Z",
      );

      const expectedState = {
        ...state,
        draftResult: null,
        checkedDraftText: null,
      };
      expect(parseProjectBackupText(serialized)).toEqual({
        state: expectedState,
        exportedAt: "2026-08-12T08:00:00.000Z",
        recovered: false,
      });
      expect(JSON.parse(serialized)).toMatchObject({
        format: "rubrictrail-project",
        formatVersion: 1,
        project: { version: 2, projectKind: state.projectKind },
      });
    }
  });

  it("uses a portable, recognizable filename without losing CJK titles", () => {
    expect(
      projectBackupFileName(uploadedState(), "2026-08-12T08:00:00.000Z"),
    ).toBe("rubrictrail-供应链-strategy-report-2026-08-12.rubrictrail.json");
  });

  it("refuses to export or restore an empty project", () => {
    expectBackupError(
      () => serializeProjectBackup(createDefaultProjectState()),
      "no-project",
    );

    const envelope = JSON.parse(serializeProjectBackup(sampleState()));
    envelope.project = createDefaultProjectState();
    expectBackupError(
      () => parseProjectBackupText(JSON.stringify(envelope)),
      "no-project",
    );
  });

  it("does not mistake raw localStorage or unrelated JSON for a backup", () => {
    expectBackupError(
      () => parseProjectBackupText(JSON.stringify(sampleState())),
      "wrong-format",
    );
    expectBackupError(
      () => parseProjectBackupText(JSON.stringify({ hello: "world" })),
      "wrong-format",
    );
  });

  it("rejects empty and character-oversized backup text before JSON validation", () => {
    expectBackupError(() => parseProjectBackupText(""), "empty-file");
    expectBackupError(
      () => parseProjectBackupText("x".repeat(MAX_PROJECT_BACKUP_CHARACTERS + 1)),
      "file-too-large",
    );
  });

  it("distinguishes future envelope and state versions", () => {
    const futureEnvelope = JSON.parse(serializeProjectBackup(sampleState()));
    futureEnvelope.formatVersion = 2;
    expectBackupError(
      () => parseProjectBackupText(JSON.stringify(futureEnvelope)),
      "unsupported-format-version",
    );

    const futureState = JSON.parse(serializeProjectBackup(sampleState()));
    futureState.project.version = 3;
    expectBackupError(
      () => parseProjectBackupText(JSON.stringify(futureState)),
      "unsupported-state-version",
    );
  });

  it("rejects malformed, unexpected, and deeply invalid backup data", () => {
    expectBackupError(() => parseProjectBackupText("{bad json"), "invalid-json");

    const extraField = JSON.parse(serializeProjectBackup(sampleState()));
    extraField.__proto_marker__ = true;
    expectBackupError(
      () => parseProjectBackupText(JSON.stringify(extraField)),
      "invalid-project",
    );

    const invalidEvidence = JSON.parse(serializeProjectBackup(uploadedState()));
    invalidEvidence.project.uploadedProject.criteria[0].evidence.page = -1;
    expectBackupError(
      () => parseProjectBackupText(JSON.stringify(invalidEvidence)),
      "invalid-project",
    );

    const excessiveFeedback = JSON.parse(serializeProjectBackup(sampleState()));
    excessiveFeedback.project.draftResult = structuredClone(SAMPLE_DRAFT_CHECK);
    excessiveFeedback.project.checkedDraftText = excessiveFeedback.project.draftText;
    excessiveFeedback.project.draftResult.feedback = Array.from(
      { length: 201 },
      () => SAMPLE_DRAFT_CHECK.feedback[0],
    );
    expectBackupError(
      () => parseProjectBackupText(JSON.stringify(excessiveFeedback)),
      "invalid-project",
    );
  });

  it("repairs obsolete ids while keeping a valid project", () => {
    const envelope = JSON.parse(serializeProjectBackup(sampleState()));
    envelope.project.completedTaskIds.push("removed-task");

    const restored = parseProjectBackupText(JSON.stringify(envelope));
    expect(restored.recovered).toBe(true);
    expect(restored.state.completedTaskIds).toEqual(["p1"]);
  });

  it("drops editable derived demo results and requires them to be rerun", () => {
    const envelope = JSON.parse(serializeProjectBackup(sampleState()));
    envelope.project.draftResult = structuredClone(SAMPLE_DRAFT_CHECK);
    envelope.project.checkedDraftText = envelope.project.draftText;

    const restored = parseProjectBackupText(JSON.stringify(envelope));
    expect(restored.recovered).toBe(true);
    expect(restored.state.draftResult).toBeNull();
    expect(restored.state.checkedDraftText).toBeNull();
  });

  it("checks bytes and UTF-8 before parsing a selected file", async () => {
    const oversized = {
      size: MAX_PROJECT_BACKUP_BYTES + 1,
      arrayBuffer: vi.fn(),
    } as unknown as File;
    await expect(readProjectBackupFile(oversized)).rejects.toMatchObject({
      code: "file-too-large",
    });
    expect(oversized.arrayBuffer).not.toHaveBeenCalled();

    const invalidUtf8 = {
      size: 2,
      arrayBuffer: async () => new Uint8Array([0xc3, 0x28]).buffer,
    } as unknown as File;
    await expect(readProjectBackupFile(invalidUtf8)).rejects.toMatchObject({
      code: "invalid-utf8",
    });
  });
});
