import { expect, test, type Page, type TestInfo } from "@playwright/test";

async function resetProject(page: Page) {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Turn the brief into a plan you can prove." }),
  ).toBeVisible();
}

function visibleWorkflowButton(page: Page, label: string) {
  return page
    .locator("nav.mobile-workflow button:visible, aside.workflow-rail button:visible")
    .filter({ hasText: label })
    .first();
}

async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    offenders: Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .map((element) => ({
        tag: element.tagName,
        className: typeof element.className === "string" ? element.className : "",
        right: Math.round(element.getBoundingClientRect().right),
        width: Math.round(element.getBoundingClientRect().width),
      }))
      .filter((item) => item.right > window.innerWidth + 1)
      .slice(0, 8),
  }));
  expect(metrics.documentWidth, JSON.stringify(metrics.offenders)).toBeLessThanOrEqual(
    metrics.viewport + 1,
  );
}

async function expectWorkspaceAtTop(page: Page) {
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
}

async function useNarrowMobileViewport(page: Page, testInfo: TestInfo) {
  if (!testInfo.project.name.startsWith("mobile")) return;
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => window.innerWidth)).toBe(320);
}

const COMPLETE_BRIEF = [
  "Assignment title: Strategy Report",
  "Deadline: 24 September 2026",
  "Word count: 2500 words",
  "Use APA 7 referencing.",
  "Rubric",
  "Strategic analysis | 40%",
  "Recommendations | 35%",
  "Communication | 25%",
].join("\n");

test.beforeEach(async ({ page }) => {
  await resetProject(page);
});

test("sample assignment keeps demo signals distinct from real completion", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await expect(page.getByText("Local demo · no credits")).toBeVisible();
  await page.getByTestId("try-sample").click();
  await expect(
    page.getByRole("heading", { name: "Reducing Collection Delays at LumaLane Market" }),
  ).toBeVisible();

  const sourceButton = page.getByRole("button", { name: /Open source 1 for/ }).first();
  await sourceButton.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sourceButton).toBeFocused();

  await page.getByRole("button", { name: "Open rubric map" }).click();
  await expect(page.getByRole("heading", { name: "See what every mark requires" })).toBeVisible();

  await visibleWorkflowButton(page, "Plan").click();
  await expect(page.getByRole("heading", { name: "A plan with a definition of done." })).toBeVisible();
  await page.getByTestId("weekly-hours").selectOption("5");
  await page.getByTestId("target-grade").selectOption("80");
  await page.getByTestId("rebalance-plan").click();
  await expect(page.getByTestId("toast")).toContainText("80% target band");
  await page.getByTestId("task-p1").getByRole("checkbox").check();
  await expect(page.getByTestId("task-p1")).toHaveClass(/is-complete/);

  await visibleWorkflowButton(page, "Check").click();
  await page.getByTestId("run-draft-check").click();
  await expect(page.getByTestId("checking-state")).toBeVisible();
  await expect(page.getByTestId("draft-results")).toBeVisible();
  await expect(page.getByText("surface signals", { exact: true })).toBeVisible();
  await expect(page.getByTestId("draft-results").getByText(/not a predicted grade/i)).toBeVisible();

  await page.getByRole("button", { name: /See what this changes in progress/ }).click();
  await expect(page.getByRole("heading", { name: /Not ready yet/ })).toBeVisible();
  await expect(page.getByText("0 of 7")).toBeVisible();

  await expectNoHorizontalOverflow(page);
  expect(browserErrors).toEqual([]);
});

