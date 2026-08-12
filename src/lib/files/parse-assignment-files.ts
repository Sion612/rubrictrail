const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_COUNT = 10;
const MAX_TOTAL_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHARACTERS = 2_000_000;
const MAX_EXTRACTED_TEXT_LINES = 50_000;
const MAX_EXTRACTED_TEXT_WORDS = 100_000;
const MAX_PDF_PAGES = 200;
const MAX_TOTAL_PDF_PAGES = 400;
const MAX_EVIDENCE_EXCERPT_CHARACTERS = 500;
const UNSAFE_FILE_NAME_CHARACTER = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u;

export const ASSIGNMENT_FILE_MAX_BYTES = MAX_FILE_SIZE_BYTES;
export const ASSIGNMENT_FILE_MAX_COUNT = MAX_FILE_COUNT;
export const ASSIGNMENT_FILES_MAX_TOTAL_BYTES = MAX_TOTAL_FILE_SIZE_BYTES;
export const ASSIGNMENT_EXTRACTED_TEXT_MAX_CHARACTERS =
  MAX_EXTRACTED_TEXT_CHARACTERS;
export const ASSIGNMENT_EXTRACTED_TEXT_MAX_LINES = MAX_EXTRACTED_TEXT_LINES;
export const ASSIGNMENT_EXTRACTED_TEXT_MAX_WORDS = MAX_EXTRACTED_TEXT_WORDS;
export const ASSIGNMENT_PDF_MAX_PAGES = MAX_PDF_PAGES;
export const ASSIGNMENT_PDFS_MAX_TOTAL_PAGES = MAX_TOTAL_PDF_PAGES;
export const ASSIGNMENT_EVIDENCE_EXCERPT_MAX_CHARACTERS =
  MAX_EVIDENCE_EXCERPT_CHARACTERS;

export type AssignmentFileErrorCode =
  | "UNSUPPORTED_FILE_TYPE"
  | "INVALID_FILE_NAME"
  | "FILE_TOO_LARGE"
  | "TOO_MANY_FILES"
  | "TOTAL_FILE_SIZE_TOO_LARGE"
  | "EXTRACTED_TEXT_TOO_LARGE"
  | "EXTRACTED_TEXT_TOO_MANY_LINES"
  | "EXTRACTED_TEXT_TOO_MANY_WORDS"
  | "PDF_TOO_MANY_PAGES"
  | "TOTAL_PDF_PAGES_TOO_LARGE"
  | "EMPTY_FILE"
  | "INVALID_TEXT_ENCODING"
  | "SCANNED_NO_TEXT"
  | "ENCRYPTED_PDF"
  | "PARSER_UNAVAILABLE"
  | "CORRUPT_DOCUMENT";

export type AssignmentFileKind = "txt" | "docx" | "pdf";

export class AssignmentFileParseError extends Error {
  readonly code: AssignmentFileErrorCode;
  readonly fileName: string | null;

  constructor(
    code: AssignmentFileErrorCode,
    message: string,
    fileName: string | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AssignmentFileParseError";
    this.code = code;
    this.fileName = fileName;
  }
}

export class AssignmentFileBatchParseError extends Error {
  readonly failures: readonly SkippedAssignmentFile[];

  constructor(failures: readonly SkippedAssignmentFile[]) {
    super("None of the selected files could be read safely.");
    this.name = "AssignmentFileBatchParseError";
    this.failures = failures;
  }
}

export interface ParsedAssignmentPage {
  pageNumber: number;
  text: string;
  /** Character offsets in the merged ParsedAssignmentFiles.text value. */
  startOffset: number;
  endOffset: number;
}

export interface ParsedAssignmentSource {
  id: string;
  fileName: string;
  kind: AssignmentFileKind;
  mediaType: string;
  sizeBytes: number;
  lastModified: number | null;
  text: string;
  wordCount: number;
  /** Character offsets in the merged ParsedAssignmentFiles.text value. */
  startOffset: number;
  endOffset: number;
  pageCount: number | null;
  pages: ParsedAssignmentPage[];
}

export interface SkippedAssignmentFile {
  inputIndex: number;
  fileName: string;
  code: AssignmentFileErrorCode;
  message: string;
}

export interface ParsedAssignmentFiles {
  text: string;
  sources: ParsedAssignmentSource[];
  totalBytes: number;
  wordCount: number;
}

export interface RecoveredAssignmentFiles {
  parsed: ParsedAssignmentFiles;
  skippedFiles: SkippedAssignmentFile[];
  selectedFileCount: number;
}

export interface UploadedSourceEvidence {
  sourceId: string | null;
  fileName: string | null;
  page: number | null;
  excerpt: string;
  startOffset: number;
  endOffset: number;
}

export type UploadedSummaryFieldStatus = "found" | "inferred" | "missing";

export interface UploadedSummaryField<T> {
  value: T | null;
  raw: string | null;
  status: UploadedSummaryFieldStatus;
  evidence: UploadedSourceEvidence | null;
}

export interface UploadedRubricCriterion {
  name: string;
  /** Null means the source did not explicitly state a weight. */
  weight: number | null;
  evidence: UploadedSourceEvidence;
}

export interface UploadedRubricSummary {
  status: "complete" | "incomplete";
  criteria: UploadedRubricCriterion[];
  /** Only populated when every detected criterion has an explicit weight. */
  totalWeight: number | null;
  message: string;
}

export interface UploadedAssignmentSummary {
  status: "complete" | "incomplete";
  title: UploadedSummaryField<string>;
  dueDate: UploadedSummaryField<string>;
  wordCount: UploadedSummaryField<number>;
  citationStyle: UploadedSummaryField<string>;
  rubric: UploadedRubricSummary;
  warnings: string[];
}

