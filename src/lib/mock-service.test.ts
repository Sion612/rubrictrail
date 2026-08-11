import { describe, expect, it } from "vitest";
import { runMockDraftCheck } from "@/lib/mock-service";
import { SAMPLE_DRAFT_TEXT } from "@/lib/sample-data";

describe("runMockDraftCheck", () => {
  it("keeps the authored sample feedback for its intended analysis section", async () => {
    const result = await runMockDraftCheck(
      SAMPLE_DRAFT_TEXT,
      "analysis-recommendations",
    );

    expect(result.sectionId).toBe("analysis-recommendations");
    expect(result.feedback.some((item) => item.id === "feedback-utilisation")).toBe(true);
  });

  it("changes the coaching when the same text is checked as implementation", async () => {
    const result = await runMockDraftCheck(SAMPLE_DRAFT_TEXT, "implementation");
    const sectionFeedback = result.feedback.find(
      (item) => item.id === "dynamic-section-fit",
    );

    expect(result.sectionId).toBe("implementation");
    expect(sectionFeedback?.title).toBe(
      "Turn the proposal into a testable implementation",
    );
    expect(sectionFeedback?.rubricIds).toContain("recommendations");
    expect(result.nextActions[1].text).toContain("owners");
  });
});
