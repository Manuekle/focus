"use client";

import type { CSSProperties } from "react";
import { useReducedMotion } from "../../lib/hooks/use-reduced-motion";
import styles from "./hero-atmosphere.module.css";

// Fixed seeds and negative delays spread the rain across every loop from the
// first frame, without random hydration differences or a synchronized restart.
const CONFETTI = Array.from({ length: 96 }, (_, index) => {
  const left = (index * 37.7) % 100;
  const duration = 5.4 + (index % 9) * 0.43;
  return {
    left,
    duration,
    phase: -((index * 1.37) % duration),
    drift: ((index * 17) % 70) - 35,
    angle: (index * 47) % 180,
    size: 3 + index % 4,
    opacity: left > 27 && left < 73 ? 0.1 + (index % 3) * 0.02 : 0.2 + (index % 3) * 0.03,
  };
});

/** Continuous, quiet confetti behind the hero. Never intercepts a control. */
export function HeroAtmosphere() {
  const reduced = useReducedMotion();
  if (reduced) return null;

  return (
    <div aria-hidden="true" data-home-atmosphere="" className={styles.atmosphere}>
      {CONFETTI.map((piece, index) => (
        <span
          key={index}
          className={styles.confetti}
          data-blue={index % 3 === 0 ? "" : undefined}
          style={{
            left: `${piece.left}%`,
            "--piece-size": `${piece.size}px`,
            "--fall-duration": `${piece.duration}s`,
            "--fall-delay": `${piece.phase}s`,
            "--fall-drift": `${piece.drift}px`,
            "--fall-angle": `${piece.angle}deg`,
            "--piece-opacity": piece.opacity,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}