interface LocallyParsedFile {
  text: string;
  lineCount: number;
  wordCount: number;
  pageCount: number | null;
  pages: Array<{
    pageNumber: number;
    text: string;
    startOffset: number;
    endOffset: number;
  }>;
}

interface RemainingExtractionLimits {
  characters: number;
  lines: number;
  words: number;
  onPdfPagesDiscovered: (pageCount: number) => void;
}

interface PdfTextItemLike {
  str?: unknown;
  hasEOL?: unknown;
}

interface PdfPageLike {
  getTextContent(): Promise<{ items: unknown[] }>;
}

interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  destroy?: () => Promise<void> | void;
}

interface PdfLoadingTaskLike {
  promise: Promise<PdfDocumentLike>;
}

interface PdfModuleLike {
  getDocument(options: {
    data: Uint8Array;
    enableScripting: boolean;
    isEvalSupported: boolean;
    useSystemFonts: boolean;
  }): PdfLoadingTaskLike;
  GlobalWorkerOptions?: { workerSrc: string };
}

interface MammothModuleLike {
  extractRawText?: (options: {
    arrayBuffer: ArrayBuffer;
  }) => Promise<{ value: string }>;
  default?: {
    extractRawText?: (options: {
      arrayBuffer: ArrayBuffer;
    }) => Promise<{ value: string }>;
  };
}

interface TextLine {
  raw: string;
  trimmed: string;
  startOffset: number;
  endOffset: number;
}

const MIME_KIND_MAP: Readonly<Record<string, AssignmentFileKind>> = {
  "text/plain": "txt",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
};

const EXTENSION_KIND_MAP: Readonly<Record<string, AssignmentFileKind>> = {
  txt: "txt",
  pdf: "pdf",
  docx: "docx",
};

const DATE_PATTERN =
  /\b(?:\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*|\s+)\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/i;

const CITATION_STYLE_PATTERN =
  /\b(?:APA(?:\s+(?:6|6th|7|7th)(?:\s+edition)?)?|Harvard|Chicago|MLA|IEEE|OSCOLA|Vancouver)\b/i;

const RUBRIC_HEADING_PATTERN =
  /^(?:(?:assessment|grading|marking)\s+)?(?:rubric|criteria)(?:\s+(?:and|&)\s+weightings?)?\s*:?$/i;

const RUBRIC_END_HEADING_PATTERN =
  /^(?:submission requirements?|deadline|due date|academic integrity|referenc(?:e|es|ing)|bibliography|appendix|learning outcomes?|assignment task|deliverables?)\s*:?$/i;

const RECOVERABLE_PER_FILE_ERROR_CODES = new Set<AssignmentFileErrorCode>([
  "UNSUPPORTED_FILE_TYPE",
  "INVALID_FILE_NAME",
  "FILE_TOO_LARGE",
  "EMPTY_FILE",
  "INVALID_TEXT_ENCODING",
  "SCANNED_NO_TEXT",
  "ENCRYPTED_PDF",
  "PDF_TOO_MANY_PAGES",
  "CORRUPT_DOCUMENT",
]);

/**
 * Parses assignment files entirely in the browser. DOCX and PDF parsers are
 * loaded only when their file type is encountered so TXT-only use stays light.
 */
export async function parseAssignmentFiles(
  files: readonly File[],
): Promise<ParsedAssignmentFiles> {
  if (files.length === 0) {
    throw new AssignmentFileParseError(
      "EMPTY_FILE",
      "Choose at least one assignment file.",
    );
  }

  if (files.length > MAX_FILE_COUNT) {
    throw new AssignmentFileParseError(
      "TOO_MANY_FILES",
      `Choose no more than ${MAX_FILE_COUNT} assignment files at once.`,
    );
  }

  const validatedFiles = files.map((file, inputIndex) => ({
    file,
    inputIndex,
    kind: validateFile(file),
  }));
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_TOTAL_FILE_SIZE_BYTES) {
    throw new AssignmentFileParseError(
      "TOTAL_FILE_SIZE_TOO_LARGE",
      "The selected files exceed the 25 MiB combined limit.",
    );
  }

  const parsedFiles: Array<{
    file: File;
    inputIndex: number;
    kind: AssignmentFileKind;
    parsed: LocallyParsedFile;
  }> = [];
  let extractedCharacterCount = 0;
  let extractedLineCount = 0;
  let extractedWordCount = 0;
  let discoveredPdfPageCount = 0;

  // Keep input order stable and avoid loading several large documents at once.
  for (const { file, inputIndex, kind } of validatedFiles) {
    const separatorLength = parsedFiles.length > 0 ? 2 : 0;
    const separatorLineCount = parsedFiles.length > 0 ? 1 : 0;
    const remainingCharacters =
      MAX_EXTRACTED_TEXT_CHARACTERS -
      extractedCharacterCount -
      separatorLength;
    const remainingLines =
      MAX_EXTRACTED_TEXT_LINES - extractedLineCount - separatorLineCount;
    const remainingWords = MAX_EXTRACTED_TEXT_WORDS - extractedWordCount;
    if (remainingCharacters <= 0) {
      throw extractedTextTooLargeError(file);
    }
    if (remainingLines <= 0) {
      throw extractedTextTooManyLinesError(file);
    }
    if (remainingWords <= 0) {
      throw extractedTextTooManyWordsError(file);
    }
    const parsed = await parseSingleFile(file, kind, {
      characters: remainingCharacters,
      lines: remainingLines,
      words: remainingWords,
      onPdfPagesDiscovered: (pageCount) => {
        const nextPageCount = discoveredPdfPageCount + pageCount;
        if (nextPageCount > MAX_TOTAL_PDF_PAGES) {
          throw totalPdfPagesTooLargeError(file);
        }
        discoveredPdfPageCount = nextPageCount;
      },
    });
    parsedFiles.push({ file, inputIndex, kind, parsed });
    extractedCharacterCount += separatorLength + parsed.text.length;
    extractedLineCount += separatorLineCount + parsed.lineCount;
    extractedWordCount += parsed.wordCount;
  }

  return mergeParsedAssignmentFiles(parsedFiles, totalBytes);
}

