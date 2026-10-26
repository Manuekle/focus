import type { Metadata } from "next";
import { MARKETING_CONTENT } from "@/lib/marketing-content";
import { MarketingJsonLd } from "@/app/_components/marketing-json-ld";
import { LANDING_FAQ_KEYS } from "@/lib/marketing-faq";
import { marketingMetadata } from "@/lib/site";
import { Landing } from "./_components/landing";

const content = MARKETING_CONTENT.es.home;
const description = content.description;

export const metadata: Metadata = marketingMetadata({
  path: "/",
  title: content.title,
  description,
});

export default function LandingPage() {
  return <>
    {/* Discover the above-the-fold fonts with the HTML, not after downloading
        and parsing the shared application stylesheet. */}
    <link rel="preload" href="/fonts/cooper/CooperLtBT_500-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
    <MarketingJsonLd description={description} faq={LANDING_FAQ_KEYS} locale="es" path="/" />
    <Landing />
  </>;
}
