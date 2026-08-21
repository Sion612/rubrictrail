import { SAMPLE_PLANNING_BASELINE_DATE } from "@/lib/sample-data";
import type { PersistedProjectState } from "@/lib/ui-types";

const CANONICAL_UTC_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function planningDateFromCanonicalUtcTimestamp(value: string): string {
  const match = CANONICAL_UTC_TIMESTAMP_PATTERN.exec(value);
  const instant = new Date(value);
  if (!match || Number.isNaN(instant.getTime()) || instant.toISOString() !== value) {
    throw new Error(
      "Uploaded project creation timestamp must be a canonical UTC ISO timestamp.",
    );
  }
  return match[1];
}

/**
 * Derives the stable plan-generation baseline from existing project data.
 * This is not the current date and is never written back to persistence.
 * Uploaded projects use the UTC calendar date encoded by their canonical
 * createdAt value because the original browser timezone was never persisted.
 */
export function projectPlanningBaselineDate(
  project: PersistedProjectState,
  fallbackCurrentDate: string,
): string {
  if (project.projectKind === "sample") return SAMPLE_PLANNING_BASELINE_DATE;
  if (project.projectKind === "uploaded" && project.uploadedProject) {
    return planningDateFromCanonicalUtcTimestamp(project.uploadedProject.createdAt);
  }
  return fallbackCurrentDate;
}
