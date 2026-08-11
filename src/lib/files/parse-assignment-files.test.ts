import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ASSIGNMENT_EVIDENCE_EXCERPT_MAX_CHARACTERS,
  ASSIGNMENT_EXTRACTED_TEXT_MAX_CHARACTERS,
  ASSIGNMENT_FILE_MAX_BYTES,
  ASSIGNMENT_FILE_MAX_COUNT,
  ASSIGNMENT_FILES_MAX_TOTAL_BYTES,
  AssignmentFileParseError,
  buildUploadedAssignmentSummary,
  parseAssignmentFiles,
} from "./parse-assignment-files";

const parserMocks = vi.hoisted(() => ({
  extractRawText: vi.fn(),
  getDocument: vi.fn(),
}));

vi.mock("mammoth", () => ({
  extractRawText: parserMocks.extractRawText,
}));

vi.mock("pdfjs-dist", () => ({
  getDocument: parserMocks.getDocument,
  GlobalWorkerOptions: { workerSrc: "test-worker" },
}));

function makeFile(
  content: BlobPart,
  name: string,
  type = "text/plain",
): File {
  const blob = new Blob([content], { type });
  return Object.assign(blob, { name, lastModified: 0 }) as File;
}

function expectErrorCode(code: AssignmentFileParseError["code"]) {
  return (error: unknown): boolean => {
    expect(error).toBeInstanceOf(AssignmentFileParseError);
    expect((error as AssignmentFileParseError).code).toBe(code);
    return true;
  };
}

