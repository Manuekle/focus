import type { Metadata } from "next";
import { MARKETING_CONTENT } from "@/lib/marketing-content";
import { MarketingJsonLd } from "@/app/_components/marketing-json-ld";
import { Team } from "@/app/team/_components/team";
import { marketingMetadata } from "@/lib/site";

const content = MARKETING_CONTENT.en.team;
const description = content.description;

export const metadata: Metadata = marketingMetadata({
  locale: "en",
  path: "/en/team",
  title: content.title,
  description,
});

export default function EnglishTeamPage() {
  return <>
    <MarketingJsonLd description={description} locale="en" path="/en/team" />
    <Team />
  </>;
}
