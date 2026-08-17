import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const baseUrl = process.env.RUBRICTRAIL_BASE_URL ?? "http://127.0.0.1:3100";
const outputDirectory = path.resolve("docs/assets");
const channel = process.env.CI ? undefined : "chrome";

const fixture = [
  "Assignment title: Strategy Report",
  "Deadline: 24 September 2026",
  "Word count: 2500 words",
  "Use APA 7 referencing.",
  "Rubric",
  "Strategic analysis | 40%",
  "Recommendations | 35%",
  "Communication | 25%",
].join("\n");

async function createProject(page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("file-input").setInputFiles({
    name: "strategy-brief.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(fixture),
  });
  await page.getByTestId("create-project").click();
  await page.getByRole("heading", { name: "Strategy Report", exact: true }).waitFor();
  await page.waitForFunction(() => window.scrollY === 0);
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ channel });

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.emulateMedia({ reducedMotion: "reduce" });
  await createProject(desktop);
  await desktop.getByRole("button", { name: "Review rubric" }).click();
  await desktop.waitForFunction(() => window.scrollY === 0);
  await desktop.getByRole("button", { name: "View retained source evidence: Strategic analysis" }).click();
  await desktop.getByTestId("toast").waitFor({ state: "detached", timeout: 5_000 });
  await desktop.evaluate(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await desktop.waitForFunction(() => window.scrollY === 0);
  await desktop.screenshot({
    path: path.join(outputDirectory, "rubrictrail-workspace.png"),
    animations: "disabled",
  });
  await desktop.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.emulateMedia({ reducedMotion: "reduce" });
  await createProject(mobile);
  await mobile.getByRole("button", { name: "Review rubric" }).click();
  await mobile.waitForFunction(() => window.scrollY === 0);
  await mobile.getByTestId("toast").waitFor({ state: "detached", timeout: 5_000 });
  await mobile.screenshot({
    path: path.join(outputDirectory, "rubrictrail-mobile.png"),
    animations: "disabled",
  });
  await mobile.close();

  console.log(`Saved screenshots to ${outputDirectory}`);
} finally {
  await browser.close();
}
