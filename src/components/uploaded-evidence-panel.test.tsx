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
  sources: [{
    id: "source-1",
    fileName: "brief.txt",
    kind: "pdf",
    origin: "extracted",
    intakeMethod: "files",
    pageCount: 5,
  }],
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
        origin: "extracted",
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
      sources: [{
        id: "source-1",
        fileName: "rubric.png",
        kind: "png",
        origin: "ocr",
        intakeMethod: "files",
        pageCount: null,
      }],
      criteria: [
        {
          ...uploadedProject.criteria[0],
          evidence: {
            ...uploadedProject.criteria[0].evidence!,
            fileName: "rubric.png",
            page: null,
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
      sources: [{
        id: "source-1",
        fileName: "fictional-rubric.pdf",
        kind: "pdf",
        origin: "extracted",
        intakeMethod: "files",
        pageCount: 2,
      }],
      criteria: [{
        ...uploadedProject.criteria[0],
        evidence: null,
        manualSourceLocator: {
          sourceId: "source-1",
          page: 2,
        },
      }],
    };
    render(
      <UploadedEvidencePanel project={project} criterionId="analysis-1" onClose={vi.fn()} />,
    );

    expect(screen.getByText("Manually added criterion")).toBeInTheDocument();
    expect(screen.getByText("Manually linked source: fictional-rubric.pdf")).toBeInTheDocument();
    expect(screen.getByText("Manually recorded page: 2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No retained excerpt" })).toBeInTheDocument();
    expect(screen.getByText(/stores only the source label and optional page locator/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Manually added criterion/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Manually added criterion/ })).not.toBeInTheDocument();
  });

  it("localizes manual provenance while keeping the recorded source name unchanged", () => {
    const project: UploadedProject = {
      ...uploadedProject,
      fileNames: ["fictional-rubric.pdf"],
      sources: [{
        id: "source-1",
        fileName: "fictional-rubric.pdf",
        kind: "pdf",
        origin: "extracted",
        intakeMethod: "files",
        pageCount: 2,
      }],
      criteria: [{
        ...uploadedProject.criteria[0],
        evidence: null,
        manualSourceLocator: {
          sourceId: "source-1",
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
    expect(screen.getByText("手动关联来源：fictional-rubric.pdf")).toBeInTheDocument();
    expect(screen.getByText("未填写页码")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "未保留来源摘录" })).toBeInTheDocument();
    expect(screen.getByText(/仅用于定位/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "手动添加的评分项" })).not.toBeInTheDocument();
  });

  it.each([
    ["txt", "Plain-text sources do not have page numbers"],
    ["docx", "Reliable DOCX page numbers are unavailable"],
    ["png", "Image sources do not have PDF page numbers"],
  ] as const)(
    "describes retained %s evidence without inventing a page",
    (kind, expectedPageDescription) => {
      const fileName = `fictional-rubric.${kind}`;
      const project: UploadedProject = {
        ...uploadedProject,
        fileNames: [fileName],
        sources: [{
          id: "source-1",
          fileName,
          kind,
          origin: kind === "png" ? "ocr" : "extracted",
          intakeMethod: "files",
          pageCount: null,
        }],
        criteria: [{
          ...uploadedProject.criteria[0],
          evidence: {
            ...uploadedProject.criteria[0].evidence!,
            fileName,
            page: null,
            origin: kind === "png" ? "ocr" : "extracted",
          },
        }],
      };

      render(
        <UploadedEvidencePanel project={project} criterionId="analysis-1" onClose={vi.fn()} />,
      );

      expect(screen.getByText(expectedPageDescription)).toBeInTheDocument();
      expect(screen.queryByText(/Recorded page:/)).not.toBeInTheDocument();
      expect(screen.getByText("Analysis | 100%")).toBeInTheDocument();
    },
  );

  it("uses intake identity, not a synthetic filename, for pasted retained evidence", () => {
    const project: UploadedProject = {
      ...uploadedProject,
      fileNames: ["Pasted assignment brief.txt"],
      sources: [{
        id: "source-1",
        fileName: "Pasted assignment brief.txt",
        kind: "txt",
        origin: "extracted",
        intakeMethod: "paste",
        pageCount: null,
      }],
      criteria: [{
        ...uploadedProject.criteria[0],
        evidence: {
          ...uploadedProject.criteria[0].evidence!,
          fileName: "Pasted assignment brief.txt",
          page: null,
          origin: "extracted",
        },
      }],
    };

    render(
      <UploadedEvidencePanel project={project} criterionId="analysis-1" onClose={vi.fn()} />,
    );

    expect(screen.getByText("Pasted text has no page number")).toBeInTheDocument();
    expect(screen.queryByText("Plain-text sources do not have page numbers")).not.toBeInTheDocument();
  });

  it.each([
    ["txt", "Plain-text sources do not have page numbers"],
    ["docx", "Reliable DOCX page numbers are unavailable"],
    ["jpeg", "Image sources do not have PDF page numbers"],
  ] as const)(
    "describes a manual %s locator without presenting retained evidence",
    (kind, expectedPageDescription) => {
      const fileName = `manual-source.${kind}`;
      const project: UploadedProject = {
        ...uploadedProject,
        fileNames: [fileName],
        sources: [{
          id: "source-1",
          fileName,
          kind,
          origin: kind === "jpeg" ? "ocr" : "extracted",
          intakeMethod: "files",
          pageCount: null,
        }],
        criteria: [{
          ...uploadedProject.criteria[0],
          evidence: null,
          manualSourceLocator: { sourceId: "source-1", page: null },
        }],
      };

      render(
        <UploadedEvidencePanel project={project} criterionId="analysis-1" onClose={vi.fn()} />,
      );

      expect(screen.getByText(`Manually linked source: ${fileName}`)).toBeInTheDocument();
      expect(screen.getByText(expectedPageDescription)).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "No retained excerpt" })).toBeInTheDocument();
      expect(screen.queryByText("Analysis | 100%")).not.toBeInTheDocument();
    },
  );

  it("describes a manual pasted locator from intake metadata without inventing pagination", () => {
    const project: UploadedProject = {
      ...uploadedProject,
      fileNames: ["Pasted rubric.txt"],
      sources: [{
        id: "source-1",
        fileName: "Pasted rubric.txt",
        kind: "txt",
        origin: "extracted",
        intakeMethod: "paste",
        pageCount: null,
      }],
      criteria: [{
        ...uploadedProject.criteria[0],
        evidence: null,
        manualSourceLocator: { sourceId: "source-1", page: null },
      }],
    };

    render(
      <UploadedEvidencePanel project={project} criterionId="analysis-1" onClose={vi.fn()} />,
    );

    expect(screen.getByText("Manually linked source: Pasted rubric.txt")).toBeInTheDocument();
    expect(screen.getByText("Pasted text has no page number")).toBeInTheDocument();
    expect(screen.queryByText("Plain-text sources do not have page numbers")).not.toBeInTheDocument();
    expect(screen.queryByText("Page not available")).not.toBeInTheDocument();
  });

  it("distinguishes a manual criterion with no locator from missing page data", () => {
    const project: UploadedProject = {
      ...uploadedProject,
      criteria: [{
        ...uploadedProject.criteria[0],
        evidence: null,
        manualSourceLocator: null,
      }],
    };

    render(
      <UploadedEvidencePanel project={project} criterionId="analysis-1" onClose={vi.fn()} />,
    );

    expect(screen.getByText("No source linked")).toBeInTheDocument();
    expect(screen.queryByText("Page not available")).not.toBeInTheDocument();
    expect(screen.queryByText("Page not entered")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No retained excerpt" })).toBeInTheDocument();
  });
});
