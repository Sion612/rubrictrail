import type { MetadataRoute } from "next";
import { PUBLIC_DEMO_URL } from "./public-demo-metadata";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: PUBLIC_DEMO_URL }];
}
