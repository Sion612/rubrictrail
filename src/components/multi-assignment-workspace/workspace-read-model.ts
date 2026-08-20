import type { WorkspaceDashboardProject } from "./dashboard-model";

import type { WorkspaceAuthoritySnapshot } from "@/lib/workspace-storage/coordinator";

/**
 * Bridges the strict coordinator snapshot to the pure Dashboard model.
 * Index order remains the only workspace ordering input. Tombstones are not
 * cards; an impossible active/no-project mismatch fails visibly instead of
 * hiding authoritative bytes behind an empty Dashboard.
 */
export function dashboardProjectsFromWorkspaceSnapshot(
  snapshot: WorkspaceAuthoritySnapshot,
): WorkspaceDashboardProject[] {
  const recordsById = new Map(
    snapshot.projects.map((project) => [project.record.projectId, project]),
  );

  return snapshot.index.projects.flatMap((entry) => {
    if (entry.kind !== "active") return [];
    const project = recordsById.get(entry.projectId);
    if (!project || project.record.value.kind !== "project") {
      throw new Error("Active workspace index entry has no active project record.");
    }
    if (project.record.value.state.projectKind === "none") {
      throw new Error("Active workspace project cannot contain a no-project state.");
    }
    return [
      {
        projectId: entry.projectId,
        state: project.record.value.state,
      },
    ];
  });
}
