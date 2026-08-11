const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export const ASSIGNMENT_FILE_MAX_BYTES = MAX_FILE_SIZE_BYTES;

export type AssignmentFileErrorCode =
  | "UNSUPPORTED_FILE_TYPE"
  | "FILE_TOO_LARGE"
  | "EMPTY_FILE"
  | "SCANNED_NO_TEXT"
  | "ENCRYPTED_PDF"
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

export interface ParsedAssignmentFiles {
  text: string;
  sources: ParsedAssignmentSource[];
  totalBytes: number;
  wordCount: number;
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
  pageCount: number | null;
  pages: Array<{
    pageNumber: number;
    text: string;
    startOffset: number;
    endOffset: number;
  }>;
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

  const validatedFiles = files.map((file) => ({
    file,
    kind: validateFile(file),
  }));

  const parsedFiles: Array<{
    file: File;
    kind: AssignmentFileKind;
    parsed: LocallyParsedFile;
  }> = [];

  // Keep input order stable and avoid loading several large documents at once.
  for (const { file, kind } of validatedFiles) {
    parsedFiles.push({
      file,
      kind,
      parsed: await parseSingleFile(file, kind),
    });
  }

  let mergedText = "";
  const sources: ParsedAssignmentSource[] = [];

  parsedFiles.forEach(({ file, kind, parsed }, index) => {
    if (index > 0) {
      mergedText += "\n\n";
    }

    const startOffset = mergedText.length;
    mergedText += parsed.text;
    const endOffset = mergedText.length;

    sources.push({
      id: `source-${index + 1}`,
      fileName: file.name,
      kind,
      mediaType: file.type || mediaTypeForKind(kind),
      sizeBytes: file.size,
      lastModified:
        typeof file.lastModified === "number" ? file.lastModified : null,
      text: parsed.text,
      wordCount: countWords(parsed.text),
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
    totalBytes: files.reduce((total, file) => total + file.size, 0),
    wordCount: countWords(mergedText),
  };
}

/**
 * A conservative, deterministic fallback for uploaded documents. It only
 * returns values present in the source text. Missing rubric weights remain
 * null; no weighting or grading data is inferred.
 */
export function buildUploadedAssignmentSummary(
  input: ParsedAssignmentFiles | string,
): UploadedAssignmentSummary {
  const text = typeof input === "string" ? normalizeExtractedText(input) : input.text;
  const sources = typeof input === "string" ? [] : input.sources;
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
      `"${file.name}" is larger than the 10 MB per-file limit.`,
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
): Promise<LocallyParsedFile> {
  if (kind === "txt") {
    return parseTextFile(file);
  }
  if (kind === "docx") {
    return parseDocxFile(file);
  }
  return parsePdfFile(file);
}

async function parseTextFile(file: File): Promise<LocallyParsedFile> {
  try {
    const bytes = await file.arrayBuffer();
    const text = normalizeExtractedText(new TextDecoder("utf-8").decode(bytes));
    ensureTextWasExtracted(text, file, "EMPTY_FILE");
    return { text, pageCount: null, pages: [] };
  } catch (error) {
    throw preserveOrWrapCorruptError(error, file);
  }
}

async function parseDocxFile(file: File): Promise<LocallyParsedFile> {
  try {
    const mammoth = (await import("mammoth")) as unknown as MammothModuleLike;
    const extractRawText =
      mammoth.extractRawText ?? mammoth.default?.extractRawText;
    if (!extractRawText) {
      throw new Error("The DOCX parser did not expose extractRawText.");
    }

    const result = await extractRawText({ arrayBuffer: await file.arrayBuffer() });
    const text = normalizeExtractedText(result.value);
    ensureTextWasExtracted(text, file, "EMPTY_FILE");
    return { text, pageCount: null, pages: [] };
  } catch (error) {
    throw preserveOrWrapCorruptError(error, file);
  }
}

async function parsePdfFile(file: File): Promise<LocallyParsedFile> {
  let document: PdfDocumentLike | null = null;

  try {
    const pdfjs = (await import("pdfjs-dist")) as unknown as PdfModuleLike;
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

    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      enableScripting: false,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    document = await loadingTask.promise;

    const pages: LocallyParsedFile["pages"] = [];
    let documentText = "";

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = normalizeExtractedText(
        content.items
          .map((item) => textFromPdfItem(item))
          .filter(Boolean)
          .join(""),
      );

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
    }

    documentText = normalizeExtractedText(documentText);
    ensureTextWasExtracted(documentText, file, "SCANNED_NO_TEXT");

    return {
      text: documentText,
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
    await document?.destroy?.();
  }
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

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
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
  let cursor = 0;
  return text.split("\n").map((raw) => {
    const line = {
      raw,
      trimmed: raw.trim(),
      startOffset: cursor,
      endOffset: cursor + raw.length,
    };
    cursor += raw.length + 1;
    return line;
  });
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
    evidence: evidenceForLine(candidate, sources),
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
      evidence: evidenceForLine(line, sources),
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
    evidence: evidenceForLine(line, sources),
  };
}

function missingField<T>(): UploadedSummaryField<T> {
  return { value: null, raw: null, status: "missing", evidence: null };
}

function evidenceForLine(
  line: TextLine,
  sources: ParsedAssignmentSource[],
): UploadedSourceEvidence {
  const source = sources.find(
    (candidate) =>
      line.startOffset >= candidate.startOffset &&
      line.startOffset < candidate.endOffset,
  );
  const page = source?.pages.find(
    (candidate) =>
      line.startOffset >= candidate.startOffset &&
      line.startOffset < candidate.endOffset,
  );
  return {
    sourceId: source?.id ?? null,
    fileName: source?.fileName ?? null,
    page: page?.pageNumber ?? null,
    excerpt: line.trimmed,
    startOffset: line.startOffset,
    endOffset: line.endOffset,
  };
}

function cleanInlineValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatWeight(weight: number): string {
  return Number.isInteger(weight) ? String(weight) : weight.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
