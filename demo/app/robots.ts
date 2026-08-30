import type { MetadataRoute } from "next";
import { PUBLIC_DEMO_SITEMAP_URL } from "./public-demo-metadata";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/rubrictrail/",
    },
    sitemap: PUBLIC_DEMO_SITEMAP_URL,
  };
}
