import type { AssignmentFileErrorCode } from "@/lib/files/parse-assignment-files";

const FILE_ISSUE_REASONS: Record<AssignmentFileErrorCode, string> = {
  UNSUPPORTED_FILE_TYPE: "The format is not supported; use PDF, DOCX or TXT.",
  INVALID_FILE_NAME: "The file name is blank or longer than 255 characters.",
  FILE_TOO_LARGE: "The file is larger than the 10 MB per-file limit.",
  TOO_MANY_FILES: "The selection contains more than 10 files.",
  TOTAL_FILE_SIZE_TOO_LARGE: "The selection is larger than the 25 MB combined limit.",
  EXTRACTED_TEXT_TOO_LARGE: "The readable-text limit was reached.",
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
