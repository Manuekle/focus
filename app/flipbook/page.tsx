import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { notFound } from "next/navigation";
import { flipbookEnabled } from "../../shared/features";
import { FlipbookStudio } from "./flipbook-studio";
import { CharacterSourceSchema } from "../../shared/characters";

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

type Props = { searchParams: Promise<{ f?: string | string[]; character?: string | string[]; version?: string | string[]; together?: string | string[] }> };

export default async function Page({ searchParams }: Props) {
  if (!flipbookEnabled()) notFound();
  const { f, character, version, together } = await searchParams;
  const source = CharacterSourceSchema.safeParse({ characterId: character, versionId: version });
  const flipbookId = typeof f === "string" && /^[0-9a-f-]{36}$/.test(f) ? f : null;
  // Several saved characters in one scene; a character in the URL is the first one picked.
  const ensemble = together === "1";
  return (
    <div className={porkys.variable}>
      <FlipbookStudio key={flipbookId ?? `${ensemble ? "together:" : ""}${source.success ? `${source.data.characterId}:${source.data.versionId}` : "new"}`} flipbookId={flipbookId} characterSource={source.success ? source.data : undefined} together={ensemble} />
    </div>
  );
}
