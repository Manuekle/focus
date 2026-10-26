"use client";

import * as motion from "motion/react-m";
import { HugeiconsIcon } from "@/components/icons/icon";
import type { IconSvgElement } from "@/components/icons/icon";
import {
  AiImagineIcon,
  BookOpen01Icon,
  Calculator01Icon,
  Cancel01Icon,
  ChevronDownIcon,
  HelpCircleIcon,
  InboxIcon,
  Layers01Icon,
  Menu01Icon,
  MetaIcon,
  ServerStack01Icon,
  Tag01Icon,
  UserGroupIcon,
  ZapIcon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, type Variants } from "motion/react";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { OrukaTile } from "@/components/icons/oruka-mark";
import { useSmoothScroll } from "@/components/motion/smooth-scroll";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth/use-session";
import { useActiveSection, useStuckHeader } from "@/lib/hooks/use-reveal";
import { useI18n, useT } from "@/lib/i18n/provider";
import { localizedMarketingPath } from "@/lib/site";
import { cn } from "@/lib/utils";
import { Shell } from "./primitives";
import { SignupDialog } from "./signup-dialog";
import styles from "./landing-header.module.css";

/**
 * Every section on the landing that carries an `id`, in document order. The
 * nav, the scroll-spy and the footer read the same list, so a section can no
 * longer end up anchorable but unreachable — which is what had happened to
 * Meta Ads — and the footer cannot drift out of step with the bar at the top
 * of the same page.
 */
export const LINKS = [
  { id: "bandeja", labelKey: "nav.inbox", icon: InboxIcon, descKey: "landing.header.descInbox" },
  { id: "ads", labelKey: "nav.ads", icon: MetaIcon, descKey: "landing.header.descAds" },
  { id: "automatizaciones", labelKey: "nav.automations", icon: ZapIcon, descKey: "landing.header.descAutomations" },
  { id: "agentes", labelKey: "landing.header.linkAgents", icon: AiImagineIcon, descKey: "landing.header.descAgents" },
  { id: "capacidades", labelKey: "landing.header.linkCapabilities", icon: Layers01Icon, descKey: "landing.header.descCapabilities" },
  { id: "autoalojado", labelKey: "landing.header.linkSelfHosted", icon: ServerStack01Icon, descKey: "landing.header.descSelfHosted" },
  { id: "preguntas", labelKey: "landing.header.linkFaq", icon: HelpCircleIcon, descKey: "landing.header.descFaq" },
] as const;

/** Hoisted so the observer's dependency array is stable across renders. */
const SECTION_IDS = LINKS.map((link) => link.id);

/** Marketing pages of their own, reached from anywhere. */
export const PAGES = [
  { href: "/pricing", labelKey: "landing.header.linkPricing", icon: Tag01Icon, descKey: "landing.header.descPricing" },
  { href: "/simulator", labelKey: "landing.header.linkSimulator", icon: Calculator01Icon, descKey: "landing.header.descSimulator" },
  { href: "/guide", labelKey: "landing.header.linkGuide", icon: BookOpen01Icon, descKey: "landing.header.descGuide" },
  { href: "/team", labelKey: "landing.header.linkTeam", icon: UserGroupIcon, descKey: "landing.header.descTeam" },
] as const;

/**
 * What the desktop bar shows flat. Eleven links never fitted the 1120px rail —
 * the centred nav overlapped the wordmark on one side and the CTA on the other
 * — so the bar carries the four conversion-critical links and everything else
 * lives under "Más". Derived from `LINKS`/`PAGES` rather than restated, so a
 * section added above cannot end up anchorable but unreachable from desktop.
 */
const PRIMARY_SECTION_IDS: ReadonlySet<string> = new Set(["agentes", "capacidades"]);
const PRIMARY_PAGE_HREFS: ReadonlySet<string> = new Set(["/pricing", "/simulator"]);

