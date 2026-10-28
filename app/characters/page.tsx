import type { Metadata } from "next";
import localFont from "next/font/local";
import { notFound } from "next/navigation";
import { flipbookEnabled } from "../../shared/features";
import { CharacterIdSchema } from "../../shared/characters";
import { CharactersStudio } from "./characters-studio";

const porkys = localFont({
  src: "../../public/fonts/porkys/Porkys-Regular.woff2",
  variable: "--font-porkys",
  weight: "400",
  display: "swap",
});
export const metadata: Metadata = {
  title: "My characters · Focus",
  description:
    "Create a character from references, keep every version and bring it into Flipbook.",
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ c?: string | string[] }>;
}) {
  if (!flipbookEnabled()) notFound();
  const { c } = await searchParams;
  const id =
    typeof c === "string" && CharacterIdSchema.safeParse(c).success ? c : null;
  return (
    <div className={porkys.variable}>
      <CharactersStudio key={id ?? "library"} initialId={id} />
    </div>
  );
}
