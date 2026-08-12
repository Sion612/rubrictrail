import { expect, test } from "@playwright/test";

const EXPECTED_SECURITY_HEADERS = {
  "permissions-policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

const DISABLED_LIVE_ROUTES = ["/api/live/assignment", "/api/live/draft"] as const;

test("production runtime enforces its HTTP contract", async ({ request }) => {
  const home = await request.get("/");
  expect(home.status()).toBe(200);

  const homeHeaders = home.headers();
  for (const [name, value] of Object.entries(EXPECTED_SECURITY_HEADERS)) {
    expect(homeHeaders[name]).toBe(value);
  }
  expect(homeHeaders["x-powered-by"]).toBeUndefined();

  for (const route of DISABLED_LIVE_ROUTES) {
    const response = await request.post(route, {
      data: { mode: "live", assignmentText: "Production runtime smoke test" },
    });

    expect(response.status(), route).toBe(503);
    expect(response.headers()["cache-control"], route).toContain("no-store");
    expect(response.headers()["content-type"], route).toContain("application/json");
    const body = await response.json();
    expect(body, route).toEqual({
      ok: false,
      error: {
        code: "LIVE_DISABLED",
        message: "Live AI is disabled. The local workflow remains available.",
        retryable: false,
      },
    });
  }
});
