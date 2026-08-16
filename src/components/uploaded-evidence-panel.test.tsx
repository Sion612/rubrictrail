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
  it("distinguishes OCR-derived evidence from extracted document evidence", () => {
    const ocrProject: UploadedProject = {
      ...uploadedProject,
      fileNames: ["rubric.png"],
      criteria: [
        {
          ...uploadedProject.criteria[0],
          evidence: {
            ...uploadedProject.criteria[0].evidence!,
            fileName: "rubric.png",
            origin: "ocr",
          },
        },
      ],
    };

    render(
      <UploadedEvidencePanel
        project={ocrProject}
        criterionId="analysis-1"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("OCR image source: rubric.png")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "OCR-derived excerpt — verify against the original image",
      }),
    ).toBeInTheDocument();
  });

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

  it("renders a manual source locator as noninteractive provenance, not retained evidence", () => {
    const project: UploadedProject = {
      ...uploadedProject,
      fileNames: ["fictional-rubric.pdf"],
      criteria: [{
        ...uploadedProject.criteria[0],
        evidence: null,
        manualSourceLocator: {
          sourceId: "source-1",
          fileName: "fictional-rubric.pdf",
          page: 2,
        },
      }],
    };
    render(
      <UploadedEvidencePanel project={project} criterionId="analysis-1" onClose={vi.fn()} />,
    );

    expect(screen.getByText("Manually added criterion")).toBeInTheDocument();
    expect(screen.getByText("Recorded source: fictional-rubric.pdf")).toBeInTheDocument();
    expect(screen.getByText("Recorded page: 2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No retained excerpt" })).toBeInTheDocument();
    expect(screen.getByText(/stores only the source label and optional page locator/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Manually added criterion/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Manually added criterion/ })).not.toBeInTheDocument();
  });

  it("localizes manual provenance while keeping the recorded source name unchanged", () => {
    const project: UploadedProject = {
      ...uploadedProject,
      fileNames: ["fictional-rubric.pdf"],
      criteria: [{
        ...uploadedProject.criteria[0],
        evidence: null,
        manualSourceLocator: {
          sourceId: "source-1",
          fileName: "fictional-rubric.pdf",
          page: null,
        },
      }],
    };
    render(
      <LocaleProvider>
        <LanguageSwitcher />
        <UploadedEvidencePanel project={project} criterionId="analysis-1" onClose={vi.fn()} />
      </LocaleProvider>,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zh-CN" } });

    expect(screen.getByText("手动添加的评分项")).toBeInTheDocument();
    expect(screen.getByText("记录的来源：fictional-rubric.pdf")).toBeInTheDocument();
    expect(screen.getByText("未记录页码")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "未保留来源摘录" })).toBeInTheDocument();
    expect(screen.getByText(/仅用于定位/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "手动添加的评分项" })).not.toBeInTheDocument();
  });
});