/**
 * Parses a user-selected file batch while retaining files that can be read.
 * Selection-wide count and byte limits remain strict; only per-file failures
 * are recoverable. The strict parser above remains the default for callers
 * such as pasted-text intake that require all supplied sources to succeed.
 */
export async function parseAssignmentFilesWithRecovery(
  files: readonly File[],
): Promise<RecoveredAssignmentFiles> {
  if (files.length === 0) {
    throw new AssignmentFileParseError(
      "EMPTY_FILE",
      "Choose at least one assignment file.",
    );
  }
  if (files.length > MAX_FILE_COUNT) {
    throw new AssignmentFileParseError(
      "TOO_MANY_FILES",
      `Choose no more than ${MAX_FILE_COUNT} assignment files at once.`,
    );
  }

  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_TOTAL_FILE_SIZE_BYTES) {
    throw new AssignmentFileParseError(
      "TOTAL_FILE_SIZE_TOO_LARGE",
      "The selected files exceed the 25 MiB combined limit.",
    );
  }

  const parsedFiles: Array<{
    file: File;
    inputIndex: number;
    kind: AssignmentFileKind;
    parsed: LocallyParsedFile;
  }> = [];
  const skippedFiles: SkippedAssignmentFile[] = [];
  let extractedCharacterCount = 0;
  let extractedLineCount = 0;
  let extractedWordCount = 0;
  let discoveredPdfPageCount = 0;

  // Parse sequentially so one large or damaged source cannot fan out memory use.
  for (const [inputIndex, file] of files.entries()) {
    try {
      const kind = validateFile(file);
      const separatorLength = parsedFiles.length > 0 ? 2 : 0;
      const separatorLineCount = parsedFiles.length > 0 ? 1 : 0;
      const remainingCharacters =
        MAX_EXTRACTED_TEXT_CHARACTERS -
        extractedCharacterCount -
        separatorLength;
      const remainingLines =
        MAX_EXTRACTED_TEXT_LINES - extractedLineCount - separatorLineCount;
      const remainingWords = MAX_EXTRACTED_TEXT_WORDS - extractedWordCount;
      if (remainingCharacters <= 0) {
        throw extractedTextTooLargeError(file);
      }
      if (remainingLines <= 0) {
        throw extractedTextTooManyLinesError(file);
      }
      if (remainingWords <= 0) {
        throw extractedTextTooManyWordsError(file);
      }
      const parsed = await parseSingleFile(file, kind, {
        characters: remainingCharacters,
        lines: remainingLines,
        words: remainingWords,
        onPdfPagesDiscovered: (pageCount) => {
          const nextPageCount = discoveredPdfPageCount + pageCount;
          if (nextPageCount > MAX_TOTAL_PDF_PAGES) {
            throw totalPdfPagesTooLargeError(file);
          }
          discoveredPdfPageCount = nextPageCount;
        },
      });
      parsedFiles.push({ file, inputIndex, kind, parsed });
      extractedCharacterCount += separatorLength + parsed.text.length;
      extractedLineCount += separatorLineCount + parsed.lineCount;
      extractedWordCount += parsed.wordCount;
    } catch (error) {
      if (!(error instanceof AssignmentFileParseError)) {
        throw error;
      }
      if (!RECOVERABLE_PER_FILE_ERROR_CODES.has(error.code)) {
        throw error;
      }
      skippedFiles.push(skippedAssignmentFile(inputIndex, file, error));
    }
  }

  if (parsedFiles.length === 0) {
    throw new AssignmentFileBatchParseError(skippedFiles);
  }

  return {
    parsed: mergeParsedAssignmentFiles(
      parsedFiles,
      parsedFiles.reduce((total, item) => total + item.file.size, 0),
    ),
    skippedFiles,
    selectedFileCount: files.length,
  };
}

function mergeParsedAssignmentFiles(
  parsedFiles: Array<{
    file: File;
    inputIndex: number;
    kind: AssignmentFileKind;
    parsed: LocallyParsedFile;
  }>,
  totalBytes: number,
): ParsedAssignmentFiles {

  let mergedText = "";
  const sources: ParsedAssignmentSource[] = [];

  parsedFiles.forEach(({ file, inputIndex, kind, parsed }, index) => {
    if (index > 0) {
      mergedText += "\n\n";
    }

    const startOffset = mergedText.length;
    mergedText += parsed.text;
    const endOffset = mergedText.length;

    sources.push({
      id: `source-${inputIndex + 1}`,
      fileName: file.name,
      kind,
      mediaType: file.type || mediaTypeForKind(kind),
      sizeBytes: file.size,
      lastModified:
        typeof file.lastModified === "number" ? file.lastModified : null,
      text: parsed.text,
      wordCount: parsed.wordCount,
      startOffset,
      endOffset,
      pageCount: parsed.pageCount,
      pages: parsed.pages.map((page) => ({
        ...page,
        startOffset: page.startOffset + startOffset,
        endOffset: page.endOffset + startOffset,
      })),
    });
  });

  return {
    text: mergedText,
    sources,
    totalBytes,
    wordCount: parsedFiles.reduce(
      (total, item) => total + item.parsed.wordCount,
      0,
    ),
  };
}

