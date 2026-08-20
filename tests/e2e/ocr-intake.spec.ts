import { expect, test, type Browser } from "@playwright/test";

import { openUploadAssignment } from "./workspace-helpers";

async function fictionalOcrScreenshot(browser: Browser): Promise<Buffer> {
  const fixturePage = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  try {
    await fixturePage.setContent(`<!doctype html>
      <html><head><style>
        html,body { margin: 0; width: 1600px; height: 900px; background: white; }
        main { padding: 90px; color: #111; font: 60px/1.55 Arial, "Microsoft YaHei", sans-serif; }
        h1 { font-size: 72px; margin: 0 0 36px; }
      </style></head><body><main>
        <h1>Assignment title: Fictional OCR Brief</h1>
        <div>Deadline: 24 September 2026</div>
        <div>Word count: 1500 words</div>
        <div>Use APA 7 referencing.</div>
        <div>Rubric</div>
        <div>分析 | 100%</div>
      </main></body></html>`);
    return await fixturePage.screenshot({ type: "png" });
  } finally {
    await fixturePage.close();
  }
}

test("keeps OCR runtime deferred for a text-only intake", async ({ page }) => {
  const appPath = process.env.PLAYWRIGHT_APP_PATH || "/";
  const ocrRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.includes("/ocr/")) ocrRequests.push(url.pathname);
  });

  await page.goto(appPath);
  await openUploadAssignment(page);
  await page.getByTestId("file-input").setInputFiles({
    name: "fictional-brief.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Assignment title: Fictional text brief\nRubric\nAnalysis | 100%"),
  });
  await expect(page.getByTestId("confirm-title")).toHaveValue("Fictional text brief");
  expect(ocrRequests).toEqual([]);
});

test("recognizes a fictional image locally and recovers from a damaged image", async ({
  browser,
  page,
}, testInfo) => {
  const appPath = process.env.PLAYWRIGHT_APP_PATH || "/";
  const expectedOrigin = new URL(String(testInfo.project.use.baseURL)).origin;
  const unexpectedNetwork: string[] = [];
  const ocrResponses: string[] = [];
  const browserErrors: string[] = [];

  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== expectedOrigin) {
      unexpectedNetwork.push(`${request.method()} ${url.origin}${url.pathname}`);
    }
    if (url.pathname.includes("/api/")) {
      unexpectedNetwork.push(`${request.method()} ${url.origin}${url.pathname}`);
    }
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.includes("/ocr/")) {
      ocrResponses.push(`${response.status()} ${url.pathname}`);
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  const screenshot = await fictionalOcrScreenshot(browser);
  await page.goto(appPath);
  await openUploadAssignment(page);
  await page.getByTestId("file-input").setInputFiles([
    {
      name: "fictional-ocr-brief.png",
      mimeType: "image/png",
      buffer: screenshot,
    },
    {
      name: "damaged.png",
      mimeType: "image/png",
      buffer: Buffer.from([1, 2, 3, 4]),
    },
  ]);

  await expect(page.getByText(/We read 1 of 2 files\./u)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("damaged.png")).toBeVisible();
  await page.getByRole("button", { name: /Review 1 ready file/u }).click();
  await expect(page.getByTestId("confirm-title")).toHaveValue(
    "Fictional OCR Brief",
  );
  await expect(page.getByTestId("ocr-source-notice")).toContainText("local OCR");
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.getByTestId("ocr-source-notice")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);

  expect(ocrResponses.some((entry) => entry.includes("/ocr/worker.min.js"))).toBe(true);
  expect(ocrResponses.some((entry) => entry.includes("tesseract-core-") && entry.startsWith("200"))).toBe(true);
  expect(ocrResponses.some((entry) => entry.includes("eng.traineddata.gz") && entry.startsWith("200"))).toBe(true);
  expect(ocrResponses.some((entry) => entry.includes("chi_sim.traineddata.gz") && entry.startsWith("200"))).toBe(true);
  expect(ocrResponses.every((entry) => entry.startsWith("200"))).toBe(true);
  expect(unexpectedNetwork).toEqual([]);
  const knownTesseractLanguageDiagnostics =
    /^Warning: Parameter not found: (?:language_model_ngram_on|segsearch_max_char_wh_ratio|language_model_ngram_space_delimited_language|language_model_use_sigmoidal_certainty|language_model_ngram_nonmatch_score|classify_integer_matcher_multiplier|assume_fixed_pitch_char_segment|allow_blob_division)$/u;
  expect(
    browserErrors.filter((message) => !knownTesseractLanguageDiagnostics.test(message)),
  ).toEqual([]);
});
