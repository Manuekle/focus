import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { EditorStudio } from "./editor-studio";

const porkys = localFont({
  src: "../../public/fonts/porkys/Porkys-Regular.woff2",
  variable: "--font-porkys",
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Editor · Focus",
  description: "Edit your clip with AI: track the subject, apply effects and finishes, and keep talking to the AI editor.",
};

export const viewport: Viewport = { viewportFit: "cover" };

type Props = { searchParams: Promise<{ v?: string | string[]; auth?: string | string[] }> };

export default async function Page({ searchParams }: Props) {
  const { v, auth } = await searchParams;
  const videoId = typeof v === "string" && /^[0-9a-f-]{36}$/.test(v) ? v : null;
  const authNotice = auth === "failed" || auth === "canceled" ? auth : null;
  // A new clip starts a fresh studio; the session and project list reload with it.
  return (
    <div className={porkys.variable}>
      <EditorStudio key={videoId ?? "new"} videoId={videoId} authNotice={authNotice} />
    </div>
  );
}