function skippedAssignmentFile(
  inputIndex: number,
  file: File,
  error: AssignmentFileParseError,
): SkippedAssignmentFile {
  return {
    inputIndex,
    fileName: safeDisplayFileName(error.fileName ?? file.name, inputIndex),
    code: error.code,
    message: error.message,
  };
}

function safeDisplayFileName(value: string, inputIndex: number): string {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) {
    return `File ${inputIndex + 1}`;
  }
  return normalized.length > 255
    ? `${normalized.slice(0, 254)}…`
    : normalized;
}

/**
 * A conservative, deterministic fallback for uploaded documents. It only
 * returns values present in the source text. Missing rubric weights remain
 * null; no weighting or grading data is inferred.
 */
export function buildUploadedAssignmentSummary(
  input: ParsedAssignmentFiles | string,
): UploadedAssignmentSummary {
  if (
    typeof input === "string" &&
    input.length > MAX_EXTRACTED_TEXT_CHARACTERS
  ) {
    throw extractedTextTooLargeError(null);
  }
  const text = typeof input === "string" ? normalizeExtractedText(input) : input.text;
  const sources = typeof input === "string" ? [] : input.sources;
  extractedTextMetrics(text, null, {
    characters: MAX_EXTRACTED_TEXT_CHARACTERS,
    lines: MAX_EXTRACTED_TEXT_LINES,
    words: MAX_EXTRACTED_TEXT_WORDS,
  });
  const lines = toTextLines(text);

  const title = extractTitle(lines, sources);
  const dueDate = extractDueDate(lines, sources);
  const wordCount = extractWordCount(lines, sources);
  const citationStyle = extractCitationStyle(lines, sources);
  const rubric = extractRubric(lines, sources);
  const warnings: string[] = [];

  if (title.status === "missing") {
    warnings.push("Assignment title was not found in the uploaded text.");
  } else if (title.status === "inferred") {
    warnings.push(
      "The title was inferred from the first heading; verify it against the brief.",
    );
  }
  if (dueDate.status === "missing") {
    warnings.push("Due date was not found; add it before relying on the plan.");
  }
  if (wordCount.status === "missing") {
    warnings.push("Word count was not found in the uploaded text.");
  }
  if (citationStyle.status === "missing") {
    warnings.push("Citation or referencing style was not found.");
  }
  if (rubric.status === "incomplete") {
    warnings.push(rubric.message);
  }

  const allFieldsFound = [title, dueDate, wordCount, citationStyle].every(
    (field) => field.status === "found",
  );

  return {
    status: allFieldsFound && rubric.status === "complete" ? "complete" : "incomplete",
    title,
    dueDate,
    wordCount,
    citationStyle,
    rubric,
    warnings,
  };
}

function validateFile(file: File): AssignmentFileKind {
  if (
    !file.name.trim() ||
    file.name.length > 255 ||
    UNSAFE_FILE_NAME_CHARACTER.test(file.name)
  ) {
    throw new AssignmentFileParseError(
      "INVALID_FILE_NAME",
      file.name.trim()
        ? "A selected file name is unsafe or longer than 255 characters. Rename it before trying again."
        : "A selected file has no usable name. Rename it before trying again.",
      null,
    );
  }
  const kind = detectFileKind(file);
  if (!kind) {
    throw new AssignmentFileParseError(
      "UNSUPPORTED_FILE_TYPE",
      `"${file.name}" is not a supported TXT, DOCX, or PDF file.`,
      file.name,
    );
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new AssignmentFileParseError(
      "FILE_TOO_LARGE",
      `"${file.name}" is larger than the 10 MiB per-file limit.`,
      file.name,
    );
  }
  if (file.size === 0) {
    throw new AssignmentFileParseError(
      "EMPTY_FILE",
      `"${file.name}" is empty.`,
      file.name,
    );
  }
  return kind;
}

function detectFileKind(file: File): AssignmentFileKind | null {
  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (extension && EXTENSION_KIND_MAP[extension]) {
    return EXTENSION_KIND_MAP[extension];
  }
  return MIME_KIND_MAP[file.type.toLowerCase()] ?? null;
}

async function parseSingleFile(
  file: File,
  kind: AssignmentFileKind,
  limits: RemainingExtractionLimits,
): Promise<LocallyParsedFile> {
  if (kind === "txt") {
    return parseTextFile(file, limits);
  }
  if (kind === "docx") {
    return parseDocxFile(file, limits);
  }
  return parsePdfFile(file, limits);
}

async function parseTextFile(
  file: File,
  limits: RemainingExtractionLimits,
): Promise<LocallyParsedFile> {
  try {
    const bytes = await file.arrayBuffer();
    let decodedText: string;
    try {
      decodedText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      throw new AssignmentFileParseError(
        "INVALID_TEXT_ENCODING",
        `"${file.name}" is not valid UTF-8 text. Save it as UTF-8 and try again.`,
        file.name,
        { cause: error },
      );
    }
    const text = normalizeExtractedText(decodedText);
    ensureTextWasExtracted(text, file, "EMPTY_FILE");
    const metrics = extractedTextMetrics(text, file, limits);
    return { text, ...metrics, pageCount: null, pages: [] };
  } catch (error) {
    throw preserveOrWrapCorruptError(error, file);
  }
}

