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

// Also before first paint: the studio sidebar's saved width (app/_editor/sidebar-resizer.tsx), so a reload doesn't slide it into place.
const sidebarScript = `try{var w=+localStorage.getItem("focus.sidebar.width"),c=localStorage.getItem("focus.sidebar.collapsed")==="1";if(c||w>0)document.documentElement.style.setProperty("--sidebar-saved",c?"0px":Math.min(420,Math.max(200,Math.round(w)))+"px")}catch(e){}`;

export default function RootLayout({children}: {readonly children: ReactNode}) {
  return <html lang="en" className={porkys.variable} suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeScript }} /><script dangerouslySetInnerHTML={{ __html: sidebarScript }} /><link rel="preload" href="/fonts/inter/InterVariable-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous"/></head>
    <body suppressHydrationWarning><FocusProvider locale="en"><ActivityProvider>{children}<GenerationLimitDialog /></ActivityProvider></FocusProvider></body></html>;
}