const PRIMARY_LINKS = LINKS.filter((link) => PRIMARY_SECTION_IDS.has(link.id));
const OVERFLOW_LINKS = LINKS.filter((link) => !PRIMARY_SECTION_IDS.has(link.id));
const PRIMARY_PAGES = PAGES.filter((page) => PRIMARY_PAGE_HREFS.has(page.href));
const OVERFLOW_PAGES = PAGES.filter((page) => !PRIMARY_PAGE_HREFS.has(page.href));

/**
 * The wordmark, shared with the app sidebar (desktop + mobile): 21px mark in
 * a tight box, 21px Cooper word. One lockup in three places, so a size change
 * here must change there too. Gap is 7px and the mark box is 22px wide — the
 * old `gap-2` + `size-8` box left ~15px of air between ink and word.
 */
export function Wordmark({ className }: { readonly className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-[7px]", className)}>
      {/* Tight box so the mark centres on the cap height instead of
          drifting on its own optical bounds — the glyph's ink is cropped to
          the silhouette, which is not vertically symmetric, so `items-center`
          on the svg alone never quite sat it next to the word. 22px wide,
          not 32: at `h-[21px]` the mark is ~18px wide, so this leaves ~2px
          of air per side instead of ~7px. */}
      <OrukaTile className="size-7" />
      <span className="font-cooper text-[21px] leading-none tracking-[-0.01em]">
        <span className="text-foreground">oruka</span>
      </span>
    </span>
  );
}

/**
 * The icon, at the height of its own text: the box stretches to the
 * title-plus-description block and the 32px glyph centres on it. The dotted
 * grid floats behind with no tile around it — no border, no ground, just the
 * dots — softened by a radial mask so the crop never shows a hard edge.
 * No `#fafafa` rect: an opaque ground would be the button look this replaced.
 * The dots are `currentColor` over `text-foreground`, so they follow the app's
 * `.dark` class like every other token. The previous `dark:invert` answered to
 * the OS `prefers-color-scheme` media query instead of the app theme, so light
 * mode on a dark OS served white dots on a white panel: invisible.
 * The glyph is `text-muted-foreground`, one step below the title ink: at 32px
 * it needs 3:1 and carries ≈5.5:1 on light / ≈5.0:1 on dark, so it stays calm
 * without going ghost.
 */
