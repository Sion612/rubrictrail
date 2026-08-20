import type {
  PersistedProjectState,
  ProjectKind,
  UploadedProject,
} from "@/lib/ui-types";

import type { WorkspaceDashboardProject } from "./dashboard-model";

export interface FictionalProjectInput {
  projectId: string;
  assignmentId?: string;
  title: string;
  course: string;
  dueDate: string;
  kind?: ProjectKind;
  completedTaskIds?: string[];
}

function buildUploadedProject(
  input: FictionalProjectInput,
  assignmentId: string,
): UploadedProject {
  return {
    id: assignmentId,
    title: input.title,
    course: input.course,
    dueDate: input.dueDate,
    wordCount: 1_500,
    citationStyle: "Harvard",
    fileNames: ["fictional-assignment.txt"],
    sources: [
      {
        id: "source-1",
        fileName: "fictional-assignment.txt",
        kind: "txt",
        origin: "extracted",
        intakeMethod: "files",
        pageCount: null,
      },
    ],
    extractedWordCount: 240,
    weightingStatus: "complete",
    criteria: [
      {
        id: "fictional-criterion",
        name: "Fictional analysis",
        weight: 100,
        evidence: null,
        manualSourceLocator: null,
      },
    ],
    createdAt: "2026-08-19T12:00:00.000Z",
  };
}

/** Test-only deterministic state record for dashboard and dormant harness tests. */
export function buildDashboardProjectFixture(
  input: FictionalProjectInput,
): WorkspaceDashboardProject {
  const assignmentId = input.assignmentId ?? `assignment-${input.projectId}`;
  const kind = input.kind ?? "uploaded";
  const uploadedProject =
    kind === "uploaded" ? buildUploadedProject(input, assignmentId) : null;
  const state: PersistedProjectState = {
    version: 3,
    supersededV2Fingerprint: null,
    projectKind: kind,
    uploadedProject,
    view: "overview",
    visitedViews: kind === "none" ? [] : ["overview"],
    completedTaskIds: input.completedTaskIds ?? [],
    weeklyHours: 8,
    targetGrade: 70,
    draftText: "Fictional student-owned draft text.",
    selectedSectionId: "fictional-section",
    draftResult: null,
    checkedDraftText: null,
    uploadedCriterionReviews: [],
    readinessChecks: [],
  };

  return { projectId: input.projectId, state };
}
