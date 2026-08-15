import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LocaleProvider } from "@/components/locale-provider";
import { UploadedEvidencePanel } from "@/components/uploaded-evidence-panel";
import type { UploadedProject } from "@/lib/ui-types";

afterEach(cleanup);

const uploadedProject: UploadedProject = {
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

describe("UploadedEvidencePanel", () => {
  it("labels saved provenance as recorded data that still needs the original", () => {
    render(
      <UploadedEvidencePanel
        project={uploadedProject}
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

  it("localizes retention warnings without translating recorded project data", () => {
    render(
      <LocaleProvider>
        <LanguageSwitcher />
        <UploadedEvidencePanel
          project={uploadedProject}
          criterionId="analysis-1"
          onClose={vi.fn()}
        />
      </LocaleProvider>,
    );

    const excerpt = screen.getByText("Analysis | 100%");
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zh-CN" },
    });

    expect(screen.getByText("记录的来源：brief.txt")).toBeInTheDocument();
    expect(screen.getByText("记录的页码：4")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "保留的摘录——请对照原文件复核",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Analysis" })).toBeInTheDocument();
    expect(screen.getByText("Analysis | 100%")).toBe(excerpt);
    expect(document.body).toHaveTextContent("完整来源文本丢弃后");
  });
});
