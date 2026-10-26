import type { Metadata } from "next";
import { MARKETING_CONTENT } from "@/lib/marketing-content";
import { MarketingJsonLd } from "@/app/_components/marketing-json-ld";
import { marketingMetadata } from "@/lib/site";
import { Simulator } from "./_components/simulator";

const content = MARKETING_CONTENT.es.simulator;
const description = content.description;

export const metadata: Metadata = marketingMetadata({
  path: "/simulator",
  title: content.title,
  description,
});

export default function SimulatorPage() {
  return <>
    <MarketingJsonLd description={description} locale="es" path="/simulator" />
    <Simulator />
  </>;
}
