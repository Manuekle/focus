"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Cancel01Icon, Delete02Icon, Undo02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import { Textarea } from "../../components/ui/textarea";
import { ToggleChip } from "../../components/ui/toggle-chip";
import { ROTOSCOPE_LIMITS } from "../../shared/rotoscope";
import fb from "../flipbook/flipbook.module.css";
import styles from "./rotoscope.module.css";

/** Rotoscope keeps every drawing at this canvas: the marks are drawn at the same pixels. */
const DEFAULT_SIZE = { width: 1024, height: 1536 } as const;
const BRUSHES = [{ label: "Fine", width: 8 }, { label: "Medium", width: 16 }, { label: "Wide", width: 32 }] as const;
const INK = "rgba(255, 32, 32, 0.9)";

type Stroke = { readonly width: number; readonly points: [number, number][] };

/**
 * A red pencil over one drawing and a note on what to change. The marks go
 * to the server as a transparent PNG at the drawing's own size; the next
 * drawing of the frame gets them over the old one, with the note.
 */
export function PencilNote({ image, busy, size = DEFAULT_SIZE, maxComment = ROTOSCOPE_LIMITS.maxCommentLength, single = false, hint, onSend, onCancel }: {
  readonly image: string;
  readonly busy: boolean;
  /** The drawing's own pixels, when it is not the rotoscope canvas. */
  readonly size?: { readonly width: number; readonly height: number };
  readonly maxComment?: number;
  /** One button that saves the note and redraws, for a drawing that is not part of a run. */
  readonly single?: boolean;
  readonly hint?: string;
  /** `redraw`: start drawing the frame right after the note is saved. */
  readonly onSend: (note: { comment: string; marks: Blob; redraw: boolean }) => void;
  readonly onCancel: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [brush, setBrush] = useState<number>(BRUSHES[1].width);
  const [comment, setComment] = useState("");
  const drawing = useRef<Stroke | null>(null);

  const paint = (all: readonly Stroke[]) => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, size.width, size.height);
    context.strokeStyle = INK;
    context.fillStyle = INK;
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const stroke of all) {
      context.lineWidth = stroke.width;
      const [first, ...rest] = stroke.points;
      if (!first) continue;
      if (!rest.length) {
        context.beginPath();
        context.arc(first[0], first[1], stroke.width / 2, 0, Math.PI * 2);
        context.fill();
        continue;
      }
      context.beginPath();
      context.moveTo(first[0], first[1]);
      for (const [x, y] of rest) context.lineTo(x, y);
      context.stroke();
    }
  };
  useEffect(() => paint(strokes), [strokes]);

  /** Pointer position in drawing pixels: the canvas is shown scaled down. */
  const at = (event: PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [((event.clientX - rect.left) / rect.width) * size.width, ((event.clientY - rect.top) / rect.height) * size.height];
  };
  const down = (event: PointerEvent<HTMLCanvasElement>) => {
    if (busy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = { width: brush, points: [at(event)] };
    paint([...strokes, drawing.current]);
  };
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current.points.push(at(event));
    paint([...strokes, drawing.current]);
  };
  const up = () => {
    const stroke = drawing.current;
    drawing.current = null;
    if (stroke) setStrokes((all) => [...all, stroke]);
  };

  const send = (redraw: boolean) => {
    canvas.current?.toBlob((marks) => {
      if (marks) onSend({ comment: comment.trim(), marks, redraw });
    }, "image/png");
  };
  const ready = comment.trim().length > 0 && !busy;

  return (
    <div className={styles.pencil}>
      <div className={`${fb.inspect} ${styles.inspectFrame}`} data-transparent="">
        <div className={styles.pencilBox} style={{ aspectRatio: `${size.width} / ${size.height}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the drawing being marked, from the run's media route */}
          <img src={image} alt="Drawing to mark" draggable={false} />
          <canvas
            ref={canvas}
            width={size.width}
            height={size.height}
            className={styles.pencilCanvas}
            aria-label="Pencil: mark what is wrong on the drawing"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          />
        </div>
      </div>
      <div className={fb.controlRow} role="group" aria-label="Pencil">
        <span className={fb.controlLabel}>Pencil</span>
        {BRUSHES.map((option) => <ToggleChip key={option.label} size="xs" selected={brush === option.width} onClick={() => setBrush(option.width)}>{option.label}</ToggleChip>)}
        <Button size="icon-xs" variant="ghost" aria-label="Undo last mark" disabled={!strokes.length || busy} onClick={() => setStrokes((all) => all.slice(0, -1))}><HugeiconsIcon icon={Undo02Icon} size={14} strokeWidth={1.75} /></Button>
        <Button size="icon-xs" variant="ghost" aria-label="Clear all marks" disabled={!strokes.length || busy} onClick={() => setStrokes([])}><HugeiconsIcon icon={Delete02Icon} size={14} strokeWidth={1.75} /></Button>
      </div>
      <Textarea
        value={comment}
        onChange={(event) => setComment(event.target.value.slice(0, maxComment))}
        placeholder="What should change where you marked? E.g. “The arm on the left of the image is too long: the hand ends at mid-thigh.”"
        aria-label="What to change"
        disabled={busy}
        rows={3}
      />
      <div className={fb.buttonRow}>
        <Button size="sm" variant="ai" disabled={!ready} onClick={() => send(true)}>{busy ? <Spinner className="size-3.5" /> : null}{single ? "Redraw with my marks" : "Save note & redraw"}</Button>
        {single ? null : <Button size="sm" variant="outline" disabled={!ready} onClick={() => send(false)}>Save note</Button>}
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}><HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />Cancel</Button>
      </div>
      <p className={fb.hint}>{hint ?? "The frame opens again and its next drawing gets your marks and note; the frames after it keep their approval."}</p>
    </div>
  );
}
