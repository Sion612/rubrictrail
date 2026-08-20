import { defineConfig, devices } from "@playwright/test";

const isCi = process.env.CI === "true";
const appPath = "/workspace-dashboard-test/";

export default defineConfig({
  testDir: "./tests/workspace-dashboard-e2e",
  fullyParallel: false,
  forbidOnly: isCi,
  retries: 0,
  reporter: "list",
  outputDir: "test-results/workspace-dashboard",
  use: {
    baseURL: "http://127.0.0.1:3102",
    channel: isCi ? undefined : "chrome",
    launchOptions: {
      args: ["--disable-background-mode"],
    },
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "workspace-1440",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "workspace-1024",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } },
    },
    {
      name: "workspace-768",
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 900 } },
    },
    {
      name: "workspace-390",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "workspace-320",
      use: { ...devices["Desktop Chrome"], viewport: { width: 320, height: 700 } },
    },
  ],
  webServer: {
    command: "node scripts/serve-static-demo.mjs",
    env: {
      PORT: "3102",
      STATIC_DEMO_BASE_PATH: appPath,
      STATIC_DEMO_ROOT: "tests/workspace-dashboard-harness/out",
    },
    url: `http://127.0.0.1:3102${appPath}`,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "true",
    timeout: 30_000,
  },
});
