import {
  buildUploadedAssignmentSummary,
  type AssignmentFileKind,
  type AssignmentSourceOrigin,
  type ParsedAssignmentFiles,
  type ParsedAssignmentPage,
  type ParsedAssignmentSource,
} from "@/lib/files/parse-assignment-files";
import type {
  AssignmentIntakeMode,
  UploadFlowResult,
} from "@/lib/ui-types";

interface FixtureSource {
  id: string;
  fileName: string;
  kind: AssignmentFileKind;
  origin: AssignmentSourceOrigin;
  intakeMethod: AssignmentIntakeMode;
  text?: string;
  pages?: string[];
}

function countWords(text: string): number {
  return text.match(/\S+/gu)?.length ?? 0;
}

export function sourceAwareUploadFixture(
  fixtureSources: FixtureSource[],
): UploadFlowResult {
  if (!fixtureSources.length) throw new Error("Fixture requires at least one source.");
  const intakeMethod = fixtureSources[0].intakeMethod;
  if (fixtureSources.some((source) => source.intakeMethod !== intakeMethod)) {
    throw new Error("One intake result cannot mix file and paste sources.");
  }

  let mergedText = "";
  const parsedSources: ParsedAssignmentSource[] = fixtureSources.map((fixture, index) => {
    if (index > 0) mergedText += "\n\n";
    const startOffset = mergedText.length;
    const sourceText = fixture.pages?.join("\n") ?? fixture.text ?? "";
    const pages: ParsedAssignmentPage[] = [];
    if (fixture.pages) {
      let pageOffset = startOffset;
      fixture.pages.forEach((pageText, pageIndex) => {
        pages.push({
          pageNumber: pageIndex + 1,
          text: pageText,
          startOffset: pageOffset,
          endOffset: pageOffset + pageText.length,
        });
        pageOffset += pageText.length + (pageIndex < fixture.pages!.length - 1 ? 1 : 0);
      });
    }
    mergedText += sourceText;
    return {
      id: fixture.id,
      fileName: fixture.fileName,
      kind: fixture.kind,
      origin: fixture.origin,
      mediaType: "application/x-rubrictrail-test-fixture",
      sizeBytes: new TextEncoder().encode(sourceText).byteLength,
      lastModified: null,
      text: sourceText,
      wordCount: countWords(sourceText),
      startOffset,
      endOffset: startOffset + sourceText.length,
      pageCount: fixture.kind === "pdf" ? fixture.pages?.length ?? 1 : null,
      pages,
    };
  });
  const parsed: ParsedAssignmentFiles = {
    text: mergedText,
    sources: parsedSources,
    totalBytes: parsedSources.reduce((total, source) => total + source.sizeBytes, 0),
    wordCount: countWords(mergedText),
  };
  return {
    intakeMethod,
    fileNames: parsedSources.map((source) => source.fileName),
    sources: parsedSources.map((source) => ({
      id: source.id,
      fileName: source.fileName,
      kind: source.kind,
      origin: source.origin,
      intakeMethod,
      pageCount: source.pageCount,
    })),
    skippedFiles: [],
    totalWords: parsed.wordCount,
    summary: buildUploadedAssignmentSummary(parsed),
  };
}

export function sourceAwareTextUpload(
  text: string,
  fileName = "brief.txt",
): UploadFlowResult {
  return sourceAwareUploadFixture([
    {
      id: "source-1",
      fileName,
      kind: "txt",
      origin: "extracted",
      intakeMethod: "files",
      text,
    },
  ]);
}
