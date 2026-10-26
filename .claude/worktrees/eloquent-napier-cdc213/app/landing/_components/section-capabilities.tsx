"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useSession } from "@/lib/auth/use-session";
import { useT } from "@/lib/i18n/provider";
import { DeferredCapabilityArt } from "./deferred-art";
import hairline from "./hairline/hairline.module.css";
import { Reveal, SectionIntro, Shell } from "./primitives";

/**
 * The twelve things an agent does, one card each.
 *
 * The rest of the page argues by screenshot: a section takes one surface of
 * the product, shows it at 1240px and talks about it for eight hundred words.
 * That works three or four times and then the page is fifteen thousand pixels
 * long and has covered a third of what the app does — which is exactly where
 * this landing was. The calendar, the CRM board, the public forms, the email
 * templates, the voice agents and the payment links had all shipped without
 * the page ever mentioning them.
 *
 * This is the other move: a grid where each cell is one capability, a drawing
 * of the mechanism, and two lines. Twelve features in one screen's worth of
 * page instead of twelve sections.
 *
 * A card is a way into the page it describes — but only for someone who has
 * one. Every `href` here is a gated route, so for a visitor who has never
 * signed in twelve links to `/knowledge`, `/crm`, `/leads` … are twelve trips
 * to the login screen. That is the same trap the header's calls to action were
 * pulled out of, so the cards are links when there is a session and plain
 * cards when there is not; the way in for a visitor is the one call to action
 * at the top, pointing at a page they can actually read.
 *
 * Every entry is real, and most of them are `lib/agent-capabilities.ts`
 * verbatim — the same list the capability picker builds an agent from. The
 * four that are not (CRM board, leads, forms, email templates) are pages in
 * the sidebar rather than agent tools, which is the only reason they are not
 * in that file. Nothing here is a capability the code does not have; a landing
 * page is the worst possible place to find that out.
 */

type Capability = {
  /** Keys the scene in `CAPABILITY_FIGURES` and the i18n strings. */
  readonly id: "knowledge" | "handoff" | "calendar" | "leads" | "payments" | "voice";
  /** The page it belongs to, so a card is a way in and not just a claim. */
  readonly href: string;
};

/**
 * Six, two to a row, every card the same size. The bento this replaced gave
 * each drawing a different stage — a wide card's figure at 480px beside a
 * narrow one's at 300 — so the same slab came out at three sizes down the page.
 *
 * The rows alternate a stacked figure with one laid out on the floor, and
 * swap sides each row, so no two alike sit side by side or one above the
 * other. Everything else is named in one line under the grid.
 *
 * The order is fixed. The cards used to trade places every few seconds; a
 * drawing that moves while you read it is a drawing you stop reading.
 */
const CAPABILITIES: readonly Capability[] = [
  { id: "knowledge", href: "/knowledge" },
  { id: "handoff", href: "/inbox" },

  { id: "leads", href: "/leads" },
  { id: "calendar", href: "/calendar" },

  { id: "voice", href: "/agents" },
  { id: "payments", href: "/automations" },
];

/**
 * The card: the drawing on its plate, then its caption — the figure number,
 * the title and two lines, the way a figure is captioned in print.
 *
 * Edged by the grid's own rules rather than a border of its own — each cell
 * draws its right and bottom edge and the grid draws the top and left, so two
 * cells share one line instead of stacking two.
 *
 * The link, when there is a session to link for, is an overlay stretched
 * across the cell. Swapping the outer element between a `<div>` and a `<Link>`
 * when the session resolves would remount the card; an overlay changes only
 * what is on top of it. It carries the card's title as its accessible name.
 */
function CapabilityCard({
  body,
  figure,
  href,
  scene,
  title,
}: {
  readonly body: string;
  readonly figure: string;
  readonly href: string | null;
  readonly scene: ReactNode;
  readonly title: string;
}) {
  const router = useRouter();

  return (
    <div className="relative flex h-full flex-col border-border border-r border-b">
      {/* The drawing answers the pointer, so it sits above the card's link
          rather than under it, and a click on it goes where the link goes. */}
      <div
        className={`${hairline.plate} relative z-10 flex-none px-3 pt-6 sm:px-6 sm:pt-8`}
        onClick={href ? () => router.push(href) : undefined}
        style={href ? { cursor: "pointer", zIndex: 40 } : undefined}
      >
        <div className="mx-auto w-full max-w-[34rem]">{scene}</div>
      </div>

      <div className="relative z-20 flex-1 px-6 pt-4 pb-8 sm:px-8">
        <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.12em]">{figure}</p>
        <h3 className="mt-3 text-[15px] text-foreground font-medium tracking-[-0.02em]">{title}</h3>
        <p className="mt-2.5 max-w-[46ch] text-[14px] text-muted-foreground leading-relaxed">{body}</p>
      </div>

      {href ? <Link aria-label={title} className="lp-focus absolute inset-0 z-30" href={href} /> : null}
    </div>
  );
}

export function CapabilitiesSection() {
  const t = useT();
  const session = useSession();

  return (
    <section id="capacidades" className="relative isolate scroll-mt-20 overflow-hidden border-border border-t py-24 sm:py-32">
      <Shell className="relative">
        <SectionIntro
          figure="Fig 05"
          title={[t("landing.capabilities.titleLine1"), t("landing.capabilities.titleLine2")]}
          body={t("landing.capabilities.body")}
          cta={{ href: "/guide", label: t("landing.capabilities.cta") }}
        />

        {/* The grid, edged top and left here and right and bottom by each
            cell. Two columns from `lg`; below that one, where a card is as wide
            as the page and the drawing caps its own width. */}
        <div className="mt-14 grid grid-cols-1 border-border border-t border-l lg:grid-cols-2">
          {CAPABILITIES.map((capability, index) => {
            return (
              // The stagger walks by pairs, because a row here is two cards.
              <Reveal className="h-full" delay={(index % 2) * 70} key={capability.id}>
                <CapabilityCard
                  body={t(`landing.capabilities.${capability.id}.body`)}
                  figure={`Fig 05.${index + 1}`}
                  href={session.signedIn ? capability.href : null}
                  scene={<DeferredCapabilityArt id={capability.id} />}
                  title={t(`landing.capabilities.${capability.id}.title`)}
                />
              </Reveal>
            );
          })}
        </div>

        {/* The line that keeps the grid honest: a capability is something you
            grant, not something that is simply on. */}
        <Reveal delay={140}>
          <div className="mx-auto mt-10 max-w-[68ch] space-y-2 text-center">
            {/* The capabilities without a card of their own. A landing page
                that drops one to tidy up its grid lies by omission; one line is
                what they are worth here. */}
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              {t("landing.capabilities.andAlso")}
            </p>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              {t("landing.capabilities.footnote")}
            </p>
          </div>
        </Reveal>
      </Shell>
    </section>
  );
}