function MoreTile({ icon }: { readonly icon: IconSvgElement }) {
  return (
    <span className="relative flex w-14 shrink-0 items-center justify-center self-stretch">
      <svg
        aria-hidden="true"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 48 48"
        fill="none"
        className="absolute inset-0 h-full w-full text-foreground [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_78%)]"
      >
        <g opacity="0.2" fill="currentColor">
          <path fillRule="evenodd" clipRule="evenodd" d="M4 48L1 48L1 47L4 47L4 48Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M10 48L7 48L7 47L10 47L10 48Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M16 48L13 48L13 47L16 47L16 48Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M22 48L19 48L19 47L22 47L22 48Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M28 48L25 48L25 47L28 47L28 48Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M34 48L31 48L31 47L34 47L34 48Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M40 48L37 48L37 47L40 47L40 48Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M46 48L43 48L43 47L46 47L46 48Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M4 36L1 36L1 35L4 35L4 36Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M10 36L7 36L7 35L10 35L10 36Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M16 36L13 36L13 35L16 35L16 36Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M22 36L19 36L19 35L22 35L22 36Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M28 36L25 36L25 35L28 35L28 36Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M34 36L31 36L31 35L34 35L34 36Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M40 36L37 36L37 35L40 35L40 36Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M46 36L43 36L43 35L46 35L46 36Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M4 24L1 24L1 23L4 23L4 24Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M10 24L7 24L7 23L10 23L10 24Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M16 24L13 24L13 23L16 23L16 24Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M22 24L19 24L19 23L22 23L22 24Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M28 24L25 24L25 23L28 23L28 24Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M34 24L31 24L31 23L34 23L34 24Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M40 24L37 24L37 23L40 23L40 24Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M46 24L43 24L43 23L46 23L46 24Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M4 12L1 12L1 11L4 11L4 12Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M10 12L7 12L7 11L10 11L10 12Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M16 12L13 12L13 11L16 11L16 12Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M22 12L19 12L19 11L22 11L22 12Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M28 12L25 12L25 11L28 11L28 12Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M34 12L31 12L31 11L34 11L34 12Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M40 12L37 12L37 11L40 11L40 12Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M46 12L43 12L43 11L46 11L46 12Z" />
        </g>
        <g opacity="0.2" fill="currentColor">
          <path fillRule="evenodd" clipRule="evenodd" d="M48 43V46H47V43H48Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M48 37V40H47V37H48Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M48 31V34H47V31H48Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M48 25V28H47V25H48Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M48 19V22H47V19H48Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M48 13V16H47V13H48Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M48 7V10H47V7H48Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M48 1V4H47V1H48Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M36 43V46H35V43H36Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M36 37V40H35V37H36Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M36 31V34H35V31H36Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M36 25V28H35V25H36Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M36 19V22H35V19H36Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M36 13V16H35V13H36Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M36 7V10H35V7H36Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M36 1V4H35V1H36Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M24 43V46H23V43H24Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M24 37V40H23V37H24Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M24 31V34H23V31H24Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M24 25V28H23V25H24Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M24 19V22H23V19H24Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M24 13V16H23V13H24Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M24 7V10H23V7H24Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M24 1V4H23V1H24Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M12 43V46H11V43H12Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M12 37V40H11V37H12Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M12 31V34H11V31H12Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M12 25V28H11V25H12Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M12 19V22H11V19H12Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M12 13V16H11V13H12Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M12 7V10H11V7H12Z" />
          <path fillRule="evenodd" clipRule="evenodd" d="M12 1V4H11V1H12Z" />
        </g>
      </svg>
      <HugeiconsIcon icon={icon} size={32} strokeWidth={1.5} className="relative text-muted-foreground" />
    </span>
  );
}

/**
 * Title over description, each exactly one line. Both truncate, so every row
 * is the same height no matter the locale — a two-line description anywhere
 * would stagger the whole grid.
 */
function MoreTexts({ title, desc }: { readonly title: string; readonly desc: string }) {
  return (
    <span className="min-w-0 py-0.5">
      <span className="block truncate text-sm font-medium text-foreground">{title}</span>
      <span title={desc} className="mt-0.5 block truncate text-[13px] leading-snug text-muted-foreground">
        {desc}
      </span>
    </span>
  );
}

/**
 * The header.
 *
 * Three zones on one row: wordmark left, nav centred, actions right. The nav
 * is absolutely positioned rather than a flex child, because centring it with
 * `justify-between` puts it wherever the two side groups happen to leave room
 * — and those groups are different widths, so the nav sits visibly off-centre
 * and moves as the copy changes.
 *
 * The active section gets a hairline under it. It is the only structural mark
 * in the bar, and it is telling the reader where they are, which is the one
 * thing a single-page nav can say that a list of links cannot.
 */
