import { describe, expect, it } from "vitest";

import { buildDashboardProjectFixture } from "./multi-assignment-dashboard.test-fixtures";
import { dashboardProjectsFromWorkspaceSnapshot } from "./workspace-read-model";

import type { WorkspaceAuthoritySnapshot } from "@/lib/workspace-storage/coordinator";
import type { WorkspaceProjectRecordV1 } from "@/lib/workspace-storage/types";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function activeRecord(
  projectId: string,
  state: ReturnType<typeof buildDashboardProjectFixture>["state"],
): WorkspaceProjectRecordV1 {
  return {
    formatVersion: 1,
    workspaceId: WORKSPACE_ID,
    workspaceGeneration: 4,
    projectId,
    revision: 2,
    value: { kind: "project", state },
  };
}

describe("dashboardProjectsFromWorkspaceSnapshot", () => {
  it("uses authoritative index order and excludes tombstones", () => {
    const projectA = buildDashboardProjectFixture({
      projectId: PROJECT_A,
      title: "Fictional alpha assignment",
      course: "Fictional course A",
      dueDate: "2026-09-10",
    });
    const projectB = buildDashboardProjectFixture({
      projectId: PROJECT_B,
      title: "Fictional beta assignment",
      course: "Fictional course B",
      dueDate: "2026-09-12",
    });
    const snapshot: WorkspaceAuthoritySnapshot = {
      index: {
        formatVersion: 1,
        workspaceId: WORKSPACE_ID,
        workspaceGeneration: 4,
        revision: 8,
        status: "active",
        projects: [
          { projectId: PROJECT_B, kind: "active" },
          { projectId: PROJECT_A, kind: "active" },
          {
            projectId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            kind: "tombstone",
          },
        ],
        legacyFingerprints: { record: null, v3: null, v2: null, v1: null },
      },
      indexRaw: "fictional-index",
      indexDigest: "a".repeat(64),
      projects: [
        {
          key: "fictional-a",
          raw: "fictional-a",
          digest: "b".repeat(64),
          record: activeRecord(PROJECT_A, projectA.state),
        },
        {
          key: "fictional-tombstone",
          raw: "fictional-tombstone",
          digest: "c".repeat(64),
          record: {
            formatVersion: 1,
            workspaceId: WORKSPACE_ID,
            workspaceGeneration: 4,
            projectId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            revision: 3,
            value: { kind: "tombstone" },
          },
        },
        {
          key: "fictional-b",
          raw: "fictional-b",
          digest: "e".repeat(64),
          record: activeRecord(PROJECT_B, projectB.state),
        },
      ],
    };

    const projects = dashboardProjectsFromWorkspaceSnapshot(snapshot);

    expect(projects.map((project) => project.projectId)).toEqual([
      PROJECT_B,
      PROJECT_A,
    ]);
    expect(projects[0]?.state.uploadedProject?.title).toBe(
      "Fictional beta assignment",
    );
  });

  it("fails visibly instead of hiding an impossible active no-project record", () => {
    const noProject = buildDashboardProjectFixture({
      projectId: PROJECT_C,
      title: "Not rendered",
      course: "Not rendered",
      dueDate: "2026-09-14",
      kind: "none",
    });
    const snapshot: WorkspaceAuthoritySnapshot = {
      index: {
        formatVersion: 1,
        workspaceId: WORKSPACE_ID,
        workspaceGeneration: 4,
        revision: 8,
        status: "active",
        projects: [{ projectId: PROJECT_C, kind: "active" }],
        legacyFingerprints: { record: null, v3: null, v2: null, v1: null },
      },
      indexRaw: "fictional-index",
      indexDigest: "a".repeat(64),
      projects: [
        {
          key: "fictional-none",
          raw: "fictional-none",
          digest: "d".repeat(64),
          record: activeRecord(PROJECT_C, noProject.state),
        },
      ],
    };

    expect(() => dashboardProjectsFromWorkspaceSnapshot(snapshot)).toThrow(
      "cannot contain a no-project state",
    );
  });
});
