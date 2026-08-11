import { describe, expect, it } from "vitest";
import {
  LIVE_BRIEF_DOCUMENT_ID,
  LIVE_DRAFT_ID,
  validateLiveAssignmentOutput,
  validateLiveDraftOutput,
} from "@/lib/ai/live-validation";
import {
  SAMPLE_ASSIGNMENT,
  SAMPLE_DRAFT_CHECK,
  SAMPLE_DRAFT_TEXT,
} from "@/lib/sample-data";

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("Live output boundary validation", () => {
  it("attaches trusted input text instead of accepting model-returned documents", () => {
    const { sourceDocuments: originalDocuments, ...output } = clone(SAMPLE_ASSIGNMENT);
    expect(originalDocuments.length).toBeGreaterThan(0);
    output.evidence = output.evidence.map((item) => ({
      ...item,
      documentId: LIVE_BRIEF_DOCUMENT_ID,
    }));
    const everyExcerpt = output.evidence.map((item) => item.excerpt).join("\n");

    const result = validateLiveAssignmentOutput(output, {
      assignmentText: everyExcerpt,
      fileName: "student-brief.txt",
    });

    expect(result.sourceDocuments).toHaveLength(1);
    expect(result.sourceDocuments[0].content).toBe(everyExcerpt);
  });

  it("rejects draft feedback with identifiers outside the trusted input", () => {
    const invalid = clone(SAMPLE_DRAFT_CHECK);
    invalid.draftId = "model-invented-draft";

    expect(() =>
      validateLiveDraftOutput(invalid, {
        assignment: SAMPLE_ASSIGNMENT,
        draftText: SAMPLE_DRAFT_TEXT,
        section: "analysis-recommendations",
      }),
    ).toThrow();

    const valid = clone(SAMPLE_DRAFT_CHECK);
    valid.draftId = LIVE_DRAFT_ID;
    expect(
      validateLiveDraftOutput(valid, {
        assignment: SAMPLE_ASSIGNMENT,
        draftText: SAMPLE_DRAFT_TEXT,
        section: "analysis-recommendations",
      }).draftId,
    ).toBe(LIVE_DRAFT_ID);
  });
});
