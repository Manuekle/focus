"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { Film01Icon, UserGroupIcon, Video01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import styles from "./mode-switch.module.css";

/**
 * The work in order: a character, its animation (Flipbook, Rotoscope and
 * Motion are ways to animate, all ending in the Flipbook editor), then the
 * optional video editor. Any step can be entered directly.
 */
export type Mode = "characters" | "animate" | "video";

const MODES = [
  { mode: "characters", href: "/characters", label: "Characters", step: 1, icon: UserGroupIcon },
  { mode: "animate", href: "/flipbook", label: "Animate", step: 2, icon: Film01Icon },
  { mode: "video", href: "/editor", label: "Video", step: 3, icon: Video01Icon },
] as const;

/** How long the old page takes to fade before the next one is asked for. */
const LEAVE_MS = 140;

/**
 * Characters → Animate → Video, centered in every studio header. Each mode is its own
 * page, so the pill slides to the picked tab and the content fades out first
 * (<html data-leaving>), then the page follows; the new page starts with the
 * pill in place and fades its content in (app/editor/studio.module.css).
 */
export function ModeSwitch({ current }: { readonly current: Mode }) {
  const router = useRouter();
  const [active, setActive] = useState<Mode>(current);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const [animate, setAnimate] = useState(false);
  const tabs = useRef(new Map<Mode, HTMLAnchorElement>());

  // Arriving on a page ends the leave of the one before.
  useEffect(() => {
    delete document.documentElement.dataset.leaving;
  }, []);

  useLayoutEffect(() => {
    const measure = () => {
      const tab = tabs.current.get(active);
      if (tab) setPill({ left: tab.offsetLeft, width: tab.offsetWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active]);

  const pick = (event: MouseEvent<HTMLAnchorElement>, mode: Mode, href: string) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    if (mode === active) return;
    setAnimate(true);
    setActive(mode);
    router.prefetch(href);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return router.push(href);
    document.documentElement.dataset.leaving = "";
    window.setTimeout(() => router.push(href), LEAVE_MS);
    // Never leave the page faded if the next one doesn't arrive.
    window.setTimeout(() => { delete document.documentElement.dataset.leaving; }, 4000);
  };

  return (
    <nav className={styles.modes} aria-label="Creation mode">
      {pill ? <span className={styles.pill} data-animate={animate || undefined} style={{ transform: `translateX(${pill.left}px)`, width: pill.width }} aria-hidden /> : null}
      {MODES.map(({ mode, href, label, step, icon }) => (
        <Link
          key={mode}
          ref={(node) => { if (node) tabs.current.set(mode, node); }}
          href={href}
          className={styles.mode}
          aria-current={current === mode ? "page" : undefined}
          data-active={active === mode || undefined}
          onClick={(event) => pick(event, mode, href)}
          title={mode === "video" ? "Step 3, optional: put the animation in a video" : `Step ${step}`}
        >
          <HugeiconsIcon icon={icon} size={14} strokeWidth={1.75} />{label}
        </Link>
      ))}
    </nav>
  );
}
