import { expect, test, type Page } from "@playwright/test";

const APP_PATH = (() => {
  const configured = process.env.PLAYWRIGHT_APP_PATH?.trim() || "/";
  const withLeadingSlash = configured.startsWith("/") ? configured : `/${configured}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
})();

async function resetProject(page: Page) {
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

test.beforeEach(async ({ page }) => {
  await resetProject(page);
});

test("sample calendar stays transient and exports a local ICS snapshot", async ({ page }) => {
  test.setTimeout(90_000);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  await page.getByTestId("try-sample").click();
  await visibleWorkflowButton(page, "Plan").click();
  await expect(page.getByTestId("plan-task-list")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("plan-calendar").click();
  await expect(page.getByTestId("plan-calendar-grid")).toBeVisible();
  await expect(page.getByText(/target completion dates/)).toBeVisible();
  await expect(page.getByText(/The assignment deadline is outside this month/)).toBeVisible();
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.getByRole("heading", { name: "September 2026" })).toBeVisible();
  await expect(page.getByTestId("calendar-day-2026-09-07")).toBeVisible();
  await expect(page.getByRole("button", { name: /assignment deadline/i })).toBeVisible();
  await expect(page.getByText("Assignment deadline", { exact: true })).toBeVisible();

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
  expect(ics).not.toContain("lumalane-brief");
  expect(ics).not.toContain("SAMPLE_DRAFT");
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

test("calendar remains usable at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByTestId("try-sample").click();
  await visibleWorkflowButton(page, "Plan").click();
  await page.getByTestId("plan-calendar").click();
  await expect(page.getByTestId("plan-calendar-grid")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
