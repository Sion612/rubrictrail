import { expect, test, type Page } from "@playwright/test";

const APP_PATH = (() => {
  const configured = process.env.PLAYWRIGHT_APP_PATH?.trim() || "/";
  const withLeadingSlash = configured.startsWith("/") ? configured : `/${configured}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
})();

async function resetApp(page: Page) {
  await page.goto(APP_PATH);
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Turn the brief into a plan you can prove." }),
  ).toBeVisible();
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

  await page.getByRole("button", { name: "Paste text" }).click();
  const brief = page.getByRole("textbox", {
    name: /Assignment brief or instructions/,
  });
  const privateText = "PRIVATE assignment requirement — keep this exact text";
  await brief.fill(privateText);

  const language = page.getByRole("combobox", { name: "Interface language" });
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
  await expect(
    page.getByRole("heading", { name: "把作业要求变成一份有据可查的计划。" }),
  ).toBeVisible();

  await page.getByTestId("try-sample").click();
  await expect(page.getByText("作业要求已梳理", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Reducing Collection Delays at LumaLane Market" }),
  ).toBeVisible();

  const workspaceLanguage = page.getByRole("combobox", { name: "界面语言" });
  await workspaceLanguage.selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByText("Assignment decoded", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Reducing Collection Delays at LumaLane Market" }),
  ).toBeVisible();

  await page.getByRole("button", { name: /\bCheck\b/ }).first().click();
  const draftText = "A saved draft that must remain unchanged across both interface languages.";
  await page.getByTestId("draft-text").fill(draftText);
  await page.getByRole("combobox", { name: "Interface language" }).selectOption("zh-CN");
  await expect(page.getByTestId("draft-text")).toHaveValue(draftText);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("rubrictrail.project.store.v1") ?? ""),
    )
    .toContain(draftText);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByTestId("draft-text")).toHaveValue(draftText);
  await expect(page.getByRole("heading", { name: "按评分标准检查，同时保留你的原创工作。" })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page);
  const projectRecordBeforeEnglish = await page.evaluate(() =>
    localStorage.getItem("rubrictrail.project.store.v1"),
  );
  await page.getByRole("combobox", { name: "界面语言" }).selectOption("en");
  await expect(page.getByTestId("draft-text")).toHaveValue(draftText);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("rubrictrail.project.store.v1")))
    .toBe(projectRecordBeforeEnglish);
  await expectNoHorizontalOverflow(page);
  expect(browserErrors).toEqual([]);
});
