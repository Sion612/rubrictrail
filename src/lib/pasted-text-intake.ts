import type { PastedTextIntakeError } from "@/lib/ui-types";

export const PASTED_ASSIGNMENT_TEXT_MAX_CHARACTERS = 100_000;
export const PASTED_ASSIGNMENT_TEXT_MAX_LINES = 10_000;
export const PASTED_BRIEF_FILE_NAME = "Pasted assignment brief.txt";
export const PASTED_RUBRIC_FILE_NAME = "Pasted rubric.txt";

export interface PastedAssignmentText {
  brief: string;
  rubric: string;
}

export function validatePastedAssignmentText(
  value: PastedAssignmentText,
): PastedTextIntakeError | null {
  const combinedCharacters = value.brief.length + value.rubric.length;
  if (combinedCharacters > PASTED_ASSIGNMENT_TEXT_MAX_CHARACTERS) {
    return {
      code: "too-many-characters",
      target: "combined",
      message: `Keep the pasted brief and rubric at or below ${PASTED_ASSIGNMENT_TEXT_MAX_CHARACTERS.toLocaleString("en-US")} characters combined.`,
    };
  }
  const combinedLines = countLines(value.brief) + countLines(value.rubric);
  if (combinedLines > PASTED_ASSIGNMENT_TEXT_MAX_LINES) {
    return {
      code: "too-many-lines",
      target: "combined",
      message: `Keep the pasted brief and rubric at or below ${PASTED_ASSIGNMENT_TEXT_MAX_LINES.toLocaleString("en-US")} lines combined. Remove repeated or unrelated content, then try again.`,
    };
  }
  if (!value.brief.replace(/^\uFEFF/, "").replace(/\u0000/g, "").trim()) {
    return {
      code: "brief-required",
      target: "brief",
      message: "Paste the assignment brief or instructions before continuing.",
    };
  }
  return null;
}

function countLines(value: string): number {
  if (!value) return 0;
  let lines = 1;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 13 || (code === 10 && value.charCodeAt(index - 1) !== 13)) {
      lines += 1;
    }
  }
  return lines;
}

export function createPastedAssignmentFiles(
  value: PastedAssignmentText,
): File[] {
  const issue = validatePastedAssignmentText(value);
  if (issue) {
    throw new Error(issue.message);
  }

  const files = [
    new File([value.brief], PASTED_BRIEF_FILE_NAME, {
      type: "text/plain",
      lastModified: 0,
    }),
  ];
  if (value.rubric.trim()) {
    files.push(
      new File([value.rubric], PASTED_RUBRIC_FILE_NAME, {
        type: "text/plain",
        lastModified: 0,
      }),
    );
  }
  return files;
}
