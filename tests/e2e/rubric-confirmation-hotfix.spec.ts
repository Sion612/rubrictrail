import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const APP_PATH = (() => {
  const configured = process.env.PLAYWRIGHT_APP_PATH?.trim() || "/";
  const withLeadingSlash = configured.startsWith("/") ? configured : `/${configured}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
})();

const PROJECT_RECORD_KEY = "rubrictrail.project.store.v1";

function pdfText(lines: string[]): string {
  return [
    "BT",
    "/F1 12 Tf",
    "72 740 Td",
    ...lines.flatMap((line, index) => [
      index === 0 ? "" : "0 -20 Td",
      `(${line.replace(/[()\\]/gu, "\\$&")}) Tj`,
    ]).filter(Boolean),
    "ET",
  ].join("\n");
}

function rubricPdf(pages: string[][]): Buffer {
  const pageObjectStart = 3;
  const fontObject = pageObjectStart + pages.length;
  const contentObjectStart = fontObject + 1;
  const pageRefs = pages.map((_, index) => `${pageObjectStart + index} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >>`,
    ...pages.map((_, index) =>
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentObjectStart + index} 0 R >>`,
    ),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...pages.map((lines) => {
      const content = pdfText(lines);
      return `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`;
    }),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}

function threePageTraceabilityPdf(): Buffer {
  return rubricPdf([
    [
      "Assignment title: Fictional Traceability Report",
      "Deadline: 24 September 2026",
      "Word count: 1500 words",
      "Use APA 7 referencing.",
      "Rubric",
      "Criterion Alpha | 50%",
      "Private full-page sentence that must not be stored.",
    ],
    [],
    ["Rubric continued", "Criterion Beta | 50%"],
  ]);
}

function twoPageRubricPdf(): Buffer {
  return rubricPdf([
    [
      "Assignment title: Fictional Two Page Report",
      "Deadline: 24 September 2026",
      "Word count: 1500 words",
      "Use APA 7 referencing.",
      "Rubric",
      "Criterion Alpha | 50%",
    ],
    ["Rubric continued", "Criterion Beta | 50%"],
  ]);
}

async function resetApp(page: Page) {
  await page.goto(APP_PATH);
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Turn the brief into a plan you can prove." }),
  ).toBeVisible();
}

function visibleWorkflowButton(page: Page, label: RegExp) {
  return page
    .locator("nav.mobile-workflow:visible, aside.workflow-rail:visible")
    .getByRole("button", { name: label })
    .first();
}

async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewport + 1);
}

async function openEvidence(page: Page, criterionName: string) {
  await page.getByRole("button", { name: new RegExp(`Open source for ${criterionName}`) }).click();
  return page.getByRole("dialog");
}

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

