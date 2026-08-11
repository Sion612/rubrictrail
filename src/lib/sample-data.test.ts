import { describe, expect, it } from "vitest";
import { rubricTrailFixtureSchema } from "./domain";
import {
  SAMPLE_ASSIGNMENT,
  SAMPLE_ASSIGNMENT_BRIEF,
  SAMPLE_DRAFT,
  SAMPLE_DRAFT_CHECK,
  SAMPLE_FIXTURE,
  SAMPLE_RUBRIC_TEXT,
} from "./sample-data";

describe("LumaLane sample fixture", () => {
  it("contains a complete original brief, rubric and five-criterion map", () => {
    expect(SAMPLE_ASSIGNMENT_BRIEF).toContain("LumaLane Market is a fictional eight-store convenience retailer");
    expect(SAMPLE_ASSIGNMENT_BRIEF).toContain("Do not invent operational data");
    expect(SAMPLE_RUBRIC_TEXT).toContain("Problem diagnosis — 20%");
    expect(SAMPLE_ASSIGNMENT.rubric.map((item) => item.weight)).toEqual([20, 25, 20, 25, 10]);
  });

  it("resolves every rubric and requirement evidence reference", () => {
    const evidenceIds = new Set(SAMPLE_ASSIGNMENT.evidence.map((item) => item.id));
    const linkedItems = [
      ...SAMPLE_ASSIGNMENT.deliverables,
      ...SAMPLE_ASSIGNMENT.learningObjectives,
      ...SAMPLE_ASSIGNMENT.constraints,
      ...SAMPLE_ASSIGNMENT.hiddenRequirements,
      ...SAMPLE_ASSIGNMENT.integrityGuidance,
      ...SAMPLE_ASSIGNMENT.ambiguities,
      ...SAMPLE_ASSIGNMENT.rubric,
    ];
    for (const item of linkedItems) {
      for (const reference of item.evidenceRefs) expect(evidenceIds.has(reference), reference).toBe(true);
    }
  });

  it("keeps evidence attached to fixture documents", () => {
    const documentIds = new Set(SAMPLE_ASSIGNMENT.sourceDocuments.map((document) => document.id));
    for (const evidence of SAMPLE_ASSIGNMENT.evidence) expect(documentIds.has(evidence.documentId)).toBe(true);
    expect(SAMPLE_ASSIGNMENT.evidence.find((item) => item.id === "brief-scope")?.excerpt).toBe("Focus on one process problem; do not attempt to redesign the whole business.");
  });

  it("provides an average-quality draft with integrity-safe feedback", () => {
    expect(SAMPLE_DRAFT.text.split(/\s+/).length).toBeGreaterThan(200);
    expect(SAMPLE_DRAFT.text).toContain("reduce waiting by at least 50%");
    expect(SAMPLE_DRAFT_CHECK.coverageEstimate).toBe(46);
    expect(SAMPLE_DRAFT_CHECK.coverageDisclaimer).toContain("not a predicted grade");
    expect(SAMPLE_DRAFT_CHECK.feedback.some((item) => item.kind === "strength")).toBe(true);
    expect(SAMPLE_DRAFT_CHECK.feedback.some((item) => item.kind === "evidence_gap")).toBe(true);
    expect(SAMPLE_DRAFT_CHECK.feedback.some((item) => item.guidance?.kind === "sentence_stem")).toBe(true);
    expect(SAMPLE_DRAFT_CHECK.feedback.some((item) => "replacementParagraph" in item)).toBe(false);
  });

  it("keeps every highlighted excerpt byte-aligned with the draft", () => {
    for (const feedback of SAMPLE_DRAFT_CHECK.feedback) {
      for (const span of feedback.draftEvidence) expect(SAMPLE_DRAFT.text.slice(span.start, span.end)).toBe(span.excerpt);
    }
    expect(rubricTrailFixtureSchema.safeParse(SAMPLE_FIXTURE).success).toBe(true);
  });
});
