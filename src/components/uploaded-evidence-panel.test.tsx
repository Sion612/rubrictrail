import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  fileNames: ["rubric.pdf"],
  sources: [{
    id: "source-1",
    fileName: "rubric.pdf",
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
        fileName: "rubric.pdf",
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

    expect(screen.getByText("Recorded source: rubric.pdf")).toBeInTheDocument();
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

    expect(screen.getByText("记录的来源：rubric.pdf")).toBeInTheDocument();
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

  it("keeps retained evidence read-only even when a save callback exists", () => {
    render(
      <UploadedEvidencePanel
        project={uploadedProject}
        criterionId="analysis-1"
        onClose={vi.fn()}
        onSaveManualSourceLocator={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("add-locator")).not.toBeInTheDocument();
    expect(screen.queryByTestId("edit-locator")).not.toBeInTheDocument();
    expect(screen.getByText("Recorded source: rubric.pdf")).toBeInTheDocument();
  });

  it("adds, validates, and saves a PDF locator without auto-confirming evidence", async () => {
    const onSave = vi.fn().mockResolvedValue("saved");
    const project: UploadedProject = {
      ...uploadedProject,
      fileNames: ["rubric.pdf", "rubric.pdf", "notes.txt", "scan.webp"],
      sources: [
        { id: "source-1", fileName: "rubric.pdf", kind: "pdf", origin: "extracted", intakeMethod: "files", pageCount: 2 },
        { id: "source-3", fileName: "rubric.pdf", kind: "pdf", origin: "extracted", intakeMethod: "files", pageCount: 2 },
        { id: "source-4", fileName: "notes.txt", kind: "txt", origin: "extracted", intakeMethod: "files", pageCount: null },
        { id: "source-5", fileName: "scan.webp", kind: "webp", origin: "ocr", intakeMethod: "files", pageCount: null },
      ],
      criteria: [{
        ...uploadedProject.criteria[0],
        evidence: null,
        manualSourceLocator: null,
      }],
    };
    render(
      <UploadedEvidencePanel
        project={project}
        criterionId="analysis-1"
        onClose={vi.fn()}
        onSaveManualSourceLocator={onSave}
      />,
    );
    fireEvent.click(screen.getByTestId("add-locator"));
    expect(screen.getByTestId("locator-source")).toHaveFocus();
    expect(screen.getByRole("option", { name: "rubric.pdf · PDF · Source 1" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "rubric.pdf · PDF · Source 3" })).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("locator-source"), { target: { value: "source-1" } });
    for (const invalid of ["0", "-1", "1.5", "3", "999"]) {
      fireEvent.change(screen.getByTestId("locator-page"), { target: { value: invalid } });
      fireEvent.click(screen.getByTestId("save-locator"));
      expect(onSave).not.toHaveBeenCalled();
      expect(screen.getByTestId("locator-page-error")).toHaveTextContent("1 to 2");
    }
    fireEvent.change(screen.getByTestId("locator-page"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("locator-source"), { target: { value: "source-3" } });
    expect(screen.getByTestId("locator-page")).toHaveValue(null);
    fireEvent.change(screen.getByTestId("locator-page"), { target: { value: "2" } });
    fireEvent.change(screen.getByTestId("locator-source"), { target: { value: "source-5" } });
    expect(screen.queryByTestId("locator-page")).not.toBeInTheDocument();
    expect(screen.getByTestId("locator-no-page")).toHaveTextContent("Image sources do not have PDF page numbers");
    fireEvent.change(screen.getByTestId("locator-source"), { target: { value: "source-1" } });
    fireEvent.change(screen.getByTestId("locator-page"), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("save-locator"));
    expect(onSave).toHaveBeenCalledWith("analysis-1", { sourceId: "source-1", page: 2 });
  });

  it("cancels without saving and shows legacy guidance without a guessed selector", () => {
    const onSave = vi.fn();
    const project: UploadedProject = {
      ...uploadedProject,
      criteria: [{
        ...uploadedProject.criteria[0],
        evidence: null,
        manualSourceLocator: { sourceId: "source-1", page: 2 },
      }],
    };
    const { rerender } = render(
      <UploadedEvidencePanel
        project={project}
        criterionId="analysis-1"
        onClose={vi.fn()}
        onSaveManualSourceLocator={onSave}
      />,
    );
    expect(screen.getByTestId("edit-locator")).toBeInTheDocument();
    expect(screen.getByTestId("remove-locator")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("edit-locator"));
    fireEvent.change(screen.getByTestId("locator-source"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Manually recorded page: 2")).toBeInTheDocument();

    const legacy: UploadedProject = { ...project, sources: undefined };
    rerender(
      <UploadedEvidencePanel
        project={legacy}
        criterionId="analysis-1"
        onClose={vi.fn()}
        onSaveManualSourceLocator={onSave}
      />,
    );
    expect(screen.getByTestId("legacy-registry-guidance")).toBeInTheDocument();
    expect(screen.queryByTestId("locator-source")).not.toBeInTheDocument();
  });

  it("reports a missing source on the source field and keeps a failed save editable", async () => {
    const onSave = vi.fn().mockResolvedValue("failed");
    const project: UploadedProject = {
      ...uploadedProject,
      criteria: [{
        ...uploadedProject.criteria[0],
        evidence: null,
        manualSourceLocator: null,
      }],
    };
    render(
      <UploadedEvidencePanel
        project={project}
        criterionId="analysis-1"
        onClose={vi.fn()}
        onSaveManualSourceLocator={onSave}
      />,
    );
    fireEvent.click(screen.getByTestId("add-locator"));
    fireEvent.click(screen.getByTestId("save-locator"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId("locator-source-error")).toHaveTextContent("Choose an included source.");
    expect(screen.getByTestId("locator-source")).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByTestId("locator-page-error")).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("locator-source"), { target: { value: "source-1" } });
    fireEvent.change(screen.getByTestId("locator-page"), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("save-locator"));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("analysis-1", { sourceId: "source-1", page: 2 }));
    expect(screen.getByTestId("locator-source")).toBeInTheDocument();
    expect(screen.getByTestId("locator-save-error")).toHaveTextContent("could not be saved");
    expect(screen.getByTestId("locator-page")).toHaveValue(2);
  });

  it("removes a locator by saving a null location", async () => {
    const onSave = vi.fn().mockResolvedValue("saved");
    const project: UploadedProject = {
      ...uploadedProject,
      criteria: [{
        ...uploadedProject.criteria[0],
        evidence: null,
        manualSourceLocator: { sourceId: "source-1", page: 2 },
      }],
    };
    render(
      <UploadedEvidencePanel
        project={project}
        criterionId="analysis-1"
        onClose={vi.fn()}
        onSaveManualSourceLocator={onSave}
      />,
    );
    const confirm = window.confirm;
    window.confirm = vi.fn(() => true);
    fireEvent.click(screen.getByTestId("remove-locator"));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("analysis-1", null));
    expect(window.confirm).toHaveBeenCalled();
    window.confirm = confirm;
  });
});
