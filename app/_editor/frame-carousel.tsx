"use client";

import Image from "next/image";
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import styles from "./frame-carousel.module.css";

type Props = {
  readonly moments: readonly number[];
  readonly active: number;
  readonly disabled?: boolean;
  readonly onSelect: (seconds: number) => void;
  readonly onInteract: () => void;
};

type Drag = { id: number; x: number; y: number; delta: number; moved: boolean };

/** A circular focus strip: one crisp frame, two smaller neighbors on either side. */
export function FrameCarousel({ moments, active, disabled = false, onSelect, onInteract }: Props) {
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const focusAfterSelect = useRef<number | null>(null);
  const [dragX, setDragX] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const count = moments.length;

  useLayoutEffect(() => {
    if (focusAfterSelect.current !== active) return;
    cards.current[active]?.focus({ preventScroll: true });
    focusAfterSelect.current = null;
  }, [active]);

  if (!count) return null;

  const select = (index: number, focus = false) => {
    const next = ((index % count) + count) % count;
    if (focus && next !== active) focusAfterSelect.current = next;
    onSelect(moments[next]);
    setAnnouncement(`Frame ${next + 1} of ${count} selected.`);
    if (focus && next === active) cards.current[next]?.focus({ preventScroll: true });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number;
    if (event.key === "ArrowLeft") next = active - 1;
    else if (event.key === "ArrowRight") next = active + 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    else return;
    if (disabled) return;
    event.preventDefault();
    suppressClick.current = false;
    select(next, true);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    suppressClick.current = false;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, delta: 0, moved: false };
    onInteract();
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const press = drag.current;
    if (!press || press.id !== event.pointerId) return;
    if (event.buttons === 0) { drag.current = null; setDragX(0); return; }
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    if (!press.moved) {
      // Preserve ordinary vertical page scrolling on a phone.
      if (Math.abs(dy) > Math.abs(dx) + 4) { drag.current = null; return; }
      if (Math.abs(dx) < 6) return;
      press.moved = true;
      suppressClick.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    press.delta = dx;
    setDragX(Math.max(-100, Math.min(100, dx * .65)));
  };

  const release = (event: PointerEvent<HTMLDivElement>, canceled = false) => {
    const press = drag.current;
    if (!press || press.id !== event.pointerId) return;
    drag.current = null;
    setDragX(0);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (canceled || !press.moved || Math.abs(press.delta) < 28) return;
    const step = event.currentTarget.clientWidth < 400 ? 64 : 100;
    const distance = Math.max(1, Math.min(2, Math.round(Math.abs(press.delta) / step)));
    select(active + (press.delta < 0 ? distance : -distance));
  };

  return (
    <div className={styles.carousel} role="region" aria-roledescription="carousel" aria-label="Reze animation frames" onKeyDown={onKeyDown} onFocusCapture={onInteract} data-frame-carousel="">
      <p className="sr-only" id="frame-carousel-help">Choose a frame, swipe, or use the left and right arrow keys to explore the animation.</p>
      <div
        className={styles.viewport}
        style={{ "--drag-x": `${dragX}px` } as CSSProperties}
        data-dragging={dragX !== 0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => release(event)}
        onPointerCancel={(event) => release(event, true)}
        onLostPointerCapture={() => { drag.current = null; setDragX(0); }}
        onClickCapture={(event) => {
          if (!suppressClick.current) return;
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }}
      >
        {moments.map((moment, index) => {
          const offset = ((index - active + count + Math.floor(count / 2)) % count) - Math.floor(count / 2);
          const distance = Math.abs(offset);
          const visible = distance <= 2;
          return (
            <button
              key={moment}
              ref={(element) => { cards.current[index] = element; }}
              type="button"
              className={styles.card}
              style={{
                "--direction": Math.sign(offset),
                "--distance": distance,
                "--scale": distance === 0 ? 1 : distance === 1 ? .74 : distance === 2 ? .48 : .3,
                "--fade": distance === 0 ? 1 : distance === 1 ? .76 : distance === 2 ? .38 : 0,
                "--blur": distance === 0 ? "0px" : distance === 1 ? ".35px" : distance === 2 ? "1.5px" : "3px",
                zIndex: count - distance,
              } as CSSProperties}
              data-visible={visible}
              aria-hidden={!visible}
              aria-label={`Preview at ${moment} ${moment === 1 ? "second" : "seconds"}`}
              aria-describedby={index === active ? "frame-carousel-help" : undefined}
              aria-pressed={index === active}
              tabIndex={index === active ? 0 : -1}
              disabled={disabled || !visible}
              onClick={() => select(index)}
            >
              <Image src={`/demo/flipbook/reze-frame-${index + 1}.jpg`} alt="" width={240} height={427} draggable={false} loading="eager" unoptimized />
            </button>
          );
        })}
      </div>
      <div className={styles.controls} role="group" aria-label="Frame navigation">
        <Button type="button" size="icon-sm" className={styles.arrow} aria-label="Previous frame" onClick={() => select(active - 1)} disabled={disabled}>
          <HugeiconsIcon icon={ArrowLeft01Icon} size={14} strokeWidth={1.75} />
        </Button>
        <Button type="button" size="icon-sm" className={styles.arrow} aria-label="Next frame" onClick={() => select(active + 1)} disabled={disabled}>
          <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.75} />
        </Button>
      </div>
      <p className="sr-only" role="status" aria-atomic="true">{announcement}</p>
    </div>
  );
}
