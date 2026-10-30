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

// Runs before first paint: the saved choice wins, otherwise the OS preference, otherwise dark.
const themeScript = `try{var r=document.documentElement,t=localStorage.getItem("focus-theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";r.classList.add(t);r.style.colorScheme=t}catch(e){document.documentElement.classList.add("dark")}`;

export default function RootLayout({children}: {readonly children: ReactNode}) {
  return <html lang="en" className={porkys.variable} suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeScript }} /><link rel="preload" href="/fonts/inter/InterVariable-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous"/></head>
    <body suppressHydrationWarning><FocusProvider locale="en"><ActivityProvider>{children}<GenerationLimitDialog /></ActivityProvider></FocusProvider></body></html>;
}
