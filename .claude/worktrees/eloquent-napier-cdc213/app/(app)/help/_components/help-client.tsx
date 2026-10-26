"use client";

import { Suspense } from "react";
import { HelpPanelSkeleton } from "../page-skeleton";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageContainer } from "../../../_components/page-container";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import { useT } from "@/lib/i18n/provider";
import { FaqPanel } from "./faq-panel";
import { IdeasPanel } from "./ideas-panel";
import { ReviewsPanel } from "./reviews-panel";
import { TutorialsPanel } from "./tutorials-panel";

const TABS = ["help", "tutorials", "ideas", "reviews"] as const;
type Tab = (typeof TABS)[number];

function HelpContent({ bookingUrl }: { readonly bookingUrl: string | null }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(requested ?? "") ? (requested as Tab) : "help";

  const select = (next: string) => {
    const search = new URLSearchParams(params.toString());
    if (next === "help") search.delete("tab");
    else search.set("tab", next);
    const query = search.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return <>
    <div className="mb-6">
      <SlidingTabs tabs={[
        { id: "help", label: t("help.tabHelp") },
        { id: "tutorials", label: t("help.tabTutorials") },
        { id: "ideas", label: t("help.tabIdeas") },
        { id: "reviews", label: t("help.tabReviews") },
      ]} value={tab} onValueChange={select} />
    </div>
    <div key={tab} className="content-enter">
      {tab === "help" ? <FaqPanel /> : tab === "tutorials" ? <TutorialsPanel bookingUrl={bookingUrl} /> : tab === "ideas" ? <IdeasPanel /> : <ReviewsPanel />}
    </div>
  </>;
}

export default function HelpClient({ bookingUrl }: { readonly bookingUrl: string | null }) {
  const t = useT();
  return <PageContainer maxWidth="max-w-6xl" title={t("help.title")} description={t("help.subtitle")}>
    <Suspense fallback={<HelpPanelSkeleton />}><HelpContent bookingUrl={bookingUrl} /></Suspense>
  </PageContainer>;
}
