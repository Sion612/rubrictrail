import path from "node:path";
import type { NextConfig } from "next";

const repositoryRoot = path.resolve(__dirname, "..");
const pagesBasePath = process.env.PAGES_BASE_PATH?.trim() ?? "";

if (
  pagesBasePath !== "" &&
  (!/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/u.test(pagesBasePath) ||
    pagesBasePath.split("/").some((segment) => segment === "." || segment === ".."))
) {
  throw new Error(
    "PAGES_BASE_PATH must be empty or a safe absolute path without a trailing slash.",
  );
}

const nextConfig: NextConfig = {
  output: "export",
  basePath: pagesBasePath,
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  turbopack: {
    root: repositoryRoot,
  },
};

export default nextConfig;
