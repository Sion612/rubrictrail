import { expect, test } from "@playwright/test";

const APP_PATH = "/rubrictrail/";

function minimalAssignmentPdf(): Buffer {
  const lines = [
    "Assignment title: Static PDF Report",
    "Deadline: 24 September 2026",
    "Word count: 1500 words",
    "Use APA 7 referencing.",
    "Rubric",
    "Strategic analysis | 100%",
  ];
  const content = [
    "BT",
    "/F1 12 Tf",
    "72 740 Td",
    ...lines.flatMap((line, index) => [
      index === 0 ? "" : "0 -20 Td",
      `(${line.replace(/[()\\]/gu, "\\$&")}) Tj`,
    ]).filter(Boolean),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}

test("the static export stays inside its subpath and parses PDF locally", async ({
  page,
  request,
}) => {
  const origin = "http://127.0.0.1:3101";
  const unexpectedRequests: string[] = [];
  const failedAssets: string[] = [];
  const browserErrors: string[] = [];
  const workerResponses: string[] = [];

  page.on("request", (outgoing) => {
    const url = new URL(outgoing.url());
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    if (url.origin !== origin || !url.pathname.startsWith(APP_PATH)) {
      unexpectedRequests.push(outgoing.url());
    }
    if (url.pathname.includes("/api/")) unexpectedRequests.push(outgoing.url());
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === origin && response.status() >= 400) {
      failedAssets.push(`${response.status()} ${url.pathname}`);
    }
    if (url.pathname.includes("pdf.worker")) workerResponses.push(response.url());
  });
  page.on("requestfailed", (outgoing) => {
    failedAssets.push(`failed ${outgoing.url()}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto(APP_PATH);
  await expect(
    page.getByRole("heading", { name: "Turn the brief into a plan you can prove." }),
  ).toBeVisible();
  await page.getByTestId("file-input").setInputFiles({
    name: "static-assignment.pdf",
    mimeType: "application/pdf",
    buffer: minimalAssignmentPdf(),
  });
  await expect(
    page.getByRole("heading", { name: "Confirm what the assignment says." }),
  ).toBeVisible();
  await expect(page.getByTestId("confirm-title")).toHaveValue("Static PDF Report");
  expect(workerResponses.length).toBeGreaterThan(0);
  expect(unexpectedRequests).toEqual([]);
  expect(failedAssets).toEqual([]);
  expect(browserErrors).toEqual([]);

  for (const route of ["assignment", "draft"]) {
    const response = await request.post(`${APP_PATH}api/live/${route}`, {
      data: { probe: true },
    });
    expect(response.status()).toBe(404);
  }
});
