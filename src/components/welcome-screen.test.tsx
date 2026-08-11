import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WelcomeScreen } from "@/components/welcome-screen";

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

  it("puts the preferred file-error recovery first and uses precise labels", () => {
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
        }}
      />,
    );
    expect(
      within(screen.getByTestId("upload-error")).getAllByRole("button").map(
        (button) => button.textContent,
      ),
    ).toEqual(["Paste text instead", "Choose another file"]);

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
        }}
      />,
    );
    expect(
      within(screen.getByTestId("upload-error")).getAllByRole("button")[0],
    ).toHaveTextContent("Choose a smaller file");
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
});
