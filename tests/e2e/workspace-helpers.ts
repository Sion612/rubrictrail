import { expect, type Page } from "@playwright/test";

export const APP_PATH = (() => {
  const configured = process.env.PLAYWRIGHT_APP_PATH?.trim() || "/";
  const withLeadingSlash = configured.startsWith("/") ? configured : `/${configured}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
})();

export type NewAssignmentMethod = "upload" | "paste" | "restore" | "sample";

const optionNames: Record<NewAssignmentMethod, string> = {
  upload: "Upload assignment files",
  paste: "Paste assignment details",
  restore: "Restore assignment backup as new",
  sample: "Try the fictional sample",
};

/** Start each browser test from the real empty v0.8 workspace, never legacy UI. */
export async function resetWorkspace(page: Page) {
  await page.goto(APP_PATH);
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page.getByRole("heading", { name: "My assignments" })).toBeVisible();
}

export async function openNewAssignment(page: Page, method: NewAssignmentMethod) {
  await expect(page.getByRole("heading", { name: "My assignments" })).toBeVisible();
  const newButton = page.getByRole("button", { name: "New assignment", exact: true }).first();
  await newButton.click();
  await page.getByRole("button", { name: optionNames[method], exact: true }).click();
}

export async function activeWorkspaceProjectCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("rubrictrail.workspace.index.v1");
    if (raw === null) return 0;
    const parsed = JSON.parse(raw) as {
      projects?: Array<{ kind?: string }>;
    };
    return parsed.projects?.filter((project) => project.kind === "active").length ?? 0;
  });
}

export async function expectActiveWorkspaceProjectCount(page: Page, count: number) {
  await expect.poll(
    () => activeWorkspaceProjectCount(page),
    {
      message: `Expected ${count} persisted workspace project(s)`,
      timeout: 15_000,
    },
  ).toBe(count);
}

export async function createSampleAssignment(page: Page) {
  const before = await activeWorkspaceProjectCount(page);
  await openNewAssignment(page, "sample");
  await expect(page.getByTestId("try-sample")).toBeVisible();
  await page.getByTestId("try-sample").click();
  await expectActiveWorkspaceProjectCount(page, before + 1);
}

export async function openUploadAssignment(page: Page) {
  await openNewAssignment(page, "upload");
  await expect(page.getByTestId("file-input")).toBeVisible();
}

export async function openPasteAssignment(page: Page) {
  await openNewAssignment(page, "paste");
  await expect(page.getByRole("heading", { name: "Paste your assignment text" })).toBeVisible();
}

export async function openRestoreAssignment(page: Page) {
  await openNewAssignment(page, "restore");
  await expect(page.getByTestId("backup-file-input")).toBeFocused();
}

export async function returnToAssignments(page: Page) {
  await page.getByRole("button", { name: "All assignments", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My assignments" })).toBeVisible();
}

export async function reopenAssignment(page: Page, title: string) {
  await expect(page.getByRole("heading", { name: "My assignments" })).toBeVisible();
  await page.getByRole("button", { name: `Open assignment: ${title}`, exact: true }).click();
  const heading = assignmentPageHeading(page, title);
  await expect(heading).toBeVisible();
  await expect(heading).toHaveText(title);
}

export function assignmentPageHeading(page: Page, title: string) {
  return page.locator('h1[tabindex="-1"]').filter({ hasText: title });
}

export function workspaceLanguageSwitcher(page: Page) {
  return page
    .getByRole("navigation", {
      name: /^(?:Workspace navigation|作业空间导航)$/,
    })
    .getByRole("combobox", {
      name: /^(?:Interface language|界面语言)$/,
    });
}

export async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewport + 1);
}