async function parseDocxFile(
  file: File,
  limits: RemainingExtractionLimits,
): Promise<LocallyParsedFile> {
  let mammoth: MammothModuleLike;
  try {
    mammoth = (await import("mammoth")) as unknown as MammothModuleLike;
  } catch (error) {
    throw parserUnavailableError(file, "DOCX", error);
  }
  const extractRawText =
    mammoth.extractRawText ?? mammoth.default?.extractRawText;
  if (!extractRawText) {
    throw parserUnavailableError(
      file,
      "DOCX",
      new Error("The DOCX parser did not expose extractRawText."),
    );
  }

  try {
    const result = await extractRawText({ arrayBuffer: await file.arrayBuffer() });
    const text = normalizeExtractedText(result.value);
    ensureTextWasExtracted(text, file, "EMPTY_FILE");
    const metrics = extractedTextMetrics(text, file, limits);
    return { text, ...metrics, pageCount: null, pages: [] };
  } catch (error) {
    throw preserveOrWrapCorruptError(error, file);
  }
}

async function parsePdfFile(
  file: File,
  limits: RemainingExtractionLimits,
): Promise<LocallyParsedFile> {
  let pdfjs: PdfModuleLike;
  try {
    pdfjs = (await import("pdfjs-dist")) as unknown as PdfModuleLike;
    if (typeof pdfjs.getDocument !== "function") {
      throw new Error("The PDF parser did not expose getDocument.");
    }
    if (
      typeof window !== "undefined" &&
      pdfjs.GlobalWorkerOptions &&
      !pdfjs.GlobalWorkerOptions.workerSrc
    ) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
    }
  } catch (error) {
    throw parserUnavailableError(file, "PDF", error);
  }

  let document: PdfDocumentLike | null = null;

  try {
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      enableScripting: false,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    document = await loadingTask.promise;

    limits.onPdfPagesDiscovered(document.numPages);
    if (document.numPages > MAX_PDF_PAGES) {
      throw pdfTooManyPagesError(file);
    }

    const pages: LocallyParsedFile["pages"] = [];
    let documentText = "";
    let documentLineCount = 0;
    let documentWordCount = 0;

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = normalizeExtractedText(
        content.items
          .map((item) => textFromPdfItem(item))
          .filter(Boolean)
          .join(""),
      );

      const separatorLength = documentText && pageText ? 2 : 0;
      const separatorLineCount = documentText && pageText ? 1 : 0;
      let pageMetrics: Pick<LocallyParsedFile, "lineCount" | "wordCount"> = {
        lineCount: 0,
        wordCount: 0,
      };
      if (pageText) {
        pageMetrics = extractedTextMetrics(pageText, file, {
          characters:
            limits.characters - documentText.length - separatorLength,
          lines:
            limits.lines - documentLineCount - separatorLineCount,
          words: limits.words - documentWordCount,
        });
      }

      if (documentText && pageText) {
        documentText += "\n\n";
      }
      const startOffset = documentText.length;
      documentText += pageText;
      pages.push({
        pageNumber,
        text: pageText,
        startOffset,
        endOffset: documentText.length,
      });
      if (pageText) {
        documentLineCount += separatorLineCount + pageMetrics.lineCount;
        documentWordCount += pageMetrics.wordCount;
      }
    }

    ensureTextWasExtracted(documentText, file, "SCANNED_NO_TEXT");

    return {
      text: documentText,
      lineCount: documentLineCount,
      wordCount: documentWordCount,
      pageCount: document.numPages,
      pages,
    };
  } catch (error) {
    if (error instanceof AssignmentFileParseError) {
      throw error;
    }
    if (isEncryptedPdfError(error)) {
      throw new AssignmentFileParseError(
        "ENCRYPTED_PDF",
        `"${file.name}" is password-protected and cannot be read locally.`,
        file.name,
        { cause: error },
      );
    }
    throw new AssignmentFileParseError(
      "CORRUPT_DOCUMENT",
      `"${file.name}" could not be read as a PDF.`,
      file.name,
      { cause: error },
    );
  } finally {
    try {
      await document?.destroy?.();
    } catch {
      // PDF.js cleanup is best effort and must not replace a stable parse result.
    }
  }
}

function parserUnavailableError(
  file: File,
  format: "DOCX" | "PDF",
  cause: unknown,
): AssignmentFileParseError {
  return new AssignmentFileParseError(
    "PARSER_UNAVAILABLE",
    `The local ${format} reader is unavailable. Try again or paste the assignment text.`,
    file.name,
    { cause },
  );
}

function textFromPdfItem(item: unknown): string {
  if (!item || typeof item !== "object") {
    return "";
  }
  const candidate = item as PdfTextItemLike;
  if (typeof candidate.str !== "string") {
    return "";
  }
  return `${candidate.str}${candidate.hasEOL === true ? "\n" : " "}`;
}

function ensureTextWasExtracted(
  text: string,
  file: File,
  code: "EMPTY_FILE" | "SCANNED_NO_TEXT",
): void {
  if (text.trim()) {
    return;
  }
  const message =
    code === "SCANNED_NO_TEXT"
      ? `"${file.name}" contains no extractable text and may be a scanned PDF.`
      : `"${file.name}" contains no readable text.`;
  throw new AssignmentFileParseError(code, message, file.name);
}

function extractedTextMetrics(
  text: string,
  file: File | null,
  limits: Pick<RemainingExtractionLimits, "characters" | "lines" | "words">,
): Pick<LocallyParsedFile, "lineCount" | "wordCount"> {
  if (text.length > limits.characters) {
    throw extractedTextTooLargeError(file);
  }

  const lineCount = countExtractedTextLines(text, limits.lines);
  if (lineCount > limits.lines) {
    throw extractedTextTooManyLinesError(file);
  }

  const wordCount = countWords(text, limits.words);
  if (wordCount > limits.words) {
    throw extractedTextTooManyWordsError(file);
  }

  return { lineCount, wordCount };
}

