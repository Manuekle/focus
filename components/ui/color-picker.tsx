"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Popover } from "radix-ui";
import { DropperIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../icons/icon";
import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from "../../lib/color";
import { useT } from "../../lib/i18n/provider";
import { cn } from "../../lib/utils";

/**
 * A colour picker the product actually owns.
 *
 * `<input type="color">` is one line of markup and the wrong control here: it
 * opens the operating system's panel, which looks like macOS or like Windows
 * and never like this app, sits outside the page so nothing about it can be
 * laid out next to a preview, and on a touch device is whatever the browser
 * felt like. The screen it is used on exists to show taste; handing that
 * moment to the OS is the one place with none.
 *
 * So the whole control is drawn here: eight starting swatches, a
 * saturation/brightness square, a hue rail and the hex. The native input is
 * gone, which means keyboard support is this file's job — the rail is a real
 * `<input type="range">` laid over the painted track, the square is a
 * `role="slider"` that answers the arrow keys, and the hex field is what
 * assistive tech reads and writes.
 */

/** The row along the top: a spread wide enough to land near most brands in
 *  one tap, with the square underneath for everything else. */
const SWATCHES: readonly string[] = [
  "#000000",
  "#ef4444",
  "#f97316",
  "#facc15",
  "#22c55e",
  "#38bdf8",
  "#7038f4",
  "#ffffff",
];

/** The marker dot, px — the rail insets by half of it so the dot never hangs
 *  off either end. */
const HANDLE = 16;

/** Keyboard step on the square, as a fraction of its width/height. */
const STEP = 0.02;
const BIG_STEP = 0.1;

type EyeDropperResult = { readonly sRGBHex: string };
type EyeDropperCtor = new () => { open: () => Promise<EyeDropperResult> };

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Whether this browser can sample a pixel from the screen. Read through
 *  `useSyncExternalStore` rather than an effect: the server has no `window`,
 *  so the server snapshot is `false` and the client's real answer arrives in
 *  the same pass that hydrates — no second render, and no tree that differs
 *  from the one the server sent. Nothing ever changes it, so there is nothing
 *  to subscribe to. */
function subscribeNever(): () => void {
  return () => {};
}

function readEyeDropper(): boolean {
  return "EyeDropper" in window;
}

export function ColorPicker({
  align = "start",
  className,
  label,
  onChange,
  value,
}: {
  readonly align?: "start" | "center" | "end";
  readonly className?: string;
  /** Names the colour being edited — "Background top", not "Colour". */
  readonly label: string;
  readonly onChange: (next: string) => void;
  readonly value: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const hex = normalizeHex(value, "#000000");

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={t("color.open", { label })}
        className={cn(
          "relative size-9 shrink-0 overflow-hidden rounded-lg ring-1 ring-black/10 dark:ring-white/10",
          "cursor-pointer transition-[scale,box-shadow] duration-150 ease-out active:scale-[0.94]",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--ring)]",
          className,
        )}
        style={{ background: hex }}
        type="button"
      />
      <Popover.Portal>
        <Popover.Content
          align={align}
          className={cn(
            "z-50 w-[268px] rounded-2xl border border-border/60 bg-popover p-3 text-popover-foreground",
            // The app's own open/close curve, the one every dropdown uses.
            "t-dropdown shadow-[var(--shadow-float)] outline-none",
          )}
          collisionPadding={12}
          side="bottom"
          sideOffset={8}
          style={{ transformOrigin: "var(--radix-popover-content-transform-origin)" }}
        >
          <ColorPickerPanel label={label} onChange={onChange} value={hex} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The panel itself, also exported so a surface that wants the picker inline —
 * with no popover around it — gets the same control rather than a second one.
 */
export function ColorPickerPanel({
  label,
  onChange,
  value,
}: {
  readonly label: string;
  readonly onChange: (next: string) => void;
  readonly value: string;
}) {
  const t = useT();

  // HSV is the state, not the hex: dragging to the bottom of the square makes
  // every hue black, and reading the hue back out of `#000000` would snap the
  // square's rail to red on the way down. `emitted` is what this panel last
  // sent out, so a value arriving from anywhere else (a preset, the hex
  // field, another control) still resets the square.
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const emitted = useRef(value);
  const [draft, setDraft] = useState(value.toUpperCase());
  const hasEyeDropper = useSyncExternalStore(subscribeNever, readEyeDropper, () => false);

  useEffect(() => {
    if (value !== emitted.current) {
      setHsv(hexToHsv(value));
      setDraft(value.toUpperCase());
    }
    emitted.current = value;
  }, [value]);

  const commit = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next);
    emitted.current = hex;
    setDraft(hex.toUpperCase());
    onChange(hex);
  };

  const commitHex = (next: string) => {
    const hex = normalizeHex(next, "");
    if (!hex) return;
    setHsv(hexToHsv(hex));
    emitted.current = hex;
    setDraft(hex.toUpperCase());
    onChange(hex);
  };

  const pickFromScreen = async () => {
    const ctor = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
    if (!ctor) return;
    try {
      const picked = await new ctor().open();
      commitHex(picked.sRGBHex);
    } catch {
      // Dismissing the eyedropper rejects. Nothing happened, so nothing to say.
    }
  };

  const hex = hsvToHex(hsv);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        {SWATCHES.map((swatch) => (
          <button
            key={swatch}
            aria-label={t("color.useSwatch", { hex: swatch.toUpperCase() })}
            aria-pressed={hex === swatch}
            className={cn(
              "size-6 flex-1 rounded-[7px] ring-1 ring-black/10 transition-[scale,box-shadow] duration-150 ease-out dark:ring-white/15",
              "cursor-pointer active:scale-[0.9]",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--ring)]",
              hex === swatch && "outline-2 outline-offset-2 outline-foreground/60",
            )}
            onClick={() => commitHex(swatch)}
            style={{ background: swatch }}
            type="button"
          />
        ))}
        {hasEyeDropper ? (
          <button
            aria-label={t("color.eyedropper")}
            className={cn(
              "grid size-6 flex-1 place-items-center rounded-[7px] text-white ring-1 ring-black/10 dark:ring-white/15",
              "cursor-pointer transition-[scale] duration-150 ease-out active:scale-[0.9]",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--ring)]",
            )}
            onClick={pickFromScreen}
            style={{
              background:
                "conic-gradient(from 180deg, #ef4444, #f97316, #facc15, #22c55e, #38bdf8, #7038f4, #ef4444)",
            }}
            type="button"
          >
            <HugeiconsIcon
              className="drop-shadow-[0_1px_1px_rgb(0_0_0/0.45)]"
              icon={DropperIcon}
              size={13}
              strokeWidth={2.2}
            />
          </button>
        ) : null}
      </div>

      <SaturationArea hsv={hsv} label={label} onChange={commit} />

      <div className="flex items-center gap-2">
        <HueRail hue={hsv.h} onChange={(h) => commit({ ...hsv, h })} />
        <input
          aria-label={t("color.hex")}
          className={cn(
            "w-[86px] shrink-0 rounded-lg border border-border bg-background px-2 py-1.5",
            "text-center font-mono text-xs tracking-[-0.02em] uppercase",
            "transition-[border-color] duration-150 ease-out hover:border-input",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--ring)]",
          )}
          maxLength={7}
          onBlur={() => setDraft(hex.toUpperCase())}
          onChange={(event) => {
            const next = event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}`;
            setDraft(next.toUpperCase());
            commitHex(next);
          }}
          spellCheck={false}
          value={draft}
        />
      </div>
    </div>
  );
}

/** Saturation across, brightness down — the square every picker draws, over a
 *  single pure hue. */
function SaturationArea({
  hsv,
  label,
  onChange,
}: {
  readonly hsv: Hsv;
  readonly label: string;
  readonly onChange: (next: Hsv) => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const seek = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    onChange({
      ...hsv,
      s: clamp01((event.clientX - rect.left) / rect.width),
      v: clamp01(1 - (event.clientY - rect.top) / rect.height),
    });
  };

  const key = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const moves: Record<string, Partial<Hsv>> = {
      ArrowLeft: { s: clamp01(hsv.s - step) },
      ArrowRight: { s: clamp01(hsv.s + step) },
      ArrowUp: { v: clamp01(hsv.v + step) },
      ArrowDown: { v: clamp01(hsv.v - step) },
      Home: { s: 0 },
      End: { s: 1 },
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    onChange({ ...hsv, ...move });
  };

  return (
    <div
      ref={ref}
      aria-label={t("color.area", { label })}
      // A square is two values in one control; saturation is the one that
      // reads as a number, and the hex says what the pair actually came to.
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(hsv.s * 100)}
      aria-valuetext={hsvToHex(hsv).toUpperCase()}
      className={cn(
        "relative h-[132px] w-full touch-none rounded-xl ring-1 ring-black/10 dark:ring-white/10",
        "cursor-crosshair select-none",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--ring)]",
      )}
      onKeyDown={key}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus();
        seek(event);
      }}
      onPointerMove={(event) => {
        if (dragging.current) seek(event);
      }}
      onPointerUp={(event) => {
        dragging.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      role="slider"
      style={{
        // `transparent` in a gradient interpolates through transparent *black*
        // in some engines and greys the ramp out; the stops are spelt with an
        // explicit zero alpha instead.
        background: [
          "linear-gradient(to top, rgb(0 0 0) 0%, rgb(0 0 0 / 0) 100%)",
          "linear-gradient(to right, rgb(255 255 255) 0%, rgb(255 255 255 / 0) 100%)",
          `hsl(${hsv.h} 100% 50%)`,
        ].join(", "),
      }}
      tabIndex={0}
    >
      <Handle color={hsvToHex(hsv)} x={hsv.s * 100} y={(1 - hsv.v) * 100} />
    </div>
  );
}

/** The hue rail. The painted track is a div; the real control on top of it is
 *  a range input at zero opacity, so arrow keys, page keys and assistive tech
 *  work without this file re-implementing any of them. Pointer events are
 *  handled on the track instead, because a range input maps a click through
 *  its thumb width and the painted handle would sit a few pixels off. */
function HueRail({ hue, onChange }: { readonly hue: number; readonly onChange: (next: number) => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);

  const seek = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    onChange(clamp01((event.clientX - rect.left) / rect.width) * 360);
  };

  return (
    <div
      ref={ref}
      className={cn(
        "relative h-4 min-w-0 flex-1 touch-none rounded-full ring-1 ring-black/10 dark:ring-white/10",
        "cursor-pointer select-none",
        "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2",
        "has-[input:focus-visible]:outline-[color:var(--ring)]",
      )}
      // Without this the browser hands focus to the nearest focusable
      // ancestor on mouse-down — the popover itself — a frame after the line
      // below asks for it, and the arrow keys then go nowhere.
      onMouseDown={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        input.current?.focus();
        seek(event);
      }}
      onPointerMove={(event) => {
        if (dragging.current) seek(event);
      }}
      onPointerUp={(event) => {
        dragging.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      style={{
        background:
          "linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
      }}
    >
      <Handle color={`hsl(${hue} 100% 50%)`} inset x={(hue / 360) * 100} y={50} />
      <input
        ref={input}
        aria-label={t("color.hue")}
        className="pointer-events-none absolute inset-0 size-full opacity-0"
        max={360}
        min={0}
        onChange={(event) => onChange(Number(event.target.value))}
        step={1}
        type="range"
        value={Math.round(hue)}
      />
    </div>
  );
}

/** The dot that marks the value, on both controls. White ring inside a dark
 *  one so it stays visible over white, over black and over a pure hue. */
function Handle({
  color,
  inset = false,
  x,
  y,
}: {
  readonly color: string;
  /** Keep the whole dot inside the track — right for a rail, wrong for the
   *  square, where a corner value should read as the corner. */
  readonly inset?: boolean;
  readonly x: number;
  readonly y: number;
}) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.35),0_1px_3px_rgb(0_0_0/0.3)]"
      style={{
        background: color,
        left: inset ? `calc(${x}% + ${(0.5 - x / 100) * HANDLE}px)` : `${x}%`,
        top: `${y}%`,
      }}
    />
  );
}
