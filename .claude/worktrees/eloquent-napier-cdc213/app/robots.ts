import type { MetadataRoute } from "next";
import { SEO_INDEXABLE, SEO_SITE_URL } from "@/lib/site";

const PUBLIC_PATHS = [
  "/$", "/pricing$", "/simulator$", "/guide$", "/team$",
  "/en$", "/en/pricing$", "/en/simulator$", "/en/guide$", "/en/team$",
  "/terms$", "/privacy$", "/legal$", "/privacy-rights$", "/cookies$",
  "/en/terms$", "/en/privacy$", "/en/legal$", "/en/privacy-rights$", "/en/cookies$",
  "/llms.txt$", "/llms-full.txt$", "/sitemap.xml$",
  "/images/oruka-customer-care.webp$", "/images/oruka-reservation.webp$", "/images/oruka-team.webp$",
  "/textures/grain.svg$", "/people/",
  "/_next/static/", "/_next/image", "/fonts/", "/logos/", "/patterns/", "/og/", "/opengraph-image", "/icon.svg", "/apple-icon", "/favicon.ico",
].flatMap((path) => path.endsWith("$") ? [path, `${path.slice(0, -1)}?`] : [path]);

const SEARCH_CRAWLERS = [
  "Googlebot",
  "bingbot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
] as const;

const publicRule = (userAgent: string) => ({ userAgent, allow: [...PUBLIC_PATHS], disallow: "/" });

/**
 * Only the marketing surface is meant to be indexed. Rendering resources
 * must remain crawlable. Everything else in this
 * app is someone's inbox, their contacts, their campaign spend and their model
 * keys — pages that are behind whatever auth the operator puts in front of the
 * deployment, and that have no business being crawled even when they are not.
 *
 * So the rule is deny-by-default with an explicit allowlist, rather than a
 * disallow list that has to be remembered every time a page is added.
 */
export default function robots(): MetadataRoute.Robots {
  if (!SEO_INDEXABLE || !SEO_SITE_URL) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: [
      publicRule("*"),
      ...SEARCH_CRAWLERS.map(publicRule),
      process.env.SEO_ALLOW_GPTBOT === "true" ? publicRule("GPTBot") : { userAgent: "GPTBot", disallow: "/" },
    ],
    sitemap: `${SEO_SITE_URL}/sitemap.xml`,
  };
}
