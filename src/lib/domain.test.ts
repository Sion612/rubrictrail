import { describe, expect, it } from "vitest";

import {
  assignmentAnalysisSchema,
  planGenerationInputSchema,
  rubricTrailFixtureSchema,
} from "./domain";
import { SAMPLE_ASSIGNMENT, SAMPLE_FIXTURE } from "./sample-data";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("assignmentAnalysisSchema", () => {
  it("accepts the complete evidence-linked sample assignment", () => {
    const parsed = assignmentAnalysisSchema.parse(SAMPLE_ASSIGNMENT);

    expect(parsed.rubric).toHaveLength(5);
    expect(parsed.rubric.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
  });

  it("rejects rubric weights that do not total 100", () => {
    const invalid = clone(SAMPLE_ASSIGNMENT);
    invalid.rubric[0].weight = 19;

    const result = assignmentAnalysisSchema.safeParse(invalid);

    expect(result.success).toBe(false);
  });

  it("rejects evidence links that cannot be resolved", () => {
    const invalid = clone(SAMPLE_ASSIGNMENT);
    invalid.deliverables[0].evidenceRefs = ["missing-evidence"];

    const result = assignmentAnalysisSchema.safeParse(invalid);

    expect(result.success).toBe(false);
  });

  it("rejects evidence that points to an unknown source document", () => {
    const invalid = clone(SAMPLE_ASSIGNMENT);
    invalid.evidence[0].documentId = "missing-document";

    const result = assignmentAnalysisSchema.safeParse(invalid);

    expect(result.success).toBe(false);
  });

  it("rejects an exact excerpt that is not present in its source", () => {
    const invalid = clone(SAMPLE_ASSIGNMENT);
    invalid.evidence[0].excerpt = "This sentence does not occur in the source.";

    const result = assignmentAnalysisSchema.safeParse(invalid);

    expect(result.success).toBe(false);
  });
});

describe("rubricTrailFixtureSchema", () => {
  it("validates assignment, draft and feedback as one fixture", () => {
    expect(rubricTrailFixtureSchema.parse(SAMPLE_FIXTURE)).toEqual(SAMPLE_FIXTURE);
  });

  it("rejects a feedback span that does not match the draft", () => {
    const invalid = clone(SAMPLE_FIXTURE);
    const span = invalid.draftCheck.feedback[0].draftEvidence[0];
    span.excerpt = `${span.excerpt} changed`;

    const result = rubricTrailFixtureSchema.safeParse(invalid);

    expect(result.success).toBe(false);
  });

  it("rejects feedback linked to a criterion outside the assignment", () => {
    const invalid = clone(SAMPLE_FIXTURE);
    invalid.draftCheck.criteria[0].criterionId = "not-a-criterion";

    const result = rubricTrailFixtureSchema.safeParse(invalid);

    expect(result.success).toBe(false);
  });
});

describe("planGenerationInputSchema", () => {
  it("rejects impossible dates and a due date before the start", () => {
    expect(
      planGenerationInputSchema.safeParse({
        weeklyHours: 10,
        targetGrade: 70,
        startDate: "2026-02-30",
        dueDate: "2026-03-10",
      }).success,
    ).toBe(false);

    expect(
      planGenerationInputSchema.safeParse({
        weeklyHours: 10,
        targetGrade: 70,
        startDate: "2026-07-20",
        dueDate: "2026-07-19",
      }).success,
    ).toBe(false);
  });
});
