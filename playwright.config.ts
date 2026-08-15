import { defineConfig, devices } from "@playwright/test";

const isCi = process.env.CI === "true";
const useProductionServer = process.env.PLAYWRIGHT_PRODUCTION === "true";

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: "static-export.spec.ts",
  fullyParallel: false,
  forbidOnly: isCi,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    channel: process.env.CI ? undefined : "chrome",
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
    command: useProductionServer
      ? "pnpm start --hostname 127.0.0.1 --port 3100"
      : "pnpm dev --hostname 127.0.0.1 --port 3100",
    env: {
      OPENAI_LIVE_ENABLED: "false",
    },
    url: "http://127.0.0.1:3100",
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "true",
    timeout: 120_000,
  },
});
