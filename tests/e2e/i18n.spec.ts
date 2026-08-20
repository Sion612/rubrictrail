import { expect, test, type Page } from "@playwright/test";

import { assignmentPageHeading, openNewAssignment, resetWorkspace, workspaceLanguageSwitcher } from "./workspace-helpers";

async function resetApp(page: Page) {
  await resetWorkspace(page);
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

test("switches to Simplified Chinese without losing intake or project state", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("console", (entry) => {
    if (entry.type() === "error") browserErrors.push(entry.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await openNewAssignment(page, "paste");
  const brief = page.getByRole("textbox", {
    name: /Assignment brief or instructions/,
  });
  const privateText = "PRIVATE assignment requirement — keep this exact text";
  await brief.fill(privateText);

  const language = workspaceLanguageSwitcher(page);
  await language.selectOption("zh-CN");

  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(
    page.getByRole("heading", { name: "把作业要求变成一份有据可查的计划。" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: /作业说明或要求/ })).toHaveValue(
    privateText,
  );
  await expect(page.getByText(/中文材料可以本地上传或粘贴/)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("heading", { name: "我的作业" })).toBeVisible();

  await page.getByRole("button", { name: "新建作业", exact: true }).click();
  await page.getByRole("button", { name: "试用虚构示例", exact: true }).click();
  await page.getByTestId("try-sample").click();
  await expect(page.getByText("作业要求已梳理", { exact: true })).toBeVisible();
  await expect(
    assignmentPageHeading(page, "Reducing Collection Delays at LumaLane Market"),
  ).toBeVisible();

  const workspaceLanguage = workspaceLanguageSwitcher(page);
  await workspaceLanguage.selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByText("Assignment decoded", { exact: true })).toBeVisible();
  await expect(
    assignmentPageHeading(page, "Reducing Collection Delays at LumaLane Market"),
  ).toBeVisible();

  await page.getByRole("button", { name: /\bCheck\b/ }).first().click();
  const draftText = "A saved draft that must remain unchanged across both interface languages.";
  await page.getByTestId("draft-text").fill(draftText);
  await workspaceLanguageSwitcher(page).selectOption("zh-CN");
  await expect(page.getByTestId("draft-text")).toHaveValue(draftText);
  await expect.poll(() => page.evaluate(
    (text) => Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => key !== null)
      .map((key) => localStorage.getItem(key) ?? "")
      .some((value) => value.includes(text)),
    draftText,
  )).toBe(true);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.getByRole("button", { name: "打开作业：Reducing Collection Delays at LumaLane Market", exact: true }).click();
  await expect(page.getByTestId("draft-text")).toHaveValue(draftText);
  await expect(page.getByRole("heading", { name: "按评分标准检查，同时保留你的原创工作。" })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page);
  const projectRecordBeforeEnglish = await page.evaluate(
    (text) => Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => key !== null)
      .map((key) => localStorage.getItem(key) ?? "")
      .find((value) => value.includes(text)) ?? null,
    draftText,
  );
  await workspaceLanguageSwitcher(page).selectOption("en");
  await expect(page.getByTestId("draft-text")).toHaveValue(draftText);
  await expect.poll(() => page.evaluate(
    (text) => Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => key !== null)
      .map((key) => localStorage.getItem(key) ?? "")
      .find((value) => value.includes(text)) ?? null,
    draftText,
  )).toBe(projectRecordBeforeEnglish);
  await expectNoHorizontalOverflow(page);
  expect(browserErrors).toEqual([]);
});