test("source traceability survives parsing, reload, and backup restoration", async ({ page }) => {
  test.setTimeout(120_000);
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.getByTestId("file-input").setInputFiles([
    {
      name: "skipped-first.rtf",
      mimeType: "application/rtf",
      buffer: Buffer.from("fictional unsupported source"),
    },
    {
      name: "fictional-three-page-rubric.pdf",
      mimeType: "application/pdf",
      buffer: threePageTraceabilityPdf(),
    },
    {
      name: "fictional-follow-up.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("A short fictional follow-up note that is not a rubric criterion."),
    },
  ]);
  await expect(page.getByRole("heading", { name: "We read 2 of 3 files." })).toBeVisible();
  await page.getByRole("button", { name: "Review 2 ready files" }).click();

  await expect(page.getByTestId("criterion-name-0")).toHaveValue("Criterion Alpha");
  await expect(page.getByTestId("criterion-name-1")).toHaveValue("Criterion Beta");
  await expect(
    page.getByTestId("criterion-name-0")
      .locator("xpath=ancestor::*[contains(@class,'rubric-editor-row')]")
      .locator(".source-evidence-note"),
  ).toContainText("page 1");
  await expect(
    page.getByTestId("criterion-name-1")
      .locator("xpath=ancestor::*[contains(@class,'rubric-editor-row')]")
      .locator(".source-evidence-note"),
  ).toContainText("page 3");

  await page.getByRole("button", { name: "Add missing criterion" }).click();
  await expect(page.getByTestId("criterion-name-2")).toBeFocused();
  await page.getByTestId("criterion-name-2").fill("Manual locator criterion");
  await page.getByTestId("criterion-weight-2").fill("10");
  await page.getByTestId("criterion-source-2").selectOption("source-2");
  await expect(page.getByTestId("criterion-source-2").locator("option:checked"))
    .toHaveText(/fictional-three-page-rubric\.pdf · PDF · Source 2/);
  await expect(page.getByTestId("criterion-source-page-2")).toHaveAttribute("max", "3");
  await expect(page.getByText("This PDF contains 3 pages. You may leave the page blank."))
    .toBeVisible();
  await page.getByTestId("criterion-source-page-2").fill("4");

  await page.getByRole("button", { name: "Add missing criterion" }).click();
  await expect(page.getByTestId("criterion-name-3")).toBeFocused();
  await page.getByTestId("criterion-name-3").fill("Unlinked manual criterion");
  await page.getByTestId("criterion-weight-3").fill("10");
  await page.getByTestId("create-project").click();

  const errorSummary = page.getByTestId("confirm-errors");
  const pageError = page.locator("#criterion-source-page-2-error");
  const totalError = page.locator("#rubric-weight-total");
  await expect(errorSummary).toBeFocused();
  await expect(errorSummary).toContainText("Criterion 3: enter a whole PDF page from 1 to 3");
  await expect(pageError).toContainText("Criterion 3: enter a whole PDF page from 1 to 3");
  await expect(totalError).toContainText("must total 100%");
  await errorSummary.getByRole("link", { name: /Criterion 3: enter a whole PDF page/ }).click();
  await expect(page.getByTestId("criterion-source-page-2")).toBeFocused();

  await page.getByTestId("criterion-source-page-2").fill("2");
  await page.getByTestId("create-project").click();
  await expect(totalError).toContainText("must total 100%");

  const emptyEvidence = page.locator(".rubric-editor-row").nth(2)
    .locator(".source-evidence-note--empty");
  const viewports = [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 768, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 844 },
  ];
  for (const locale of ["en", "zh-CN"] as const) {
    await page.getByRole("combobox", { name: /language|语言/i }).selectOption(locale);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await expectNoHorizontalOverflow(page);
      const boxes = await page.evaluate(() => {
        const note = document.querySelectorAll<HTMLElement>(".source-evidence-note--empty")[0];
        const index = document.querySelector<HTMLElement>(".criterion-index");
        const aggregate = document.querySelector<HTMLElement>("#rubric-weight-total");
        const weight = document.querySelector<HTMLElement>(".weight-field");
        return {
          note: note?.getBoundingClientRect().width ?? 0,
          index: index?.getBoundingClientRect().width ?? 0,
          aggregate: aggregate?.getBoundingClientRect().width ?? 0,
          weight: weight?.getBoundingClientRect().width ?? 0,
        };
      });
      expect(boxes.note).toBeGreaterThan(boxes.index * 3);
      expect(boxes.aggregate).toBeGreaterThan(boxes.weight);
    }
  }
  await expect(emptyEvidence).toContainText("此字段未保留原文摘录");
  await expect(totalError).toContainText("必须合计为 100%");

  await page.getByRole("combobox", { name: /language|语言/i }).selectOption("en");
  await page.getByTestId("criterion-weight-0").fill("40");
  await page.getByTestId("criterion-weight-1").fill("40");
  await page.getByTestId("create-project").click();

  await expect(page.getByRole("heading", { name: "Fictional Traceability Report", exact: true }))
    .toBeVisible();
  const sourceRegister = page.getByRole("region", { name: "Sources used for this project" });
  await expect(sourceRegister).toContainText("fictional-three-page-rubric.pdf");
  await expect(sourceRegister).toContainText("PDF · 3 pages");
  await expect(sourceRegister).toContainText("fictional-follow-up.txt");
  await expect(sourceRegister).toContainText("TXT · extracted text");

  await expect.poll(async () => page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const record = JSON.parse(raw) as { value?: { state?: { uploadedProject?: { sources?: { id: string }[] } } } };
    return record.value?.state?.uploadedProject?.sources?.map((source) => source.id) ?? null;
  }, PROJECT_RECORD_KEY)).toEqual(["source-2", "source-3"]);

  await visibleWorkflowButton(page, /Rubric/).click();
  const summaryBand = page.locator(".rubric-summary-band");
  await expect(summaryBand).toContainText("2retained excerpts");
  await expect(summaryBand).toContainText("1manual locators");
  await expect(summaryBand).toContainText("1no source linked");

  let dialog = await openEvidence(page, "Criterion Alpha");
  await expect(dialog).toContainText("Recorded page: 1");
  await expect(dialog).toContainText("Criterion Alpha | 50%");
  await dialog.getByRole("button", { name: "Close evidence panel" }).click();
  dialog = await openEvidence(page, "Criterion Beta");
  await expect(dialog).toContainText("Recorded page: 3");
  await dialog.getByRole("button", { name: "Close evidence panel" }).click();
  dialog = await openEvidence(page, "Manual locator criterion");
  await expect(dialog).toContainText("Manually linked source: fictional-three-page-rubric.pdf");
  await expect(dialog).toContainText("Manually recorded page: 2");
  await expect(dialog).toContainText("No retained excerpt");
  await dialog.getByRole("button", { name: "Close evidence panel" }).click();
  dialog = await openEvidence(page, "Unlinked manual criterion");
  await expect(dialog).toContainText("No source linked");
  await expect(dialog).not.toContainText("Page not available");
  await dialog.getByRole("button", { name: "Close evidence panel" }).click();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Confirm what earns marks." })).toBeVisible();
  dialog = await openEvidence(page, "Manual locator criterion");
  await expect(dialog).toContainText("Manually recorded page: 2");
  await dialog.getByRole("button", { name: "Close evidence panel" }).click();

  await page.getByRole("combobox", { name: /language|语言/i }).selectOption("zh-CN");
  await page.getByRole("button", { name: /打开Manual locator criterion的来源/ }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("手动关联来源：fictional-three-page-rubric.pdf");
  await expect(dialog).toContainText("手动记录页码：2");
  await expect(dialog).toContainText("未保留来源摘录");
  await dialog.getByRole("button", { name: "关闭原文依据面板" }).click();
  await page.setViewportSize({ width: 320, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.getByRole("combobox", { name: /language|语言/i }).selectOption("en");

  await page.getByLabel("Project backup options").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download backup/ }).click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  expect(backupPath).not.toBeNull();
  const backupText = await readFile(backupPath!, "utf8");
  const backup = JSON.parse(backupText) as {
    formatVersion: number;
    project: {
      version: number;
      uploadedProject: {
        sources: { id: string; pageCount: number | null; text?: unknown; pages?: unknown }[];
        criteria: {
          id: string;
          evidence: { page: number; excerpt: string } | null;
          manualSourceLocator?: { sourceId: string; page: number | null } | null;
        }[];
      };
    };
  };
  expect(backup.formatVersion).toBe(1);
  expect(backup.project.version).toBe(3);
  expect(backup.project.uploadedProject.sources.map((source) => source.id)).toEqual(["source-2", "source-3"]);
  expect(backup.project.uploadedProject.sources[0].pageCount).toBe(3);
  expect(backup.project.uploadedProject.sources.every((source) => !("text" in source) && !("pages" in source))).toBe(true);
  expect(backup.project.uploadedProject.criteria.find((criterion) => criterion.id === "manual-locator-criterion-3")?.manualSourceLocator)
    .toEqual({ sourceId: "source-2", page: 2 });
  expect(backupText).not.toContain("Private full-page sentence that must not be stored.");
  expect(backupText).not.toContain("%PDF-1.4");

  page.once("dialog", (confirmation) => confirmation.accept());
  await page.getByLabel("Reset local project").click();
  await expect(page.getByRole("heading", { name: "Turn the brief into a plan you can prove." })).toBeVisible();
  page.once("dialog", (confirmation) => confirmation.accept());
  await page.getByTestId("backup-file-input").setInputFiles(backupPath!);
  await expect(page.locator("#workspace-main").getByText("Fictional Traceability Report", { exact: true }))
    .toBeVisible();
  await expect(page.getByRole("heading", { name: "Confirm what earns marks." })).toBeVisible();

  await visibleWorkflowButton(page, /Rubric/).click();
  dialog = await openEvidence(page, "Criterion Alpha");
  await expect(dialog).toContainText("Recorded page: 1");
  await dialog.getByRole("button", { name: "Close evidence panel" }).click();
  dialog = await openEvidence(page, "Criterion Beta");
  await expect(dialog).toContainText("Recorded page: 3");
  await dialog.getByRole("button", { name: "Close evidence panel" }).click();
  dialog = await openEvidence(page, "Manual locator criterion");
  await expect(dialog).toContainText("Manually recorded page: 2");
  await expect(dialog).toContainText("No retained excerpt");
  await dialog.getByRole("button", { name: "Close evidence panel" }).click();

  await visibleWorkflowButton(page, /Check/).click();
  await page.getByRole("combobox", { name: "Rubric criterion" }).selectOption("manual-locator-criterion-3");
  await expect(page.getByRole("checkbox", { name: /The source is traceable/ })).not.toBeChecked();
  await expect(page.getByText("Self-check still incomplete")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save self-check" })).toBeDisabled();

  await visibleWorkflowButton(page, /Progress/).click();
  await expect(page.getByText("Manual source locations still need checking")).toBeVisible();
  await expect(page.getByText("Manual criteria have no source location")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(browserErrors).toEqual([]);
});

test("a two-page PDF rejects page 3 before project creation", async ({ page }) => {
  test.setTimeout(60_000);
  await page.getByTestId("file-input").setInputFiles({
    name: "fictional-two-page-rubric.pdf",
    mimeType: "application/pdf",
    buffer: twoPageRubricPdf(),
  });
  await page.getByRole("button", { name: "Add missing criterion" }).click();
  await page.getByTestId("criterion-name-2").fill("Manual verification criterion");
  await page.getByTestId("criterion-weight-0").fill("45");
  await page.getByTestId("criterion-weight-1").fill("45");
  await page.getByTestId("criterion-weight-2").fill("10");
  await page.getByTestId("criterion-source-2").selectOption("source-1");
  await expect(page.getByTestId("criterion-source-page-2")).toHaveAttribute("max", "2");
  await page.getByTestId("criterion-source-page-2").fill("3");
  await page.getByTestId("create-project").click();

  await expect(page.locator("#criterion-source-page-2-error"))
    .toContainText("Criterion 3: enter a whole PDF page from 1 to 2");
  await expect(page.getByTestId("confirm-errors"))
    .toContainText("Criterion 3: enter a whole PDF page from 1 to 2");
  await expect(page.getByRole("heading", { name: "Confirm what the assignment says." })).toBeVisible();

  await page.getByTestId("criterion-source-page-2").fill("2");
  await page.getByTestId("create-project").click();
  await expect(page.getByRole("heading", { name: "Fictional Two Page Report", exact: true }))
    .toBeVisible();
});
