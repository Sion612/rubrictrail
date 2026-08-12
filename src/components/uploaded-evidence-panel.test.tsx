import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UploadedEvidencePanel } from "@/components/uploaded-evidence-panel";
import type { UploadedProject } from "@/lib/ui-types";

afterEach(cleanup);

describe("UploadedEvidencePanel", () => {
  it("labels saved provenance as recorded data that still needs the original", () => {
    const project: UploadedProject = {
      id: "uploaded-1",
      title: "Strategy Report",
      course: "BUS302",
      dueDate: "2026-09-24",
      wordCount: 2_500,
      citationStyle: "APA 7",
      fileNames: ["brief.txt"],
      extractedWordCount: 120,
      weightingStatus: "complete",
      criteria: [
        {
          id: "analysis-1",
          name: "Analysis",
          weight: 100,
          evidence: {
            sourceId: "source-1",
            fileName: "brief.txt",
            page: 4,
            excerpt: "Analysis | 100%",
            startOffset: 40,
            endOffset: 55,
          },
        },
      ],
      createdAt: "2026-08-12T00:00:00.000Z",
    };

    render(
      <UploadedEvidencePanel
        project={project}
        criterionId="analysis-1"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Recorded source: brief.txt")).toBeInTheDocument();
    expect(screen.getByText("Recorded page: 4")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Retained excerpt — re-check the original",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/cannot re-verify them/i)).toBeInTheDocument();
    expect(screen.queryByText("Exact retained excerpt")).not.toBeInTheDocument();
  });
});
