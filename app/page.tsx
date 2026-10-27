import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Workspace } from "./_editor/workspace";

const porkys = localFont({
  src: "../public/fonts/porkys/Porkys-Regular.woff2",
  variable: "--font-porkys",
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Focus — Make anything stand out.",
  description: "Your clip. Your words. A whole new look. Create AI video effects that put your subject in the spotlight with Focus.",
};

// Lets the mobile export bar sit above the home indicator (env(safe-area-inset-bottom)).
export const viewport: Viewport = { viewportFit: "cover" };

export default function Page() {
  return <div className={porkys.variable}><Workspace /></div>;
}
