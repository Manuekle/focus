import type { Metadata } from "next";
import { MARKETING_CONTENT } from "@/lib/marketing-content";
import { MarketingJsonLd } from "@/app/_components/marketing-json-ld";
import { Guide } from "@/app/guide/_components/guide";
import { marketingMetadata } from "@/lib/site";

const content = MARKETING_CONTENT.en.guide;
const description = content.description;

export const metadata: Metadata = marketingMetadata({
  locale: "en",
  path: "/en/guide",
  title: content.title,
  description,
});

export default function EnglishGuidePage() {
  return <>
    <MarketingJsonLd description={description} locale="en" path="/en/guide" />
    <Guide />
  </>;
}
