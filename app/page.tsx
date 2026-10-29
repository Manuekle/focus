import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Workspace } from "./_editor/workspace";
import { siteDescription, siteTitle, websiteStructuredData } from "../lib/seo";

const porkys = localFont({
  src: "../public/fonts/porkys/Porkys-Regular.woff2",
  variable: "--font-porkys",
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: siteTitle,
  description: siteDescription,
  alternates: { canonical: "/" },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
};

// Lets the mobile export bar sit above the home indicator (env(safe-area-inset-bottom)).
export const viewport: Viewport = { viewportFit: "cover" };

export default function Page() {
  return (
    <div className={porkys.variable}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteStructuredData).replace(/</g, "\\u003c") }}
      />
      <Workspace />
    </div>
  );
}
