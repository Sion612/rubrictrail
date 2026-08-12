import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraftCheckView } from "@/components/views/draft-check-view";
import { ProgressView } from "@/components/views/progress-view";
import { DEFAULT_PLAN_INPUT, generateActionPlan } from "@/lib/plan";
import { SAMPLE_ASSIGNMENT } from "@/lib/sample-data";

afterEach(cleanup);

function EmptyDraftHarness() {
  const [draftText, setDraftText] = useState("");

  return (
    <DraftCheckView
      analysis={SAMPLE_ASSIGNMENT}
      draftText={draftText}
      selectedSectionId="executive-summary"
      result={null}
      checkedDraftText={null}
      isChecking={false}
      checkingStage={0}
      onDraftChange={setDraftText}
      onSectionChange={vi.fn()}
      onCheck={vi.fn()}
      onOpenEvidence={vi.fn()}
      onNavigateProgress={vi.fn()}
    />
  );
}

describe("sample workflow accessibility", () => {
  it("keeps mobile coverage headers available to assistive technology", () => {
    render(
      <ProgressView
        analysis={SAMPLE_ASSIGNMENT}
        plan={generateActionPlan(DEFAULT_PLAN_INPUT)}
        draftResult={null}
        readinessChecks={[]}
        onToggleReadiness={vi.fn()}
        onContinue={vi.fn()}
      />,
    );

    const table = screen.getByRole("table", {
      name: "Plan work and deterministic demo signals by rubric criterion",
    });
    const headerRow = within(table).getAllByRole("row")[0];
    expect(headerRow).toHaveClass("mobile-visually-hidden");
    expect(
      within(headerRow).getAllByRole("columnheader").map((header) => header.textContent),
    ).toEqual(["Criterion", "Plan work", "Demo signals", "Signal state"]);
  });

  it("does not announce the untouched empty draft as an alert", () => {
    render(<EmptyDraftHarness />);

    const guidance = screen.getByText("Paste your own writing to begin. RubricTrail prompts your review; it will not write the assignment for you.");
    expect(guidance).not.toHaveAttribute("role");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("draft-text")).toHaveAttribute(
      "aria-describedby",
      expect.stringContaining("draft-empty-message"),
    );
  });

  it("announces the empty-state guidance after the user clears an edited draft", () => {
    render(<EmptyDraftHarness />);

    const draft = screen.getByTestId("draft-text");
    fireEvent.change(draft, { target: { value: "A draft sentence." } });
    fireEvent.change(draft, { target: { value: "" } });

    expect(screen.getByRole("alert")).toHaveTextContent("Paste your own writing to begin.");
  });
});
