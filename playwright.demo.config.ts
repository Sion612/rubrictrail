import { defineConfig, devices } from "@playwright/test";

const isCi = process.env.CI === "true";
const appPath = process.env.PLAYWRIGHT_APP_PATH || "/rubrictrail/";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["core-flow.spec.ts", "i18n.spec.ts", "static-export.spec.ts"],
  fullyParallel: false,
  forbidOnly: isCi,
  retries: 0,
  reporter: "list",
  outputDir: "test-results/static-demo",
  use: {
    baseURL: "http://127.0.0.1:3101",
    channel: isCi ? undefined : "chrome",
    launchOptions: {
      args: ["--disable-background-mode"],
    },
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-chrome",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: "node scripts/serve-static-demo.mjs",
    env: {
      PORT: "3101",
      STATIC_DEMO_BASE_PATH: appPath,
      STATIC_DEMO_ROOT: "demo/out",
    },
    url: `http://127.0.0.1:3101${appPath.endsWith("/") ? appPath : `${appPath}/`}`,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "true",
    timeout: 30_000,
  },
});
