import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/components/locale-provider";
import { WelcomeScreen } from "@/components/welcome-screen";
import { COMMUNITY_URLS } from "@/components/community-links";
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
  imageOcrProgress: null,
  uploadError: null,
  partialUploadResult: null,
  onReviewPartialUpload: vi.fn(),
  onImportBackup: vi.fn(),
  isImportingBackup: false,
  backupError: null,
};

afterEach(cleanup);

describe("WelcomeScreen upload controls", () => {
  it("keeps fixed community links visible without putting pasted work in their URLs", () => {
    const privateDraft = "PRIVATE-COURSEWORK-MARKER";
    render(
      <WelcomeScreen
        {...defaultProps}
        pastedBrief={privateDraft}
        pastedRubric={`${privateDraft}-RUBRIC`}
      />,
    );

    const community = screen.getByRole("navigation", {
      name: "RubricTrail community",
    });
    expect(
      within(community).getByRole("link", { name: /View source/ }),
    ).toHaveAttribute("href", COMMUNITY_URLS.source);
    expect(
      within(community).getByRole("link", { name: /Report a problem/ }),
    ).toHaveAttribute("href", COMMUNITY_URLS.report);
    expect(
      within(community).getByRole("link", { name: /Contribute/ }),
    ).toHaveAttribute("href", COMMUNITY_URLS.contribute);
    for (const link of within(community).getAllByRole("link")) {
      expect(link.getAttribute("href")).not.toContain(privateDraft);
    }
  });

  it("states the local-processing, document-trust, and backup-authenticity boundaries", () => {
    render(<WelcomeScreen {...defaultProps} />);

    const main = screen.getByRole("main");
    expect(main).toHaveTextContent(
      "RubricTrail parses assignment content locally in this browser; the app does not upload it or send it to an AI service.",
    );
    expect(main).toHaveTextContent(
      "Use only files you trust; these limits are not a malicious-file sandbox.",
    );
    expect(main).toHaveTextContent(
      "Backups are unencrypted and unsigned; open only one you created or trust.",
    );
    expect(main).toHaveTextContent("Local processing.");
    expect(main).not.toHaveTextContent("Everything is processed only in this browser.");
    expect(main).not.toHaveTextContent("Private by default.");
  });

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

  it("accepts supported images and announces bounded local OCR progress", () => {
    render(
      <WelcomeScreen
        {...defaultProps}
        uploadStatus="parsing"
        imageOcrProgress={{
          fileName: "fictional-rubric.png",
          currentFile: 2,
          totalFiles: 3,
          phase: "recognizing",
          progress: 0.42,
        }}
      />,
    );

    expect(screen.getByTestId("file-input")).toHaveAttribute(
      "accept",
      expect.stringContaining("image/webp"),
    );
    expect(screen.getByTestId("ocr-progress")).toHaveTextContent(
      "Recognizing image 2 of 3: fictional-rubric.png (42%)",
    );
    expect(screen.getByTestId("ocr-progress")).toHaveAttribute("role", "status");
  });

  it("announces local OCR progress and accuracy limits in Simplified Chinese", () => {
    render(
      <LocaleProvider>
        <WelcomeScreen
          {...defaultProps}
          uploadStatus="parsing"
          imageOcrProgress={{
            fileName: "虚构评分标准.png",
            currentFile: 2,
            totalFiles: 4,
            phase: "recognizing",
            progress: 0.5,
          }}
        />
      </LocaleProvider>,
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zh-CN" },
    });

    expect(screen.getByTestId("ocr-progress")).toHaveTextContent(
      "正在识别第 2/4 张图片：虚构评分标准.png（50%）",
    );
    expect(screen.getByText(/OCR 可能出错，请对照原图核实识别出的要求/u)).toBeInTheDocument();
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
          sources: [{
            id: "source-1",
            fileName: "brief.txt",
            kind: "txt",
            origin: "extracted",
            intakeMethod: "files",
            pageCount: null,
          }],
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

  it("switches the visible intake and recovery copy to Simplified Chinese without changing file names", () => {
    render(
      <LocaleProvider>
        <WelcomeScreen
          {...defaultProps}
          uploadStatus="error"
          uploadError={{
            code: "SCANNED_NO_TEXT",
            fileName: "rubric-scan.pdf",
            title: "This file has no selectable text.",
            message: "Paste the assignment instructions.",
            preferredRecovery: "paste",
            fileIssues: [],
          }}
        />
      </LocaleProvider>,
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zh-CN" },
    });

    expect(
      screen.getByRole("heading", { name: "把作业要求变成一份有据可查的计划。" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("upload-error")).toHaveTextContent(
      "未找到可选择文字；这可能是扫描件。",
    );
    expect(screen.getByTestId("upload-error")).toHaveTextContent("rubric-scan.pdf");
    expect(
      within(screen.getByTestId("upload-error")).getAllByRole("button").map(
        (button) => button.textContent,
      ),
    ).toEqual(["改为粘贴文字", "选择其他文件"]);
  });
});
