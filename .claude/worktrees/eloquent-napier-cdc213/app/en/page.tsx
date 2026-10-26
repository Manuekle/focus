import type { Metadata } from "next";
import { MARKETING_CONTENT } from "@/lib/marketing-content";
import { MarketingJsonLd } from "@/app/_components/marketing-json-ld";
import { Landing } from "@/app/landing/_components/landing";
import { LANDING_FAQ_KEYS } from "@/lib/marketing-faq";
import { marketingMetadata } from "@/lib/site";

const content = MARKETING_CONTENT.en.home;
const description = content.description;

export const metadata: Metadata = marketingMetadata({
  locale: "en",
  path: "/en",
  title: content.title,
  description,
});

export default function EnglishLandingPage() {
  return <>
    <link rel="preload" href="/fonts/cooper/CooperLtBT_500-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
    <MarketingJsonLd description={description} faq={LANDING_FAQ_KEYS} locale="en" path="/en" />
    <Landing />
  </>;
}
