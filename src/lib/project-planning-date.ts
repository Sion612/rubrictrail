import { z } from "zod";

import { SAMPLE_PLANNING_BASELINE_DATE } from "@/lib/sample-data";
import type { PersistedProjectState } from "@/lib/ui-types";

// Keep this validation aligned with UploadedProject.createdAt in local-state.
// Persisted v0.8.0 data may use any ISO datetime representation with an offset.
const persistedCreationInstantSchema = z.string().datetime({ offset: true });

function planningDateFromPersistedCreationInstant(value: string): string {
  const parsed = persistedCreationInstantSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Uploaded project creation timestamp must be a valid ISO timestamp.");
  }
  const instant = new Date(parsed.data);
  if (Number.isNaN(instant.getTime())) {
    throw new Error("Uploaded project creation timestamp must identify a valid instant.");
  }
  return instant.toISOString().slice(0, 10);
}

/**
 * Derives the stable plan-generation baseline from existing project data.
 * This is not the current date and is never written back to persistence.
 * Uploaded projects normalize their persisted creation instant to its UTC
 * calendar date because the original browser timezone was never persisted.
 */
export function projectPlanningBaselineDate(
  project: PersistedProjectState,
  fallbackCurrentDate: string,
): string {
  if (project.projectKind === "sample") return SAMPLE_PLANNING_BASELINE_DATE;
  if (project.projectKind === "uploaded" && project.uploadedProject) {
    return planningDateFromPersistedCreationInstant(project.uploadedProject.createdAt);
  }
  return fallbackCurrentDate;
}
