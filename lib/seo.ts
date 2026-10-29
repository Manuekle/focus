import type { Metadata } from "next";

// One public origin for canonical links, crawlers and social previews. The
// fallback is the deployed domain, so a Docker build never publishes localhost.
export const siteUrl = new URL(
  "/",
  process.env.FOCUS_PUBLIC_URL?.trim() ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : "https://focusmeta.up.railway.app"),
);

export const siteTitle = "Focus — Bring your drawings to life";
export const siteDescription =
  "Bring your characters to life with Focus. Turn a single drawing into a frame-by-frame animation, explore AI video effects, and export MP4, GIF or sprite sheets.";

// Deliberately shared by Open Graph and Twitter, across every route and locale.
const socialImage = {
  url: "/og.png",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "Focus. Your drawings. In motion. Bring your characters to life, one frame at a time.",
};

export const siteMetadata: Metadata = {
  metadataBase: siteUrl,
  applicationName: "Focus",
  title: siteTitle,
  description: siteDescription,
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Focus",
    title: siteTitle,
    description: siteDescription,
    url: siteUrl,
    images: [socialImage],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: [socialImage],
  },
  // Studios, account flows and legal pages keep their existing noindex policy.
  // The public landing explicitly opts into indexing in app/page.tsx.
  robots: { index: false, follow: false },
};

export const websiteStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${siteUrl}#website`,
      name: "Focus",
      url: siteUrl.href,
      description: siteDescription,
      inLanguage: "en",
    },
    {
      "@type": "WebApplication",
      "@id": `${siteUrl}#application`,
      name: "Focus",
      url: siteUrl.href,
      description: siteDescription,
      image: new URL(socialImage.url, siteUrl).href,
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Web",
      inLanguage: "en",
      featureList: [
        "Frame-by-frame character animation",
        "AI video effects",
        "MP4, GIF, sprite sheet and PNG frame exports",
      ],
    },
  ],
};
