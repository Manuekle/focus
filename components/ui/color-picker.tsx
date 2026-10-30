"use client";

import * as React from "react";
import { Popover } from "radix-ui";

import { Input } from "./input";
import { cn } from "../../lib/utils";

type Hsv = { h: number; s: number; v: number };

const HEX = /^#[0-9a-fA-F]{6}$/;

function hexToHsv(hex: string): Hsv {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const part = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${part(f(5))}${part(f(3))}${part(f(1))}`;
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** Drags a 0–1 value along one or two axes of an element. */
function useDrag(onMove: (x: number, y: number) => void) {
  return (event: React.PointerEvent<HTMLElement>) => {
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const apply = (e: { clientX: number; clientY: number }) => {
      const box = element.getBoundingClientRect();
      onMove(clamp((e.clientX - box.left) / box.width), clamp((e.clientY - box.top) / box.height));
    };
    apply(event);
    const move = (e: PointerEvent) => apply(e);
    const up = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
  };
}

/**
 * A color field in the system's own surfaces: a swatch button that opens a
 * popover with a saturation/brightness plane, a hue strip, a hex input and
 * optional presets. Replaces the browser's native color input, which opens
 * the operating system's picker and ignores the theme.
 */
export function ColorPicker({
  value,
  onChange,
  label,
  presets = ["#ffffff", "#000000", "#f4f1ea", "#1d1f27", "#87ceeb", "#f6c177", "#9ccfd8", "#eb6f92"],
  className,
}: {
  readonly value: string;
  readonly onChange: (hex: string) => void;
  readonly label: string;
  readonly presets?: readonly string[];
  readonly className?: string;
}) {
  const [hsv, setHsv] = React.useState<Hsv>(() => hexToHsv(HEX.test(value) ? value : "#ffffff"));
  const [draft, setDraft] = React.useState(value);
  // Hue and saturation are lost at black and white: keep them while the value is the one we last sent.
  const sent = React.useRef(value.toLowerCase());
  React.useEffect(() => {
    setDraft(value);
    if (HEX.test(value) && value.toLowerCase() !== sent.current) {
      sent.current = value.toLowerCase();
      setHsv(hexToHsv(value));
    }
  }, [value]);

  const commit = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next);
    sent.current = hex;
    setDraft(hex);
    onChange(hex);
  };
  const plane = useDrag((x, y) => commit({ ...hsv, s: x, v: 1 - y }));
  const strip = useDrag((x) => commit({ ...hsv, h: x * 360 }));
  const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 });

  const onKey = (axis: "plane" | "hue") => (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const key = event.key;
    if (!key.startsWith("Arrow")) return;
    event.preventDefault();
    const dx = key === "ArrowRight" ? step : key === "ArrowLeft" ? -step : 0;
    const dy = key === "ArrowUp" ? step : key === "ArrowDown" ? -step : 0;
    if (axis === "hue") commit({ ...hsv, h: (hsv.h + (dx || dy) * 360 + 360) % 360 });
    else commit({ ...hsv, s: clamp(hsv.s + dx), v: clamp(hsv.v + dy) });
  };

  return (
    <Popover.Root>
      <Popover.Trigger
        type="button"
        aria-label={`${label}: ${value}`}
        className={cn("size-7 shrink-0 cursor-pointer rounded-md border-0 p-0 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_14.9%,transparent)] outline-none transition-[scale,box-shadow] duration-150 ease-[var(--ease-smooth-out)] hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--btn-focus-ring)] data-[state=open]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_14.9%,transparent),0_0_0_2px_var(--primary)]", className)}
        style={{ background: value }}
      />
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="t-dropdown z-50 flex w-[224px] flex-col gap-3 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl outline-none"
        >
          <div
            role="slider"
            tabIndex={0}
            aria-label={`${label}: saturation and brightness`}
            aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
            aria-valuenow={Math.round(hsv.s * 100)}
            className="relative h-32 w-full cursor-crosshair touch-none rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--btn-focus-ring)]"
            style={{ backgroundColor: hueColor, backgroundImage: "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)" }}
            onPointerDown={plane}
            onKeyDown={onKey("plane")}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_#0006]"
              style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: value }}
            />
          </div>
          <div
            role="slider"
            tabIndex={0}
            aria-label={`${label}: hue`}
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hsv.h)}
            className="relative h-3 w-full cursor-pointer touch-none rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--btn-focus-ring)]"
            style={{ background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}
            onPointerDown={strip}
            onKeyDown={onKey("hue")}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_#0006]"
              style={{ left: `${(hsv.h / 360) * 100}%`, background: hueColor }}
            />
          </div>
          <Input
            value={draft}
            maxLength={7}
            spellCheck={false}
            aria-label={`${label}: hex value`}
            className="h-8 font-mono text-xs uppercase"
            onChange={(event) => {
              const text = event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}`;
              setDraft(text);
              if (HEX.test(text)) commit(hexToHsv(text));
            }}
            onBlur={() => setDraft(value)}
          />
          {presets.length ? (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Preset colors">
              {presets.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  title={hex}
                  aria-label={hex}
                  aria-pressed={hex.toLowerCase() === value.toLowerCase()}
                  className="size-5 cursor-pointer rounded-md border-0 p-0 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_14.9%,transparent)] transition-[scale] duration-150 hover:scale-110 aria-pressed:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_14.9%,transparent),0_0_0_2px_var(--primary)]"
                  style={{ background: hex }}
                  onClick={() => commit(hexToHsv(hex))}
                />
              ))}
            </div>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
