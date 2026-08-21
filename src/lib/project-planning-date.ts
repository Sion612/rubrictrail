import { browserLocalDate } from "@/lib/date-only";
import { SAMPLE_PLANNING_BASELINE_DATE } from "@/lib/sample-data";
import type { PersistedProjectState } from "@/lib/ui-types";

/**
 * Derives the stable plan-generation baseline from existing project data.
 * This is not the current date and is never written back to persistence.
 */
export function projectPlanningBaselineDate(
  project: PersistedProjectState,
  fallbackCurrentDate = browserLocalDate(),
): string {
  if (project.projectKind === "sample") return SAMPLE_PLANNING_BASELINE_DATE;
  if (project.projectKind === "uploaded" && project.uploadedProject) {
    const createdAt = new Date(project.uploadedProject.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error("Validated uploaded project has an invalid creation timestamp.");
    }
    return browserLocalDate(createdAt);
  }
  return fallbackCurrentDate;
}