describe("parseAssignmentFiles", () => {
  beforeEach(() => {
    parserMocks.extractRawText.mockReset();
    parserMocks.getDocument.mockReset();
  });

  it("merges multiple TXT files in order and preserves source offsets", async () => {
    const first = makeFile("Assignment title: Queue Improvement\r\nWord count: 2,000 words", "brief.txt");
    const second = makeFile("Rubric\nProblem diagnosis — 100%", "rubric.txt");

    const result = await parseAssignmentFiles([first, second]);

    expect(result.text).toBe(
      "Assignment title: Queue Improvement\nWord count: 2,000 words\n\nRubric\nProblem diagnosis — 100%",
    );
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]).toMatchObject({
      id: "source-1",
      fileName: "brief.txt",
      kind: "txt",
      startOffset: 0,
    });
    expect(result.sources[0].endOffset).toBe(result.sources[0].text.length);
    expect(result.sources[1].startOffset).toBe(result.sources[0].endOffset + 2);
    expect(result.totalBytes).toBe(first.size + second.size);
    expect(parserMocks.extractRawText).not.toHaveBeenCalled();
    expect(parserMocks.getDocument).not.toHaveBeenCalled();
  });

  it("rejects an unsupported file type with a stable code", async () => {
    const file = makeFile("legacy", "brief.doc", "application/msword");

    await expect(parseAssignmentFiles([file])).rejects.toSatisfy(
      expectErrorCode("UNSUPPORTED_FILE_TYPE"),
    );
  });

  it("enforces the 10 MB limit per file before parsing", async () => {
    const file = makeFile("x", "large.txt");
    Object.defineProperty(file, "size", {
      configurable: true,
      value: ASSIGNMENT_FILE_MAX_BYTES + 1,
    });

    await expect(parseAssignmentFiles([file])).rejects.toSatisfy(
      expectErrorCode("FILE_TOO_LARGE"),
    );
  });

  it("rejects more than the maximum file count before parsing", async () => {
    const files = Array.from(
      { length: ASSIGNMENT_FILE_MAX_COUNT + 1 },
      (_, index) => makeFile(`Brief ${index + 1}`, `brief-${index + 1}.txt`),
    );

    await expect(parseAssignmentFiles(files)).rejects.toSatisfy(
      expectErrorCode("TOO_MANY_FILES"),
    );
    expect(parserMocks.extractRawText).not.toHaveBeenCalled();
    expect(parserMocks.getDocument).not.toHaveBeenCalled();
  });

  it("rejects a selection over the combined size limit before parsing", async () => {
    const files = [
      makeFile("first", "first.txt"),
      makeFile("second", "second.txt"),
      makeFile("third", "third.txt"),
    ];
    const sizes = [
      ASSIGNMENT_FILE_MAX_BYTES,
      ASSIGNMENT_FILE_MAX_BYTES,
      ASSIGNMENT_FILES_MAX_TOTAL_BYTES - ASSIGNMENT_FILE_MAX_BYTES * 2 + 1,
    ];
    files.forEach((file, index) => {
      Object.defineProperty(file, "size", {
        configurable: true,
        value: sizes[index],
      });
    });

    await expect(parseAssignmentFiles(files)).rejects.toSatisfy(
      expectErrorCode("TOTAL_FILE_SIZE_TOO_LARGE"),
    );
    expect(parserMocks.extractRawText).not.toHaveBeenCalled();
    expect(parserMocks.getDocument).not.toHaveBeenCalled();
  });

  it("caps cumulative extracted text across files", async () => {
    const firstLength = Math.floor(
      ASSIGNMENT_EXTRACTED_TEXT_MAX_CHARACTERS / 2,
    );
    parserMocks.extractRawText
      .mockResolvedValueOnce({ value: "a".repeat(firstLength) })
      .mockResolvedValueOnce({
        value: "b".repeat(
          ASSIGNMENT_EXTRACTED_TEXT_MAX_CHARACTERS - firstLength,
        ),
      });
    const files = [
      makeFile(
        "mock-docx-1",
        "first.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
      makeFile(
        "mock-docx-2",
        "second.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ];

    await expect(parseAssignmentFiles(files)).rejects.toSatisfy(
      expectErrorCode("EXTRACTED_TEXT_TOO_LARGE"),
    );
    expect(parserMocks.extractRawText).toHaveBeenCalledTimes(2);
  });

  it("rejects an empty or whitespace-only text file", async () => {
    const file = makeFile("  \n\t ", "empty.txt");

    await expect(parseAssignmentFiles([file])).rejects.toSatisfy(
      expectErrorCode("EMPTY_FILE"),
    );
  });

  it("loads mammoth only for DOCX and extracts raw text", async () => {
    parserMocks.extractRawText.mockResolvedValue({
      value: "Operations Management\n\nDue date: 22 July 2026",
    });
    const file = makeFile(
      "mock-docx",
      "brief.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    const result = await parseAssignmentFiles([file]);

    expect(parserMocks.extractRawText).toHaveBeenCalledOnce();
    expect(result.sources[0]).toMatchObject({ kind: "docx", pageCount: null });
    expect(result.text).toContain("Due date: 22 July 2026");
  });

  it("maps a broken DOCX to CORRUPT_DOCUMENT", async () => {
    parserMocks.extractRawText.mockRejectedValue(new Error("invalid zip"));
    const file = makeFile(
      "broken",
      "brief.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    await expect(parseAssignmentFiles([file])).rejects.toSatisfy(
      expectErrorCode("CORRUPT_DOCUMENT"),
    );
  });

  it("extracts PDF pages and records their merged offsets", async () => {
    const destroy = vi.fn();
    parserMocks.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: vi
          .fn()
          .mockResolvedValueOnce({
            getTextContent: vi.fn().mockResolvedValue({
              items: [
                { str: "Assignment brief", hasEOL: true },
                { str: "Analyse the queue", hasEOL: false },
              ],
            }),
          })
          .mockResolvedValueOnce({
            getTextContent: vi.fn().mockResolvedValue({
              items: [{ str: "Rubric 100%", hasEOL: false }],
            }),
          }),
        destroy,
      }),
    });
    const file = makeFile("mock-pdf", "brief.pdf", "application/pdf");

    const result = await parseAssignmentFiles([file]);

    expect(result.sources[0].pageCount).toBe(2);
    expect(result.sources[0].pages).toHaveLength(2);
    expect(result.sources[0].pages[0].startOffset).toBe(0);
    expect(result.sources[0].pages[1].startOffset).toBeGreaterThan(
      result.sources[0].pages[0].endOffset,
    );
    expect(result.text).toContain("Analyse the queue");
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("identifies a PDF with no extractable text as scanned", async () => {
    parserMocks.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue({
          getTextContent: vi.fn().mockResolvedValue({ items: [] }),
        }),
        destroy: vi.fn(),
      }),
    });
    const file = makeFile("mock-pdf", "scan.pdf", "application/pdf");

    await expect(parseAssignmentFiles([file])).rejects.toSatisfy(
      expectErrorCode("SCANNED_NO_TEXT"),
    );
  });

  it("maps password-protected and corrupt PDFs to distinct codes", async () => {
    const encrypted = Object.assign(new Error("No password given"), {
      name: "PasswordException",
    });
    parserMocks.getDocument.mockReturnValueOnce({
      promise: Promise.reject(encrypted),
    });
    const encryptedFile = makeFile("pdf", "locked.pdf", "application/pdf");

    await expect(parseAssignmentFiles([encryptedFile])).rejects.toSatisfy(
      expectErrorCode("ENCRYPTED_PDF"),
    );

    parserMocks.getDocument.mockReturnValueOnce({
      promise: Promise.reject(new Error("Invalid PDF structure")),
    });
    const corruptFile = makeFile("pdf", "broken.pdf", "application/pdf");

    await expect(parseAssignmentFiles([corruptFile])).rejects.toSatisfy(
      expectErrorCode("CORRUPT_DOCUMENT"),
    );
  });
});

