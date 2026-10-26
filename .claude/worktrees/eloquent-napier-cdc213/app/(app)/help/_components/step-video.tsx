"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** Creates a small, captioned WebM walkthrough from the same steps shown on
 * screen. This keeps every integration tutorial watchable without shipping
 * 22 stale recordings of a third-party console that changes independently. */
export function StepVideo({ title, steps, labels }: {
  readonly title: string;
  readonly steps: readonly string[];
  readonly labels: { readonly create: string; readonly creating: string; readonly unsupported: string; readonly alt: string; readonly brandNote: string };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);
  useEffect(() => () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const createVideo = () => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.captureStream || typeof MediaRecorder === "undefined") {
      setUnsupported(true);
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    const stream = canvas.captureStream(2);
    streamRef.current = stream;
    const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) { setUnsupported(true); return; }
    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;
    const width = canvas.width;
    const height = canvas.height;
    const paint = (index: number) => {
      context.fillStyle = "#101114";
      context.fillRect(0, 0, width, height);
      context.fillStyle = "#a8e8cb";
      context.fillRect(64, 62, 72, 6);
      context.fillStyle = "#f4f2ed";
      context.font = "600 30px system-ui, sans-serif";
      context.fillText(title.slice(0, 42), 64, 120);
      context.fillStyle = "#8f929b";
      context.font = "500 18px system-ui, sans-serif";
      context.fillText(`ORUKA  ·  ${index + 1} / ${steps.length}`, 64, 164);
      context.fillStyle = "#f4f2ed";
      context.font = "500 25px system-ui, sans-serif";
      const words = steps[index].split(/\s+/);
      let line = "";
      let y = 248;
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (context.measureText(next).width > width - 128) {
          context.fillText(line, 64, y);
          line = word;
          y += 38;
        } else line = next;
      }
      context.fillText(line, 64, y);
      context.fillStyle = "#8f929b";
      context.font = "400 16px system-ui, sans-serif";
      context.fillText(labels.brandNote, 64, height - 56);
    };
    paint(0);
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks, { type: mimeType });
      const next = URL.createObjectURL(blob);
      setSrc((current) => { if (current) URL.revokeObjectURL(current); return next; });
      setRecording(false);
    };
    recorder.start();
    setRecording(true);
    let index = 0;
    timerRef.current = window.setInterval(() => {
      index += 1;
      if (index >= steps.length) {
        if (timerRef.current !== null) window.clearInterval(timerRef.current);
        timerRef.current = null;
        recorder.stop();
        return;
      }
      paint(index);
    }, 2200);
  };

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4" aria-label={labels.alt}>
      <canvas ref={canvasRef} width={1280} height={720} className="sr-only" aria-hidden="true" />
      {src ? <video className="aspect-video w-full rounded-xl bg-black" controls playsInline src={src} aria-label={labels.alt} /> : (
        <div className="grid aspect-video place-items-center rounded-xl border border-border bg-[radial-gradient(ellipse_at_top_left,rgba(168,232,203,.12),transparent_55%),var(--muted)] px-6 text-center">
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{labels.alt}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[52ch] text-xs leading-relaxed text-muted-foreground">{unsupported ? labels.unsupported : labels.alt}</p>
        <Button type="button" variant="outline" size="sm" onClick={createVideo} disabled={recording}>
          {recording ? labels.creating : labels.create}
        </Button>
      </div>
    </section>
  );
}
