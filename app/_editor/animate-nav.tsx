"use client";

import Link from "next/link";
import { Film01Icon, Motion01Icon, UserGroupIcon, UserMultiple02Icon, VideoReplayIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { referenceMotionEnabled, rotoscopeEnabled } from "../../shared/features";
import shell from "../editor/studio.module.css";

/** Where each way of making an animation lives. */
export type AnimatePlace = "characters" | "flipbook" | "together" | "rotoscope" | "motion";

const PLACES = [
  { place: "characters", href: "/characters", label: "My characters", icon: UserGroupIcon, on: () => true },
  { place: "flipbook", href: "/flipbook", label: "Flipbook animations", icon: Film01Icon, on: () => true },
  { place: "together", href: "/flipbook?together=1", label: "Animate together", icon: UserMultiple02Icon, on: () => true },
  { place: "rotoscope", href: "/rotoscope", label: "Rotoscope · exact copy", icon: VideoReplayIcon, on: rotoscopeEnabled },
  { place: "motion", href: "/animate", label: "Motion · GPU render", icon: Motion01Icon, on: referenceMotionEnabled },
] as const;

/**
 * The same library links in every sidebar of steps 1 and 2: the characters,
 * then each way of animating them. Every way ends in a Flipbook animation,
 * so the user can move between them without a "back" link.
 */
export function AnimateNav({ current }: { readonly current: AnimatePlace | null }) {
  return (
    <nav className={shell.sidebarNav} aria-label="Library">
      {PLACES.filter((entry) => entry.on()).map(({ place, href, label, icon }) => (
        <Button key={place} asChild variant="ghost" size="sm" className="w-full justify-start font-normal text-muted-foreground hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground">
          <Link href={href} aria-current={current === place ? "page" : undefined}>
            <HugeiconsIcon icon={icon} size={14} strokeWidth={1.75} />
            {label}
          </Link>
        </Button>
      ))}
    </nav>
  );
}
