"use client";

import { useEffect, useRef, useState } from "react";
import { advanceQrClock, createQrScene, drawQrFrame, FADE, isQrMatrix, TOTAL } from "./qr-canvas";

/** One millisecond clock: opening and closing traverse the same beam path. */
export function AnimatedQR({
  source,
  className,
  size = 460,
  open = true,
  label = "QR",
  downloadLabel = label,
  onDownload,
}: {
  /** The QR endpoint. It serves a printable SVG, and the same URL with
   *  `&json` the module grid this canvas animates. */
  source: string;
  className?: string;
  /** Display size. Integer module geometry lives in the backing canvas. */
  size?: number;
  open?: boolean;
  label?: string;
  downloadLabel?: string;
  onDownload?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const openRef = useRef(open);
  const runRef = useRef<(() => void) | null>(null);
  const [result, setResult] = useState<{ source: string; modules: boolean[][] | null } | null>(null);
  const current = result?.source === source ? result : null;
  const modules = current?.modules;
  const fallback = current !== null && modules === null;

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${source}${source.includes("?") ? "&" : "?"}json`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`QR request failed: ${response.status}`);
        const body: unknown = await response.json();
        if (!body || typeof body !== "object" || !("modules" in body) || !isQrMatrix(body.modules)) {
          throw new Error("Invalid QR matrix");
        }
        if (!controller.signal.aborted) setResult({ source, modules: body.modules });
      })
      .catch(() => {
        // Keep the printable SVG available if animation data cannot be loaded.
        if (!controller.signal.aborted) setResult({ source, modules: null });
      });
    return () => controller.abort();
  }, [source]);

  useEffect(() => {
    openRef.current = open;
    runRef.current?.();
  }, [open]);

  // Canvas setup/parking deliberately does not depend on `open` or callbacks.
  // A parent render or reversal must never reset the clock to an endpoint.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !modules) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const scene = createQrScene(modules);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(scene.stage * dpr);
    canvas.height = Math.round(scene.stage * dpr);
    // Only set the transform during setup; draws preserve this retina scale.
    ctx.setTransform(canvas.width / scene.stage, 0, 0, canvas.height / scene.stage, 0, 0);

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = media.matches;
    let clock = 0;
    let raf = 0;
    let previous = 0;
    let disposed = false;

    const tick = (now: number) => {
      raf = 0;
      if (disposed) return;
      clock = advanceQrClock(clock, now - previous, openRef.current, reduced);
      previous = now;
      drawQrFrame(ctx, scene, clock, reduced);
      const target = openRef.current ? (reduced ? FADE : TOTAL) : 0;
      if (clock !== target) raf = requestAnimationFrame(tick);
    };
    const run = () => {
      if (disposed || raf) return;
      previous = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const onMotionChange = () => {
      const fraction = clock / (reduced ? FADE : TOTAL);
      reduced = media.matches;
      clock = fraction * (reduced ? FADE : TOTAL);
      drawQrFrame(ctx, scene, clock, reduced);
      run();
    };
    runRef.current = run;
    media.addEventListener("change", onMotionChange);
    drawQrFrame(ctx, scene, clock, reduced);
    run();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      media.removeEventListener("change", onMotionChange);
      runRef.current = null;
    };
  }, [modules]);

  const image = fallback ? (
    <img src={source} alt={label} width={size} height={size} className="block h-auto w-full" style={{ opacity: open ? 1 : 0, transition: "opacity 200ms" }} />
  ) : (
    <canvas key={source} ref={canvasRef} role="img" aria-label={label} className="block h-auto w-full" width={460} height={460} />
  );

  return (
    <div className={className} style={{ width: size, maxWidth: "100%" }} aria-busy={!current}>
      {onDownload ? (
        <button
          type="button"
          aria-label={downloadLabel}
          onClick={onDownload}
          className="block w-full overflow-hidden rounded-lg border border-border bg-[#FCFCFC] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        >
          {image}
        </button>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-[#FCFCFC]">{image}</div>
      )}
    </div>
  );
}
