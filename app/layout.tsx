import type { ReactNode } from "react";
import { FocusProvider } from "../components/focus-provider";
import { siteMetadata } from "../lib/seo";
import { ActivityProvider } from "./_activity/activity-provider";
import "./globals.css";

export const metadata = siteMetadata;
export default function RootLayout({children}: {readonly children: ReactNode}) {
  return <html lang="en" className="dark" style={{ colorScheme: "dark" }} suppressHydrationWarning><head><link rel="preload" href="/fonts/inter/InterVariable-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous"/></head>
    <body suppressHydrationWarning><FocusProvider locale="en" forcedTheme="dark"><ActivityProvider>{children}</ActivityProvider></FocusProvider></body></html>;
}
