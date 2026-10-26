import type { Metadata } from "next";
import { MARKETING_CONTENT } from "@/lib/marketing-content";
import { MarketingJsonLd } from "@/app/_components/marketing-json-ld";
import { marketingMetadata } from "@/lib/site";
import { Guide } from "./_components/guide";

const content = MARKETING_CONTENT.es.guide;
const description = content.description;

export const metadata: Metadata = marketingMetadata({
  path: "/guide",
  title: content.title,
  description,
});

export default function GuidePage() {
  return <>
    <MarketingJsonLd description={description} locale="es" path="/guide" />
    <Guide />
  </>;
}
