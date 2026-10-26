import type { Metadata } from "next";
import { MARKETING_CONTENT } from "@/lib/marketing-content";
import { MarketingJsonLd } from "@/app/_components/marketing-json-ld";
import { Pricing } from "@/app/pricing/_components/pricing";
import { PRICING_FAQ_KEYS } from "@/lib/marketing-faq";
import { marketingMetadata } from "@/lib/site";

const content = MARKETING_CONTENT.en.pricing;
const description = content.description;

export const metadata: Metadata = marketingMetadata({
  locale: "en",
  path: "/en/pricing",
  title: content.title,
  description,
});

export default function EnglishPricingPage() {
  return <>
    <MarketingJsonLd description={description} faq={PRICING_FAQ_KEYS} locale="en" path="/en/pricing" />
    <Pricing />
  </>;
}
