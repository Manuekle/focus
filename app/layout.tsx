import type { Metadata } from "next";
import type { ReactNode } from "react";
import { FocusProvider } from "../components/focus-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Focus — Design system", description: "Una identidad nueva. Un sistema completo de componentes, patrones y fundamentos para construir interfaces con claridad.",
  robots: { index: false, follow: false },
};
const themeScript = `(function(){try{var t=localStorage.getItem('focus-theme');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';document.documentElement.classList.add(t);document.documentElement.style.colorScheme=t}catch(e){}})()`;
export default function RootLayout({children}: {readonly children: ReactNode}) {
  return <html lang="es" suppressHydrationWarning><head><link rel="preload" href="/fonts/optimistic/optimistic.ttf" as="font" type="font/ttf" crossOrigin="anonymous"/><script dangerouslySetInnerHTML={{__html:themeScript}} /></head>
    <body><FocusProvider>{children}</FocusProvider></body></html>;
}
