import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadSummaryView } from "@/components/upload-summary-view";
import { buildUploadedAssignmentSummary } from "@/lib/files/parse-assignment-files";
import { draftFromUpload } from "@/lib/uploaded-project";
import type { UploadFlowResult } from "@/lib/ui-types";

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function completeUpload(): UploadFlowResult {
  const text = [
    "Assignment title: Strategy Report",
    "Deadline: 24 September 2026",
    "Word count: 2500 words",
    "Use APA 7 referencing.",
    "Rubric",
    "Analysis | 60%",
    "Communication | 40%",
  ].join("\n");
  return {
    intakeMethod: "files",
    fileNames: ["brief.txt"],
    totalWords: 18,
    summary: buildUploadedAssignmentSummary(text),
  };
}

describe("UploadSummaryView provenance", () => {
  it("labels pasted sources without claiming that a file was uploaded", () => {
    const result = {
      ...completeUpload(),
      intakeMethod: "paste" as const,
      fileNames: ["Pasted assignment brief.txt", "Pasted rubric.txt"],
    };
    render(
      <UploadSummaryView
        result={result}
        onBack={vi.fn()}
        onCreateProject={vi.fn()}
      />,
    );

    expect(screen.getByText("Pasted text ready")).toBeInTheDocument();
    expect(screen.getAllByText("Found in pasted text").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Edit pasted text" })).toBeInTheDocument();
    expect(screen.queryByText("Found in the uploaded source")).not.toBeInTheDocument();
  });

  it("marks edits as manual and restores source provenance after an exact revert", () => {
    const result = completeUpload();
    const initial = draftFromUpload(result);
    render(
      <UploadSummaryView
        result={result}
        onBack={vi.fn()}
        onCreateProject={vi.fn()}
      />,
    );

    const heading = screen.getByRole("heading", {
      name: "Confirm what the assignment says.",
    });
    expect(heading).toHaveFocus();

    const title = screen.getByTestId("confirm-title");
    const titleField = title.closest("label") as HTMLElement;
    fireEvent.change(title, { target: { value: "Edited title" } });
    expect(
      within(titleField).getByText(
        "Edited manually — compare with the source excerpt",
      ),
    ).toBeInTheDocument();
    fireEvent.change(title, { target: { value: initial.title } });
    expect(
      within(titleField).getByText("Found in the uploaded source"),
    ).toBeInTheDocument();

    const criterionInput = screen.getByTestId("criterion-name-0");
    const originalCriterionRow = criterionInput.closest(".rubric-editor-row");
    criterionInput.focus();
    fireEvent.change(criterionInput, { target: { value: "Edited analysis" } });
    let criterionRow = screen.getByTestId("criterion-name-0").closest(".rubric-editor-row");
    expect(criterionRow).not.toBeNull();
    expect(criterionRow).toBe(originalCriterionRow);
    expect(screen.getByTestId("criterion-name-0")).toHaveFocus();
    expect(
      within(criterionRow as HTMLElement).getByText(
        "No source excerpt was retained for this field.",
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("criterion-name-0"), {
      target: { value: initial.criteria[0].name },
    });
    criterionRow = screen.getByTestId("criterion-name-0").closest(".rubric-editor-row");
    expect(
      within(criterionRow as HTMLElement).getByText(/Source: source text/),
    ).toBeInTheDocument();
  });

  it("links the error summary to specific invalid controls", () => {
    render(
      <UploadSummaryView
        result={completeUpload()}
        onBack={vi.fn()}
        onCreateProject={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId("confirm-title"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("criterion-name-1"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByTestId("create-project"));

    const title = screen.getByTestId("confirm-title");
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(title).toHaveAttribute("aria-describedby", "confirm-title-error");
    expect(screen.getAllByText("Criterion 2: add a name.")).toHaveLength(2);

    const titleErrorLink = screen.getByRole("link", {
      name: "Add an assignment title.",
    });
    expect(titleErrorLink).toHaveAttribute("href", "#confirm-title");
    fireEvent.click(titleErrorLink);
    expect(title).toHaveFocus();
  });
});
