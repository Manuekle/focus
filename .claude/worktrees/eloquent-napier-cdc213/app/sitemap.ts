import type { MetadataRoute } from "next";
import { localizedMarketingPath, marketingLanguages, SEO_INDEXABLE, SEO_SITE_URL } from "@/lib/site";
import { LEGAL_INCOMPLETE, LEGAL_LINKS, LEGAL_VERSION } from "@/lib/legal";
import { LANDING_IMAGES } from "@/lib/marketing-content";

/**
 * Canonical public pages only. Incomplete legal documents are noindex and
 * stay out until the operator fills in identity and operational details.
 */
const PAGES: readonly { readonly path: string; readonly priority: number }[] = [
  { path: "/", priority: 1 },
  { path: "/pricing", priority: 0.8 },
  { path: "/simulator", priority: 0.7 },
  { path: "/guide", priority: 0.6 },
  { path: "/team", priority: 0.6 },
  ...(!LEGAL_INCOMPLETE ? LEGAL_LINKS.map((link) => ({ path: link.href, priority: 0.3 })) : []),
];

export default function sitemap(): MetadataRoute.Sitemap {
  if (!SEO_INDEXABLE || !SEO_SITE_URL) return [];

  return PAGES.flatMap((page) =>
    (["es", "en"] as const).map((locale) => ({
      changeFrequency: "monthly" as const,
      ...(LEGAL_LINKS.some((link) => link.href === page.path) ? { lastModified: LEGAL_VERSION } : {}),
      priority: page.priority,
      url: `${SEO_SITE_URL}${localizedMarketingPath(page.path, locale)}`,
      ...(page.path === "/" ? { images: Object.values(LANDING_IMAGES).map((image) => `${SEO_SITE_URL}${image}`) } : {}),
      alternates: { languages: marketingLanguages(page.path) },
    })),
  );
}
