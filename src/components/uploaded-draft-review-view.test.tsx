import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UploadedDraftReviewView } from "@/components/views/uploaded-project-views";
import type { UploadedCriterionReview, UploadedProject } from "@/lib/ui-types";

afterEach(cleanup);

function projectWithCriterion(name: string): UploadedProject {
  return {
    id: "same-project-id",
    title: "Assignment",
    course: "Course",
    dueDate: "2026-09-24",
    wordCount: 2_500,
    citationStyle: "APA 7",
    fileNames: ["brief.txt"],
    extractedWordCount: 100,
    weightingStatus: "complete",
    criteria: [
      {
        id: "shared-criterion-id",
        name,
        weight: 100,
        evidence: null,
      },
    ],
    createdAt: "2026-08-12T00:00:00.000Z",
  };
}

function reviewWithText(draftText: string): UploadedCriterionReview {
  return {
    criterionId: "shared-criterion-id",
    draftText,
    evidenceVisible: true,
    linkExplained: true,
    sourceTraceable: true,
    updatedAt: "2026-08-12T00:00:00.000Z",
  };
}

describe("UploadedDraftReviewView", () => {
  it("selects a valid requested criterion and falls back safely", () => {
    const project: UploadedProject = {
      ...projectWithCriterion("Analysis"),
      criteria: [
        {
          id: "analysis",
          name: "Analysis",
          weight: 60,
          evidence: null,
        },
        {
          id: "communication",
          name: "Communication",
          weight: 40,
          evidence: null,
        },
      ],
    };
    const props = {
      project,
      reviews: [],
      onChange: vi.fn(),
      onSave: vi.fn(async () => undefined),
      onNavigate: vi.fn(),
    };
    const { rerender } = render(
      <UploadedDraftReviewView
        {...props}
        initialCriterionId="communication"
      />,
    );

    expect(screen.getByRole("combobox", { name: "Rubric criterion" })).toHaveValue(
      "communication",
    );

    rerender(
      <UploadedDraftReviewView
        {...props}
        initialCriterionId="removed-criterion"
      />,
    );

    expect(screen.getByRole("combobox", { name: "Rubric criterion" })).toHaveValue(
      "analysis",
    );
  });

  it("uses replacement project reviews as authoritative even when the project and criterion ids match", async () => {
    const onChange = vi.fn();
    const onSave = vi.fn(async () => undefined);
    const projectA = projectWithCriterion("Criterion from project A");
    const reviewA = reviewWithText(
      "Draft evidence from project A must not survive replacement.",
    );
    const { rerender } = render(
      <UploadedDraftReviewView
        project={projectA}
        reviews={[reviewA]}
        onChange={onChange}
        onSave={onSave}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByRole("option", { name: "Criterion from project A · 100%" })).toBeInTheDocument();
    expect(screen.getByTestId("uploaded-review-text")).toHaveValue(reviewA.draftText);

    const locallyEditedText =
      "A locally edited project A value must also be replaced by project B.";
    fireEvent.change(screen.getByTestId("uploaded-review-text"), {
      target: { value: locallyEditedText },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      criterionId: "shared-criterion-id",
      draftText: locallyEditedText,
      evidenceVisible: true,
      linkExplained: true,
      sourceTraceable: true,
      updatedAt: null,
    });

    const projectB = projectWithCriterion("Criterion from project B");
    const reviewB = reviewWithText(
      "Replacement evidence from project B is the only text that may be saved.",
    );
    rerender(
      <UploadedDraftReviewView
        project={projectB}
        reviews={[reviewB]}
        onChange={onChange}
        onSave={onSave}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.queryByRole("option", { name: /project A/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Criterion from project B · 100%" })).toBeInTheDocument();
    expect(screen.getByTestId("uploaded-review-text")).toHaveValue(reviewB.draftText);
    expect(onChange).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTestId("save-self-check"));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith({
      criterionId: "shared-criterion-id",
      draftText: reviewB.draftText,
      evidenceVisible: true,
      linkExplained: true,
      sourceTraceable: true,
      updatedAt: expect.any(String),
    });
    expect(JSON.stringify(onSave.mock.calls)).not.toContain(reviewA.draftText);
    expect(JSON.stringify(onSave.mock.calls)).not.toContain(locallyEditedText);
  });
});