export function LandingHeader() {
  const t = useT();
  const { locale } = useI18n();
  const headerRef = useRef<HTMLElement>(null);
  const menuInnerRef = useRef<HTMLDivElement>(null);
  const session = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const active = useActiveSection(SECTION_IDS);
  const pathname = usePathname();

  /**
   * Section links are bare fragments on the landing and full paths anywhere
   * else. Pricing and the legal pages share this header, and a bare `#agentes`
   * there points at nothing.
   */
  const landingPath = localizedMarketingPath("/", locale);
  const onLanding = pathname === landingPath;
  const sectionHref = (id: string) => (onLanding ? `#${id}` : `${landingPath}#${id}`);
  const pageHref = (path: string) => localizedMarketingPath(path, locale);

  useStuckHeader(headerRef);

  /**
   * Plays the exit animation before unmounting. The panel used to carry
   * `t-dropdown`, a Radix-only class whose exit rule hangs off
   * `[data-state="closed"]` — an attribute nothing here ever set — so the menu
   * appeared with an animation and then vanished on a frame.
   */
  const closeMenu = () => setMenuOpen(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  /**
   * The "Más" dropdown closes on anything that makes it stale: Escape, a
   * pointer landing outside it, and a route change (handled with the mobile
   * menu below).
   */
  useEffect(() => {
    if (!moreOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [moreOpen]);

  /**
   * The page holds still while the sheet is open.
   *
   * It did not, and that was the worst of the mobile bugs: the menu is pinned
   * to a fixed header, so a stray touch scrolled the whole document underneath
   * it and the sheet looked like it had come unstuck from the page. With Lenis
   * driving the scroll it was worse — the momentum carried on after the menu
   * closed, so you landed somewhere you never asked for.
   *
   * It takes both halves, and neither one is sufficient:
   *
   * `overflow: hidden` on the root — set through a `data-menu-open` attribute
   * so the rule lives in the stylesheet — is what stops the native path, which
   * is what a reader on `prefers-reduced-motion` gets, since `SmoothScroll`
   * hands them plain scrolling and there is no Lenis instance at all.
   *
   * `lenis.stop()` is what stops the other one. Lenis does not scroll the
   * document by scrolling it: it listens for wheel and touch, and writes the
   * offset itself. `overflow: hidden` is invisible to that — the menu locked
   * the page in every browser except the one the page actually ships with,
   * which is the sort of fix that looks done and is not.
   */
  const { lenis } = useSmoothScroll();

  useEffect(() => {
    if (!menuOpen) return;
    const root = document.documentElement;
    root.dataset.menuOpen = "";
    lenis?.stop();
    return () => {
      delete root.dataset.menuOpen;
      lenis?.start();
    };
  }, [menuOpen, lenis]);

  /**
   * Closed by anything that makes it stale: a route change, and the viewport
   * crossing into the width where the sheet is hidden.
   *
   * The second one is not theoretical. `data-open` stayed `true` through a
   * rotation or a resize, so the panel was still open — inert-free, tabbable,
   * `pointer-events: auto` — sitting invisibly under the desktop header, and
   * it came back the instant the window narrowed again with the burger showing
   * a close icon for a menu the reader never opened.
   */
  useEffect(() => {
    setMenuOpen(false);
    setMoreOpen(false);
  }, [pathname]);

  /**
   * Publishes the drawer's natural height to the header as `--lp-menu-h`.
   *
   * The drawer opens by transitioning `height`, and `height: auto` does not
   * transition — so something has to know the number. It is measured rather
   * than guessed because the row count is not fixed: the last item depends on
   * whether the reader is signed in, and every label is translated, so a
   * two-line row in one locale is a row height the stylesheet cannot know.
   *
   * Written straight to the DOM instead of through state. A measurement that
   * re-renders the header is a re-render on every rotation and on the frame
   * the session resolves, for a value only CSS ever reads.
   *
   * Zero is never published. Above the breakpoint the drawer is hidden,
   * and a `display: none` element measures 0 — publish that and the menu opens
   * to nothing the next time the window is narrow enough to have one.
   */
  const measureMenu = useCallback(() => {
    const header = headerRef.current;
    const inner = menuInnerRef.current;
    if (!header || !inner) return;

    const height = inner.offsetHeight;
    if (height > 0) header.style.setProperty("--lp-menu-h", `${height}px`);
  }, []);

  /**
   * Kept current while the page is open — a locale switch or the session
   * resolving changes the height of a menu nobody has opened yet.
   *
   * The observer is not sufficient on its own, which is why the button
   * measures too: an element that has been `display: none` since mount has
   * never been observed at a real size, and coming back from none does not
   * reliably deliver an entry. Crossing the breakpoint with the menu shut is
   * exactly that case, and it is the common one — every desktop reader who
   * narrows the window, and every phone that rotates.
   */
  useEffect(() => {
    const inner = menuInnerRef.current;
    if (!inner) return;

    measureMenu();
    const observer = new ResizeObserver(measureMenu);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [measureMenu]);

  /** Measured on the way in, so the first open animates to the right height. */
  const openMenu = () => {
    measureMenu();
    setMenuOpen(true);
  };

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 64rem)");
    const onChange = () => {
      if (wide.matches) setMenuOpen(false);
    };
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  /** The "Más" button carries the active mark when the reader is inside one of its sections. */
  const overflowActive = OVERFLOW_LINKS.some((link) => link.id === active);

  /**
   * Open/close choreography, owned by Motion rather than stylesheets.
   *
   * The split is deliberate and load-bearing: the frame moves (rise + grow on
   * open, shrink + lift on close) but never fades, because Chromium does not
   * sample `backdrop-filter` while opacity interpolates — fading the frosted
   * frame flashes it transparent first. The rows fade instead, on a wrapper
   * that carries no backdrop-filter, over the same 200ms so both end together.
   */
  const reduceMotion = useReducedMotion();
  const moreDur = reduceMotion ? 0 : 0.2;
  const moreFrame: Variants = {
    hidden: { y: -8, scale: 0.96 },
    shown: { y: 0, scale: 1, transition: { duration: moreDur, ease: [0.16, 1, 0.3, 1] } },
    gone: { y: -8, scale: 0.96, transition: { duration: moreDur, ease: [0.5, 0, 0.75, 0] } },
  };
  const moreRows: Variants = {
    hidden: { opacity: 0 },
    shown: { opacity: 1, transition: { duration: moreDur, ease: "easeOut" } },
    gone: { opacity: 0, transition: { duration: moreDur, ease: "easeIn" } },
  };

  return (
    <header className="lp-header" data-menu-open={menuOpen} ref={headerRef}>
      {/* The frost, as its own layer, and — since the drawer below is part of
          this element's box — the mobile menu's background too. One surface,
          so the bar and the open menu cannot disagree about what colour they
          are, which is what they used to do at the top of the page.

          The blur is a Tailwind utility rather than a `backdrop-filter` in
          globals.css because only the utilities resolve through the
          `--tw-backdrop-*` chain and come out of this project's CSS pipeline
          intact — the same reason `.lp-veil` carries its blurs on spans.
          `.lp-header-blur` fades it in on scroll, and holds it up while the
          menu is open however far down the page the reader is. */}
      <div aria-hidden="true" className="lp-header-blur backdrop-blur-xl backdrop-saturate-150" />
      <Shell className="relative flex h-16 items-center justify-between gap-6">
        <Link
          href={landingPath}
          prefetch={false}
          aria-label={t("landing.header.homeAria")}
          className="lp-focus shrink-0 rounded-md transition-opacity duration-150 hover:opacity-80"
        >
          <Wordmark />
        </Link>

        <nav
          aria-label={t("landing.header.sectionsAria")}
          className={cn(styles.desktopNav, "-translate-x-1/2 absolute left-1/2 items-center gap-6 text-[13px]")}
        >
          {PRIMARY_LINKS.map((link) => (
            <a
              key={link.id}
              href={sectionHref(link.id)}
              aria-current={active === link.id ? "true" : undefined}
              className="lp-navlink lp-focus"
            >
              {t(link.labelKey)}
            </a>
          ))}
          {PRIMARY_PAGES.map((page) => (
            <Link
              key={page.href}
              href={pageHref(page.href)}
              prefetch={false}
              aria-current={pathname === pageHref(page.href) ? "page" : undefined}
              className="lp-navlink lp-focus"
            >
              {t(page.labelKey)}
            </Link>
          ))}
          {/* The rest of the map, as a wide panel: a 48px patterned tile, a
              title and one line of description per row, sections over pages.
              One dropdown rather than two flat groups — grouping by kind would
              be two one-handed menus, and the reader thinks in names. */}
          <div className="relative" ref={moreRef}>
            <button
              type="button"
              aria-expanded={moreOpen}
              aria-haspopup="true"
              aria-current={overflowActive ? "true" : undefined}
              onClick={() => setMoreOpen((open) => !open)}
              className="lp-navlink lp-focus inline-flex cursor-pointer items-center gap-1"
            >
              {t("landing.header.more")}
              <HugeiconsIcon
                icon={ChevronDownIcon}
                size={14}
                strokeWidth={2}
                className={`transition-transform duration-200 ${moreOpen ? "rotate-180" : ""}`}
              />
            </button>
            <AnimatePresence initial={false}>
              {moreOpen ? (
                <motion.div
                  key="more-panel"
                  variants={moreFrame}
                  initial="hidden"
                  animate="shown"
                  exit="gone"
                  style={{ transformOrigin: "top right" }}
                  className="absolute top-[calc(100%+12px)] right-0 w-[min(92vw,36rem)]"
                >
                {/* Tooltip notch pointing at the "Más" button: a rotated square
                    showing only its top and left borders, so it reads as the
                    panel's own corner lifted toward the trigger. Same
                    translucent ground as the panel, so it frosts what is behind
                    it instead of punching a solid chip out of the blur. */}
                <span
                  aria-hidden="true"
                  className="absolute -top-[5px] right-7 z-10 block size-2.5 rotate-45 border-t border-l border-border bg-popover/80 backdrop-blur-xl"
                />
                <div className="relative overflow-hidden rounded-2xl border border-border bg-popover/80 shadow-xl backdrop-blur-xl">
                  <motion.div variants={moreRows} className="relative p-2">
                    <div className="grid gap-1 sm:grid-cols-2">
                      {OVERFLOW_LINKS.map((link) => (
                        <a
                          key={link.id}
                          href={sectionHref(link.id)}
                          aria-current={active === link.id ? "true" : undefined}
                          onClick={() => setMoreOpen(false)}
                          className="lp-focus group flex items-center gap-4 rounded-xl p-3 transition-colors duration-150 hover:bg-accent/80"
                        >
                          <MoreTile icon={link.icon} />
                          <MoreTexts title={t(link.labelKey)} desc={t(link.descKey)} />
                        </a>
                      ))}
                    </div>
                    <div aria-hidden="true" className="mx-2 my-1.5 h-px bg-border" />
                    <div className="grid gap-1 sm:grid-cols-2">
                      {OVERFLOW_PAGES.map((page) => (
                        <Link
                          key={page.href}
                          href={pageHref(page.href)}
                          prefetch={false}
                          aria-current={pathname === pageHref(page.href) ? "page" : undefined}
                          onClick={() => setMoreOpen(false)}
                          className="lp-focus group flex items-center gap-4 rounded-xl p-3 transition-colors duration-150 hover:bg-accent/80"
                        >
                          <MoreTile icon={page.icon} />
                          <MoreTexts title={t(page.labelKey)} desc={t(page.descKey)} />
                        </Link>
                      ))}
                    </div>
                  </motion.div>
                </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </nav>

        {/* The session decides the action: open the app, sign in to an
            existing workspace or install, or set up a fresh install.
            Keep a placeholder until the current session is known. */}
        <div className="flex items-center gap-2">
          {session.loading ? (
            <span aria-hidden="true" className="h-8 w-[7.5rem] rounded-xl bg-muted/60" />
          ) : session.signedIn ? (
            <Button asChild size="sm">
              <Link href="/dashboard" prefetch={false}>{t("landing.cta.openApp")}</Link>
            </Button>
          ) : session.workspaceFinder || session.claimed ? (
            /* No radius override: `size="sm"` already carries the system's
               11px, and a pill here would be the one button on the site that
               is not shaped like every button inside the product. */
            <Button asChild size="sm">
              <Link href={session.workspaceFinder ? "/signin" : "/login"} prefetch={false}>{t("landing.cta.signIn")}</Link>
            </Button>
          ) : (
            <SignupDialog>
              <Button size="sm">{t("landing.cta.start")}</Button>
            </SignupDialog>
          )}
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="lp-menu"
            aria-label={menuOpen ? t("nav.closeMenu") : t("nav.menu")}
            onClick={() => (menuOpen ? closeMenu() : openMenu())}
            className={cn(styles.menuToggle, "lp-focus -mr-2 relative size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground")}
          >
            {/* Both glyphs, stacked and cross-faded, rather than one swapped
                on state. Swapping is a hard cut on the frame the click lands,
                against a drawer that takes half a second to come out — the
                button was already showing the close icon while the menu was
                still on its way in. They turn as they trade, which is the same 45° the
                landing's accordions use to make a plus into a cross. */}
            {(
              [
                [Menu01Icon, !menuOpen],
                [Cancel01Icon, menuOpen],
              ] as const
            ).map(([icon, shown], index) => (
              <span
                aria-hidden="true"
                // biome-ignore lint/suspicious/noArrayIndexKey: two fixed glyphs
                key={index}
                className="absolute inset-0 flex items-center justify-center transition-[opacity,transform] duration-[var(--panel-open-dur)] ease-[var(--panel-ease)]"
                style={{
                  opacity: shown ? 1 : 0,
                  transform: shown ? "rotate(0deg)" : "rotate(-45deg)",
                }}
              >
                <HugeiconsIcon icon={icon} size={18} strokeWidth={1.75} />
              </span>
            ))}
          </button>
        </div>
      </Shell>

      {/* Mounted always, `data-open` toggling — that is what the drawer needs
          to animate both halves, and it is also what lets the content be
          measured while the menu is shut (see `--lp-menu-h` above).

          `inert` while closed does the work unmounting used to: no tab stop,
          no screen reader, no click. The stylesheet only clips it, which would
          have left every link in there reachable by keyboard on a page that
          shows no menu.

          No background, no border, no shadow of its own. It is a window onto
          content that already sits under the bar, and the frost layer above
          is what the reader sees it through — a second opaque panel here is
          exactly the seam this replaced. */}
      <div className={cn(styles.mobileMenu, "lp-menu")} data-open={menuOpen} id="lp-menu" inert={!menuOpen}>
        {/* The measured element, and the drawer's scroll region on a screen
            too short to hold the whole list. `data-lenis-prevent` keeps the
            smooth-scroll driver off it. */}
        <div className="lp-menu-inner" data-lenis-prevent ref={menuInnerRef}>
          <Shell className="flex flex-col gap-1 py-3">
            {LINKS.map((link, index) => (
              <a
                key={link.id}
                href={sectionHref(link.id)}
                aria-current={active === link.id ? "true" : undefined}
                onClick={closeMenu}
                className="lp-menu-item lp-focus rounded-lg px-3 py-2.5 text-muted-foreground text-sm transition-colors duration-150 hover:bg-accent hover:text-foreground aria-[current]:text-foreground"
                style={{ "--i": index } as React.CSSProperties}
              >
                {t(link.labelKey)}
              </a>
            ))}
            {[
              ...PAGES.map((page) => ({ ...page, href: pageHref(page.href) })),
              session.signedIn
                ? { href: "/dashboard", labelKey: "landing.cta.openApp" }
                : {
                    href: session.workspaceFinder ? "/signin" : "/login",
                    labelKey: session.workspaceFinder || session.claimed ? "landing.cta.signIn" : "landing.cta.start",
                  },
            ].map((page, index) => (
              <Link
                key={page.href}
                href={page.href}
                prefetch={false}
                onClick={closeMenu}
                className="lp-menu-item lp-focus rounded-lg px-3 py-2.5 text-muted-foreground text-sm transition-colors duration-150 hover:bg-accent hover:text-foreground aria-[current]:text-foreground"
                aria-current={pathname === page.href ? "page" : undefined}
                /* The stagger runs across both lists, so it carries on from
                   where the section links left off rather than restarting. */
                style={{ "--i": LINKS.length + index } as React.CSSProperties}
              >
                {t(page.labelKey)}
              </Link>
            ))}
          </Shell>
        </div>
      </div>
    </header>
  );
}
