import type { Metadata } from "next";
import type { ReactNode } from "react";
import { FocusProvider } from "../components/focus-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Focus — Design system", description: "A new identity. A complete system of components, patterns, and foundations for building clear interfaces.",
  robots: { index: false, follow: false },
};
export default function RootLayout({children}: {readonly children: ReactNode}) {
  return <html lang="en" className="dark" style={{ colorScheme: "dark" }} suppressHydrationWarning><head><link rel="preload" href="/fonts/inter/InterVariable-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous"/></head>
    <body suppressHydrationWarning><FocusProvider locale="en" forcedTheme="dark">{children}</FocusProvider></body></html>;
}
