import { expect, test, type Page } from "@playwright/test";

import {
  APP_PATH,
  assignmentPageHeading,
  createSampleAssignment,
  expectActiveWorkspaceProjectCount,
  expectNoHorizontalOverflow,
  openNewAssignment,
  resetWorkspace,
  returnToAssignments,
  workspaceLanguageSwitcher,
} from "./workspace-helpers";

const PASTED_BRIEF = [
  "Assignment title: Fictional Operations Memo",
  "Deadline: 24 September 2026",
  "Word count: 1200 words",
  "Use APA 7 referencing.",
].join("\n");

const PASTED_RUBRIC = [
  "Rubric",
  "Analysis | 60%",
  "Communication | 40%",
].join("\n");

async function createPastedAssignment(page: Page) {
  await openNewAssignment(page, "paste");
  await page.getByTestId("pasted-assignment-brief").fill(PASTED_BRIEF);
  await page.getByTestId("pasted-assignment-rubric").fill(PASTED_RUBRIC);
  await page.getByRole("button", { name: "Review assignment details" }).click();
  await expect(page.getByRole("heading", { name: "Confirm what the assignment says." })).toBeVisible();
  await page.getByTestId("create-project").click();
  await expectActiveWorkspaceProjectCount(page, 2);
  await expect(assignmentPageHeading(page, "Fictional Operations Memo")).toBeVisible();
}

async function expectLiveBoundary(page: Page) {
  for (const route of ["assignment", "draft"]) {
    const response = await page.request.post(`${APP_PATH}api/live/${route}`, { data: {} });
    expect(response.status(), route).toBeGreaterThanOrEqual(400);
  }
}

interface StoredWorkspaceProjectEntry {
  projectId: string;
  kind: "active" | "tombstone";
}

interface StoredWorkspaceIndex {
  workspaceId: string;
  workspaceGeneration: number;
  revision: number;
  status: "active" | "cleared";
  projects: StoredWorkspaceProjectEntry[];
}

async function readWorkspaceIndex(page: Page): Promise<StoredWorkspaceIndex> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("rubrictrail.workspace.index.v1");
    if (raw === null) throw new Error("Workspace index is missing");
    return JSON.parse(raw) as StoredWorkspaceIndex;
  });
}

async function readAllLocalStorage(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => Object.fromEntries(
    Array.from(
      { length: window.localStorage.length },
      (_, index) => window.localStorage.key(index),
    )
      .filter((key): key is string => key !== null)
      .sort()
      .map((key) => [key, window.localStorage.getItem(key) ?? ""]),
  ));
}

async function holdNextWorkspaceLock(page: Page) {
  await page.evaluate(() => {
    const manager = navigator.locks;
    const originalRequest = manager.request.bind(manager);
    let releaseGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    Object.defineProperty(window, "__releaseRubricTrailLifecycleLock", {
      configurable: true,
      value: releaseGate,
    });
    Object.defineProperty(manager, "request", {
      configurable: true,
      value: (...args: unknown[]) =>
        gate.then(() => Reflect.apply(originalRequest, manager, args)),
    });
  });
}

async function releaseWorkspaceLock(page: Page) {
  await page.evaluate(() => {
    const release = Reflect.get(window, "__releaseRubricTrailLifecycleLock");
    if (typeof release !== "function") {
      throw new Error("Lifecycle lock gate is missing");
    }
    release();
  });
}

test.beforeEach(async ({ page }) => {
  await resetWorkspace(page);
});

