import { expect, test } from "@playwright/test";

const APP_PATH = "/workspace-dashboard-test/";

test("keeps the dormant bilingual workspace usable and contained", async ({
  page,
}) => {
  const offOriginRequests: string[] = [];
  const escapedBasePathRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:3102") {
      offOriginRequests.push(url.origin);
    } else if (!url.pathname.startsWith("/workspace-dashboard-test/")) {
      escapedBasePathRequests.push(url.pathname);
    }
  });

  await page.goto(APP_PATH);
  await expect(page.getByRole("heading", { name: "My assignments" })).toBeVisible();
  await expect(page.getByText("2 assignments")).toBeVisible();
  await expect(page.getByText("Fictional market entry analysis").first()).toBeVisible();
  await expect(page.getByText("Fictional language portfolio").first()).toBeVisible();

  const newAssignment = page.getByRole("button", { name: "New assignment" });
  await newAssignment.focus();
  await page.keyboard.press("Enter");
  const upload = page.getByRole("button", { name: "Upload assignment files" });
  await expect(upload).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(newAssignment).toBeFocused();

  await page
    .getByRole("button", {
      name: "Open assignment: Fictional market entry analysis",
    })
    .click();
  const assignmentAHeading = page.getByRole("heading", {
    name: "Fictional market entry analysis",
  });
  await expect(assignmentAHeading).toBeFocused();
  await expect(page.getByText("Fictional draft A remains isolated.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Project Tracker" })).toBeVisible();
  await expect(page.getByText("Brief · Rubric · Plan · Check · Progress")).toBeVisible();

  await page
    .getByRole("button", { name: "Mark this assignment save as pending" })
    .click();
  await page.getByRole("button", { name: "All assignments" }).click();
  await expect(page.getByRole("heading", { name: "My assignments" })).toBeFocused();
  await page
    .getByRole("button", {
      name: "Open assignment: Fictional language portfolio",
    })
    .click();
  await expect(page.getByRole("status").last()).toContainText(
    "Finish or resolve the pending save",
  );
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Fictional language portfolio",
    }),
  ).toHaveCount(0);

  await page
    .getByRole("button", {
      name: "Open assignment: Fictional market entry analysis",
    })
    .click();
  await page.getByRole("button", { name: "Finish pending save" }).click();
  await page.getByRole("button", { name: "All assignments" }).click();
  await page
    .getByRole("button", {
      name: "Open assignment: Fictional language portfolio",
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Fictional language portfolio" }),
  ).toBeFocused();
  await expect(page.getByText("Fictional draft B remains independent.")).toBeVisible();
  await page.getByRole("button", { name: "RubricTrail" }).press("Enter");

  await expect(page.getByRole("heading", { name: "Storage & recovery" })).toBeVisible();
  const reviewProjectDeletion = page.getByRole("button", {
    name: "Review project deletion",
  });
  await reviewProjectDeletion.click();
  await expect(page.getByRole("dialog")).toContainText("Delete this project?");
  await page.keyboard.press("Escape");
  await expect(reviewProjectDeletion).toBeFocused();

  await page.getByRole("button", { name: "Show recovery-only state" }).click();
  const recoveryPrivacy = page.getByRole("button", {
    name: "Review recovery-only privacy deletion",
  });
  await recoveryPrivacy.click();
  await expect(page.getByRole("dialog")).toContainText(
    "Delete all discovered workspace data?",
  );
  await page
    .getByLabel(/Type DELETE RECOVERY DATA to confirm/iu)
    .fill("DELETE RECOVERY DATA");
  await page
    .getByLabel(/I understand every exact discovered workspace candidate/iu)
    .check();
  await page.getByRole("button", { name: "Delete discovered workspace data" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(recoveryPrivacy).toBeFocused();
  await expect(
    page.getByRole("status").filter({
      hasText: "Lifecycle action: delete-workspace-recovery",
    }),
  ).toBeVisible();

  await page
    .getByRole("navigation", { name: /workspace navigation|作业空间导航/iu })
    .getByRole("combobox", { name: /language|语言/iu })
    .selectOption("zh-CN");
  await expect(page.getByRole("heading", { name: "我的作业" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "存储与恢复" })).toBeVisible();
  await expect(page.getByText("Fictional market entry analysis").first()).toBeVisible();
  await page.getByRole("button", { name: "新建作业" }).click();
  await page.getByRole("button", { name: "把作业备份恢复为新作业" }).click();
  await expect(page.getByText("3 份作业")).toBeVisible();
  await expect(page.getByText("Fictional restored assignment").first()).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
  expect(offOriginRequests).toEqual([]);
  expect(escapedBasePathRequests).toEqual([]);
});
