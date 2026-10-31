"use client";

import { AnimatePresence, motion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import { useReducedMotion } from "../../lib/hooks/use-reduced-motion";
import styles from "./flipbook.module.css";

type CastMember = { readonly id: string; readonly name: string; readonly coverUrl: string };
type Tile = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

const GAP = 12;
/** Covers are full-body drawings at 2:3. */
const COVER_ASPECT = 2 / 3;
const SPRING = { type: "spring", stiffness: 260, damping: 30, mass: 0.9 } as const;

/**
 * Tiles that fill the whole stage. Picks the column count that gives each
 * drawing the most room at 2:3, then stretches a short last row across the
 * full width, so no count leaves a gap.
 */
function layout(count: number, width: number, height: number): Tile[] {
  if (!count || width <= 0 || height <= 0) return [];
  let best = { cols: 1, score: -1 };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const cellWidth = (width - (cols - 1) * GAP) / cols;
    const cellHeight = (height - (rows - 1) * GAP) / rows;
    const drawn = Math.min(cellWidth, cellHeight * COVER_ASPECT);
    // Strictly greater: on a tie the fewer columns (taller tiles) win.
    if (drawn > best.score) best = { cols, score: drawn };
  }
  const rows = Math.ceil(count / best.cols);
  const tileHeight = (height - (rows - 1) * GAP) / rows;
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / best.cols);
    const inRow = row < rows - 1 ? best.cols : count - best.cols * (rows - 1);
    const column = index - row * best.cols;
    const tileWidth = (width - (inRow - 1) * GAP) / inRow;
    return { x: column * (tileWidth + GAP), y: row * (tileHeight + GAP), width: tileWidth, height: tileHeight };
  });
}

/** The picked cast, filling the scene and re-flowing with a spring as members join or leave. */
export function CastStage({ cast }: { readonly cast: readonly CastMember[] }) {
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const reducedMotion = useReducedMotion();

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const tiles = layout(cast.length, size.width, size.height);
  const transition = reducedMotion ? { duration: 0 } : SPRING;

  return (
    <div ref={stage} className={styles.castStage}>
      <AnimatePresence initial={false}>
        {tiles.length
          ? cast.map((member, index) => {
              const tile = tiles[index];
              return (
                <motion.figure
                  key={member.id}
                  className={styles.castTile}
                  initial={reducedMotion ? false : { ...tile, opacity: 0, scale: 0.92, filter: "blur(10px)" }}
                  animate={{ ...tile, opacity: 1, scale: 1, filter: "blur(0px)" }}
                  exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9, filter: "blur(10px)", transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } }}
                  transition={transition}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- the character's cover, from the media route */}
                  <img src={member.coverUrl} alt={member.name} draggable={false} />
                  <figcaption>
                    <span className={styles.castOrder}>{index + 1}</span>
                    {member.name}
                  </figcaption>
                </motion.figure>
              );
            })
          : null}
      </AnimatePresence>
    </div>
  );
}
