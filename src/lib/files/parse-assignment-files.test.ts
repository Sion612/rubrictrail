import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ASSIGNMENT_EVIDENCE_EXCERPT_MAX_CHARACTERS,
  ASSIGNMENT_EXTRACTED_TEXT_MAX_CHARACTERS,
  ASSIGNMENT_EXTRACTED_TEXT_MAX_LINES,
  ASSIGNMENT_EXTRACTED_TEXT_MAX_WORDS,
  ASSIGNMENT_FILE_MAX_BYTES,
  ASSIGNMENT_FILE_MAX_COUNT,
  ASSIGNMENT_FILES_MAX_TOTAL_BYTES,
  ASSIGNMENT_PDF_MAX_PAGES,
  ASSIGNMENT_PDFS_MAX_TOTAL_PAGES,
  AssignmentFileBatchParseError,
  AssignmentFileParseError,
  buildUploadedAssignmentSummary,
  parseAssignmentFiles,
  parseAssignmentFilesWithRecovery,
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

function makeLineText(lineCount: number): string {
  return "x\n".repeat(lineCount);
}

function makeWordText(wordCount: number): string {
  return "x ".repeat(wordCount);
}

function retainedLineCount(text: string): number {
  if (!text) return 0;
  let lineCount = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) lineCount += 1;
  }
  return lineCount;
}

