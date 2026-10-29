"use client";

import { useEffect, useRef, type ComponentProps } from "react";

import { cn } from "../../lib/utils";
import styles from "./scroll-area.module.css";

/** Soft scroll edges appear only during movement and only over hidden content. */
export function ScrollArea({
  as: Element = "div",
  children,
  className,
  viewportClassName,
  contentClassName,
  ...props
}: Omit<ComponentProps<"div">, "ref"> & {
  as?: "div" | "main";
  viewportClassName?: string;
  contentClassName?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const area = root.current, view = viewport.current, body = content.current;
    if (!area || !view || !body) return;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const scrollable = /auto|scroll/.test(getComputedStyle(view).overflowY) && view.scrollHeight > view.clientHeight + 1;
      area.dataset.fadeTop = String(scrollable && view.scrollTop > 1);
      area.dataset.fadeBottom = String(scrollable && view.scrollHeight - view.clientHeight - view.scrollTop > 1);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
      area.dataset.scrolling = "true";
      clearTimeout(idle);
      idle = setTimeout(() => { delete area.dataset.scrolling; }, 140);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(view);
    observer.observe(body);
    view.addEventListener("scroll", onScroll, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      view.removeEventListener("scroll", onScroll);
      clearTimeout(idle);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <Element ref={root} data-slot="scroll-area" className={cn(styles.area, className)} {...props}>
      <div className={styles.surface}>
        <div ref={viewport} data-slot="scroll-area-viewport" className={cn(styles.viewport, viewportClassName)}>
          <div ref={content} className={contentClassName}>{children}</div>
        </div>
        <div aria-hidden="true" data-slot="scroll-fade-top" className={cn(styles.edge, styles.top)} />
        <div aria-hidden="true" data-slot="scroll-fade-bottom" className={cn(styles.edge, styles.bottom)} />
      </div>
    </Element>
  );
}
