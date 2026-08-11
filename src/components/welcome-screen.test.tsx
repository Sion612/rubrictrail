import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WelcomeScreen } from "@/components/welcome-screen";
import { buildUploadedAssignmentSummary } from "@/lib/files/parse-assignment-files";

const defaultProps = {
  onTrySample: vi.fn(),
  onFiles: vi.fn(),
  onPastedText: vi.fn(),
  intakeMode: "files" as const,
  onIntakeModeChange: vi.fn(),
  pastedBrief: "",
  onPastedBriefChange: vi.fn(),
  pastedRubric: "",
  onPastedRubricChange: vi.fn(),
  pastedTextError: null,
  isLoadingSample: false,
  uploadStatus: "idle" as const,
  uploadError: null,
  partialUploadResult: null,
  onReviewPartialUpload: vi.fn(),
  onImportBackup: vi.fn(),
  isImportingBackup: false,
  backupError: null,
};

afterEach(cleanup);

describe("WelcomeScreen upload controls", () => {
  it("locks repeated drops until the parent reports that parsing finished", () => {
    const onFiles = vi.fn();
    const { rerender } = render(
      <WelcomeScreen {...defaultProps} onFiles={onFiles} />,
    );
    const file = new File(["Assignment brief"], "brief.txt", {
      type: "text/plain",
    });
    const drop = { dataTransfer: { files: [file] } };

    fireEvent.drop(screen.getByTestId("upload-zone"), drop);
    fireEvent.drop(screen.getByTestId("upload-zone"), drop);
    expect(onFiles).toHaveBeenCalledTimes(1);

    rerender(
      <WelcomeScreen
        {...defaultProps}
        onFiles={onFiles}
        uploadStatus="error"
        uploadError={{
          code: "UNKNOWN",
          fileName: null,
          title: "Try again",
          message: "Choose another source.",
          preferredRecovery: "files",
          fileIssues: [],
        }}
      />,
    );
    fireEvent.drop(screen.getByTestId("upload-zone"), drop);
    expect(onFiles).toHaveBeenCalledTimes(2);
  });

  it("exposes parsing as a disabled, busy upload group", () => {
    render(
      <WelcomeScreen {...defaultProps} uploadStatus="parsing" />,
    );

    const uploadGroup = screen.getByRole("group", {
      name: "Drop brief and rubric here",
    });
    expect(uploadGroup).toHaveAttribute("aria-busy", "true");
    expect(uploadGroup).toHaveAttribute("aria-disabled", "true");
    expect(uploadGroup).toHaveTextContent("10 MiB each · 25 MiB combined");
    expect(
      screen.getByLabelText("Upload assignment brief and rubric files"),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Parsing locally…" })).toBeDisabled();
    expect(screen.getByLabelText("Choose a RubricTrail project backup")).toBeDisabled();
  });

  it("keeps project backup errors separate from assignment upload errors", () => {
    render(
      <WelcomeScreen
        {...defaultProps}
        backupError="This is not a RubricTrail backup."
      />,
    );

    expect(screen.getByTestId("backup-error")).toHaveTextContent(
      "This is not a RubricTrail backup.",
    );
    expect(screen.queryByTestId("upload-error")).not.toBeInTheDocument();
  });

  it("puts the preferred file-error recovery first and uses precise labels", async () => {
    const { rerender } = render(
      <WelcomeScreen
        {...defaultProps}
        uploadStatus="error"
        uploadError={{
          code: "SCANNED_NO_TEXT",
          fileName: "scan.pdf",
          title: "This file has no selectable text.",
          message: "Paste the assignment instructions.",
          preferredRecovery: "paste",
          fileIssues: [],
        }}
      />,
    );
    expect(
      within(screen.getByTestId("upload-error")).getAllByRole("button").map(
        (button) => button.textContent,
      ),
    ).toEqual(["Paste text instead", "Choose another file"]);
    await waitFor(() => expect(screen.getByTestId("upload-error")).toHaveFocus());

    rerender(
      <WelcomeScreen
        {...defaultProps}
        uploadStatus="error"
        uploadError={{
          code: "FILE_TOO_LARGE",
          fileName: "large.pdf",
          title: "There is too much to process at once.",
          message: "Choose a smaller file.",
          preferredRecovery: "files",
          fileIssues: [],
        }}
      />,
    );
    expect(
      within(screen.getByTestId("upload-error")).getAllByRole("button")[0],
    ).toHaveTextContent("Choose a smaller file");

    for (const { code, chooseLabel } of [
      { code: "PDF_TOO_MANY_PAGES", chooseLabel: "Choose a shorter PDF" },
      { code: "TOTAL_PDF_PAGES_TOO_LARGE", chooseLabel: "Choose fewer files" },
      { code: "EXTRACTED_TEXT_TOO_LARGE", chooseLabel: "Choose fewer files" },
      { code: "EXTRACTED_TEXT_TOO_MANY_LINES", chooseLabel: "Choose fewer files" },
      { code: "EXTRACTED_TEXT_TOO_MANY_WORDS", chooseLabel: "Choose fewer files" },
    ] as const) {
      rerender(
        <WelcomeScreen
          {...defaultProps}
          uploadStatus="error"
          uploadError={{
            code,
            fileName: code === "PDF_TOO_MANY_PAGES" ? "long.pdf" : null,
            title: "Bounded parsing limit reached.",
            message: "Choose a bounded source or paste the relevant text.",
            preferredRecovery: "paste",
            fileIssues: [],
          }}
        />,
      );
      expect(
        within(screen.getByTestId("upload-error")).getAllByRole("button").map(
          (button) => button.textContent,
        ),
      ).toEqual(["Paste text instead", chooseLabel]);
    }
  });

  it("makes sample, assignment upload, and backup restore mutually exclusive", () => {
    render(
      <WelcomeScreen {...defaultProps} isImportingBackup />,
    );

    expect(screen.getByTestId("try-sample")).toBeDisabled();
    expect(
      screen.getByLabelText("Upload assignment brief and rubric files"),
    ).toBeDisabled();
    expect(screen.getByTestId("backup-file-input")).toBeDisabled();
    expect(screen.getByTestId("upload-zone")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("keeps paste intake discoverable and submits a valid draft only once", () => {
    const onPastedText = vi.fn();
    render(
      <WelcomeScreen
        {...defaultProps}
        intakeMode="paste"
        pastedBrief="Assignment title: Service report"
        pastedRubric={"Rubric\nAnalysis | 100%"}
        onPastedText={onPastedText}
      />,
    );

    expect(screen.getByRole("button", { name: "Upload files" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paste text" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const submit = screen.getByRole("button", {
      name: "Review assignment details",
    });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(onPastedText).toHaveBeenCalledOnce();
    expect(onPastedText).toHaveBeenCalledWith(
      "Assignment title: Service report",
      "Rubric\nAnalysis | 100%",
    );
  });

  it("marks pasted-text errors against the relevant input", () => {
    render(
      <WelcomeScreen
        {...defaultProps}
        intakeMode="paste"
        pastedTextError={{
          target: "brief",
          message: "Paste the assignment brief or instructions before continuing.",
        }}
      />,
    );

    expect(screen.getByTestId("pasted-assignment-brief")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByTestId("pasted-assignment-brief")).toBeRequired();
    expect(
      screen.getByTestId("pasted-assignment-rubric").getAttribute("aria-describedby"),
    ).not.toContain("pasted-text-error");
    expect(screen.getByTestId("pasted-text-error")).toHaveTextContent(
      "Nothing was saved or changed.",
    );
  });

  it("focuses a partial result and keeps the decision order explicit", async () => {
    const onReviewPartialUpload = vi.fn();
    render(
      <WelcomeScreen
        {...defaultProps}
        onReviewPartialUpload={onReviewPartialUpload}
        partialUploadResult={{
          intakeMethod: "files",
          fileNames: ["brief.txt"],
          skippedFiles: [
            {
              inputIndex: 1,
              fileName: "rubric-scan.pdf",
              code: "SCANNED_NO_TEXT",
              message: "No selectable text was found.",
            },
          ],
          totalWords: 40,
          summary: buildUploadedAssignmentSummary(
            "Assignment title: Service Report",
          ),
        }}
      />,
    );

    const partial = screen.getByRole("region", {
      name: "We read 1 of 2 files.",
    });
    await waitFor(() => expect(partial).toHaveFocus());
    expect(partial).toHaveTextContent("Ready to review (1)");
    expect(partial).toHaveTextContent("rubric-scan.pdf");
    expect(partial).toHaveTextContent("No selectable text was found");
    expect(
      within(partial).getAllByRole("button").map((button) => button.textContent),
    ).toEqual([
      "Review 1 ready file",
      "Choose all files again",
      "Paste all text instead",
    ]);

    fireEvent.click(
      within(partial).getByRole("button", { name: "Review 1 ready file" }),
    );
    expect(onReviewPartialUpload).toHaveBeenCalledOnce();
  });

  it("lists every file when no selected source can be read", () => {
    render(
      <WelcomeScreen
        {...defaultProps}
        uploadStatus="error"
        uploadError={{
          code: "NO_READABLE_FILES",
          fileName: null,
          title: "None of these files could be read.",
          message: "Review each file below.",
          preferredRecovery: "files",
          fileIssues: [
            {
              inputIndex: 0,
              fileName: "old-brief.doc",
              code: "UNSUPPORTED_FILE_TYPE",
              message: "Unsupported file.",
            },
            {
              inputIndex: 1,
              fileName: "empty.txt",
              code: "EMPTY_FILE",
              message: "Empty file.",
            },
          ],
        }}
      />,
    );

    const error = screen.getByTestId("upload-error");
    expect(error).toHaveTextContent("File 1: old-brief.doc");
    expect(error).toHaveTextContent("File 2: empty.txt");
    expect(
      within(error).getByRole("button", { name: "Choose all files again" }),
    ).toBeInTheDocument();
  });
});