function extractedTextTooLargeError(file: File | null): AssignmentFileParseError {
  return new AssignmentFileParseError(
    "EXTRACTED_TEXT_TOO_LARGE",
    `The selected files contain more than ${MAX_EXTRACTED_TEXT_CHARACTERS.toLocaleString("en-US")} extracted characters. Choose fewer or shorter files.`,
    file?.name ?? null,
  );
}

function extractedTextTooManyLinesError(
  file: File | null,
): AssignmentFileParseError {
  return new AssignmentFileParseError(
    "EXTRACTED_TEXT_TOO_MANY_LINES",
    `The selected files contain more than ${MAX_EXTRACTED_TEXT_LINES.toLocaleString("en-US")} extracted lines. Choose fewer or simpler files.`,
    file?.name ?? null,
  );
}

function extractedTextTooManyWordsError(
  file: File | null,
): AssignmentFileParseError {
  return new AssignmentFileParseError(
    "EXTRACTED_TEXT_TOO_MANY_WORDS",
    `The selected files contain more than ${MAX_EXTRACTED_TEXT_WORDS.toLocaleString("en-US")} extracted words. Choose fewer or shorter files.`,
    file?.name ?? null,
  );
}

function pdfTooManyPagesError(file: File): AssignmentFileParseError {
  return new AssignmentFileParseError(
    "PDF_TOO_MANY_PAGES",
    `"${file.name}" contains more than ${MAX_PDF_PAGES.toLocaleString("en-US")} pages. Choose a shorter PDF or paste only the relevant text.`,
    file.name,
  );
}

function totalPdfPagesTooLargeError(file: File): AssignmentFileParseError {
  return new AssignmentFileParseError(
    "TOTAL_PDF_PAGES_TOO_LARGE",
    `The selected PDF files contain more than ${MAX_TOTAL_PDF_PAGES.toLocaleString("en-US")} pages in total. Choose fewer or shorter PDFs.`,
    file.name,
  );
}

function preserveOrWrapCorruptError(
  error: unknown,
  file: File,
): AssignmentFileParseError {
  if (error instanceof AssignmentFileParseError) {
    return error;
  }
  return new AssignmentFileParseError(
    "CORRUPT_DOCUMENT",
    `"${file.name}" could not be read.`,
    file.name,
    { cause: error },
  );
}

function isEncryptedPdfError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { name?: unknown; message?: unknown };
  const name = typeof candidate.name === "string" ? candidate.name : "";
  const message =
    typeof candidate.message === "string" ? candidate.message : "";
  return name === "PasswordException" || /password|encrypted/i.test(message);
}

function normalizeExtractedText(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countExtractedTextLines(text: string, maximum: number): number {
  if (!text) {
    return 0;
  }

  let lineCount = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 10) {
      continue;
    }
    lineCount += 1;
    if (lineCount > maximum) {
      return lineCount;
    }
  }
  return lineCount;
}

function countWords(text: string, maximum = Number.POSITIVE_INFINITY): number {
  const matcher = /\S+/gu;
  let wordCount = 0;
  while (matcher.exec(text) !== null) {
    wordCount += 1;
    if (wordCount > maximum) {
      return wordCount;
    }
  }
  return wordCount;
}

function mediaTypeForKind(kind: AssignmentFileKind): string {
  if (kind === "txt") {
    return "text/plain";
  }
  if (kind === "pdf") {
    return "application/pdf";
  }
  return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function toTextLines(text: string): TextLine[] {
  const lines: TextLine[] = [];
  let cursor = 0;
  while (cursor <= text.length) {
    if (lines.length >= MAX_EXTRACTED_TEXT_LINES) {
      throw extractedTextTooManyLinesError(null);
    }
    const newlineIndex = text.indexOf("\n", cursor);
    const endOffset = newlineIndex < 0 ? text.length : newlineIndex;
    const raw = text.slice(cursor, endOffset);
    lines.push({
      raw,
      trimmed: raw.trim(),
      startOffset: cursor,
      endOffset,
    });
    if (newlineIndex < 0) {
      break;
    }
    cursor = newlineIndex + 1;
  }
  return lines;
}

function extractTitle(
  lines: TextLine[],
  sources: ParsedAssignmentSource[],
): UploadedSummaryField<string> {
  const labelledPatterns = [
    /^(?:assignment|assessment|report|case study)\s*(?:title|task|brief)?\s*[:\-–—]\s*(.{3,160})$/i,
    /^(?:title|task)\s*[:\-–—]\s*(.{3,160})$/i,
  ];

  for (const line of lines.slice(0, 40)) {
    for (const pattern of labelledPatterns) {
      const match = line.trimmed.match(pattern);
      if (match?.[1]) {
        const value = cleanInlineValue(match[1]);
        return foundField(value, match[1], line, sources);
      }
    }
  }

  const candidate = lines
    .filter((line) => line.trimmed)
    .slice(0, 12)
    .find((line) => isSafeInferredTitle(line.trimmed));

  if (!candidate) {
    return missingField();
  }

  return {
    value: candidate.trimmed,
    raw: candidate.trimmed,
    status: "inferred",
    evidence: evidenceForLine(candidate, sources, candidate.trimmed),
  };
}

function extractDueDate(
  lines: TextLine[],
  sources: ParsedAssignmentSource[],
): UploadedSummaryField<string> {
  for (const line of lines) {
    if (!/(?:due(?:\s+date)?|deadline|submission(?:\s+date)?)/i.test(line.trimmed)) {
      continue;
    }
    const match = line.trimmed.match(DATE_PATTERN);
    if (match?.[0]) {
      return foundField(match[0], match[0], line, sources);
    }
  }
  return missingField();
}

function extractWordCount(
  lines: TextLine[],
  sources: ParsedAssignmentSource[],
): UploadedSummaryField<number> {
  const patterns = [
    /(?:word\s*(?:count|limit)|length)\s*(?:is|required|of)?\s*[:\-–—]?\s*(?:approximately|approx\.?|about|maximum|max\.?|up to)?\s*([\d,]+)\s*words?\b/i,
    /\b([\d,]+)[-\s]?word\s+(?:report|essay|analysis|assignment)\b/i,
  ];

  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.trimmed.match(pattern);
      if (!match?.[1]) {
        continue;
      }
      const value = Number.parseInt(match[1].replace(/,/g, ""), 10);
      if (Number.isFinite(value) && value > 0) {
        return foundField(value, match[0], line, sources);
      }
    }
  }
  return missingField();
}

