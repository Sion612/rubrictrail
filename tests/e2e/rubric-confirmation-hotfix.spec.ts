import { expect, test, type Page } from "@playwright/test";

const APP_PATH = (() => {
  const configured = process.env.PLAYWRIGHT_APP_PATH?.trim() || "/";
  const withLeadingSlash = configured.startsWith("/") ? configured : `/${configured}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
})();

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

function twoPageRubricPdf(): Buffer {
  const firstPage = pdfText([
    "Assignment title: Fictional Two Page Report",
    "Deadline: 24 September 2026",
    "Word count: 1500 words",
    "Use APA 7 referencing.",
    "Rubric",
    "Criterion Alpha | 50%",
  ]);
  const secondPage = pdfText(["Rubric continued", "Criterion Beta | 50%"]);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(firstPage, "ascii")} >>\nstream\n${firstPage}\nendstream`,
    `<< /Length ${Buffer.byteLength(secondPage, "ascii")} >>\nstream\n${secondPage}\nendstream`,
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

async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewport + 1);
}

test("PDF pages remain attributed and manual rubric locators stay readable", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(APP_PATH);
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByTestId("file-input").setInputFiles({
    name: "fictional-two-page-rubric.pdf",
    mimeType: "application/pdf",
    buffer: twoPageRubricPdf(),
  });

  await expect(page.getByTestId("criterion-name-0")).toHaveValue("Criterion Alpha");
  await expect(page.getByTestId("criterion-name-1")).toHaveValue("Criterion Beta");
  const firstEvidence = page.getByTestId("criterion-name-0")
    .locator("xpath=ancestor::*[contains(@class,'rubric-editor-row')]")
    .locator(".source-evidence-note");
  const secondEvidence = page.getByTestId("criterion-name-1")
    .locator("xpath=ancestor::*[contains(@class,'rubric-editor-row')]")
    .locator(".source-evidence-note");
  await expect(firstEvidence).toContainText("page 1");
  await expect(secondEvidence).toContainText("page 2");

  await page.getByRole("button", { name: "Remove criterion 1" }).click();
  await page.getByRole("button", { name: "Remove criterion 1" }).click();
  await page.getByRole("button", { name: "Add missing criterion" }).click();
  await expect(page.getByTestId("criterion-name-0")).toBeFocused();
  await page.getByTestId("criterion-name-0").fill("Manual verification criterion");
  await page.getByTestId("criterion-weight-0").fill("20");
  await page.getByTestId("criterion-source-0").selectOption("source-1");
  await page.getByTestId("criterion-source-page-0").fill("2");
  await page.getByTestId("create-project").click();

  const totalError = page.locator("#rubric-weight-total");
  const emptyEvidence = page.locator(".rubric-editor-row").first()
    .locator(".source-evidence-note--empty");
  await expect(totalError).toContainText("must total 100%");
  await expect(emptyEvidence).toContainText("No source excerpt was retained");

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
        const note = document.querySelector<HTMLElement>(".source-evidence-note--empty");
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

  await page.getByRole("button", { name: "添加缺失评分项" }).click();
  await expect(page.getByTestId("criterion-name-1")).toBeFocused();
  await page.getByTestId("criterion-name-1").fill("Temporary focus check");
  await page.getByRole("button", { name: "删除第 2 个评分项" }).click();
  await page.getByTestId("criterion-weight-0").fill("100");
  await page.getByTestId("create-project").click();

  await expect(page.getByRole("heading", { name: "Fictional Two Page Report", exact: true }))
    .toBeVisible();
  await page.getByRole("navigation", { name: /项目工作流程|Project workflow/ })
    .getByRole("button", { name: /评分标准|Rubric/ })
    .click();
  await page.getByRole("button", { name: /Manual verification criterion/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("手动添加的评分项");
  await expect(dialog).toContainText("记录的来源：fictional-two-page-rubric.pdf");
  await expect(dialog).toContainText("记录的页码：2");
  await expect(dialog).toContainText("未保留来源摘录");
  await expect(dialog.getByRole("button", { name: "手动添加的评分项" })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "手动添加的评分项" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
