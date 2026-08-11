import { z } from "zod";
import {
  assignmentAnalysisSchema,
  draftCheckResultSchema,
  rubricTrailFixtureSchema,
  type AssignmentAnalysis,
  type DraftCheckResult,
  type SourceDocument,
} from "@/lib/domain";

export const LIVE_BRIEF_DOCUMENT_ID = "uploaded-brief";
export const LIVE_RUBRIC_DOCUMENT_ID = "uploaded-rubric";
export const LIVE_DRAFT_ID = "live-draft-input";

export const liveAssignmentOutputSchema = z
  .object(assignmentAnalysisSchema.shape)
  .omit({ sourceDocuments: true })
  .strict();

interface LiveAssignmentSourceInput {
  assignmentText: string;
  rubricText?: string;
  fileName?: string;
}

interface LiveDraftValidationInput {
  assignment: AssignmentAnalysis;
  draftText: string;
  section: string;
}

export function buildCanonicalSourceDocuments(
  input: LiveAssignmentSourceInput,
): SourceDocument[] {
  const documents: SourceDocument[] = [
    {
      id: LIVE_BRIEF_DOCUMENT_ID,
      name: input.fileName?.trim() || "Uploaded assignment brief",
      kind: "brief",
      mimeType: "text/plain",
      content: input.assignmentText,
    },
  ];

  if (input.rubricText?.trim()) {
    documents.push({
      id: LIVE_RUBRIC_DOCUMENT_ID,
      name: "Uploaded marking rubric",
      kind: "rubric",
      mimeType: "text/plain",
      content: input.rubricText,
    });
  }

  return documents;
}

export function validateLiveAssignmentOutput(
  value: unknown,
  input: LiveAssignmentSourceInput,
): AssignmentAnalysis {
  const output = liveAssignmentOutputSchema.parse(value);
  return assignmentAnalysisSchema.parse({
    ...output,
    sourceDocuments: buildCanonicalSourceDocuments(input),
  });
}

export function validateLiveDraftOutput(
  value: unknown,
  input: LiveDraftValidationInput,
): DraftCheckResult {
  const draftCheck = draftCheckResultSchema.parse(value);
  const fixture = rubricTrailFixtureSchema.parse({
    assignment: input.assignment,
    draft: {
      id: LIVE_DRAFT_ID,
      assignmentId: input.assignment.id,
      sectionId: input.section,
      sectionLabel: input.section,
      text: input.draftText,
    },
    draftCheck,
  });

  return fixture.draftCheck;
}