function extractCitationStyle(
  lines: TextLine[],
  sources: ParsedAssignmentSource[],
): UploadedSummaryField<string> {
  for (const line of lines) {
    if (!/(?:referenc|citat|bibliograph)/i.test(line.trimmed)) {
      continue;
    }
    const match = line.trimmed.match(CITATION_STYLE_PATTERN);
    if (match?.[0]) {
      return foundField(match[0], match[0], line, sources);
    }
  }
  return missingField();
}

function extractRubric(
  lines: TextLine[],
  sources: ParsedAssignmentSource[],
): UploadedRubricSummary {
  const headingIndex = lines.findIndex((line) =>
    RUBRIC_HEADING_PATTERN.test(line.trimmed),
  );
  if (headingIndex < 0) {
    return {
      status: "incomplete",
      criteria: [],
      totalWeight: null,
      message:
        "No reliable rubric section was detected. Rubric analysis is incomplete; no weights were assumed.",
    };
  }

  const criteria: UploadedRubricCriterion[] = [];
  const seenNames = new Set<string>();
  const endIndex = Math.min(lines.length, headingIndex + 41);

  for (let index = headingIndex + 1; index < endIndex; index += 1) {
    const line = lines[index];
    if (criteria.length > 0 && RUBRIC_END_HEADING_PATTERN.test(line.trimmed)) {
      break;
    }
    const parsed = parseRubricCriterionLine(line.trimmed);
    if (!parsed) {
      continue;
    }
    const key = parsed.name.toLocaleLowerCase();
    if (seenNames.has(key)) {
      continue;
    }
    seenNames.add(key);
    criteria.push({
      ...parsed,
      evidence: evidenceForLine(line, sources, parsed.name),
    });
  }

  if (criteria.length === 0) {
    return {
      status: "incomplete",
      criteria: [],
      totalWeight: null,
      message:
        "A rubric heading was found, but no reliable criteria were extracted. Rubric analysis is incomplete; no weights were assumed.",
    };
  }

  const missingWeightCount = criteria.filter(
    (criterion) => criterion.weight === null,
  ).length;
  if (missingWeightCount > 0) {
    return {
      status: "incomplete",
      criteria,
      totalWeight: null,
      message: `Detected ${criteria.length} rubric criteria, but ${missingWeightCount} ${missingWeightCount === 1 ? "weight was" : "weights were"} not explicit. Missing weights remain blank.`,
    };
  }

  const totalWeight = criteria.reduce(
    (total, criterion) => total + (criterion.weight ?? 0),
    0,
  );
  if (Math.abs(totalWeight - 100) > 0.01) {
    return {
      status: "incomplete",
      criteria,
      totalWeight,
      message: `Explicit rubric weights total ${formatWeight(totalWeight)}%, not 100%. Verify whether criteria are missing.`,
    };
  }

  return {
    status: "complete",
    criteria,
    totalWeight,
    message: `Detected ${criteria.length} rubric criteria with explicit weights totalling 100%.`,
  };
}

function parseRubricCriterionLine(
  value: string,
): Pick<UploadedRubricCriterion, "name" | "weight"> | null {
  if (!value) {
    return null;
  }

  const cells = value
    .split(/\s*(?:\||\t)\s*/)
    .map((cell) => cell.trim())
    .filter(Boolean);
  if (cells.length > 1) {
    const weightIndex = cells.findIndex((cell) => /^\(?\d{1,3}(?:\.\d+)?\s*%\)?$/.test(cell));
    if (weightIndex >= 0) {
      const weight = parseExplicitWeight(cells[weightIndex]);
      const possibleName = cells[weightIndex === 0 ? 1 : 0];
      const name = cleanCriterionName(possibleName);
      if (name && weight !== null) {
        return { name, weight };
      }
    }
  }

  const prefixWeight = value.match(
    /^(?:[-*•]\s*)?\(?(\d{1,3}(?:\.\d+)?)\s*%\)?\s*(?:[-–—:|]\s*)?(.{3,100})$/,
  );
  if (prefixWeight) {
    const name = cleanCriterionName(prefixWeight[2]);
    const weight = parseExplicitWeight(prefixWeight[1]);
    if (name && weight !== null) {
      return { name, weight };
    }
  }

  const suffixWeight = value.match(
    /^(?:[-*•]\s*)?(.{3,100}?)\s*(?:[-–—:|]\s*)?\(?(\d{1,3}(?:\.\d+)?)\s*%\)?$/,
  );
  if (suffixWeight) {
    const name = cleanCriterionName(suffixWeight[1]);
    const weight = parseExplicitWeight(suffixWeight[2]);
    if (name && weight !== null) {
      return { name, weight };
    }
  }

  const explicitUnweighted = value.match(
    /^(?:[-*•]\s+|criterion\s*[:\-–—]\s*)(.{3,100})$/i,
  );
  if (explicitUnweighted) {
    const name = cleanCriterionName(explicitUnweighted[1]);
    if (name && name.split(/\s+/).length <= 12) {
      return { name, weight: null };
    }
  }

  return null;
}

