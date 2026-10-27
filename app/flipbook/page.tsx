import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { notFound } from "next/navigation";
import { flipbookEnabled } from "../../shared/features";
import { FlipbookStudio } from "./flipbook-studio";

const porkys = localFont({
  src: "../../public/fonts/porkys/Porkys-Regular.woff2",
  variable: "--font-porkys",
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Flipbook · Focus",
  description: "Turn a single illustration into a frame-by-frame animation.",
};

export const viewport: Viewport = { viewportFit: "cover" };

type Props = { searchParams: Promise<{ f?: string | string[] }> };

export default async function Page({ searchParams }: Props) {
  if (!flipbookEnabled()) notFound();
  const { f } = await searchParams;
  const flipbookId = typeof f === "string" && /^[0-9a-f-]{36}$/.test(f) ? f : null;
  return (
    <div className={porkys.variable}>
      <FlipbookStudio key={flipbookId ?? "new"} flipbookId={flipbookId} />
    </div>
  );
}