test("sample users can hand off directly to their own files", async ({ page }) => {
  await page.getByTestId("try-sample").click();
  await expect(
    page.getByRole("heading", { name: "Reducing Collection Delays at LumaLane Market" }),
  ).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Use my assignment" }).click();

  await expect(
    page.getByRole("heading", { name: "Turn the brief into a plan you can prove." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose files" })).toBeFocused();
});

test("real upload can create and persist a source-linked local project", async ({ page }) => {
  await page.getByTestId("file-input").setInputFiles({
    name: "strategy-brief.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(COMPLETE_BRIEF),
  });

  await expect(page.getByRole("heading", { name: "Confirm what the assignment says." })).toBeVisible();
  await expect(page.getByTestId("confirm-title")).toHaveValue("Strategy Report");
  await expect(page.getByTestId("criterion-weight-0")).toHaveValue("40");
  await expect(page.getByText("100% total")).toBeVisible();
  await page.getByTestId("create-project").click();

  await expect(page.getByRole("heading", { name: "Strategy Report", exact: true })).toBeVisible();
  await expectWorkspaceAtTop(page);
  await expect(page.getByText("APA 7")).toBeVisible();
  await expect(page.getByText("LumaLane Market")).toHaveCount(0);
  await expect(page.getByText("OM302 Operations Management")).toHaveCount(0);

  await page.getByRole("button", { name: "Review rubric" }).click();
  await expect(page.getByRole("heading", { name: "Confirm what earns marks." })).toBeVisible();
  await expectWorkspaceAtTop(page);
  const evidenceButton = page.getByRole("button", { name: "Open source for Strategic analysis" });
  await evidenceButton.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Strategic analysis | 40%");
  await page.keyboard.press("Escape");

  await visibleWorkflowButton(page, "Plan").click();
  const firstTask = page.getByTestId("task-confirm-brief");
  await firstTask.getByRole("checkbox").check();
  await expect(firstTask).toHaveClass(/is-complete/);

  await visibleWorkflowButton(page, "Check").click();
  await page.getByTestId("uploaded-review-text").fill(
    "The market evidence shows a clear strategic constraint, and APA Source (2025) explains why it matters.",
  );
  await page.getByLabel("Evidence is visible").check();
  await page.getByLabel("The link is explained").check();
  await page.getByLabel("The source is traceable").check();
  await page.getByTestId("save-self-check").click();
  await expect(page.getByTestId("toast")).toContainText("Self-check recorded");

  await page.reload();
  await expect(page.getByText("Strategy Report", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("uploaded-review-text")).toHaveValue(/strategic constraint/);
  await expectNoHorizontalOverflow(page);
});

test("a mixed file batch keeps readable sources only after explicit review", async ({ page }, testInfo) => {
  await useNarrowMobileViewport(page, testInfo);
  const omittedTail = "OMITTED-MIXED-BATCH-CONTENT-7C31";
  const longUnsupportedName = `${"long-unsupported-source-".repeat(10)}.exe`;

  await page.getByTestId("file-input").setInputFiles([
    {
      name: "brief.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(COMPLETE_BRIEF),
    },
    {
      name: longUnsupportedName,
      mimeType: "application/octet-stream",
      buffer: Buffer.from(omittedTail),
    },
  ]);

  const partial = page.getByRole("region", { name: "We read 1 of 2 files." });
  await expect(partial).toBeFocused();
  await expect(partial).toContainText(longUnsupportedName);
  const partialButtons = partial.getByRole("button");
  await expect(partialButtons).toHaveText([
    "Review 1 ready file",
    "Choose all files again",
    "Paste all text instead",
  ]);
  for (const button of await partialButtons.all()) {
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await expectNoHorizontalOverflow(page);

  await page.keyboard.press("Tab");
  await expect(
    partial.getByRole("button", { name: "Review 1 ready file" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { name: "Confirm what the assignment says." }),
  ).toBeFocused();
  await expectWorkspaceAtTop(page);
  await expect(
    page.getByRole("heading", {
      name: "This preview uses 1 of the 2 selected files.",
    }),
  ).toBeVisible();
  await expect(page.locator(".source-strip")).toContainText("brief.txt");
  await expect(page.locator(".source-strip")).not.toContainText(longUnsupportedName);
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Review file selection" }).first().click();
  await expect(partial).toBeFocused();
  await partial.getByRole("button", { name: "Review 1 ready file" }).click();
  await page.getByTestId("create-project").click();
  await expect(
    page.getByRole("heading", { name: "Strategy Report", exact: true }),
  ).toBeVisible();
  const storedProject = await page.evaluate(
    () => window.localStorage.getItem("rubrictrail.project.v2") ?? "",
  );
  expect(storedProject).toContain("brief.txt");
  expect(storedProject).not.toContain(longUnsupportedName);
  expect(storedProject).not.toContain(omittedTail);
  await expectNoHorizontalOverflow(page);
});

test("pasted brief and rubric can create a private source-linked project", async ({ page }, testInfo) => {
  const privateTail = "PRIVATE-PASTE-TAIL-MUST-NOT-PERSIST-8F21";
  await page.getByRole("button", { name: "Paste text" }).click();
  await useNarrowMobileViewport(page, testInfo);
  await expectNoHorizontalOverflow(page);
  expect(
    await page.getByTestId("pasted-assignment-brief").evaluate((element) =>
      Number.parseFloat(window.getComputedStyle(element).fontSize),
    ),
  ).toBeGreaterThanOrEqual(16);
  await page.getByTestId("pasted-assignment-brief").fill(
    [
      "Assignment title: Pasted Strategy Report",
      "Deadline: 24 September 2026",
      "Word count: 2500 words",
      "Use APA 7 referencing.",
      privateTail,
    ].join("\n"),
  );
  await page.getByTestId("pasted-assignment-rubric").fill(
    "Rubric\nStrategic analysis | 40%\nRecommendations | 35%\nCommunication | 25%",
  );
  await page.getByRole("button", { name: "Review assignment details" }).click();

  await expect(
    page.getByRole("heading", { name: "Confirm what the assignment says." }),
  ).toBeFocused();
  await expect(page.getByText("Pasted assignment brief, Pasted rubric")).toBeVisible();
  await expect(page.getByText("Found in pasted text").first()).toBeVisible();

  await page.getByRole("button", { name: "Edit pasted text" }).click();
  await expect(page.getByRole("heading", { name: "Paste your assignment text" })).toBeFocused();
  await expect(page.getByTestId("pasted-assignment-brief")).toHaveValue(
    new RegExp(privateTail),
  );

  await page.getByRole("button", { name: "Review assignment details" }).click();
  await page.getByTestId("create-project").click();
  await expect(
    page.getByRole("heading", { name: "Pasted Strategy Report", exact: true }),
  ).toBeVisible();
  await expect.poll(() =>
    page.evaluate(() => window.localStorage.getItem("rubrictrail.project.v2") ?? ""),
  ).not.toContain(privateTail);
  await expectNoHorizontalOverflow(page);
});

test("a versioned project backup can leave and safely restore the browser", async ({ page }) => {
  await page.getByTestId("file-input").setInputFiles({
    name: "strategy-brief.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(COMPLETE_BRIEF),
  });
  await page.getByTestId("create-project").click();
  await expect(page.getByRole("heading", { name: "Strategy Report", exact: true })).toBeVisible();

  await page.getByLabel("Project backup options").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download backup/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^rubrictrail-strategy-report-\d{4}-\d{2}-\d{2}\.rubrictrail\.json$/,
  );
  const backupPath = await download.path();
  expect(backupPath).not.toBeNull();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("Reset local project").click();
  await expect(
    page.getByRole("heading", { name: "Turn the brief into a plan you can prove." }),
  ).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("backup-file-input").setInputFiles(backupPath!);
  await expect(page.getByRole("heading", { name: "Strategy Report", exact: true })).toBeVisible();
  await expect(page.getByTestId("toast")).toContainText("Project restored from backup");
  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByLabel("Project backup options").click();
  await expect(page.getByText("Contains saved project details")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("missing rubric can be repaired manually without fabricating weights", async ({ page }) => {
  await page.getByTestId("file-input").setInputFiles({
    name: "brief-without-rubric.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Assignment title: Service Report\nDeadline: 30 September 2026\nWord count: 2000 words\nUse Harvard referencing.",
    ),
  });

  await expect(page.getByText("0% total")).toBeVisible();
  await page.getByTestId("create-project").click();
  await expect(page.getByTestId("confirm-errors")).toContainText("Add at least one rubric criterion");

  await page.getByRole("button", { name: "Add missing criterion" }).click();
  await page.getByTestId("criterion-name-0").fill("Analysis");
  await page.getByTestId("criterion-weight-0").fill("60");
  await page.getByRole("button", { name: "Add missing criterion" }).click();
  await page.getByTestId("criterion-name-1").fill("Communication");
  await page.getByTestId("criterion-weight-1").fill("40");
  await page.getByTestId("create-project").click();

  await expect(page.getByRole("heading", { name: "Service Report", exact: true })).toBeVisible();
  await expect(page.getByText("2 confirmed criteria")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("unsupported files and empty sample drafts have actionable recovery states", async ({ page }, testInfo) => {
  await useNarrowMobileViewport(page, testInfo);
  await page.getByTestId("file-input").setInputFiles({
    name: "unsafe.exe",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("not an assignment"),
  });
  await expect(page.getByTestId("upload-error")).toContainText("This file type is not supported yet");
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Paste text instead" }).click();
  await expect(page.getByRole("heading", { name: "Paste your assignment text" })).toBeFocused();

  await page.getByTestId("try-sample").click();
  await visibleWorkflowButton(page, "Check").click();
  await page.getByLabel("Report section").selectOption("implementation");
  await page.getByTestId("run-draft-check").click();
  await expect(page.getByText("Turn the proposal into a testable implementation")).toBeVisible();
  await page.getByTestId("draft-text").fill("");
  await expect(page.getByText("Paste your own writing to begin.", { exact: false })).toBeVisible();
  await expect(page.getByTestId("run-draft-check")).toBeDisabled();
});
