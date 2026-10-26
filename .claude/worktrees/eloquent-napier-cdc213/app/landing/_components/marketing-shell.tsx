"use client";

import { useRef, type ReactNode } from "react";
import { SmoothScroll } from "@/components/motion/smooth-scroll";
import { useReveal } from "@/lib/hooks/use-reveal";
import { LandingFooter } from "./landing-footer";
import { LandingHeader } from "./landing-header";
import styles from "./editorial.module.css";
import { Grain } from "./grain";

/**
 * The frame every marketing page sits in: the dark wrapper, the header, the
 * footer, and the single IntersectionObserver that drives the reveals.
 *
 * It lives beside the landing's own components rather than in a folder of its
 * own because every marketing surface — the landing, pricing, the two legal
 * pages — is built from this same set. If the landing ever moves to `/` behind
 * a route group, the whole folder moves with it.
 *
 * `lp` no longer carries `dark`. It used to, which made the marketing surface
 * dark whatever the visitor had chosen inside the product — and made a theme
 * toggle on these pages a control that could not do its one job. The four
 * landing-only values that assumed a dark ground (the two hairline washes, the
 * bloom and the frame bevel) now have both halves in `globals.css`, so the
 * surface follows `<html>` like every other page.
 *
 * Every string reads the shared translation context. On public routes the
 * provider selects its dictionary from the URL, keeping visible copy aligned
 * with the page's search metadata and translated links.
 */
export function MarketingShell({
  children,
  editorial = true,
}: {
  readonly children: ReactNode;
  readonly editorial?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useReveal(rootRef);

  return (
    <>
      {/* The browser owns wheel and touch scrolling: no interpolation delay
          or continuous JS loop competing with the product demos. The shared
          API still publishes native scroll metrics and supports anchors. */}
      <SmoothScroll native>
        <div className="lp min-h-dvh" ref={rootRef}>
          <LandingHeader />
          <main>{children}</main>
          <LandingFooter editorial={editorial} />
        </div>
      </SmoothScroll>
    </>
  );
}

/**
 * The opening block of a marketing page that is not the landing: an eyebrow,
 * a heading and a standfirst on the prose rail, over the same hairline the
 * feature sections use. Deliberately quieter than the landing's hero — these
 * are pages you arrive at knowing what you came for.
 *
 * Quieter, not unlit. Four pages come through here — pricing, the guide and
 * the two legal texts — and until the rig existed they all opened on a flat
 * rectangle of page colour with a heading on it. That is not restraint, it is
 * the landing's first screen and one of its four follow-ons belonging to
 * different products: the visitor who clicks "Precios" from a lit hero lands
 * somewhere that looks like it was built by someone else.
 *
 * So it takes the hero's backdrop at the hero's own intensity minus a step:
 * the hairline grid, and one beam entering from above and opening over the
 * heading. Left-biased for the same reason the hero's is — the copy is pinned
 * to the left rail, and a beam centred on the viewport lights the empty half.
 *
 * `top-0` rather than a negative offset, and `overflow-hidden` on the header:
 * the beam is cut by the header's own bottom border, and starting it flush
 * with the top means there is no *upper* edge to cut. The cone's mask fades in
 * over its first sixth, so it still arrives rather than switching on.
 *
 * Sideways it is anchored to the RAIL, not the viewport, which is why there is
 * a wrapper around it instead of a percentage `left`. The rail is centred and
 * capped at 1120px, so the heading's own position moves with the window while
 * a viewport percentage does not: a beam aimed at the copy on a 1440px screen
 * is aimed at empty page on a 1000px one. Inside a box that tracks the rail,
 * `left-0` means "the left edge of the column", which is where the heading
 * actually is at every width.
 */
export function PageHeader({
  eyebrow,
  lede,
  title,
  titleClassName = "",
  actions,
}: {
  readonly eyebrow: string;
  readonly lede: ReactNode;
  readonly title: string;
  readonly titleClassName?: string;
  /** Botones bajo el lede — ej. el CTA al simulador en `/pricing`. */
  readonly actions?: ReactNode;
}) {
  return (
    <header className={`${styles.surface} ${styles.publicHeader} relative overflow-hidden border-border border-b pt-32 pb-16 sm:pt-40 sm:pb-20`}>
      <div aria-hidden="true" className="lp-grid" />
      <div aria-hidden="true" className={styles.heroAtmosphere}>
        <div className={styles.heroLight} />
        <Grain variant="hero" />
      </div>
      <div className="relative z-[1] mx-auto w-full max-w-[1120px] px-6 sm:px-8">
        <p className="lp-eyebrow">{eyebrow}</p>
        {/* Milled, like the landing's own headline. These four pages open on
            the biggest type they contain and it was flat `--foreground` — the
            visitor who arrives from a hero with a ramp through it lands on the
            same sentence rendered by a different product. One piece of text,
            not a per-word reveal, so the ramp goes on the element itself. */}
        <h1
          className={`lp-lumen mt-4 max-w-[20ch] text-balance font-heading text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.25] overflow-visible pb-[0.12em] font-medium tracking-[-0.02em] ${titleClassName}`}
          data-text={title}
        >
          {title}
        </h1>
        <p className="mt-6 max-w-[58ch] text-[15px] leading-relaxed text-pretty text-muted-foreground">{lede}</p>
        {actions ? <div className="mt-8 flex flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}