function parseExplicitWeight(value: string): number | null {
  const match = value.match(/\d{1,3}(?:\.\d+)?/);
  if (!match) {
    return null;
  }
  const weight = Number.parseFloat(match[0]);
  return weight >= 0 && weight <= 100 ? weight : null;
}

function cleanCriterionName(value: string): string | null {
  const name = value
    .replace(/^[-*•\s]+/, "")
    .replace(/[\s:|\-–—]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (
    name.length < 3 ||
    name.length > 100 ||
    /^(?:criterion|criteria|weight|weighting|descriptor|rubric|total|high distinction|distinction|credit|pass|fail)$/i.test(
      name,
    )
  ) {
    return null;
  }
  return name;
}

function isSafeInferredTitle(value: string): boolean {
  return (
    value.length >= 5 &&
    value.length <= 160 &&
    !/^(?:assignment|assessment)\s+brief$/i.test(value) &&
    !RUBRIC_HEADING_PATTERN.test(value) &&
    !/(?:due(?:\s+date)?|deadline|submission date|word\s*(?:count|limit)|referenc(?:e|ing)\s+style)\s*[:\-–—]/i.test(
      value,
    )
  );
}

function foundField<T>(
  value: T,
  raw: string,
  line: TextLine,
  sources: ParsedAssignmentSource[],
): UploadedSummaryField<T> {
  return {
    value,
    raw: cleanInlineValue(raw),
    status: "found",
    evidence: evidenceForLine(line, sources, raw),
  };
}

function missingField<T>(): UploadedSummaryField<T> {
  return { value: null, raw: null, status: "missing", evidence: null };
}

function evidenceForLine(
  line: TextLine,
  sources: ParsedAssignmentSource[],
  preferredMatch?: string,
): UploadedSourceEvidence {
  const excerpt = excerptForLine(line, preferredMatch);
  const excerptStartOffset = line.startOffset + excerpt.startOffset;
  const excerptEndOffset = line.startOffset + excerpt.endOffset;
  const source = sources.find(
    (candidate) =>
      excerptStartOffset >= candidate.startOffset &&
      excerptStartOffset < candidate.endOffset,
  );
  const page = source?.pages.find(
    (candidate) =>
      excerptStartOffset >= candidate.startOffset &&
      excerptStartOffset < candidate.endOffset,
  );
  return {
    sourceId: source?.id ?? null,
    fileName: source?.fileName ?? null,
    page: page?.pageNumber ?? null,
    excerpt: excerpt.text,
    startOffset: excerptStartOffset,
    endOffset: excerptEndOffset,
  };
}

function excerptForLine(
  line: TextLine,
  preferredMatch?: string,
): { text: string; startOffset: number; endOffset: number } {
  const contentStart = line.raw.search(/\S/u);
  if (contentStart < 0) {
    return { text: "", startOffset: 0, endOffset: 0 };
  }

  let contentEnd = line.raw.length;
  while (contentEnd > contentStart && /\s/u.test(line.raw[contentEnd - 1])) {
    contentEnd -= 1;
  }
  const content = line.raw.slice(contentStart, contentEnd);
  if (content.length <= MAX_EVIDENCE_EXCERPT_CHARACTERS) {
    return {
      text: content,
      startOffset: contentStart,
      endOffset: contentEnd,
    };
  }

  const match = findPreferredMatch(content, preferredMatch);
  if (!match) {
    return {
      text: content.slice(0, MAX_EVIDENCE_EXCERPT_CHARACTERS),
      startOffset: contentStart,
      endOffset: contentStart + MAX_EVIDENCE_EXCERPT_CHARACTERS,
    };
  }

  const matchLength = Math.min(
    match.end - match.start,
    MAX_EVIDENCE_EXCERPT_CHARACTERS,
  );
  const surroundingCharacters =
    MAX_EVIDENCE_EXCERPT_CHARACTERS - matchLength;
  let windowStart = Math.max(
    0,
    match.start - Math.floor(surroundingCharacters / 2),
  );
  let windowEnd = Math.min(
    content.length,
    windowStart + MAX_EVIDENCE_EXCERPT_CHARACTERS,
  );
  windowStart = Math.max(0, windowEnd - MAX_EVIDENCE_EXCERPT_CHARACTERS);
  if (windowEnd < match.end) {
    windowEnd = Math.min(content.length, match.end);
    windowStart = Math.max(0, windowEnd - MAX_EVIDENCE_EXCERPT_CHARACTERS);
  }

  return {
    text: content.slice(windowStart, windowEnd),
    startOffset: contentStart + windowStart,
    endOffset: contentStart + windowEnd,
  };
}

function findPreferredMatch(
  content: string,
  preferredMatch?: string,
): { start: number; end: number } | null {
  const preferred = preferredMatch?.trim();
  if (!preferred) {
    return null;
  }

  const directIndex = content.indexOf(preferred);
  if (directIndex >= 0) {
    return { start: directIndex, end: directIndex + preferred.length };
  }

  const tokens = preferred.split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }
  const flexibleWhitespacePattern = tokens
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const flexibleMatch = new RegExp(flexibleWhitespacePattern, "iu").exec(content);
  return flexibleMatch
    ? {
        start: flexibleMatch.index,
        end: flexibleMatch.index + flexibleMatch[0].length,
      }
    : null;
}

function cleanInlineValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatWeight(weight: number): string {
  return Number.isInteger(weight) ? String(weight) : weight.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