test("My assignments keeps two independent local assignments across dashboard, reload, locale and viewports", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const externalRequests: string[] = [];
  const origin = new URL(testInfo.project.use.baseURL as string).origin;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== origin) {
      externalRequests.push(request.url());
    }
  });

  // The dashboard creation menu is keyboard-operable and restores its opener.
  const newButton = page.getByRole("button", { name: "New assignment", exact: true }).first();
  await newButton.click();
  await expect(page.getByRole("button", { name: "Upload assignment files", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(newButton).toBeFocused();

  await createSampleAssignment(page);
  await expect(assignmentPageHeading(
    page,
    "Reducing Collection Delays at LumaLane Market",
  )).toBeVisible();
  await page.getByRole("button", { name: /Plan/ }).first().click();
  await page.getByTestId("task-p1").getByRole("checkbox").check();
  await returnToAssignments(page);

  await createPastedAssignment(page);
  await returnToAssignments(page);
  await expect(page.getByRole("heading", { name: "My assignments" })).toBeVisible();
  await expect(page.getByText("2 assignments", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "Reducing Collection Delays at LumaLane Market",
    exact: true,
  })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "Fictional Operations Memo",
    exact: true,
  })).toBeVisible();
  expect(await page.locator("progress[aria-label*='Reducing Collection Delays']")
    .evaluate((element: HTMLProgressElement) => element.value)).toBeGreaterThan(0);
  expect(await page.locator("progress[aria-label*='Fictional Operations Memo']")
    .evaluate((element: HTMLProgressElement) => element.value)).toBe(0);

  await page.getByRole("button", { name: "Open assignment: Fictional Operations Memo", exact: true }).click();
  await expect(assignmentPageHeading(page, "Fictional Operations Memo")).toBeVisible();
  await page.getByRole("button", { name: /Check/ }).first().click();
  const independentDraft = "Fictional memo draft that belongs only to the second assignment.";
  await page.getByTestId("uploaded-review-text").fill(independentDraft);
  await returnToAssignments(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "My assignments" })).toBeVisible();
  await expect(page.getByText("2 assignments", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open assignment: Fictional Operations Memo", exact: true }).click();
  await expect(page.getByTestId("uploaded-review-text")).toHaveValue(independentDraft);
  await returnToAssignments(page);

  await workspaceLanguageSwitcher(page).selectOption("zh-CN");
  await expect(page.getByRole("heading", { name: "我的作业" })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "Reducing Collection Delays at LumaLane Market",
    exact: true,
  })).toBeVisible();
  await workspaceLanguageSwitcher(page).selectOption("en");

  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoHorizontalOverflow(page);
  }
  await expectLiveBoundary(page);
  expect(externalRequests).toEqual([]);
});

test("an exact v0.7 active record migrates once without deleting its legacy source", async ({ page }) => {
  await createSampleAssignment(page);

  const fixture = await page.evaluate(() => {
    const projectKey = Array.from(
      { length: window.localStorage.length },
      (_, index) => window.localStorage.key(index),
    ).find((key) => key?.includes(".generation.1.project.") && key.endsWith(".v1"));
    if (!projectKey) throw new Error("Generated workspace project record is missing");
    const workspaceRaw = window.localStorage.getItem(projectKey);
    if (workspaceRaw === null) throw new Error("Generated workspace project is missing");
    const workspaceRecord = JSON.parse(workspaceRaw) as {
      value?: { kind?: string; state?: unknown };
    };
    if (workspaceRecord.value?.kind !== "project" || !workspaceRecord.value.state) {
      throw new Error("Generated workspace project is invalid");
    }
    const legacyRaw = JSON.stringify({
      formatVersion: 1,
      revision: 7,
      value: { kind: "project", state: workspaceRecord.value.state },
      legacyFingerprints: { v3: null, v2: null, v1: null },
    });
    const expectedState = JSON.stringify(workspaceRecord.value.state);
    window.localStorage.clear();
    window.localStorage.setItem("rubrictrail.project.store.v1", legacyRaw);
    return { legacyRaw, expectedState };
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "My assignments" })).toBeVisible();
  await expect(page.getByText("1 assignment", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "Reducing Collection Delays at LumaLane Market",
    exact: true,
  })).toBeVisible();

  const migrated = await page.evaluate(() => {
    const indexRaw = window.localStorage.getItem("rubrictrail.workspace.index.v1");
    if (indexRaw === null) throw new Error("Migrated index is missing");
    const index = JSON.parse(indexRaw) as StoredWorkspaceIndex;
    const active = index.projects.filter((entry) => entry.kind === "active");
    if (active.length !== 1) throw new Error("Expected one migrated assignment");
    const projectKey = Array.from(
      { length: window.localStorage.length },
      (_, position) => window.localStorage.key(position),
    ).find((key) => key?.includes(`.project.${active[0].projectId}.v1`));
    if (!projectKey) throw new Error("Migrated project key is missing");
    const projectRaw = window.localStorage.getItem(projectKey);
    if (projectRaw === null) throw new Error("Migrated project record is missing");
    const project = JSON.parse(projectRaw) as {
      value?: { kind?: string; state?: unknown };
    };
    return {
      status: index.status,
      activeCount: active.length,
      state: JSON.stringify(project.value?.state),
      legacyRaw: window.localStorage.getItem("rubrictrail.project.store.v1"),
    };
  });
  expect(migrated).toEqual({
    status: "active",
    activeCount: 1,
    state: fixture.expectedState,
    legacyRaw: fixture.legacyRaw,
  });

  await page.reload();
  await expect(page.getByText("1 assignment", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem("rubrictrail.project.store.v1")))
    .toBe(fixture.legacyRaw);
});

