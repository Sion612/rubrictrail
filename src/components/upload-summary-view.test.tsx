import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/components/locale-provider";
import { UploadSummaryView } from "@/components/upload-summary-view";
import { buildUploadedAssignmentSummary } from "@/lib/files/parse-assignment-files";
import { draftFromUpload } from "@/lib/uploaded-project";
import type { UploadFlowResult } from "@/lib/ui-types";

function uploadWithRubric(rubricLines: string[]): UploadFlowResult {
  const text = [
    "Assignment title: Strategy Report",
    "Deadline: 24 September 2026",
    "Word count: 2500 words",
    "Use APA 7 referencing.",
    "Rubric",
    ...rubricLines,
  ].join("\n");
  return {
    intakeMethod: "files",
    fileNames: ["brief.txt"],
    skippedFiles: [],
    totalWords: 24,
    summary: buildUploadedAssignmentSummary(text),
  };
}

function completeUpload(): UploadFlowResult {
  return uploadWithRubric(["Analysis | 60%", "Communication | 40%"]);
}

beforeEach(() => {
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("UploadSummaryView rubric weighting", () => {
  it("labels OCR-derived sources and evidence as needing image verification", () => {
    const result = completeUpload();
    result.fileNames = ["rubric.png"];
    result.sources = [{ fileName: "rubric.png", origin: "ocr" }];
    for (const criterion of result.summary.rubric.criteria) {
      criterion.evidence = {
        ...criterion.evidence,
        fileName: "rubric.png",
        origin: "ocr",
      };
    }

    render(
      <UploadSummaryView
        result={result}
        onBack={vi.fn()}
        onCreateProject={vi.fn()}
      />,
    );

    expect(screen.getByTestId("ocr-source-notice")).toHaveTextContent(
      "read with local OCR",
    );
    expect(
      screen.getAllByText("OCR-derived excerpt — verify against the image"),
    ).toHaveLength(2);
  });

  it("defaults to published only for a complete official 100% breakdown", () => {
    render(
      <UploadSummaryView
        result={uploadWithRubric(["Analysis | 60%", "Communication | 40%"])}
        onBack={vi.fn()}
        onCreateProject={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("radio", { name: /Yes — use the published percentages/ }),
    ).toBeChecked();
    expect(screen.getByText("Published total: 100%")).toBeInTheDocument();
    expect(screen.getByTestId("criterion-weight-0")).toHaveValue(60);
  });

  it("requires a choice, then retains a known partial 40% without inventing the missing value", () => {
    const onCreateProject = vi.fn();
    render(
      <UploadSummaryView
        result={uploadWithRubric(["- Analysis", "- Communication — 40%"])}
        onBack={vi.fn()}
        onCreateProject={onCreateProject}
      />,
    );

    const published = screen.getByRole("radio", {
      name: /Yes — use the published percentages/,
    });
    const notPublished = screen.getByRole("radio", {
      name: /No — no complete percentage breakdown is published/,
    });
    expect(published).not.toBeChecked();
    expect(notPublished).not.toBeChecked();

    fireEvent.click(screen.getByTestId("create-project"));
    const errorLink = screen.getByRole("link", {
      name: "Choose whether the official rubric provides a complete percentage breakdown.",
    });
    fireEvent.click(errorLink);
    expect(published).toHaveFocus();

    fireEvent.click(notPublished);
    expect(screen.getByTestId("criterion-weight-0")).toHaveValue(null);
    expect(screen.getByTestId("criterion-weight-1")).toHaveValue(40);
    expect(screen.getByTestId("criterion-weight-1")).not.toBeDisabled();
    expect(
      screen.getByText("Incomplete weights: 1 of 2 recorded"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("create-project"));

    expect(onCreateProject).toHaveBeenCalledTimes(1);
    expect(onCreateProject.mock.calls[0][0].weightingStatus).toBe("incomplete");
    expect(
      onCreateProject.mock.calls[0][0].criteria.map(
        (criterion: { weight: number | null }) => criterion.weight,
      ),
    ).toEqual([null, 40]);
  });

  it("keeps criterion provenance when only a published weight is edited", () => {
    render(
      <UploadSummaryView
        result={uploadWithRubric(["Analysis | 60%", "Communication | 40%"])}
        onBack={vi.fn()}
        onCreateProject={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Source-linked criterion")).toHaveLength(2);
    fireEvent.change(screen.getByTestId("criterion-weight-0"), {
      target: { value: "55" },
    });
    expect(screen.getAllByText("Source-linked criterion")).toHaveLength(2);
    expect(screen.getByText("Entered manually — verify")).toBeInTheDocument();
  });

  it("keeps the weight source label aligned after an earlier criterion is removed", () => {
    render(
      <UploadSummaryView
        result={uploadWithRubric(["Analysis | 60%", "Communication | 40%"])}
        onBack={vi.fn()}
        onCreateProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove criterion 1" }));

    const remainingWeight = screen.getByTestId("criterion-weight-0");
    expect(remainingWeight).toHaveValue(40);
    const weightField = remainingWeight.closest(".weight-field");
    expect(weightField).not.toBeNull();
    expect(within(weightField as HTMLElement).getByText("Found in source")).toBeInTheDocument();
  });
});

describe("UploadSummaryView provenance and recovery", () => {
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

  it("does not translate a real uploaded file whose name resembles a pasted source", () => {
    const result = {
      ...completeUpload(),
      intakeMethod: "files" as const,
      fileNames: ["Pasted assignment brief.txt"],
    };
    render(
      <LocaleProvider>
        <UploadSummaryView result={result} onBack={vi.fn()} onCreateProject={vi.fn()} />
      </LocaleProvider>,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zh-CN" } });
    expect(screen.getByText("Pasted assignment brief.txt")).toBeInTheDocument();
    expect(screen.queryByText("粘贴的作业说明")).not.toBeInTheDocument();
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
    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 0,
      left: 0,
      behavior: "auto",
    });

    const title = screen.getByTestId("confirm-title");
    const titleField = title.closest(".confirm-field") as HTMLElement;
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
    let criterionRow = screen
      .getByTestId("criterion-name-0")
      .closest(".rubric-editor-row");
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
    criterionRow = screen
      .getByTestId("criterion-name-0")
      .closest(".rubric-editor-row");
    expect(
      within(criterionRow as HTMLElement).getByText(/Source: source text/),
    ).toBeInTheDocument();
  });

  it("keeps evidence disclosures outside explicit field labels", () => {
    const { container } = render(
      <UploadSummaryView
        result={completeUpload()}
        onBack={vi.fn()}
        onCreateProject={vi.fn()}
      />,
    );

    const expectedNames = new Map([
      ["confirm-title", "Assignment title"],
      ["confirm-course", "Course or module Optional"],
      ["confirm-deadline", "Deadline"],
      ["confirm-word-count", "Word count"],
      ["confirm-citation-style", "Citation style"],
    ]);

    expectedNames.forEach((name, id) => {
      const control = container.querySelector<HTMLElement>(`#${id}`);
      const label = container.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
      expect(control).not.toBeNull();
      expect(label).not.toBeNull();
      expect(control).toHaveAccessibleName(name);
    });

    container.querySelectorAll(".source-evidence-note").forEach((details) => {
      expect(details.closest("label")).toBeNull();
    });
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

  it("keeps omitted files visible throughout a partial preview", () => {
    const onBack = vi.fn();
    const result: UploadFlowResult = {
      ...completeUpload(),
      skippedFiles: [
        {
          inputIndex: 1,
          fileName: "<img onerror=alert(1)>.pdf",
          code: "SCANNED_NO_TEXT",
          message: "No selectable text was found.",
        },
      ],
    };
    const { container } = render(
      <UploadSummaryView
        result={result}
        onBack={onBack}
        onCreateProject={vi.fn()}
      />,
    );

    expect(screen.getByText("Partial parse ready")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "This preview uses 1 of the 2 selected files.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("brief.txt")).toBeInTheDocument();
    expect(screen.getByText("<img onerror=alert(1)>.pdf")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/not included in any detected field/i)).toBeInTheDocument();

    const reviewButtons = screen.getAllByRole("button", {
      name: "Review file selection",
    });
    expect(reviewButtons).toHaveLength(2);
    fireEvent.click(reviewButtons[0]);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("keeps edited and source data intact while switching the confirmation view to Chinese", () => {
    render(
      <LocaleProvider>
        <UploadSummaryView
          result={completeUpload()}
          onBack={vi.fn()}
          onCreateProject={vi.fn()}
        />
      </LocaleProvider>,
    );

    const language = screen.getByRole("combobox");
    fireEvent.change(language, { target: { value: "en" } });
    fireEvent.change(screen.getByTestId("confirm-title"), {
      target: { value: "PRIVATE-EDITED-TITLE" },
    });
    fireEvent.change(language, { target: { value: "zh-CN" } });

    expect(screen.getByRole("heading", { name: "确认作业要求。" })).toBeInTheDocument();
    expect(screen.getByTestId("confirm-title")).toHaveValue("PRIVATE-EDITED-TITLE");
    expect(screen.getByTestId("criterion-name-0")).toHaveValue("Analysis");
    expect(screen.getByText("brief.txt")).toBeInTheDocument();
    expect(screen.getByText("已手动编辑 — 请与原文摘录核对")).toBeInTheDocument();
  });
});
