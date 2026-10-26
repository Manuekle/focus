import type { Metadata } from "next";
import { MARKETING_CONTENT } from "@/lib/marketing-content";
import { MarketingJsonLd } from "@/app/_components/marketing-json-ld";
import { Simulator } from "@/app/simulator/_components/simulator";
import { marketingMetadata } from "@/lib/site";

const content = MARKETING_CONTENT.en.simulator;
const description = content.description;

export const metadata: Metadata = marketingMetadata({
  locale: "en",
  path: "/en/simulator",
  title: content.title,
  description,
});

export default function EnglishSimulatorPage() {
  return <>
    <MarketingJsonLd description={description} locale="en" path="/en/simulator" />
    <Simulator />
  </>;
}