test("the real lifecycle dialogs preserve active-empty, cleared and reactivated workspace semantics at 320px", async ({ page }) => {
  await createSampleAssignment(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByRole("button", { name: "Manage local workspace" }).click();
  await expect(page.getByRole("heading", { name: "Storage & recovery" })).toBeVisible();
  await page.getByRole("button", { name: "Review project deletion" }).click();

  const projectDialog = page.getByRole("dialog", { name: "Delete this project?" });
  await expect(projectDialog).toBeVisible();
  await expect(projectDialog.getByRole("button", { name: "Close confirmation" }))
    .toBeFocused();
  await expectNoHorizontalOverflow(page);
  await expect(projectDialog.getByText("Reducing Collection Delays at LumaLane Market"))
    .toBeVisible();

  const beforeDelete = await readWorkspaceIndex(page);
  const activeProject = beforeDelete.projects.find((entry) => entry.kind === "active");
  if (!activeProject) throw new Error("Selected project is missing from the index");
  const projectToken = `DELETE PROJECT ${activeProject.projectId.slice(0, 8)}`;
  await projectDialog.getByLabel(new RegExp(`Type ${projectToken} to confirm`))
    .fill(projectToken);

  await holdNextWorkspaceLock(page);
  const deleteButton = projectDialog.getByRole("button", {
    name: "Delete this project",
    exact: true,
  });
  await deleteButton.click();
  await expect(projectDialog).toHaveAttribute("aria-busy", "true");
  await expect(projectDialog.getByRole("button", { name: "Working…" }))
    .toBeDisabled();
  await expect(projectDialog).toBeVisible();
  await releaseWorkspaceLock(page);

  await expect(projectDialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "My assignments" })).toBeVisible();
  const emptyActive = await readWorkspaceIndex(page);
  expect(emptyActive.status).toBe("active");
  expect(emptyActive.projects.filter((entry) => entry.kind === "active")).toHaveLength(0);
  expect(emptyActive.projects.filter((entry) => entry.kind === "tombstone")).toHaveLength(1);

  await page.getByRole("button", { name: "Review whole-workspace deletion" }).click();
  const workspaceDialog = page.getByRole("dialog", {
    name: "Delete the entire workspace?",
  });
  await expect(workspaceDialog).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const workspaceToken = `DELETE WORKSPACE ${emptyActive.workspaceId.slice(0, 8)}`;
  await workspaceDialog.getByLabel(new RegExp(`Type ${workspaceToken} to confirm`))
    .fill(workspaceToken);
  await workspaceDialog.getByRole("button", { name: "Delete entire workspace" }).click();
  await expect(workspaceDialog).toBeHidden();

  const cleared = await readWorkspaceIndex(page);
  expect(cleared.status).toBe("cleared");
  expect(cleared.projects).toEqual([]);
  await expect(page.getByRole("button", { name: "New assignment" }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await createSampleAssignment(page);
  await expect(assignmentPageHeading(
    page,
    "Reducing Collection Delays at LumaLane Market",
  )).toBeVisible();
  const reactivated = await readWorkspaceIndex(page);
  expect(reactivated).toMatchObject({
    workspaceId: cleared.workspaceId,
    workspaceGeneration: cleared.workspaceGeneration,
    revision: cleared.revision + 1,
    status: "active",
  });
  expect(reactivated.projects.filter((entry) => entry.kind === "active"))
    .toHaveLength(1);
  await expectNoHorizontalOverflow(page);
});

test("a browser without Web Locks can read and export an exact portable project backup without mutation", async ({ page }) => {
  await createSampleAssignment(page);
  const index = await readWorkspaceIndex(page);
  const project = index.projects.find((entry) => entry.kind === "active");
  if (!project) throw new Error("Expected one readable project before disabling Web Locks");
  const before = await readAllLocalStorage(page);

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
  });
  await page.reload();

  await expect(page.getByRole("heading", {
    name: "RubricTrail stopped before choosing a workspace",
  })).toBeVisible();
  await expect(page.getByText(
    "This browser does not provide the Web Lock required for safe workspace changes.",
  )).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "Download readable project backups",
  })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", {
    name: "Download backup for RubricTrail sample project, readable record 1",
  }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  if (stream === null) throw new Error("Portable backup download stream is unavailable");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const backupRaw = Buffer.concat(chunks).toString("utf8");
  expect(JSON.parse(backupRaw)).toMatchObject({
    format: "rubrictrail-project",
    formatVersion: 1,
    project: { projectKind: "sample" },
  });
  expect(backupRaw).not.toContain(index.workspaceId);
  expect(backupRaw).not.toContain(project.projectId);
  expect(await readAllLocalStorage(page)).toEqual(before);
});
