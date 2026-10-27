"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AstronomyColored24 } from "../../components/icons/AstronomyColored24";
import { EarthColored24 } from "../../components/icons/EarthColored24";
import { StackPlayColored24 } from "../../components/icons/StackPlayColored24";
import { VideoColored24 } from "../../components/icons/VideoColored24";
import { EASE_OUT } from "../../lib/ease";
import { useReducedMotion } from "../../lib/hooks/use-reduced-motion";
import styles from "./hero-badge.module.css";

// Every line has the same 30 characters, so the pill keeps its size as they turn.
const LINES = [
  { Icon: AstronomyColored24, text: "Finds your subject in any clip" },
  { Icon: EarthColored24, text: "Follows it through every frame" },
  { Icon: StackPlayColored24, text: "Three effects, one prompt away" },
  { Icon: VideoColored24, text: "Exported as a crisp, clean MP4" },
] as const;
const INTERVAL_MS = 3200;

/** The hero's eyebrow: what Focus does, one line at a time, inside a shimmering border. */
export function HeroBadge() {
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setIndex((value) => (value + 1) % LINES.length);
    }, INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [reducedMotion]);

  const line = LINES[reducedMotion ? 0 : index];

  return (
    <span className={styles.badge}>
      <span className="sr-only">{LINES.map((item) => item.text).join(". ")}.</span>
      {/* Every line sits in the same cell, so the widest one sets the width. */}
      <span className={styles.stack} aria-hidden="true">
        {LINES.map(({ Icon, text }) => <span key={text} className={styles.sizer}><Icon className={styles.icon} />{text}</span>)}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={line.text}
            className={styles.line}
            initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
            transition={{ duration: 0.45, ease: EASE_OUT }}
          >
            <line.Icon className={styles.icon} />
            {line.text}
          </motion.span>
        </AnimatePresence>
      </span>
    </span>
  );
}
