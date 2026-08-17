import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/components/locale-provider";
import {
  UploadedBriefView,
  UploadedDraftReviewView,
  UploadedProgressView,
  UploadedRubricView,
} from "@/components/views/uploaded-project-views";
import { generateActionPlan } from "@/lib/plan";
import { buildUploadedPlanTemplates } from "@/lib/uploaded-project";
import type { UploadedProject } from "@/lib/ui-types";

afterEach(cleanup);

const project: UploadedProject = {
  id: "traceability-project",
  title: "Fictional traceability report",
  course: "BUS302",
  dueDate: "2026-09-24",
  wordCount: 2_500,
  citationStyle: "APA 7",
  fileNames: ["same-name.pdf", "rubric.png", "same-name.txt"],
  sources: [
    {
      id: "source-1",
      fileName: "same-name.pdf",
      kind: "pdf",
      origin: "extracted",
      intakeMethod: "files",
      pageCount: 3,
    },
    {
      id: "source-2",
      fileName: "rubric.png",
      kind: "png",
      origin: "ocr",
      intakeMethod: "files",
      pageCount: null,
    },
    {
      id: "source-3",
      fileName: "same-name.txt",
      kind: "txt",
      origin: "extracted",
      intakeMethod: "files",
      pageCount: null,
    },
  ],
  extractedWordCount: 42,
  weightingStatus: "complete",
  criteria: [
    {
      id: "retained-criterion",
      name: "Retained criterion",
      weight: 40,
      evidence: {
        sourceId: "source-1",
        fileName: "same-name.pdf",
        page: 1,
        excerpt: "Retained criterion | 40%",
        startOffset: 0,
        endOffset: 24,
        origin: "extracted",
      },
      manualSourceLocator: null,
    },
    {
      id: "manual-criterion",
      name: "Manual locator criterion",
      weight: 35,
      evidence: null,
      manualSourceLocator: { sourceId: "source-1", page: 3 },
    },
    {
      id: "unlinked-criterion",
      name: "Unlinked manual criterion",
      weight: 25,
      evidence: null,
      manualSourceLocator: null,
    },
  ],
  createdAt: "2026-08-12T00:00:00.000Z",
};

function renderWithLocale(ui: React.ReactNode) {
  return render(<LocaleProvider>{ui}</LocaleProvider>);
}

describe("uploaded project traceability", () => {
  it("renders the compact source registry with duplicate names disambiguated by type and order", () => {
    renderWithLocale(<UploadedBriefView project={project} onNavigate={vi.fn()} />);

    const register = screen.getByRole("region", { name: "Sources used for this project" });
    expect(within(register).getByText("same-name.pdf")).toBeInTheDocument();
    expect(within(register).getByText(/PDF · 3 pages · Source 1 · Full source text not stored/)).toBeInTheDocument();
    expect(within(register).getByText("rubric.png")).toBeInTheDocument();
    expect(within(register).getByText(/PNG · local OCR · Source 2 · Full source text not stored/)).toBeInTheDocument();
    expect(within(register).getByText("same-name.txt")).toBeInTheDocument();
    expect(within(register).getByText(/TXT · extracted text · Source 3 · Full source text not stored/)).toBeInTheDocument();
  });

  it("keeps retained evidence, manual locators, and unlinked criteria as three distinct rubric states", () => {
    const onOpenEvidence = vi.fn();
    renderWithLocale(
      <UploadedRubricView
        project={project}
        onOpenEvidence={onOpenEvidence}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByText("retained excerpts").previousSibling).toHaveTextContent("1");
    expect(screen.getByText("manual locators").previousSibling).toHaveTextContent("1");
    expect(screen.getByText("no source linked").previousSibling).toHaveTextContent("1");
    expect(screen.getByText("Source-linked")).toBeInTheDocument();
    expect(screen.getByText("Manual source locator")).toBeInTheDocument();
    expect(screen.getByText("No source linked")).toBeInTheDocument();
    expect(screen.getByText("View or edit source location")).toBeInTheDocument();
    expect(screen.getByText("Add source location")).toBeInTheDocument();
    expect(screen.getByText("same-name.pdf · p.3")).toBeInTheDocument();

    screen.getAllByRole("button", { name: /source location|retained source evidence/i }).forEach((button) => button.click());
    expect(onOpenEvidence.mock.calls.map(([criterionId]) => criterionId)).toEqual([
      "retained-criterion",
      "manual-criterion",
      "unlinked-criterion",
    ]);
  });

  it("does not treat a manual locator as a completed self-check", () => {
    renderWithLocale(
      <UploadedDraftReviewView
        project={project}
        reviews={[]}
        initialCriterionId="manual-criterion"
        onChange={vi.fn()}
        onSave={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Rubric criterion" })).toHaveValue("manual-criterion");
    expect(screen.getByRole("checkbox", { name: /The source is traceable/ })).not.toBeChecked();
    expect(screen.getByText("Self-check still incomplete")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save self-check" })).toBeDisabled();
  });

  it("reports manual locator and unlinked risks separately in progress", () => {
    const plan = generateActionPlan(
      {
        weeklyHours: 10,
        planningDepth: "standard",
        startDate: "2026-08-11",
        dueDate: project.dueDate,
        asOfDate: "2026-08-11",
        completedTaskIds: [],
      },
      buildUploadedPlanTemplates(project),
    );

    renderWithLocale(
      <UploadedProgressView
        project={project}
        plan={plan}
        reviews={[]}
        readinessChecks={[]}
        onToggleReadiness={vi.fn()}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByText("Manual source locations still need checking")).toBeInTheDocument();
    expect(screen.getByText("Manual criteria have no source location")).toBeInTheDocument();
    expect(screen.getByText(/A source location was recorded, but no excerpt was retained/)).toBeInTheDocument();
    expect(screen.getByText(/Link a source where possible/)).toBeInTheDocument();
    expect(screen.queryByText("No tracked evidence risks")).not.toBeInTheDocument();
  });
});
