import { expect, test, type Page } from "@playwright/test";

import { openRestoreAssignment, openUploadAssignment, reopenAssignment, resetWorkspace, returnToAssignments } from "./workspace-helpers";

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

function twoPagePdf(): Buffer {
  const pages = [
    [
      "Assignment title: Locator Edit Report",
      "Deadline: 24 September 2026",
      "Word count: 1500 words",
      "Use APA 7 referencing.",
      "Rubric",
      "Criterion Alpha | 50%",
    ],
    ["Criterion Beta | 50%"],
  ];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
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
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}

function visibleWorkflowButton(page: Page, label: string) {
  return page
    .locator("nav.mobile-workflow:visible, aside.workflow-rail:visible")
    .getByRole("button", { name: new RegExp(`(?:^|\\s)${label}(?:\\s|$)`) })
    .first();
}

test("post-creation locator add, edit, and remove persist without confirming Check", async ({ page }) => {
  test.setTimeout(120_000);
  await resetWorkspace(page);
  await openUploadAssignment(page);
  await page.getByTestId("file-input").setInputFiles({
    name: "locator-edit.pdf",
    mimeType: "application/pdf",
    buffer: twoPagePdf(),
  });
  await expect(page.getByRole("heading", { name: "Confirm what the assignment says." })).toBeVisible();
  await page.getByRole("button", { name: "Add missing criterion" }).click();
  await page.getByTestId("criterion-name-2").fill("Unlinked manual criterion");
  await page.getByTestId("criterion-weight-0").fill("45");
  await page.getByTestId("criterion-weight-1").fill("45");
  await page.getByTestId("criterion-weight-2").fill("10");
  await page.getByTestId("create-project").click();
  await visibleWorkflowButton(page, "Rubric").click();
  await page.getByRole("button", { name: /Add source location: Unlinked manual criterion/ }).click();
  await page.getByTestId("add-locator").click();
  await expect(page.getByTestId("locator-source")).toBeFocused();
  await page.getByTestId("locator-source").selectOption("source-1");
  await page.getByTestId("locator-page").fill("3");
  await page.getByTestId("save-locator").click();
  await expect(page.getByTestId("locator-page-error")).toContainText("1 to 2");
  await page.getByTestId("locator-page").fill("2");
  await page.getByTestId("save-locator").click();
  await expect(page.getByText("Source location saved in this browser")).toBeVisible();
  await expect(page.getByText("1manual locators")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close evidence panel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await visibleWorkflowButton(page, "Check").click();
  await page.getByRole("combobox", { name: "Rubric criterion" }).selectOption("unlinked-manual-criterion-3");
  await page.getByTestId("uploaded-review-text").fill("A checked paragraph with enough detail to save.");
  await page.getByLabel("Evidence is visible").check();
  await page.getByLabel("The link is explained").check();
  await page.getByLabel("The source is traceable").check();
  await page.getByTestId("save-self-check").click();
  await expect(page.getByTestId("toast")).toContainText("Self-check saved");

  await visibleWorkflowButton(page, "Rubric").click();
  await page.getByRole("button", { name: /View or edit source location: Unlinked manual criterion/ }).click();
  await page.getByTestId("edit-locator").click();
  await page.getByTestId("save-locator").click();
  await expect(page.getByTestId("edit-locator")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close evidence panel" }).click();
  await visibleWorkflowButton(page, "Check").click();
  await page.getByRole("combobox", { name: "Rubric criterion" }).selectOption("unlinked-manual-criterion-3");
  await expect(page.getByLabel("The source is traceable")).toBeChecked();
  await expect(page.getByTestId("uploaded-review-text")).toHaveValue(/checked paragraph/);

  await visibleWorkflowButton(page, "Rubric").click();
  await page.getByRole("button", { name: /View or edit source location: Unlinked manual criterion/ }).click();
  await page.getByTestId("edit-locator").click();
  await page.getByTestId("locator-page").fill("1");
  await page.getByTestId("save-locator").click();
  await expect(page.getByText("Source location saved in this browser")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close evidence panel" }).click();
  await visibleWorkflowButton(page, "Check").click();
  await page.getByRole("combobox", { name: "Rubric criterion" }).selectOption("unlinked-manual-criterion-3");
  await expect(page.getByLabel("The source is traceable")).not.toBeChecked();
  await expect(page.getByLabel("Evidence is visible")).toBeChecked();
  await expect(page.getByLabel("The link is explained")).toBeChecked();
  await expect(page.getByTestId("uploaded-review-text")).toHaveValue(/checked paragraph/);

  await page.getByLabel("Project backup options").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download backup/ }).click();
  const backupPath = await downloadPromise.then((item) => item.path());
  expect(backupPath).not.toBeNull();
  await returnToAssignments(page);
  await resetWorkspace(page);
  await openRestoreAssignment(page);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("backup-file-input").setInputFiles(backupPath!);
  await visibleWorkflowButton(page, "Rubric").click();
  await page.getByRole("button", { name: /View or edit source location: Unlinked manual criterion/ }).click();
  await expect(page.getByText("Manually recorded page: 1")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("remove-locator").click();
  await expect(page.getByTestId("add-locator")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close evidence panel" }).click();
  await page.reload();
  await reopenAssignment(page, "Locator Edit Report");
  await visibleWorkflowButton(page, "Rubric").click();
  await expect(page.getByRole("button", { name: /Add source location: Unlinked manual criterion/ })).toBeVisible();
  await page.getByRole("button", { name: /Add source location: Unlinked manual criterion/ }).click();
  await expect(page.getByRole("dialog")).toContainText("No source linked");
  await page.getByRole("dialog").getByRole("button", { name: "Close evidence panel" }).click();
  await visibleWorkflowButton(page, "Check").click();
  await page.getByRole("combobox", { name: "Rubric criterion" }).selectOption("unlinked-manual-criterion-3");
  await expect(page.getByLabel("The source is traceable")).not.toBeChecked();

  await page.getByLabel("Project backup options").click();
  const removedBackup = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download backup/ }).click();
  const removedPath = await removedBackup.then((item) => item.path());
  expect(removedPath).not.toBeNull();
  const { readFile } = await import("node:fs/promises");
  const removedBackupText = await readFile(removedPath!, "utf8");
  expect(removedBackupText).not.toMatch(/"manualSourceLocator":\s*\{\s*"sourceId":\s*"source-1"/);
});