function makePdfDocument(
  pageCount: number,
  options: {
    destroyError?: Error;
    pageText?: (pageNumber: number) => string | null;
  } = {},
) {
  const destroy = options.destroyError
    ? vi.fn().mockRejectedValue(options.destroyError)
    : vi.fn();
  const getPage = vi.fn().mockImplementation(async (pageNumber: number) => {
    const text = options.pageText
      ? options.pageText(pageNumber)
      : `Page ${pageNumber}`;
    return {
      getTextContent: vi.fn().mockResolvedValue({
        items: text === null ? [] : [{ str: text, hasEOL: false }],
      }),
    };
  });
  return {
    document: { numPages: pageCount, getPage, destroy },
    destroy,
    getPage,
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

  it("decodes valid ASCII, multibyte and BOM-prefixed UTF-8 text", async () => {
    const ascii = makeFile("Assignment title: Plain text", "ascii.txt");
    const multibyte = makeFile("Rubric\n分析 — café ✅", "multibyte.txt");
    const withBom = makeFile(
      new Uint8Array([0xef, 0xbb, 0xbf, 0x44, 0x75, 0x65]),
      "bom.txt",
    );

    const result = await parseAssignmentFiles([ascii, multibyte, withBom]);

    expect(result.text).toBe(
      "Assignment title: Plain text\n\nRubric\n分析 — café ✅\n\nDue",
    );
    expect(result.text).not.toContain("�");
  });

  it.each([
    { name: "invalid continuation", bytes: [0x41, 0x80, 0x42] },
    { name: "invalid continuation sequence", bytes: [0x41, 0xc3, 0x28, 0x42] },
    { name: "truncated multibyte sequence", bytes: [0x41, 0xe2, 0x82] },
    { name: "overlong sequence", bytes: [0x41, 0xc0, 0xaf, 0x42] },
  ])("rejects $name with a stable encoding code", async ({ bytes }) => {
    const file = makeFile(new Uint8Array(bytes), "invalid-encoding.txt");

    await expect(parseAssignmentFiles([file])).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(AssignmentFileParseError);
        expect(error).toMatchObject({
          code: "INVALID_TEXT_ENCODING",
          fileName: "invalid-encoding.txt",
        });
        expect((error as Error).message).toContain("valid UTF-8");
        return true;
      },
    );
  });

  it("does not misreport a TXT read failure as invalid encoding", async () => {
    const file = makeFile("Readable", "unreadable.txt");
    vi.spyOn(file, "arrayBuffer").mockRejectedValue(new Error("read failed"));

    await expect(parseAssignmentFiles([file])).rejects.toSatisfy(
      expectErrorCode("CORRUPT_DOCUMENT"),
    );
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

  it("accepts the exact extracted-character limit and rejects one more", async () => {
    const accepted = await parseAssignmentFiles([
      makeFile(
        "x".repeat(ASSIGNMENT_EXTRACTED_TEXT_MAX_CHARACTERS),
        "exact-characters.txt",
      ),
    ]);

    expect(accepted.text).toHaveLength(
      ASSIGNMENT_EXTRACTED_TEXT_MAX_CHARACTERS,
    );
    expect(accepted.wordCount).toBe(1);

    await expect(
      parseAssignmentFiles([
        makeFile(
          "x".repeat(ASSIGNMENT_EXTRACTED_TEXT_MAX_CHARACTERS + 1),
          "too-many-characters.txt",
        ),
      ]),
    ).rejects.toSatisfy(expectErrorCode("EXTRACTED_TEXT_TOO_LARGE"));
  });

  it("bounds retained lines without changing word-count semantics", async () => {
    const accepted = await parseAssignmentFiles([
      makeFile(
        makeLineText(ASSIGNMENT_EXTRACTED_TEXT_MAX_LINES),
        "exact-lines.txt",
      ),
    ]);

    expect(accepted.sources[0].wordCount).toBe(
      ASSIGNMENT_EXTRACTED_TEXT_MAX_LINES,
    );
    expect(accepted.wordCount).toBe(ASSIGNMENT_EXTRACTED_TEXT_MAX_LINES);

    await expect(
      parseAssignmentFiles([
        makeFile(
          makeLineText(ASSIGNMENT_EXTRACTED_TEXT_MAX_LINES + 1),
          "too-many-lines.txt",
        ),
      ]),
    ).rejects.toSatisfy(expectErrorCode("EXTRACTED_TEXT_TOO_MANY_LINES"));
  });

  it("bounds words with Unicode whitespace and no split-sized token array", async () => {
    const unicode = await parseAssignmentFiles([
      makeFile("one\ttwo\nthree\u00a0four\u2028five", "unicode-words.txt"),
    ]);
    expect(unicode.sources[0].wordCount).toBe(5);
    expect(unicode.wordCount).toBe(5);

    const accepted = await parseAssignmentFiles([
      makeFile(
        makeWordText(ASSIGNMENT_EXTRACTED_TEXT_MAX_WORDS),
        "exact-words.txt",
      ),
    ]);
    expect(accepted.sources[0].wordCount).toBe(
      ASSIGNMENT_EXTRACTED_TEXT_MAX_WORDS,
    );
    expect(accepted.wordCount).toBe(ASSIGNMENT_EXTRACTED_TEXT_MAX_WORDS);

    await expect(
      parseAssignmentFiles([
        makeFile(
          makeWordText(ASSIGNMENT_EXTRACTED_TEXT_MAX_WORDS + 1),
          "too-many-words.txt",
        ),
      ]),
    ).rejects.toSatisfy(expectErrorCode("EXTRACTED_TEXT_TOO_MANY_WORDS"));
  });

  it("counts merged line separators and source words at exact batch boundaries", async () => {
    const firstLineCount = Math.floor(ASSIGNMENT_EXTRACTED_TEXT_MAX_LINES / 2);
    const secondLineCount =
      ASSIGNMENT_EXTRACTED_TEXT_MAX_LINES - firstLineCount - 1;
    const exactLines = await parseAssignmentFiles([
      makeFile(makeLineText(firstLineCount), "first-lines.txt"),
      makeFile(makeLineText(secondLineCount), "second-lines.txt"),
    ]);
    expect(retainedLineCount(exactLines.text)).toBe(
      ASSIGNMENT_EXTRACTED_TEXT_MAX_LINES,
    );

    await expect(
      parseAssignmentFiles([
        makeFile(makeLineText(firstLineCount), "first-lines.txt"),
        makeFile(makeLineText(secondLineCount + 1), "second-lines.txt"),
      ]),
    ).rejects.toSatisfy(expectErrorCode("EXTRACTED_TEXT_TOO_MANY_LINES"));

    const firstWordCount = Math.floor(ASSIGNMENT_EXTRACTED_TEXT_MAX_WORDS / 2);
    const secondWordCount =
      ASSIGNMENT_EXTRACTED_TEXT_MAX_WORDS - firstWordCount;
    const exactWords = await parseAssignmentFiles([
      makeFile(makeWordText(firstWordCount), "first-words.txt"),
      makeFile(makeWordText(secondWordCount), "second-words.txt"),
    ]);
    expect(exactWords.wordCount).toBe(ASSIGNMENT_EXTRACTED_TEXT_MAX_WORDS);

    await expect(
      parseAssignmentFiles([
        makeFile(makeWordText(firstWordCount), "first-words.txt"),
        makeFile(makeWordText(secondWordCount + 1), "second-words.txt"),
      ]),
    ).rejects.toSatisfy(expectErrorCode("EXTRACTED_TEXT_TOO_MANY_WORDS"));
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

  it("accepts a 200-page PDF and rejects 201 pages before reading page one", async () => {
    const acceptedDocument = makePdfDocument(ASSIGNMENT_PDF_MAX_PAGES);
    parserMocks.getDocument.mockReturnValueOnce({
      promise: Promise.resolve(acceptedDocument.document),
    });

    const accepted = await parseAssignmentFiles([
      makeFile("pdf", "exact-pages.pdf", "application/pdf"),
    ]);

    expect(accepted.sources[0].pageCount).toBe(ASSIGNMENT_PDF_MAX_PAGES);
    expect(acceptedDocument.getPage).toHaveBeenCalledTimes(
      ASSIGNMENT_PDF_MAX_PAGES,
    );
    expect(acceptedDocument.destroy).toHaveBeenCalledOnce();

    const oversizedDocument = makePdfDocument(ASSIGNMENT_PDF_MAX_PAGES + 1);
    parserMocks.getDocument.mockReturnValueOnce({
      promise: Promise.resolve(oversizedDocument.document),
    });

    await expect(
      parseAssignmentFiles([
        makeFile("pdf", "too-many-pages.pdf", "application/pdf"),
      ]),
    ).rejects.toSatisfy(expectErrorCode("PDF_TOO_MANY_PAGES"));
    expect(oversizedDocument.getPage).not.toHaveBeenCalled();
    expect(oversizedDocument.destroy).toHaveBeenCalledOnce();
  });

  it.each([
    {
      code: "EXTRACTED_TEXT_TOO_LARGE" as const,
      firstPageText: "x".repeat(
        ASSIGNMENT_EXTRACTED_TEXT_MAX_CHARACTERS + 1,
      ),
      name: "character",
    },
    {
      code: "EXTRACTED_TEXT_TOO_MANY_LINES" as const,
      firstPageText: makeLineText(ASSIGNMENT_EXTRACTED_TEXT_MAX_LINES + 1),
      name: "line",
    },
    {
      code: "EXTRACTED_TEXT_TOO_MANY_WORDS" as const,
      firstPageText: makeWordText(ASSIGNMENT_EXTRACTED_TEXT_MAX_WORDS + 1),
      name: "word",
    },
  ])(
    "stops after the first PDF page exceeds the $name budget",
    async ({ code, firstPageText }) => {
      const document = makePdfDocument(2, {
        pageText: (pageNumber) =>
          pageNumber === 1 ? firstPageText : "This page must not be read.",
      });
      parserMocks.getDocument.mockReturnValueOnce({
        promise: Promise.resolve(document.document),
      });

      await expect(
        parseAssignmentFiles([
          makeFile("pdf", "resource-heavy.pdf", "application/pdf"),
        ]),
      ).rejects.toSatisfy(expectErrorCode(code));
      expect(document.getPage).toHaveBeenCalledTimes(1);
      expect(document.getPage).toHaveBeenLastCalledWith(1);
      expect(document.destroy).toHaveBeenCalledOnce();
    },
  );

  it("does not charge empty PDF pages against text line or word budgets", async () => {
    const exactText = "x x\n".repeat(ASSIGNMENT_EXTRACTED_TEXT_MAX_LINES);
    const document = makePdfDocument(2, {
      pageText: (pageNumber) => (pageNumber === 1 ? null : exactText),
    });
    parserMocks.getDocument.mockReturnValueOnce({
      promise: Promise.resolve(document.document),
    });

    const result = await parseAssignmentFiles([
      makeFile("pdf", "empty-first-page.pdf", "application/pdf"),
    ]);

    expect(result.wordCount).toBe(ASSIGNMENT_EXTRACTED_TEXT_MAX_WORDS);
    expect(retainedLineCount(result.text)).toBe(
      ASSIGNMENT_EXTRACTED_TEXT_MAX_LINES,
    );
    expect(result.sources[0].pages[0]).toMatchObject({
      startOffset: 0,
      endOffset: 0,
      text: "",
    });
    expect(result.sources[0].pages[1].startOffset).toBe(0);
  });

  it("keeps PDF cleanup best-effort after success and stable page-limit errors", async () => {
    const successfulDocument = makePdfDocument(1, {
      destroyError: new Error("cleanup failed"),
    });
    parserMocks.getDocument.mockReturnValueOnce({
      promise: Promise.resolve(successfulDocument.document),
    });

    const result = await parseAssignmentFiles([
      makeFile("pdf", "readable.pdf", "application/pdf"),
    ]);
    expect(result.sources[0].pageCount).toBe(1);
    expect(successfulDocument.destroy).toHaveBeenCalledOnce();

    const oversizedDocument = makePdfDocument(ASSIGNMENT_PDF_MAX_PAGES + 1, {
      destroyError: new Error("cleanup failed"),
    });
    parserMocks.getDocument.mockReturnValueOnce({
      promise: Promise.resolve(oversizedDocument.document),
    });

    await expect(
      parseAssignmentFiles([
        makeFile("pdf", "oversized.pdf", "application/pdf"),
      ]),
    ).rejects.toSatisfy(expectErrorCode("PDF_TOO_MANY_PAGES"));
    expect(oversizedDocument.getPage).not.toHaveBeenCalled();
    expect(oversizedDocument.destroy).toHaveBeenCalledOnce();
  });

  it("rejects a 401st accepted PDF page before reading it and destroys every document", async () => {
    const firstDocument = makePdfDocument(ASSIGNMENT_PDF_MAX_PAGES);
    const secondDocument = makePdfDocument(ASSIGNMENT_PDF_MAX_PAGES);
    const lastDocument = makePdfDocument(
      ASSIGNMENT_PDFS_MAX_TOTAL_PAGES - ASSIGNMENT_PDF_MAX_PAGES * 2 + 1,
    );
    for (const candidate of [
      firstDocument,
      secondDocument,
      lastDocument,
    ]) {
      parserMocks.getDocument.mockReturnValueOnce({
        promise: Promise.resolve(candidate.document),
      });
    }

    await expect(
      parseAssignmentFiles([
        makeFile("pdf", "first.pdf", "application/pdf"),
        makeFile("pdf", "second.pdf", "application/pdf"),
        makeFile("pdf", "last.pdf", "application/pdf"),
      ]),
    ).rejects.toSatisfy(expectErrorCode("TOTAL_PDF_PAGES_TOO_LARGE"));

    expect(firstDocument.getPage).toHaveBeenCalledTimes(
      ASSIGNMENT_PDF_MAX_PAGES,
    );
    expect(secondDocument.getPage).toHaveBeenCalledTimes(
      ASSIGNMENT_PDF_MAX_PAGES,
    );
    expect(lastDocument.getPage).not.toHaveBeenCalled();
    expect(firstDocument.destroy).toHaveBeenCalledOnce();
    expect(secondDocument.destroy).toHaveBeenCalledOnce();
    expect(lastDocument.destroy).toHaveBeenCalledOnce();
  });

  it("prioritises the total PDF budget when the current file also exceeds 200 pages", async () => {
    const acceptedDocument = makePdfDocument(ASSIGNMENT_PDF_MAX_PAGES);
    const bothLimitsDocument = makePdfDocument(ASSIGNMENT_PDF_MAX_PAGES + 1);
    for (const candidate of [acceptedDocument, bothLimitsDocument]) {
      parserMocks.getDocument.mockReturnValueOnce({
        promise: Promise.resolve(candidate.document),
      });
    }

    await expect(
      parseAssignmentFiles([
        makeFile("pdf", "accepted.pdf", "application/pdf"),
        makeFile("pdf", "both-limits.pdf", "application/pdf"),
      ]),
    ).rejects.toSatisfy(expectErrorCode("TOTAL_PDF_PAGES_TOO_LARGE"));

    expect(acceptedDocument.getPage).toHaveBeenCalledTimes(
      ASSIGNMENT_PDF_MAX_PAGES,
    );
    expect(bothLimitsDocument.getPage).not.toHaveBeenCalled();
    expect(bothLimitsDocument.destroy).toHaveBeenCalledOnce();
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

describe("parseAssignmentFilesWithRecovery", () => {
  beforeEach(() => {
    parserMocks.extractRawText.mockReset();
    parserMocks.getDocument.mockReset();
  });

  it("retains readable files in selection order and reports an unsupported middle file", async () => {
    const first = makeFile("Assignment title: Queue Improvement", "brief.txt");
    const unsupported = makeFile("legacy", "rubric.doc", "application/msword");
    const third = makeFile("Rubric\nAnalysis | 100%", "rubric.txt");

    const result = await parseAssignmentFilesWithRecovery([
      first,
      unsupported,
      third,
    ]);

    expect(result.selectedFileCount).toBe(3);
    expect(result.parsed.sources.map((source) => source.id)).toEqual([
      "source-1",
      "source-3",
    ]);
    expect(result.parsed.sources.map((source) => source.fileName)).toEqual([
      "brief.txt",
      "rubric.txt",
    ]);
    expect(result.parsed.sources[1].startOffset).toBe(
      result.parsed.sources[0].endOffset + 2,
    );
    expect(result.parsed.totalBytes).toBe(first.size + third.size);
    expect(result.skippedFiles).toEqual([
      expect.objectContaining({
        inputIndex: 1,
        fileName: "rubric.doc",
        code: "UNSUPPORTED_FILE_TYPE",
      }),
    ]);
  });

  it("skips malformed UTF-8 while preserving readable files in a mixed batch", async () => {
    const first = makeFile("Assignment title: Safe Brief", "brief.txt");
    const malformed = makeFile(
      new Uint8Array([0x52, 0x75, 0x62, 0x72, 0x69, 0x63, 0x3a, 0x20, 0x80]),
      "malformed.txt",
    );
    const third = makeFile("Rubric\nAnalysis | 100%", "rubric.txt");

    const result = await parseAssignmentFilesWithRecovery([
      first,
      malformed,
      third,
    ]);

    expect(result.parsed.sources.map((source) => source.id)).toEqual([
      "source-1",
      "source-3",
    ]);
    expect(result.parsed.text).toBe(
      "Assignment title: Safe Brief\n\nRubric\nAnalysis | 100%",
    );
    expect(result.parsed.totalBytes).toBe(first.size + third.size);
    expect(result.skippedFiles).toEqual([
      expect.objectContaining({
        inputIndex: 1,
        fileName: "malformed.txt",
        code: "INVALID_TEXT_ENCODING",
      }),
    ]);
  });

  it("returns a friendly per-file encoding failure when no TXT is readable", async () => {
    const malformed = makeFile(
      new Uint8Array([0xf0, 0x28, 0x8c, 0x28]),
      "malformed.txt",
    );

    await expect(
      parseAssignmentFilesWithRecovery([malformed]),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(AssignmentFileBatchParseError);
      expect((error as Error).message).toBe(
        "None of the selected files could be read safely.",
      );
      expect((error as AssignmentFileBatchParseError).failures).toEqual([
        expect.objectContaining({
          inputIndex: 0,
          fileName: "malformed.txt",
          code: "INVALID_TEXT_ENCODING",
          message:
            '"malformed.txt" is not valid UTF-8 text. Save it as UTF-8 and try again.',
        }),
      ]);
      return true;
    });
  });

  it("continues after a corrupt document and keeps later source identity", async () => {
    parserMocks.extractRawText.mockRejectedValue(new Error("invalid zip"));
    const files = [
      makeFile("Assignment title: Service Report", "brief.txt"),
      makeFile(
        "broken",
        "broken.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
      makeFile("Rubric\nAnalysis | 100%", "rubric.txt"),
    ];

    const result = await parseAssignmentFilesWithRecovery(files);

    expect(result.parsed.sources.map((source) => source.id)).toEqual([
      "source-1",
      "source-3",
    ]);
    expect(result.skippedFiles).toEqual([
      expect.objectContaining({ inputIndex: 1, code: "CORRUPT_DOCUMENT" }),
    ]);
  });

  it("returns every per-file issue when the whole batch is unreadable", async () => {
    const files = [
      makeFile("legacy", "brief.doc", "application/msword"),
      makeFile("", "empty.txt"),
    ];

    await expect(parseAssignmentFilesWithRecovery(files)).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(AssignmentFileBatchParseError);
        expect(
          (error as AssignmentFileBatchParseError).failures.map((failure) => ({
            inputIndex: failure.inputIndex,
            code: failure.code,
          })),
        ).toEqual([
          { inputIndex: 0, code: "UNSUPPORTED_FILE_TYPE" },
          { inputIndex: 1, code: "EMPTY_FILE" },
        ]);
        return true;
      },
    );
  });

  it("keeps extracted-text exhaustion as a batch-level failure", async () => {
    parserMocks.extractRawText.mockResolvedValue({
      value: "x".repeat(ASSIGNMENT_EXTRACTED_TEXT_MAX_CHARACTERS),
    });
    const trailing = makeFile("Rubric\nAnalysis | 100%", "rubric.txt");
    const trailingRead = vi.spyOn(trailing, "arrayBuffer");
    const files = [
      makeFile("Readable brief", "brief.txt"),
      makeFile(
        "large-docx",
        "large.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
      trailing,
    ];

    await expect(parseAssignmentFilesWithRecovery(files)).rejects.toSatisfy(
      expectErrorCode("EXTRACTED_TEXT_TOO_LARGE"),
    );
    expect(trailingRead).not.toHaveBeenCalled();
  });

  it.each([
    {
      code: "EXTRACTED_TEXT_TOO_MANY_LINES" as const,
      content: makeLineText(ASSIGNMENT_EXTRACTED_TEXT_MAX_LINES + 1),
      name: "line exhaustion",
    },
    {
      code: "EXTRACTED_TEXT_TOO_MANY_WORDS" as const,
      content: makeWordText(ASSIGNMENT_EXTRACTED_TEXT_MAX_WORDS + 1),
      name: "word exhaustion",
    },
  ])("keeps $name fatal and stops before later files", async ({ code, content }) => {
    const trailing = makeFile("Rubric\nAnalysis | 100%", "rubric.txt");
    const trailingRead = vi.spyOn(trailing, "arrayBuffer");

    await expect(
      parseAssignmentFilesWithRecovery([
        makeFile("Readable brief", "brief.txt"),
        makeFile(content, "resource-heavy.txt"),
        trailing,
      ]),
    ).rejects.toSatisfy(expectErrorCode(code));
    expect(trailingRead).not.toHaveBeenCalled();
  });

  it("charges a skipped PDF's metadata pages to the 400-page selection budget", async () => {
    const skippedDocument = makePdfDocument(ASSIGNMENT_PDF_MAX_PAGES + 1);
    const acceptedPageCount =
      ASSIGNMENT_PDFS_MAX_TOTAL_PAGES - (ASSIGNMENT_PDF_MAX_PAGES + 1);
    const acceptedDocument = makePdfDocument(acceptedPageCount);
    for (const candidate of [skippedDocument, acceptedDocument]) {
      parserMocks.getDocument.mockReturnValueOnce({
        promise: Promise.resolve(candidate.document),
      });
    }

    const result = await parseAssignmentFilesWithRecovery([
      makeFile("pdf", "oversized.pdf", "application/pdf"),
      makeFile("pdf", "accepted.pdf", "application/pdf"),
    ]);

    expect(result.parsed.sources.map((source) => source.id)).toEqual(["source-2"]);
    expect(result.parsed.sources[0].pageCount).toBe(acceptedPageCount);
    expect(result.skippedFiles).toEqual([
      expect.objectContaining({
        inputIndex: 0,
        code: "PDF_TOO_MANY_PAGES",
      }),
    ]);
    expect(skippedDocument.getPage).not.toHaveBeenCalled();
    expect(skippedDocument.destroy).toHaveBeenCalledOnce();
    expect(acceptedDocument.getPage).toHaveBeenCalledTimes(acceptedPageCount);
    expect(acceptedDocument.destroy).toHaveBeenCalledOnce();
  });

  it("keeps total PDF page exhaustion fatal during mixed recovery", async () => {
    const firstDocument = makePdfDocument(ASSIGNMENT_PDF_MAX_PAGES + 1);
    const secondDocument = makePdfDocument(ASSIGNMENT_PDF_MAX_PAGES);
    for (const candidate of [firstDocument, secondDocument]) {
      parserMocks.getDocument.mockReturnValueOnce({
        promise: Promise.resolve(candidate.document),
      });
    }
    const trailing = makeFile("Rubric\nAnalysis | 100%", "rubric.txt");
    const trailingRead = vi.spyOn(trailing, "arrayBuffer");

    await expect(
      parseAssignmentFilesWithRecovery([
        makeFile("pdf", "skipped-201-pages.pdf", "application/pdf"),
        makeFile("pdf", "over-budget-200-pages.pdf", "application/pdf"),
        trailing,
      ]),
    ).rejects.toSatisfy(expectErrorCode("TOTAL_PDF_PAGES_TOO_LARGE"));

    expect(firstDocument.getPage).not.toHaveBeenCalled();
    expect(firstDocument.destroy).toHaveBeenCalledOnce();
    expect(secondDocument.getPage).not.toHaveBeenCalled();
    expect(secondDocument.destroy).toHaveBeenCalledOnce();
    expect(trailingRead).not.toHaveBeenCalled();
  });

  it("rejects selection-wide file count and byte limits before reading files", async () => {
    const tooMany = Array.from(
      { length: ASSIGNMENT_FILE_MAX_COUNT + 1 },
      (_, index) => makeFile(`Brief ${index + 1}`, `brief-${index + 1}.txt`),
    );
    const tooManyReads = tooMany.map((file) => vi.spyOn(file, "arrayBuffer"));

    await expect(parseAssignmentFilesWithRecovery(tooMany)).rejects.toSatisfy(
      expectErrorCode("TOO_MANY_FILES"),
    );
    expect(tooManyReads.every((read) => read.mock.calls.length === 0)).toBe(true);

    const unsupported = makeFile("legacy", "brief.doc", "application/msword");
    const readable = makeFile("Readable brief", "brief.txt");
    Object.defineProperty(unsupported, "size", {
      configurable: true,
      value: ASSIGNMENT_FILES_MAX_TOTAL_BYTES,
    });
    Object.defineProperty(readable, "size", {
      configurable: true,
      value: 1,
    });
    const unsupportedRead = vi.spyOn(unsupported, "arrayBuffer");
    const readableRead = vi.spyOn(readable, "arrayBuffer");

    await expect(
      parseAssignmentFilesWithRecovery([unsupported, readable]),
    ).rejects.toSatisfy(expectErrorCode("TOTAL_FILE_SIZE_TOO_LARGE"));
    expect(unsupportedRead).not.toHaveBeenCalled();
    expect(readableRead).not.toHaveBeenCalled();
  });

  it("stops the batch when a local parser is unavailable", async () => {
    parserMocks.extractRawText.mockRejectedValue(
      new AssignmentFileParseError(
        "PARSER_UNAVAILABLE",
        "The local DOCX reader is unavailable.",
        "brief.docx",
      ),
    );
    const trailing = makeFile("Rubric\nAnalysis | 100%", "rubric.txt");
    const trailingRead = vi.spyOn(trailing, "arrayBuffer");

    await expect(
      parseAssignmentFilesWithRecovery([
        makeFile("Readable brief", "brief.txt"),
        makeFile(
          "docx",
          "brief.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
        trailing,
      ]),
    ).rejects.toSatisfy(expectErrorCode("PARSER_UNAVAILABLE"));
    expect(trailingRead).not.toHaveBeenCalled();
  });

  it("bounds unsafe failure display names without retaining the full name", async () => {
    const unsafeName = `${"<img onerror=alert(1)>".repeat(20)}.txt`;
    const invalid = makeFile("unsafe name", unsafeName);
    const readable = makeFile("Assignment title: Safe Brief", "brief.txt");

    const result = await parseAssignmentFilesWithRecovery([invalid, readable]);

    expect(result.skippedFiles[0]).toMatchObject({
      inputIndex: 0,
      code: "INVALID_FILE_NAME",
    });
    expect(result.skippedFiles[0].fileName.length).toBeLessThanOrEqual(255);
    expect(result.skippedFiles[0].fileName).not.toBe(unsafeName);
  });
});

describe("buildUploadedAssignmentSummary", () => {
  it.each([
    {
      code: "EXTRACTED_TEXT_TOO_LARGE" as const,
      makeInput: () =>
        "x".repeat(ASSIGNMENT_EXTRACTED_TEXT_MAX_CHARACTERS + 1),
      name: "character",
    },
    {
      code: "EXTRACTED_TEXT_TOO_MANY_LINES" as const,
      makeInput: () =>
        makeLineText(ASSIGNMENT_EXTRACTED_TEXT_MAX_LINES + 1),
      name: "line",
    },
    {
      code: "EXTRACTED_TEXT_TOO_MANY_WORDS" as const,
      makeInput: () =>
        makeWordText(ASSIGNMENT_EXTRACTED_TEXT_MAX_WORDS + 1),
      name: "word",
    },
  ])("rejects a direct string over the $name limit", ({ code, makeInput }) => {
    let caught: unknown;
    try {
      buildUploadedAssignmentSummary(makeInput());
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AssignmentFileParseError);
    expect((caught as AssignmentFileParseError).code).toBe(code);
    expect((caught as AssignmentFileParseError).fileName).toBeNull();
  });

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
