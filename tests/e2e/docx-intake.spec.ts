import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test as base, type Page } from "@playwright/test";

import {
  APP_PATH,
  assignmentPageHeading,
  expectActiveWorkspaceProjectCount,
  expectNoHorizontalOverflow,
  openUploadAssignment,
  reopenAssignment,
} from "./workspace-helpers";

const FILE_NAME = "fictional-paragraph-table.docx";
const FIXTURE_PATH = resolve(__dirname, "../fixtures/docx", FILE_NAME);
const DAMAGED_FILE_NAME = "damaged-paragraph-table.docx";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const TITLE = "Fictional DOCX Paragraph & Table Review";
const COURSE = "DOCX101 Fictional Evidence";
const PRIVATE_PARAGRAPH = "PRIVATE_UNRETAINED_DOCX_PARAGRAPH_Z9";
const CRITERIA = [
  { name: "Table Analysis", weight: 60 },
  { name: "Table Evidence 中文", weight: 40 },
];

const test = base.extend<{ docxBoundaries: void }>({
  docxBoundaries: [async ({ page, baseURL }, use, testInfo) => {
    if (!baseURL) throw new Error("DOCX tests require a configured baseURL.");
    const expectedOrigin = new URL(baseURL).origin;
    const diagnostics = {
      consoleErrors: [] as string[],
      pageErrors: [] as string[],
      offOriginRequests: [] as string[],
      outsideAppPathRequests: [] as string[],
      apiRequests: [] as string[],
      writeRequests: [] as string[],
      failedRequests: [] as string[],
      httpErrors: [] as string[],
    };
    page.on("console", (message) => {
      if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      const label = `${request.method()} ${request.url()}`;
      if (url.origin !== expectedOrigin) diagnostics.offOriginRequests.push(label);
      if (!url.pathname.startsWith(APP_PATH)) diagnostics.outsideAppPathRequests.push(label);
      if (/\/api(?:\/|$)/u.test(url.pathname)) diagnostics.apiRequests.push(label);
      if (!["GET", "HEAD"].includes(request.method())) diagnostics.writeRequests.push(label);
    });
    page.on("requestfailed", (request) => {
      diagnostics.failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        diagnostics.httpErrors.push(`${response.status()} ${response.url()}`);
      }
    });
    await use(undefined);
    await testInfo.attach("docx-browser-boundaries", {
      body: JSON.stringify(diagnostics, null, 2),
      contentType: "application/json",
    });
    for (const [boundary, errors] of Object.entries(diagnostics)) {
      expect(errors, boundary).toEqual([]);
    }
    // The portal also hosts healthy development tools; only error UI is a failure.
    await expect(page.locator(
      'nextjs-portal [data-nextjs-dialog-root]:visible, ' +
      'nextjs-portal [data-next-badge][data-error="true"]',
    )).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  }, { auto: true }],
});

test.beforeEach(async ({ page, baseURL }) => {
  // Playwright supplies a fresh context; avoid a setup reload cancelling assets.
  await page.goto(APP_PATH);
  await expect(page).toHaveTitle(/RubricTrail/u);
  await expect(page).toHaveURL(new URL(APP_PATH, baseURL).href);
  await openUploadAssignment(page);
  await expectActiveWorkspaceProjectCount(page, 0);
});

async function damagedDocx() {
  const valid = await readFile(FIXTURE_PATH);
  return { name: DAMAGED_FILE_NAME, mimeType: DOCX_MIME, buffer: valid.subarray(0, 100) };
}

async function confirmPreview(page: Page) {
  await expect(page.getByRole("heading", { name: "Confirm what the assignment says." })).toBeVisible();
  await expect(page.getByTestId("confirm-title")).toHaveValue(TITLE);
  await expect(page.getByTestId("confirm-deadline")).toHaveValue("2027-09-24");
  await expect(page.getByTestId("confirm-word-count")).toHaveValue("1500");
  await expect(page.getByTestId("confirm-citation-style")).toHaveValue("APA 7");
  // Course labels require the user's confirmation; they are not auto-extracted.
  await expect(page.locator("#confirm-course")).toHaveValue("");
  await page.locator("#confirm-course").fill(COURSE);
  for (const [index, criterion] of CRITERIA.entries()) {
    await expect(page.getByTestId(`criterion-name-${index}`)).toHaveValue(criterion.name);
    await expect(page.getByTestId(`criterion-weight-${index}`)).toHaveValue(String(criterion.weight));
  }
  await expect(page.locator('input[name="rubric-weighting-mode"][value="complete"]')).toBeChecked();
  await expect(page.getByText("Published total: 100%", { exact: true })).toBeVisible();
  await expect(page.locator(".source-strip")).toContainText(FILE_NAME);
  await expect(page.locator(".source-strip")).not.toContainText(DAMAGED_FILE_NAME);
  await expectActiveWorkspaceProjectCount(page, 0);
  await expectNoHorizontalOverflow(page);
}

