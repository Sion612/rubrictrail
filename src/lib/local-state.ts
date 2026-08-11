import type { PersistedProjectState, WorkspaceView } from "@/lib/ui-types";
import { SAMPLE_DRAFT_TEXT } from "@/lib/sample-data";

export const STORAGE_KEY = "rubrictrail.project.v2";
const LEGACY_STORAGE_KEY = "proofline.project.v1";

const VIEWS: WorkspaceView[] = ["overview", "rubric", "plan", "draft", "progress"];

export function createDefaultProjectState(): PersistedProjectState {
  return {
    version: 2,
    projectKind: "none",
    uploadedProject: null,
    view: "overview",
    visitedViews: [],
    completedTaskIds: [],
    weeklyHours: 10,
    targetGrade: 70,
    draftText: SAMPLE_DRAFT_TEXT,
    selectedSectionId: "analysis-recommendations",
    draftResult: null,
    checkedDraftText: null,
    uploadedCriterionReviews: [],
    readinessChecks: [],
  };
}

export const DEFAULT_PROJECT_STATE = createDefaultProjectState();

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeState(candidate: Partial<PersistedProjectState>): PersistedProjectState {
  const fallback = createDefaultProjectState();
  const view = VIEWS.includes(candidate.view as WorkspaceView)
    ? (candidate.view as WorkspaceView)
    : "overview";
  return {
    ...fallback,
    ...candidate,
    version: 2,
    projectKind:
      candidate.projectKind === "sample" || candidate.projectKind === "uploaded"
        ? candidate.projectKind
        : "none",
    uploadedProject:
      candidate.uploadedProject && typeof candidate.uploadedProject === "object"
        ? candidate.uploadedProject
        : null,
    view,
    visitedViews: strings(candidate.visitedViews).filter((item): item is WorkspaceView =>
      VIEWS.includes(item as WorkspaceView),
    ),
    completedTaskIds: strings(candidate.completedTaskIds),
    readinessChecks: strings(candidate.readinessChecks),
    selectedSectionId:
      candidate.selectedSectionId === "analysis-and-recommendations"
        ? "analysis-recommendations"
        : candidate.selectedSectionId || fallback.selectedSectionId,
    uploadedCriterionReviews: Array.isArray(candidate.uploadedCriterionReviews)
      ? candidate.uploadedCriterionReviews
      : [],
  };
}

function migrateLegacy(raw: string): PersistedProjectState {
  try {
    const legacy = JSON.parse(raw) as Record<string, unknown>;
    return normalizeState({
      projectKind: legacy.sampleLoaded === true ? "sample" : "none",
      view: legacy.view as WorkspaceView,
      completedTaskIds: strings(legacy.completedTaskIds),
      weeklyHours: typeof legacy.weeklyHours === "number" ? legacy.weeklyHours : 10,
      targetGrade: typeof legacy.targetGrade === "number" ? legacy.targetGrade : 70,
      draftText: typeof legacy.draftText === "string" ? legacy.draftText : SAMPLE_DRAFT_TEXT,
      selectedSectionId:
        typeof legacy.selectedSectionId === "string"
          ? legacy.selectedSectionId
          : "analysis-recommendations",
      draftResult: (legacy.draftResult as PersistedProjectState["draftResult"]) ?? null,
      checkedDraftText:
        typeof legacy.checkedDraftText === "string" ? legacy.checkedDraftText : null,
      readinessChecks: strings(legacy.readinessChecks),
    });
  } catch {
    return createDefaultProjectState();
  }
}

export function readProjectState(): PersistedProjectState {
  if (typeof window === "undefined") return createDefaultProjectState();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const candidate = JSON.parse(raw) as Partial<PersistedProjectState>;
      if (candidate.version === 2) return normalizeState(candidate);
    }
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    return legacy ? migrateLegacy(legacy) : createDefaultProjectState();
  } catch {
    return createDefaultProjectState();
  }
}

export function writeProjectState(state: PersistedProjectState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage may be unavailable in private or restricted browser contexts.
  }
}

export function clearProjectState(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Reset still succeeds in memory when browser storage is unavailable.
  }
}
