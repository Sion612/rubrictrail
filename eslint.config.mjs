import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "demo/.next/**",
    "demo/out/**",
    "demo/public/ocr/**",
    "tests/workspace-dashboard-harness/.next/**",
    "tests/workspace-dashboard-harness/out/**",
    "public/ocr/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
