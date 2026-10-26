import type { Metadata } from "next";
import { MARKETING_CONTENT } from "@/lib/marketing-content";
import { MarketingJsonLd } from "@/app/_components/marketing-json-ld";
import { PRICING_FAQ_KEYS } from "@/lib/marketing-faq";
import { marketingMetadata } from "@/lib/site";
import { Pricing } from "./_components/pricing";

const content = MARKETING_CONTENT.es.pricing;
const description = content.description;

export const metadata: Metadata = marketingMetadata({
  path: "/pricing",
  title: content.title,
  description,
});

export default function PricingPage() {
  return <>
    <MarketingJsonLd description={description} faq={PRICING_FAQ_KEYS} locale="es" path="/pricing" />
    <Pricing />
  </>;
}
