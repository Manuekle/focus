"use client";

import { HugeiconsIcon } from "@/components/icons/icon";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth/use-session";
import { useT } from "@/lib/i18n/provider";
import { salesOpen } from "@/lib/sales";
import { SalesContactDialog } from "./sales-contact-dialog";
import { YCombinatorMark } from "./brand-marks";
import { BrandGlow } from "./lighting";
import styles from "./editorial.module.css";
import { Grain } from "./grain";
import { Reveal, Shell } from "./primitives";
import { StoryFrame } from "./story/story-frame";
import { SignupDialog } from "./signup-dialog";
import { HumanVisual } from "./human-visual";

/**
 * The opening pairs the product claim with a customer receiving a reservation,
 * offers the beta, and then shows the product doing that once: a customer asks
 * on WhatsApp, oruka answers from the business's prices, and the contact and
 * its next step are left behind.
 */
export function LandingHero() {
  const t = useT();
  const session = useSession();

  return (
    <section className={`${styles.surface} ${styles.hero} relative overflow-hidden pt-28 pb-16 sm:pt-32 sm:pb-24`}>
      {/* Texture belongs to the light, behind the copy and fading before the demo. */}
      <div aria-hidden="true" className={styles.heroAtmosphere}>
        <div className={styles.heroLight} />
        <Grain variant="hero" />
      </div>

      <Shell className={`${styles.heroIntro} relative`}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 md:col-span-2">
          <Reveal>
            {/* The announcement row. The container takes the app's card shape —
                a 12px squircle, `--card` surface, hairline border — and the
                only pill on it is the app's own `Badge`, which is round by
                design. A full-pill container here was the shape the product
                never uses. */}
            <Link
              // `#agentes` signed out, and that is a correctness fix rather than
              // a preference: `/agents` is behind the session gate, so the one
              // announcement on the page sent every visitor who clicked it to
              // the login wall. The section it is announcing is further down
              // this page. Signed in, the real thing is better.
              href={session.signedIn ? "/agents" : "#agentes"}
              // Nothing to prefetch for a hash, and for the app route the click
              // is deliberate — a marketing page should not pull the product's
              // JS down behind the visitor's back.
              prefetch={false}
              className="group inline-flex items-center gap-2.5 rounded-xl border border-border bg-card py-1.5 pr-3 pl-1.5 text-xs shadow-[var(--shadow-soft)] transition-[border-color,box-shadow] duration-200 hover:border-input hover:shadow-[var(--shadow-elevated)]"
            >
              <Badge className="px-2 py-0.5 text-[10px]">{t("landing.hero.badge")}</Badge>
              <span className="text-muted-foreground">{t("landing.hero.announcement")}</span>
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                size={13}
                strokeWidth={2}
                className="text-muted-foreground transition-transform duration-200 ease-[var(--lp-ease)] group-hover:translate-x-0.5"
              />
            </Link>
          </Reveal>

          <Reveal delay={80}>
            <div className="inline-flex max-w-full min-h-[34px] items-center gap-2.5 text-[12px] leading-snug text-muted-foreground">
              <BrandGlow className="shrink-0" colour="#FB651E"><YCombinatorMark size={18} /></BrandGlow>
              <span className="min-w-0">{t("landing.hero.ycApplication")}</span>
            </div>
          </Reveal>
        </div>
        <div className="min-w-0">
          {/* The LCP heading is visible in the server HTML, without waiting for
              hydration, per-word blur animations or a motion preference check. */}
          <h1
            className="max-w-[24ch] text-balance font-heading font-cooper text-[clamp(2.75rem,6.6vw,4.25rem)] leading-[1.25] overflow-visible pb-[0.12em] font-medium tracking-[-0.02em]"
          >
            {t("landing.hero.title")}
          </h1>

          <Reveal delay={120}>
            <p className="mt-5 max-w-[52ch] text-[15px] leading-relaxed text-pretty text-muted-foreground">
              {t("landing.hero.subtitle")}
            </p>
          </Reveal>

          <Reveal delay={180}>
            <div className="relative mt-6 flex flex-wrap items-center gap-3">
              {/* Vendor visitors can request beta access directly. Existing
                  installs offer sign-in; signed-in customers get the app. */}
              {session.signedIn ? (
                <Button asChild size="lg">
                  <Link href="/dashboard">{t("landing.cta.openApp")}</Link>
                </Button>
              ) : session.workspaceFinder && !salesOpen() ? (
                <SalesContactDialog
                  emphasis
                  triggerSize="lg"
                  triggerClassName="w-auto"
                  source="early-access"
                  titleKey="pricing.earlyAccess.title"
                  bodyKey="pricing.earlyAccess.body"
                  submitLabelKey="pricing.earlyAccess.submit"
                  triggerLabelKey="pricing.cta.earlyAccess"
                />
              ) : session.claimed ? (
                /* An install that already has its owner (www.oruka.si, every
                   tenant) takes no new accounts, so its door is sign-in. It used
                   to open the sign-up dialog — on its own, five seconds in —
                   offering credits the install could never grant. */
                <Button asChild size="lg">
                  <Link href={session.workspaceFinder ? "/signin" : "/login"} prefetch={false}>
                    {t("landing.cta.signIn")}
                  </Link>
                </Button>
              ) : (
                <SignupDialog>
                  <Button size="lg">{t("landing.cta.start")}</Button>
                </SignupDialog>
              )}
              {/* Signed out, the second door is the demo right below rather
                  than pricing: a visitor deciding whether to ask for access
                  needs to see the work first, and pricing stays in the bar. */}
              {session.signedIn ? (
                <Button asChild size="lg" variant="outline">
                  <Link href="/settings" prefetch={false}>{t("landing.cta.settings")}</Link>
                </Button>
              ) : (
                <Button asChild size="lg" variant="outline">
                  <a href="#como-funciona">{t("landing.cta.howItWorks")}</a>
                </Button>
              )}
            </div>
            <p className="mt-4 text-[13px] text-muted-foreground">
              {t(salesOpen() ? "landing.hero.noAccount" : "landing.hero.beta")}
            </p>
          </Reveal>

        </div>
        <Reveal className={styles.heroVisual} delay={80} lift={false}>
          <HumanVisual scene="reservation" />
        </Reveal>
      </Shell>

      {/* The product, on a wider rail than the copy. `#como-funciona` is
          where the hero's second button lands. */}
      <div
        className="relative mx-auto mt-12 w-full max-w-[1240px] scroll-mt-24 px-6 sm:mt-16 sm:px-8"
        id="como-funciona"
      >
        <Reveal delay={240} lift={false}>
          {/* The first of the page's four story loops, on the same dot plate
              as the rest: no browser window, nothing under it. */}
          <StoryFrame scene="chat" label={t("landing.hero.frameLabel")} />
        </Reveal>
      </div>

      {/* There was a second, page-wide floor pool here and it had to go. The
          hero carries `overflow: hidden` — that is what keeps its grid and its
          beam off the band below — and the pool sat 160px past the section's
          foot, so the clip fell through the middle of it and drew a hard bright
          line the full width of the page exactly on the boundary.

          Nothing is lost: the story's plate brings its own pool, sized to the
          story and ending inside the section. Two floors under one object was a duplicate
          before it was a seam. */}
    </section>
  );
}
