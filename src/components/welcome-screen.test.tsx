import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WelcomeScreen } from "@/components/welcome-screen";

const defaultProps = {
  onTrySample: vi.fn(),
  onFiles: vi.fn(),
  isLoadingSample: false,
  uploadStatus: "idle" as const,
  uploadError: null,
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
        uploadError="Try again"
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
  });
});
