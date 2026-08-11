import { describe, expect, it } from "vitest";
import {
  buildUploadedAssignmentSummary,
  parseAssignmentFiles,
} from "@/lib/files/parse-assignment-files";
import {
  createPastedAssignmentFiles,
  PASTED_ASSIGNMENT_TEXT_MAX_CHARACTERS,
  PASTED_ASSIGNMENT_TEXT_MAX_LINES,
  PASTED_BRIEF_FILE_NAME,
  PASTED_RUBRIC_FILE_NAME,
  validatePastedAssignmentText,
} from "@/lib/pasted-text-intake";

describe("pasted assignment intake", () => {
  it("requires a non-empty brief and bounds combined characters before parsing", () => {
    expect(validatePastedAssignmentText({ brief: " \n ", rubric: "" })).toMatchObject({
      target: "brief",
    });
    expect(validatePastedAssignmentText({ brief: "\uFEFF\u0000\u0000", rubric: "" })).toMatchObject({
      target: "brief",
    });
    expect(
      validatePastedAssignmentText({
        brief: "a".repeat(PASTED_ASSIGNMENT_TEXT_MAX_CHARACTERS),
        rubric: "",
      }),
    ).toBeNull();
    expect(
      validatePastedAssignmentText({
        brief: "a".repeat(PASTED_ASSIGNMENT_TEXT_MAX_CHARACTERS),
        rubric: "b",
      }),
    ).toMatchObject({ target: "combined" });
  });

  it("rejects pathological line counts without splitting the full input", () => {
    expect(
      validatePastedAssignmentText({
        brief: "x\n".repeat(PASTED_ASSIGNMENT_TEXT_MAX_LINES),
        rubric: "",
      }),
    ).toMatchObject({ target: "combined" });
    expect(
      validatePastedAssignmentText({
        brief: "x\r".repeat(PASTED_ASSIGNMENT_TEXT_MAX_LINES),
        rubric: "",
      }),
    ).toMatchObject({ target: "combined" });
  });

  it("creates fixed plain-text sources and omits an empty optional rubric", () => {
    const oneFile = createPastedAssignmentFiles({
      brief: "Assignment instructions",
      rubric: "  ",
    });
    expect(oneFile).toHaveLength(1);
    expect(oneFile[0]).toMatchObject({
      name: PASTED_BRIEF_FILE_NAME,
      type: "text/plain",
      lastModified: 0,
    });

    const twoFiles = createPastedAssignmentFiles({
      brief: "Assignment instructions",
      rubric: "Rubric\nAnalysis | 100%",
    });
    expect(twoFiles.map((file) => file.name)).toEqual([
      PASTED_BRIEF_FILE_NAME,
      PASTED_RUBRIC_FILE_NAME,
    ]);
  });

  it("reuses the bounded TXT parser and retains pasted-source provenance", async () => {
    const files = createPastedAssignmentFiles({
      brief: [
        "Assignment title: Service Report",
        "Deadline: 24 September 2026",
        "Word count: 2500 words",
        "Use APA 7 referencing.",
      ].join("\n"),
      rubric: "Rubric\nAnalysis | 60%\nCommunication | 40%",
    });
    const parsed = await parseAssignmentFiles(files);
    const summary = buildUploadedAssignmentSummary(parsed);

    expect(summary.status).toBe("complete");
    expect(summary.title.evidence?.fileName).toBe(PASTED_BRIEF_FILE_NAME);
    expect(summary.rubric.criteria[0].evidence.fileName).toBe(
      PASTED_RUBRIC_FILE_NAME,
    );
    expect(parsed.sources).toHaveLength(2);
  });
});
