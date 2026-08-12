import {
  ASSIGNMENT_EXTRACTED_TEXT_MAX_CHARACTERS,
  ASSIGNMENT_EXTRACTED_TEXT_MAX_LINES,
  ASSIGNMENT_EXTRACTED_TEXT_MAX_WORDS,
  ASSIGNMENT_PDF_MAX_PAGES,
  ASSIGNMENT_PDFS_MAX_TOTAL_PAGES,
  type AssignmentFileErrorCode,
} from "@/lib/files/parse-assignment-files";

const FILE_ISSUE_REASONS: Record<AssignmentFileErrorCode, string> = {
  UNSUPPORTED_FILE_TYPE: "The format is not supported; use PDF, DOCX or TXT.",
  INVALID_FILE_NAME: "The file name is blank or longer than 255 characters.",
  FILE_TOO_LARGE: "The file is larger than the 10 MiB per-file limit.",
  TOO_MANY_FILES: "The selection contains more than 10 files.",
  TOTAL_FILE_SIZE_TOO_LARGE: "The selection is larger than the 25 MiB combined limit.",
  EXTRACTED_TEXT_TOO_LARGE: `The readable text is longer than the ${ASSIGNMENT_EXTRACTED_TEXT_MAX_CHARACTERS.toLocaleString("en-US")}-character combined limit.`,
  EXTRACTED_TEXT_TOO_MANY_LINES: `The readable text contains more than ${ASSIGNMENT_EXTRACTED_TEXT_MAX_LINES.toLocaleString("en-US")} lines in total.`,
  EXTRACTED_TEXT_TOO_MANY_WORDS: `The readable text contains more than ${ASSIGNMENT_EXTRACTED_TEXT_MAX_WORDS.toLocaleString("en-US")} words in total.`,
  PDF_TOO_MANY_PAGES: `The PDF contains more than ${ASSIGNMENT_PDF_MAX_PAGES.toLocaleString("en-US")} pages.`,
  TOTAL_PDF_PAGES_TOO_LARGE: `The selected PDFs contain more than ${ASSIGNMENT_PDFS_MAX_TOTAL_PAGES.toLocaleString("en-US")} pages combined.`,
  EMPTY_FILE: "No readable text was found.",
  SCANNED_NO_TEXT: "No selectable text was found; this may be a scan.",
  ENCRYPTED_PDF: "The PDF is password-protected.",
  PARSER_UNAVAILABLE: "The local document reader is unavailable.",
  CORRUPT_DOCUMENT: "The document could not be read.",
};

export function assignmentFileIssueReason(
  code: AssignmentFileErrorCode,
): string {
  return FILE_ISSUE_REASONS[code];
}