async function expectSavedProject(page: Page) {
  await expectActiveWorkspaceProjectCount(page, 1);
  const storage = await page.evaluate(() => Object.fromEntries(
    Object.keys(window.localStorage).map((key) => [key, window.localStorage.getItem(key)]),
  ));
  const rawRecords = Object.entries(storage)
    .filter(([key]) => key.startsWith("rubrictrail.workspace.") && key.includes(".project."))
    .map(([, value]) => value);
  expect(rawRecords).toHaveLength(1);
  const record: unknown = JSON.parse(rawRecords[0] ?? "null");
  expect(record).toEqual(expect.objectContaining({
    value: expect.objectContaining({
      kind: "project",
      state: expect.objectContaining({
        projectKind: "uploaded",
        uploadedProject: expect.objectContaining({
          title: TITLE,
          course: COURSE,
          dueDate: "2027-09-24",
          wordCount: 1500,
          citationStyle: "APA 7",
          weightingStatus: "complete",
          fileNames: [FILE_NAME],
          sources: [{
            id: "source-1", fileName: FILE_NAME, kind: "docx",
            origin: "extracted", intakeMethod: "files", pageCount: null,
          }],
          criteria: CRITERIA.map((criterion) => expect.objectContaining({
            ...criterion,
            evidence: expect.objectContaining({
              sourceId: "source-1", fileName: FILE_NAME, page: null,
              origin: "extracted", excerpt: `${criterion.name} | ${criterion.weight}%`,
            }),
          })),
        }),
      }),
    }),
  }));
  expect(JSON.stringify(storage)).not.toContain(PRIVATE_PARAGRAPH);
  expect(JSON.stringify(storage)).not.toContain(DAMAGED_FILE_NAME);
}

async function saveProject(page: Page) {
  await page.getByTestId("create-project").click();
  await expect(assignmentPageHeading(page, TITLE)).toBeVisible();
  await expectSavedProject(page);
}

async function expectRetainedEvidence(page: Page) {
  await page.locator("nav.mobile-workflow:visible, aside.workflow-rail:visible")
    .getByRole("button", { name: /(?:^|\s)Rubric(?:\s|$)/u }).first().click();
  for (const criterion of CRITERIA) {
    await page.getByRole("button", {
      name: `View retained source evidence: ${criterion.name}`, exact: true,
    }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("blockquote")).toHaveText(`${criterion.name} | ${criterion.weight}%`);
    await expect(dialog).toContainText(`Recorded source: ${FILE_NAME}`);
    await expect(dialog).toContainText("Retained excerpt — re-check the original");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
}

test("real DOCX fields and table weights survive saving and reopening without full source text", async ({ page }) => {
  await page.getByTestId("file-input").setInputFiles(FIXTURE_PATH);
  await confirmPreview(page);
  await saveProject(page);
  await expectRetainedEvidence(page);
  await page.reload();
  await reopenAssignment(page, TITLE);
  await expectSavedProject(page);
  await expectRetainedEvidence(page);
});

test("a truncated DOCX leaves no project and recovers through Choose another file", async ({ page }) => {
  await page.getByTestId("file-input").setInputFiles(await damagedDocx());
  const error = page.getByTestId("upload-error");
  await expect(error).toBeVisible();
  await expect(error).toContainText(DAMAGED_FILE_NAME);
  await expect(error).toContainText("We could not open this file.");
  await expect(error).toContainText("Download or save a fresh copy, choose another file, or paste the text.");
  await expect(error).toContainText("Nothing was saved or changed.");
  await expect(page.getByTestId("create-project")).toHaveCount(0);
  await expectActiveWorkspaceProjectCount(page, 0);
  await expectNoHorizontalOverflow(page);
  const chooser = page.waitForEvent("filechooser");
  await error.getByRole("button", { name: "Choose another file", exact: true }).click();
  await (await chooser).setFiles(FIXTURE_PATH);
  await expect(error).toHaveCount(0);
  await confirmPreview(page);
  await saveProject(page);
});

test("a mixed DOCX batch requires explicit acceptance and saves only the readable source", async ({ page }) => {
  await page.getByTestId("file-input").setInputFiles([
    { name: FILE_NAME, mimeType: DOCX_MIME, buffer: await readFile(FIXTURE_PATH) },
    await damagedDocx(),
  ]);
  const partial = page.getByRole("region", { name: "We read 1 of 2 files." });
  await expect(partial).toBeVisible();
  await expect(partial).toContainText(FILE_NAME);
  await expect(partial).toContainText(DAMAGED_FILE_NAME);
  await expect(partial).toContainText("The document could not be read.");
  await expect(page.getByTestId("confirm-title")).toHaveCount(0);
  await expect(page.getByTestId("create-project")).toHaveCount(0);
  await expectActiveWorkspaceProjectCount(page, 0);
  await expectNoHorizontalOverflow(page);
  await partial.getByRole("button", { name: "Review 1 ready file", exact: true }).click();
  await expect(page.getByRole("heading", {
    name: "This preview uses 1 of the 2 selected files.",
  })).toBeVisible();
  await confirmPreview(page);
  await saveProject(page);
  await expectRetainedEvidence(page);
});
