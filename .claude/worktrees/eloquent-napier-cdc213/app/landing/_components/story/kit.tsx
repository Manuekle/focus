"use client";

/**
 * The parts every story loop is drawn with.
 *
 * ── The canvas ───────────────────────────────────────────────────────
 *
 * A story is composed on a fixed board, the way a video is: 1040 × 600 when
 * the frame is wide, 360 × 640 when it is a phone. The board is scaled to the
 * frame as one piece, so a composition that is right at one width is right at
 * every width — nothing re-wraps, nothing collides, the choreography holds.
 * It is still live DOM: text stays sharp at any zoom, the colours are the
 * app's tokens (so it follows light and dark), and the faces are the
 * platform's own — SF Pro Text and SF Pro Rounded on Apple, which a rendered
 * video could never carry.
 *
 * ── The clock ────────────────────────────────────────────────────────
 *
 * One `requestAnimationFrame` loop per story, running only while the story is
 * on screen, the tab is visible and the visitor allows motion. Every element
 * is a pure function of `t` (see `time.ts`), so pausing holds the exact frame
 * and reduced motion shows the story's poster — its most complete moment —
 * instead of a blank stage.
 */

import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/icon";
import { File01Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import {
  type CSSProperties,
  type ReactNode,
  type Ref,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useAnimationActive } from "@/lib/hooks/use-animation-active";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";
import styles from "./story.module.css";
import { bump, ease, fade, mix, ramp, reveal, settle } from "./time";

// ── Canvas ───────────────────────────────────────────────────────────

export type Layout = "wide" | "tall";

/** Board widths. Each story sets its own heights (`StoryScript.board`) so
 *  there is no empty band above or below what it draws. */
export const BOARD_WIDTH = { wide: 1040, tall: 360 } as const;

/** Below this frame width the story switches to its phone composition. */
const WIDE_FROM = 720;
/** A phone board in a tablet-wide frame grows, but not past this. */
const TALL_MAX_SCALE = 1.25;

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export type StoryProps = {
  readonly t: number;
  readonly layout: Layout;
  /** Whether the clock is running — for parts with their own motion (the AI orb). */
  readonly running: boolean;
};

export type StoryScript = {
  /** Loop length in ms. The last frame must equal the first. */
  readonly duration: number;
  /** Where a lap that has not started yet rests: the opening, already set. */
  readonly start: number;
  /** The most complete moment, shown with reduced motion. */
  readonly poster: number;
  /** Board heights for the wide and the phone composition. */
  readonly board: { readonly wide: number; readonly tall: number };
};

export function StoryCanvas({
  script,
  paused = false,
  time,
  label,
  children,
}: {
  readonly script: StoryScript;
  readonly paused?: boolean;
  /** For the dev scrubber and tests: draw this moment and do not run. */
  readonly time?: number;
  readonly label?: string;
  readonly children: (props: StoryProps) => ReactNode;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const live = useAnimationActive(outer);
  const reduced = useReducedMotion();
  const [box, setBox] = useState<{ layout: Layout; scale: number; left: number } | null>(null);
  const [t, setT] = useState(script.start);

  useIsoLayoutEffect(() => {
    const node = outer.current;
    if (!node) return;
    const measure = () => {
      const width = node.clientWidth;
      if (!width) return;
      const layout: Layout = width >= WIDE_FROM ? "wide" : "tall";
      const w = BOARD_WIDTH[layout];
      const scale = layout === "wide" ? width / w : Math.min(width / w, TALL_MAX_SCALE);
      const left = (width - w * scale) / 2;
      setBox((prev) =>
        prev && prev.layout === layout && Math.abs(prev.scale - scale) < 1e-4 && Math.abs(prev.left - left) < 0.25
          ? prev
          : { layout, scale, left },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const running = time === undefined && live && !paused && !reduced && box !== null;

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      // At most ~60 renders a second: on a 120 Hz screen every other frame is
      // skipped, which halves the work and is invisible at these speeds.
      if (now - last < 15) return;
      // A long gap (a dropped frame, a background tab the observer has not
      // reported yet) advances one ordinary frame, never a jump.
      const dt = Math.min(now - last, 50);
      last = now;
      setT((prev) => (prev + dt) % script.duration);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, script.duration]);

  const shown = time ?? (reduced ? script.poster : t);

  return (
    <div className="@container w-full" aria-label={label}>
      <div ref={outer} className={STAGE} style={stageHeights(script.board)} data-story={running ? "playing" : "still"}>
        {box ? (
          <div
            data-board=""
            className="absolute top-0 origin-top-left font-sans text-foreground"
            style={{
              left: box.left,
              width: BOARD_WIDTH[box.layout],
              height: script.board[box.layout],
              transform: `scale(${box.scale})`,
            }}
          >
            {children({ t: shown, layout: box.layout, running })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The board's height for each composition, set before any script runs, so
 * the frame never changes size when a story mounts.
 */
const STAGE = cn(styles.plate, "w-full h-[var(--story-tall)] @min-[720px]:h-[var(--story-wide)]");

function stageHeights(board: StoryScript["board"]): CSSProperties {
  return {
    "--story-wide": `calc(100cqw * ${board.wide} / ${BOARD_WIDTH.wide})`,
    "--story-tall": `min(calc(100cqw * ${board.tall} / ${BOARD_WIDTH.tall}), ${board.tall * TALL_MAX_SCALE}px)`,
  } as CSSProperties;
}

/** The empty stage a story is loaded into: same size, same ground, nothing on it. */
export function StoryStage({ board }: { readonly board: StoryScript["board"] }) {
  return (
    <div className="@container w-full" aria-hidden="true">
      <div className={STAGE} style={stageHeights(board)} />
    </div>
  );
}

// ── Surfaces ─────────────────────────────────────────────────────────

/** A card lifted off the stage: hairline, bevel, soft float shadow. */
export function Surface({
  className,
  style,
  children,
  ref,
}: {
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly children?: ReactNode;
  readonly ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={ref}
      className={cn(
        "absolute overflow-hidden rounded-[18px] border border-border bg-card",
        "shadow-[inset_0_1px_0_var(--lp-bevel,oklch(1_0_0/0.9)),var(--story-shadow)]",
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}

export function Avatar({ initials, className }: { readonly initials: string; readonly className?: string }) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-[12px] font-medium text-muted-foreground shadow-[var(--shadow-inset)]",
        className,
      )}
    >
      {initials}
    </span>
  );
}

/** The icon tile the app puts beside a name: muted square, inset edge. */
export function Tile({
  icon,
  className,
  size = 16,
}: {
  readonly icon: IconSvgElement;
  readonly className?: string;
  readonly size?: number;
}) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-muted text-muted-foreground shadow-[var(--shadow-inset)]",
        className,
      )}
    >
      <HugeiconsIcon icon={icon} size={size} strokeWidth={1.75} />
    </span>
  );
}

// ── Conversation ─────────────────────────────────────────────────────

export type Speaker = "customer" | "oruka" | "team";

/**
 * A chat bubble as the landing's canonical conversation draws it: the
 * customer on a card, oruka on the primary fill, each with the corner nearest
 * its speaker tucked in. A person from the team writes on the muted fill, so
 * the moment a human takes over is visible at a glance.
 */
export function Bubble({
  from,
  children,
  className,
}: {
  readonly from: Speaker;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "w-fit max-w-[84%] px-3.5 py-2.5 text-[13.5px] leading-[1.45] tracking-[-0.006em] text-pretty",
        from === "customer" && "rounded-[16px] rounded-tl-[6px] border border-border bg-card text-foreground shadow-[var(--shadow-soft)]",
        from === "oruka" && "ml-auto rounded-[16px] rounded-tr-[6px] bg-primary text-primary-foreground shadow-[var(--shadow-button)]",
        from === "team" && "ml-auto rounded-[16px] rounded-tr-[6px] bg-muted text-foreground shadow-[var(--shadow-inset)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A message that joins a conversation. Its row opens from zero height while
 * the bubble fades and focuses in, so the messages above are pushed up by the
 * new one rather than jumping — the way a real thread scrolls.
 */
export function Arrive({
  t,
  at,
  leave,
  children,
  className,
}: {
  readonly t: number;
  readonly at: number;
  readonly leave?: number;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const open = settle(t, at, 620);
  const close = leave === undefined ? 0 : settle(t, leave, 520);
  const rows = open * (1 - close);
  if (rows <= 0.0005) return null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)]" style={{ gridTemplateRows: `${rows.toFixed(4)}fr` }}>
      <div className={cn("min-h-0 min-w-0", className)}>
        <div style={reveal(t, at + 60, { dur: 520, y: 8, scale: 0.97, blur: 5 }, leave === undefined ? undefined : { at: leave, dur: 200, y: -2, blur: 4 })}>
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * A conversation's messages, newest at the foot. When there are more than fit,
 * the oldest slide up under the header and dissolve there — and only then: a
 * thread that fits shows every message at full strength, with room above the
 * first one.
 */
export function Thread({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  const node = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(0);
  useIsoLayoutEffect(() => {
    const thread = node.current;
    const first = thread?.firstElementChild as HTMLElement | null;
    if (!thread || !first) return;
    const measure = () => {
      const next = Math.max(0, Math.min(28, PAD_TOP - first.offsetTop));
      setOverflow((previous) => Math.abs(next - previous) > 0.5 ? next : previous);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    // The messages' expanding rows move the first message even once the
    // thread reaches max-height. Observe them as well as the thread itself.
    const observer = new ResizeObserver(measure);
    observer.observe(thread);
    for (const child of thread.children) observer.observe(child);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={node}
      className={cn("relative flex min-h-0 flex-1 flex-col justify-end gap-2.5 overflow-hidden px-4 pt-3 pb-4", className)}
      style={
        overflow > 0.5
          ? {
              maskImage: `linear-gradient(to bottom, transparent 0, #000 ${(overflow + 6).toFixed(1)}px)`,
              WebkitMaskImage: `linear-gradient(to bottom, transparent 0, #000 ${(overflow + 6).toFixed(1)}px)`,
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

/** `pt-3` on the thread. */
const PAD_TOP = 12;

/** oruka is writing: three dots that take turns, without moving. */
export function Typing({ t, className }: { readonly t: number; readonly className?: string }) {
  return (
    <div className={cn("ml-auto flex h-9 w-[58px] items-center justify-center gap-1 rounded-[16px] rounded-tr-[6px] bg-primary", className)}>
      {[0, 1, 2].map((dot) => {
        const phase = ((t / 900 - dot * 0.18) % 1 + 1) % 1;
        const glow = Math.sin(Math.PI * Math.min(phase / 0.6, 1)) ** 2;
        return (
          <span
            key={dot}
            className="size-[5px] rounded-full bg-primary-foreground"
            style={{ opacity: 0.35 + glow * 0.6 }}
          />
        );
      })}
    </div>
  );
}

/** Text arriving word by word, each word focusing in. Layout is the final one from the start. */
export function Words({
  t,
  at,
  text,
  gap = 42,
}: {
  readonly t: number;
  readonly at: number;
  readonly text: string;
  readonly gap?: number;
}) {
  const words = text.split(" ");
  return (
    <>
      {words.map((word, index) => {
        // Opacity only: a blur here would be one filter layer per word, every frame.
        const p = ramp(t, at + index * gap, 240, ease.smooth);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: words repeat; position is the identity.
          <span key={index} style={{ opacity: p }}>
            {word}
            {index < words.length - 1 ? " " : ""}
          </span>
        );
      })}
    </>
  );
}

/** Typed text with a caret that blinks while waiting and holds while typing. */
export function Typed({
  t,
  text,
  shown,
  caret = true,
  className,
}: {
  readonly t: number;
  readonly text: string;
  readonly shown: string;
  readonly caret?: boolean;
  readonly className?: string;
}) {
  const typing = shown.length > 0 && shown.length < text.length;
  const on = typing || Math.floor(t / 530) % 2 === 0;
  return (
    <span className={className}>
      {shown}
      {caret ? (
        <span
          aria-hidden="true"
          className="ml-px inline-block h-[1.1em] w-[1.5px] translate-y-[0.18em] rounded-full bg-[var(--btn-ai-bg)]"
          style={{ opacity: on ? 1 : 0 }}
        />
      ) : null}
    </span>
  );
}

/** Where an answer came from: the file it was read from. */
export function SourceChip({ name, className }: { readonly name: string; readonly className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11.5px] text-muted-foreground", className)}>
      <HugeiconsIcon icon={File01Icon} size={12} strokeWidth={1.75} />
      {name}
    </span>
  );
}

// ── Status ───────────────────────────────────────────────────────────

export type Tone = "pending" | "progress" | "success" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  pending: "tone-pending",
  progress: "tone-progress",
  success: "tone-success",
  neutral: "tone-expired",
};

/** The app's status pill (`.pill.tone-pill`), with an optional icon. */
export function Pill({
  tone,
  icon,
  children,
  className,
  style,
}: {
  readonly tone: Tone;
  readonly icon?: IconSvgElement;
  readonly children: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
}) {
  return (
    <span className={cn("pill tone-pill", TONE_CLASS[tone], className)} style={style}>
      {icon ? <HugeiconsIcon icon={icon} size={12} strokeWidth={2} /> : null}
      {children}
    </span>
  );
}

/**
 * One pill turning into another at `at`: the first focuses out upwards as the
 * second focuses in from below, in the same slot. Right-aligned, so a status
 * column keeps its edge.
 */
export function PillSwap({
  t,
  at,
  from,
  to,
  align = "end",
}: {
  readonly t: number;
  readonly at: number;
  readonly from: ReactNode;
  readonly to: ReactNode;
  readonly align?: "start" | "end";
}) {
  const p = ramp(t, at, 460, ease.smooth);
  return (
    <span className={cn("grid", align === "end" ? "justify-items-end" : "justify-items-start")}>
      <span
        className="col-start-1 row-start-1"
        style={{
          opacity: 1 - p,
          transform: `translateY(${(-p * 6).toFixed(2)}px)`,
          filter: p > 0.02 && p < 0.98 ? `blur(${(p * 4).toFixed(2)}px)` : undefined,
          visibility: p >= 1 ? "hidden" : undefined,
        }}
      >
        {from}
      </span>
      <span
        className="col-start-1 row-start-1"
        style={{
          opacity: p,
          transform: `translateY(${((1 - p) * 6).toFixed(2)}px)`,
          filter: p > 0.02 && p < 0.98 ? `blur(${((1 - p) * 4).toFixed(2)}px)` : undefined,
          visibility: p <= 0 ? "hidden" : undefined,
        }}
      >
        {to}
      </span>
    </span>
  );
}

/**
 * Labels that replace one another at given moments, in a box that is always
 * as wide as the label it shows — a button that says "Created" is not left
 * the width of "Create with AI". Each label is measured once laid out; the
 * width eases between them while they cross-fade.
 */
export function Swap({
  t,
  items,
  className,
}: {
  readonly t: number;
  /** `at` of the first item is ignored: it is there from the start. */
  readonly items: readonly { readonly at: number; readonly node: ReactNode }[];
  readonly className?: string;
}) {
  const nodes = useRef<(HTMLSpanElement | null)[]>([]);
  const [widths, setWidths] = useState<readonly number[]>([]);
  useIsoLayoutEffect(() => {
    const measure = () => {
      const next = nodes.current.map((node) => node?.offsetWidth ?? 0);
      setWidths((previous) => next.some((width, index) => Math.abs(width - (previous[index] ?? -1)) > 0.5) ? next : previous);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    for (const node of nodes.current) if (node) observer.observe(node);
    return () => observer.disconnect();
  }, [items.length]);
  const current = items.reduce((found, item, index) => (index === 0 || t >= item.at ? index : found), 0);
  const p = current === 0 ? 1 : ramp(t, items[current].at, 320, ease.smooth);
  const from = widths[Math.max(0, current - 1)] ?? 0;
  const to = widths[current] ?? 0;
  return (
    <span className={cn("relative inline-flex", className)} style={widths.length ? { width: mix(from, to, p) } : undefined}>
      {items.map((item, index) => {
        const opacity = index === current ? p : index === current - 1 ? 1 - p : 0;
        return (
          <span
            key={item.at}
            ref={(node) => {
              nodes.current[index] = node;
            }}
            aria-hidden={index !== current || undefined}
            className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", index === current ? "relative" : "absolute top-0 left-0")}
            style={{ opacity }}
          >
            {item.node}
          </span>
        );
      })}
    </span>
  );
}

/** A check that draws itself. */
export function Check({
  t,
  at,
  size = 16,
  className,
}: {
  readonly t: number;
  readonly at: number;
  readonly size?: number;
  readonly className?: string;
}) {
  const p = ramp(t, at, 520, ease.out);
  const ring = ramp(t, at - 80, 420, ease.smooth);
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center rounded-full bg-[var(--status-success-bg)] text-[var(--status-success-fg)]", className)}
      style={{ width: size + 6, height: size + 6, opacity: ring, transform: `scale(${mix(0.8, 1, ring).toFixed(4)})` }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M6 12.5l4 4L18 8"
          pathLength={1}
          stroke="currentColor"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={1}
          strokeDashoffset={1 - p}
        />
      </svg>
    </span>
  );
}

/**
 * The app's spinner (`components/ui/spinner.tsx`: Loading03Icon, turning)
 * that resolves into a check at `done`. It turns on the story clock, so a
 * paused story holds it still.
 */
export function Progress({
  t,
  at,
  done,
  until,
  size = 16,
}: {
  readonly t: number;
  readonly at: number;
  readonly done: number;
  /** When the result clears again, for a story that loops on the same card. */
  readonly until?: number;
  readonly size?: number;
}) {
  const spinning = fade(t, at, 200, done - 200, 140);
  const shown = until === undefined ? 1 : 1 - ramp(t, until, 320, ease.smooth);
  return (
    <span className="relative flex shrink-0 items-center justify-center" style={{ width: size + 6, height: size + 6, opacity: shown }}>
      <span className="absolute inset-0 flex items-center justify-center text-muted-foreground" style={{ opacity: spinning }}>
        <Spin t={t} size={size} />
      </span>
      <span className="absolute inset-0 flex items-center justify-center">
        <Check t={t} at={done} size={size} />
      </span>
    </span>
  );
}

/** Loading03Icon turning once a second, on the story clock. */
export function Spin({ t, size = 16, className }: { readonly t: number; readonly size?: number; readonly className?: string }) {
  return (
    <HugeiconsIcon
      icon={Loading03Icon}
      size={size}
      strokeWidth={1.75}
      className={className}
      style={{ transform: `rotate(${(((t / 1000) * 360) % 360).toFixed(1)}deg)` }}
    />
  );
}

// ── Numbers ──────────────────────────────────────────────────────────

/**
 * A figure that changes at `at`: the old value leaves upwards as the new one
 * rises into its place, in rounded tabular figures so nothing beside it moves.
 */
export function Roll({
  t,
  at,
  from,
  to,
  className,
}: {
  readonly t: number;
  readonly at: number;
  readonly from: string;
  readonly to: string;
  readonly className?: string;
}) {
  const p = ramp(t, at, 520, ease.out);
  return (
    <span className={cn("relative inline-grid overflow-hidden font-heading tabular-nums", className)}>
      <span
        className="col-start-1 row-start-1"
        style={{ transform: `translateY(${(-p * 100).toFixed(2)}%)`, opacity: 1 - p }}
      >
        {from}
      </span>
      <span
        className="col-start-1 row-start-1"
        style={{ transform: `translateY(${((1 - p) * 100).toFixed(2)}%)`, opacity: p }}
      >
        {to}
      </span>
    </span>
  );
}

/** A line of AI-blue light passing over muted text while something is being worked out. */
export function Shimmer({ t, children, className }: { readonly t: number; readonly children: ReactNode; readonly className?: string }) {
  const x = 160 - ((t / 1500) % 1) * 220;
  return (
    <span
      className={cn("bg-clip-text text-transparent", className)}
      style={{
        backgroundImage:
          "linear-gradient(100deg, var(--muted-foreground) 35%, var(--btn-ai-bg) 50%, var(--muted-foreground) 65%)",
        backgroundSize: "250% 100%",
        backgroundPosition: `${x.toFixed(1)}% 0`,
      }}
    >
      {children}
    </span>
  );
}

// ── Anchors ──────────────────────────────────────────────────────────

export type Point = { readonly x: number; readonly y: number };

/**
 * Where named elements sit on the board, in board units, measured after every
 * frame's layout. For a pointer that has to land on a button whose position
 * depends on text the story does not control (a translation, a font).
 * Returns a ref factory and the last measured centres.
 */
export function useBoardPoints<K extends string>(): readonly [(key: K) => (node: HTMLElement | null) => void, Partial<Record<K, Point>>] {
  const nodes = useRef(new Map<K, HTMLElement>());
  const setters = useRef(new Map<K, (node: HTMLElement | null) => void>());
  const [points, setPoints] = useState<Partial<Record<K, Point>>>({});

  useIsoLayoutEffect(() => {
    let changed = false;
    const next: Partial<Record<K, Point>> = { ...points };
    for (const [key, node] of nodes.current) {
      const board = node.closest<HTMLElement>("[data-board]");
      if (!board || !node.isConnected) continue;
      const scale = board.getBoundingClientRect().width / board.offsetWidth || 1;
      const b = board.getBoundingClientRect();
      const r = node.getBoundingClientRect();
      const point = { x: (r.left - b.left + r.width / 2) / scale, y: (r.top - b.top + r.height / 2) / scale };
      const prev = points[key];
      if (!prev || Math.abs(prev.x - point.x) > 0.5 || Math.abs(prev.y - point.y) > 0.5) {
        next[key] = point;
        changed = true;
      }
    }
    if (changed) setPoints(next);
  });

  const ref = (key: K) => {
    let setter = setters.current.get(key);
    if (!setter) {
      setter = (node: HTMLElement | null) => {
        if (node) nodes.current.set(key, node);
        else nodes.current.delete(key);
      };
      setters.current.set(key, setter);
    }
    return setter;
  };

  return [ref, points] as const;
}

/** A surface's height in board units, measured only when its size changes. */
export function useHeight(): readonly [Ref<HTMLDivElement>, number] {
  const node = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useIsoLayoutEffect(() => {
    const element = node.current;
    if (!element) return;
    const measure = () => {
      const next = element.offsetHeight;
      setHeight((previous) => Math.abs(next - previous) > 0.5 ? next : previous);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [node, height] as const;
}

// ── Pointer ──────────────────────────────────────────────────────────

/**
 * The demo's pointer, always the system arrow so it can never be mistaken for
 * the visitor's own. `press` is a click moment: the arrow dips and a ring
 * opens under its tip.
 */
export function Cursor({
  x,
  y,
  t,
  presses = [],
  opacity = 1,
}: {
  readonly x: number;
  readonly y: number;
  readonly t: number;
  readonly presses?: readonly number[];
  readonly opacity?: number;
}) {
  const press = presses.reduce((sum, at) => Math.max(sum, bump(t, at, at + 220)), 0);
  const ring = presses.reduce((found, at) => (t >= at && t < at + 600 ? at : found), -1);
  const ringP = ring < 0 ? 0 : ramp(t, ring, 600, ease.out);
  if (opacity <= 0.001) return null;
  return (
    <div className="pointer-events-none absolute top-0 left-0 z-30" style={{ transform: `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`, opacity }}>
      {ring >= 0 ? (
        <span
          className="absolute -top-4 -left-4 size-8 rounded-full border border-foreground/40"
          style={{ opacity: (1 - ringP) * 0.9, transform: `scale(${mix(0.3, 1.2, ringP).toFixed(3)})` }}
        />
      ) : null}
      <svg
        width="20"
        height="22"
        viewBox="0 0 20 22"
        aria-hidden="true"
        className="drop-shadow-[0_2px_4px_oklch(0_0_0/0.25)]"
        style={{ transform: `scale(${(1 - press * 0.12).toFixed(3)})`, transformOrigin: "2px 2px" }}
      >
        <path
          d="M2.2 1.6v15.6c0 .5.6.8 1 .4l3.6-3.5 2.6 5.9c.2.4.6.5 1 .4l2.1-.9c.4-.2.5-.6.4-1l-2.6-5.8 5-.2c.5 0 .8-.6.4-1L3.3 1.1c-.4-.3-1.1 0-1.1.5Z"
          fill="#111"
          stroke="#fff"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/** A button being pressed by the demo pointer: it darkens and dips. */
export function pressStyle(t: number, at: number): CSSProperties {
  const p = bump(t, at, at + 260);
  return { transform: `scale(${(1 - p * 0.04).toFixed(4)})`, filter: p > 0.01 ? `brightness(${(1 - p * 0.12).toFixed(3)})` : undefined };
}

// ── Connectors ───────────────────────────────────────────────────────

/** A hairline drawn from one point to another along a soft S, with a light travelling it. */
export function Wire({
  t,
  at,
  from,
  to,
  out,
  dur = 700,
}: {
  readonly t: number;
  readonly at: number;
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  readonly out?: number;
  readonly dur?: number;
}) {
  const p = ramp(t, at, dur, ease.inOut);
  const o = out === undefined ? 1 : 1 - ramp(t, out, 320, ease.in);
  if (p <= 0 || o <= 0) return null;
  const [x1, y1] = from;
  const [x2, y2] = to;
  const mx = (x1 + x2) / 2;
  const d = `M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  const minX = Math.min(x1, x2) - 8;
  const minY = Math.min(y1, y2) - 8;
  const w = Math.abs(x2 - x1) + 16;
  const h = Math.abs(y2 - y1) + 16;
  const pulse = ramp(t, at + dur * 0.4, 900, ease.inOut);
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute overflow-visible"
      style={{ left: minX, top: minY, width: w, height: h, opacity: o }}
      viewBox={`${minX} ${minY} ${w} ${h}`}
    >
      <path d={d} fill="none" stroke="var(--border)" strokeWidth={1.5} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
      <path
        d={d}
        fill="none"
        stroke="var(--btn-ai-bg)"
        strokeWidth={1.5}
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="0.14 1"
        strokeDashoffset={0.14 - pulse * 1.14}
        style={{ opacity: pulse > 0 && pulse < 1 ? 0.9 : 0 }}
      />
      <circle cx={x2} cy={y2} r={3} fill="var(--card)" stroke="var(--border)" strokeWidth={1.5} style={{ opacity: ramp(t, at + dur * 0.8, 240) }} />
    </svg>
  );
}
