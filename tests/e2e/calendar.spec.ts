import { expect, test, type Page } from "@playwright/test";

const APP_PATH = (() => {
  const configured = process.env.PLAYWRIGHT_APP_PATH?.trim() || "/";
  const withLeadingSlash = configured.startsWith("/") ? configured : `/${configured}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
})();

const FROZEN_NOW = "2026-08-17T12:00:00";

async function resetProject(page: Page) {
  await page.clock.install({ time: new Date(FROZEN_NOW) });
  await page.goto(APP_PATH);
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
}

function visibleWorkflowButton(page: Page, label: string) {
  return page
    .locator("nav.mobile-workflow:visible, aside.workflow-rail:visible")
    .getByRole("button", { name: new RegExp(`(?:^|\\s)${label}(?:\\s|$)`) })
    .first();
}

async function openSampleCalendar(page: Page) {
  await page.getByTestId("try-sample").click();
  await visibleWorkflowButton(page, "Plan").click();
  await page.getByTestId("plan-calendar").click();
  await expect(page.getByTestId("plan-calendar-grid")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await resetProject(page);
});

test("sample calendar stays transient and exports a local ICS snapshot", async ({ page }) => {
  test.setTimeout(90_000);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  await openSampleCalendar(page);
  await expect(page.getByText(/target completion dates/)).toBeVisible();
  await expect(page.getByTestId("calendar-legend")).toBeVisible();
  await expect(page.getByText(/The assignment deadline is outside this month/)).toBeVisible();
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.getByRole("heading", { name: "September 2026" })).toBeVisible();
  await expect(page.getByTestId("calendar-day-2026-09-07")).toBeVisible();
  await expect(page.getByRole("button", { name: /assignment deadline/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /planning date/i })).toHaveCount(0);

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-ics").click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const { readFile } = await import("node:fs/promises");
  const ics = await readFile(path!, "utf8");
  expect(ics).toContain("BEGIN:VCALENDAR");
  expect(ics).toContain("DTSTART;VALUE=DATE:");
  expect(ics).toContain("Assignment deadline");
  expect(ics).toContain("Reducing Collection Delays");
  expect(ics).not.toContain("lumalane-brief");
  expect(ics).not.toContain("SAMPLE_DRAFT");
  expect(ics).not.toContain(" p1");
  expect(requests.some((url) => url.includes(".ics"))).toBe(false);

  await page.getByTestId("plan-task-list").click();
  await expect(page.getByTestId("task-p1")).toBeVisible();
  await page.reload();
  await visibleWorkflowButton(page, "Plan").click();
  await expect(page.getByTestId("plan-task-list")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("plan-calendar-grid")).toHaveCount(0);
  const stored = await page.evaluate(() => window.localStorage.getItem("rubrictrail.project.store.v1"));
  expect(stored).not.toContain("\"calendar\"");
});

test("calendar completion, rebalance, focus, and empty-month navigation stay consistent", async ({ page }) => {
  test.setTimeout(90_000);
  await openSampleCalendar(page);
  const firstTask = page.getByTestId("calendar-task-p1");
  await expect(firstTask).toBeVisible();
  await expect(page.getByText("Blocked", { exact: true }).first()).toBeVisible();
  await firstTask.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Open in task list" }).first().click();
  await expect(page.getByTestId("task-p1")).toBeFocused();
  await expect(page.getByTestId("task-p1")).toHaveClass(/is-complete/);

  await page.getByTestId("plan-calendar").click();
  await expect(page.getByTestId("plan-calendar-grid")).toBeVisible();
  await page.getByTestId("calendar-day-2026-08-28").click();
  await expect(page.getByTestId("calendar-task-p13")).toContainText("28 Aug 2026");
  await page.getByTestId("weekly-hours").selectOption("5");
  await page.getByTestId("rebalance-plan").click();
  await expect(page.getByTestId("plan-calendar-grid")).toBeVisible();
  await page.getByTestId("calendar-day-2026-08-28").click();
  await expect(page.getByTestId("calendar-task-p13")).toHaveCount(0);
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.getByRole("heading", { name: "September 2026" })).toBeVisible();
  await page.getByTestId("calendar-day-2026-09-11").click();
  await expect(page.getByTestId("calendar-task-p13")).toContainText("11 Sept 2026");
  await page.getByTestId("plan-task-list").click();
  await expect(page.getByTestId("task-p13")).toContainText("Due 11 Sept");

  await page.getByTestId("plan-calendar").click();
  await expect(page.getByTestId("plan-calendar-grid")).toBeVisible();
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.getByRole("heading", { name: "September 2026" })).toBeVisible();
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.getByRole("heading", { name: "October 2026" })).toBeVisible();
  await expect(page.getByText(/The assignment deadline is outside this month/)).toBeVisible();
  await page.getByRole("button", { name: "Previous month" }).click();
  await page.getByRole("button", { name: "Previous month" }).click();
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.getByRole("heading", { name: "July 2026" })).toBeVisible();
  await expect(page.getByText("No tasks have a target completion date in this week.")).toBeVisible();
});

test("uploaded project calendar and Chinese ICS stay localized", async ({ page }) => {
  test.setTimeout(90_000);
  await page.getByTestId("file-input").setInputFiles({
    name: "strategy-brief.txt",
    mimeType: "text/plain",
    buffer: Buffer.from([
      "Assignment title: Strategy Report",
      "Deadline: 24 September 2026",
      "Word count: 1500 words",
      "Use APA 7 referencing.",
      "Rubric",
      "Strategic analysis | 100%",
    ].join("\n")),
  });
  await page.getByTestId("create-project").click();
  await visibleWorkflowButton(page, "Plan").click();
  await page.getByTestId("plan-calendar").click();
  await expect(page.getByTestId("plan-calendar-grid")).toBeVisible();
  await page.getByRole("combobox", { name: /language|语言/i }).selectOption("zh-CN");
  await expect(page.getByTestId("calendar-legend")).toContainText("任务状态");
  await expect(page.getByText("高优先级").first()).toBeVisible();
  await expect(page.getByText(/分钟/).first()).toBeVisible();
  await expect(page.getByText("high", { exact: true })).toHaveCount(0);

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-ics").click();
  const download = await downloadPromise;
  const { readFile } = await import("node:fs/promises");
  const ics = await readFile((await download.path())!, "utf8");
  expect(ics).toContain("作业截止日期：Strategy Report");
  expect(ics).toContain("高");
  expect(ics).toMatch(/分钟|小时/);
  expect(ics).toContain("确认作业说明并记录待解决问题");
  expect(ics).not.toMatch(/依赖:[^\n]*criterion-\d+/);
});

test("calendar remains usable at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await openSampleCalendar(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