describe("buildUploadedAssignmentSummary", () => {
  it("keeps a matched value inside a capped excerpt from a long source line", async () => {
    const rawDate = "22 July 2026";
    const longLine = `${"context-before ".repeat(80)}Deadline: ${rawDate} ${"context-after ".repeat(80)}`;
    const parsed = await parseAssignmentFiles([
      makeFile(longLine, "long-line.txt"),
    ]);

    const summary = buildUploadedAssignmentSummary(parsed);
    const evidence = summary.dueDate.evidence;

    expect(summary.dueDate.raw).toBe(rawDate);
    expect(evidence).not.toBeNull();
    expect(evidence?.excerpt.length).toBeLessThanOrEqual(
      ASSIGNMENT_EVIDENCE_EXCERPT_MAX_CHARACTERS,
    );
    expect(evidence?.excerpt).toContain(rawDate);
    expect(
      parsed.text.slice(evidence?.startOffset, evidence?.endOffset),
    ).toBe(evidence?.excerpt);
  });

  it("extracts only explicit assignment fields and complete rubric weights", () => {
    const summary = buildUploadedAssignmentSummary(`
Assignment title: Service Operations Improvement Report
Due date: 22 July 2026
Word count: 2,000 words
Use Harvard referencing throughout.

Rubric
- Problem diagnosis — 25%
- Application of operations theory — 25%
- Evidence and analysis — 20%
- Quality of recommendations — 20%
- Structure and academic communication — 10%
    `);

    expect(summary).toMatchObject({
      status: "complete",
      title: { value: "Service Operations Improvement Report", status: "found" },
      dueDate: { value: "22 July 2026", status: "found" },
      wordCount: { value: 2000, status: "found" },
      citationStyle: { value: "Harvard", status: "found" },
      rubric: { status: "complete", totalWeight: 100 },
    });
    expect(summary.rubric.criteria.map(({ name, weight }) => ({ name, weight }))).toEqual([
      { name: "Problem diagnosis", weight: 25 },
      { name: "Application of operations theory", weight: 25 },
      { name: "Evidence and analysis", weight: 20 },
      { name: "Quality of recommendations", weight: 20 },
      { name: "Structure and academic communication", weight: 10 },
    ]);
  });

  it("marks an unrecognised rubric incomplete without inventing criteria or weights", () => {
    const summary = buildUploadedAssignmentSummary(`
Operations Management Report
Due date: 22 July 2026
Word count: 2,000 words
Use APA 7th edition referencing.
Your work will be assessed against the course rubric.
    `);

    expect(summary.status).toBe("incomplete");
    expect(summary.title.status).toBe("inferred");
    expect(summary.rubric).toMatchObject({
      status: "incomplete",
      criteria: [],
      totalWeight: null,
    });
    expect(summary.rubric.message).toContain("no weights were assumed");
  });

  it("retains explicit criteria but leaves missing weights null", () => {
    const summary = buildUploadedAssignmentSummary(`
Assignment title: Retail Operations Analysis
Rubric
- Problem diagnosis
- Recommendations — 40%
    `);

    expect(summary.rubric.status).toBe("incomplete");
    expect(summary.rubric.totalWeight).toBeNull();
    expect(summary.rubric.criteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Problem diagnosis", weight: null }),
        expect.objectContaining({ name: "Recommendations", weight: 40 }),
      ]),
    );
  });
});
