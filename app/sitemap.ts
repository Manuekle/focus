import type { MetadataRoute } from "next";
import { siteUrl } from "../lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  // Only the public, indexable landing belongs here; projects stay noindex.
  return [{ url: siteUrl.href }];
}
