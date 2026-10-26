import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MotionProvider } from "@/components/motion/provider";
import { ThemeProvider } from "@/components/theme-provider";
import { I18nProvider } from "@/lib/i18n/provider";
import { OfflineGate } from "@/components/offline-gate";
import { SoundProvider } from "@/components/sound-provider";
import { ToastProvider } from "@/components/toast-provider";
import { PrivacyConsent } from "@/components/privacy-consent";
import { FontPlatform } from "@/components/font-platform";
import { ViewportSync } from "@/components/viewport-sync";
import { SEO_INDEXABLE, SEO_SITE_URL, SITE_NAME } from "@/lib/site";
import { MARKETING_CONTENT, MARKETING_OG_CONTENT, marketingImageUrl } from "@/lib/marketing-content";
import { OG_SIZE } from "@/lib/og-size";
import { FONT_PLATFORM_SCRIPT, interfaceFontPreloadScript } from "@/lib/font-platform";
import { MARKETING_LOCALE_SCRIPT } from "@/lib/marketing-locale";
import "./globals.css";

// Shared mono labels (including the hero frame), code blocks and the score
// readouts — one Geist Mono face for every platform.
const mono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
  preload: false,
});

// Apple uses its installed SF Pro (Text/Display for text, Rounded for
// headings and numerals) and Geist Mono, and never downloads SN Pro or Inter. Other platforms use self-hosted
// SN Pro (with Inter as fallback) and Geist Mono, and never Apple fonts;
// Cooper remains the brand's display face on every platform.

const home = MARKETING_CONTENT.es.home;
const homeImage = {
  url: marketingImageUrl("es", "home"),
  width: OG_SIZE.width,
  height: OG_SIZE.height,
  type: "image/png",
  alt: `Oruka — ${MARKETING_OG_CONTENT.home.lines.join(" ")} ${MARKETING_OG_CONTENT.home.eyebrow}.`,
};

export const metadata: Metadata = {
  // Every route under this layout resolves its relative metadata URLs against
  // this — the default share card below, and the `icon.svg` / `apple-icon`
  // links Next emits from the file convention.
  ...(SEO_SITE_URL ? { metadataBase: new URL(SEO_SITE_URL) } : {}),
  title: home.title,
  applicationName: SITE_NAME,
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "default" },
  description: home.description,
  keywords: [...home.keywords],
  category: "technology",
  creator: SITE_NAME,
  publisher: SITE_NAME,
  robots: SEO_INDEXABLE ? undefined : { index: false, follow: false },
  // The card every page without its own shares — the white SF Pro + Cooper
  // home card. Marketing pages replace it with theirs (marketingMetadata).
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "es_CO",
    title: home.title,
    description: home.description,
    images: [homeImage],
  },
  twitter: {
    card: "summary_large_image",
    title: home.title,
    description: home.description,
    images: [homeImage],
  },
  // Safari (iOS/macOS) rewrites anything that looks like a phone number into
  // `<a href="tel:…">` before React hydrates, so the server HTML (plain text)
  // never matches the client DOM. The landing demo renders mock numbers like
  // "+54 9 341 615-2290" — that rewrite was the hydration mismatch in
  // `screen-inbox.tsx`. Opt out page-wide.
  formatDetection: { telephone: false },
};

// Mobile fields have a 16px floor in globals.css, preventing focus zoom
// without restricting manual zoom. Android resizes for its keyboard; Safari
// uses ViewportSync to publish its visual viewport instead.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#171717" },
  ],
};

/**
 * Sets the theme class before the browser paints anything.
 *
 * This has to be a raw inline <script>, not `next/script`. In the App Router
 * a `beforeInteractive` script is not inlined into the HTML — it is pushed
 * onto `self.__next_s` and replayed by the Next runtime once the framework
 * bundle has loaded. That is long after first paint, so every full page load
 * in dark mode rendered the light palette first and then snapped to dark: the
 * white flash. A plain inline script runs during head parsing, before any
 * paint, which is the whole point of it.
 *
 * This was tried again with `next/script` and the served HTML is the proof:
 * the head ships `(self.__next_s=self.__next_s||[]).push([0,{"children":"..."}])`
 * — the source as data, not as a script that runs. The raw tag ships
 * `<script>(function(){...})()</script>` in the same position and executes there.
 *
 * `color-scheme` goes on too, so the parts the page does not paint itself —
 * the canvas behind it, scrollbars, form controls — start out dark as well.
 */
const themeInitScript = `
(function() {
  try {
    var stored = localStorage.getItem('oruka-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored === 'dark' || stored === 'light' ? stored : (prefersDark ? 'dark' : 'light');
    var root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.classList.toggle('light', theme === 'light');
    root.style.colorScheme = theme;
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <html
      className={mono.variable}
      lang="es"
      suppressHydrationWarning
    >
      <head>
        <script id="marketing-locale" dangerouslySetInnerHTML={{ __html: MARKETING_LOCALE_SCRIPT }} />
        <script id="font-platform" dangerouslySetInnerHTML={{ __html: FONT_PLATFORM_SCRIPT }} />
        {/* Parser-executed, right after the platform flag it reads: the early
            font preload for non-Apple platforms. Lives here rather than in a
            page component — scripts rendered inside React components never
            execute on client navigation. */}
        <script
          id="interface-font-preload"
          dangerouslySetInnerHTML={{
            __html: interfaceFontPreloadScript("/fonts/sn-pro/SNPro-latin.woff2"),
          }}
        />
        <script
          id="theme-init"
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
          suppressHydrationWarning
        />
      </head>

      <body suppressHydrationWarning>
        <FontPlatform />
        <ViewportSync />
        <MotionProvider>
          <ThemeProvider>
            <I18nProvider>
              <SoundProvider>
                <TooltipProvider>
                  <ToastProvider><OfflineGate>{children}</OfflineGate><PrivacyConsent /></ToastProvider>
                </TooltipProvider>
              </SoundProvider>
            </I18nProvider>
          </ThemeProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
