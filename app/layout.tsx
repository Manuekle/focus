import type { ReactNode } from "react";
import localFont from "next/font/local";
import { FocusProvider } from "../components/focus-provider";
import { siteMetadata } from "../lib/seo";
import { ActivityProvider } from "./_activity/activity-provider";
import { GenerationLimitDialog } from "./_auth/generation-limit-dialog";
import "./globals.css";

// The wordmark and headings use Porkys on every page; defined here so no route can be left without it.
const porkys = localFont({
  src: "../public/fonts/porkys/Porkys-Regular.woff2",
  variable: "--font-porkys",
  weight: "400",
  display: "swap",
});

export const metadata = siteMetadata;
export default function RootLayout({children}: {readonly children: ReactNode}) {
  return <html lang="en" className={`dark ${porkys.variable}`} style={{ colorScheme: "dark" }} suppressHydrationWarning><head><link rel="preload" href="/fonts/inter/InterVariable-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous"/></head>
    <body suppressHydrationWarning><FocusProvider locale="en" forcedTheme="dark"><ActivityProvider>{children}<GenerationLimitDialog /></ActivityProvider></FocusProvider></body></html>;
}
