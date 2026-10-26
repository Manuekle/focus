import type { Metadata } from "next";
import { MARKETING_CONTENT } from "@/lib/marketing-content";
import { MarketingJsonLd } from "@/app/_components/marketing-json-ld";
import { marketingMetadata } from "@/lib/site";
import { Team } from "./_components/team";

const content = MARKETING_CONTENT.es.team;
const description = content.description;

export const metadata: Metadata = marketingMetadata({
  path: "/team",
  title: content.title,
  description,
});

export default function TeamPage() {
  return <>
    <MarketingJsonLd description={description} locale="es" path="/team" />
    <Team />
  </>;
}
