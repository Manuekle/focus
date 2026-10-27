"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AiSearch02Icon, AiPaintbrushIcon, Download01Icon, Refresh01Icon, Upload01Icon, Video01Icon } from "@hugeicons/core-free-icons";
import { SlidingTabs } from "../../components/ai-elements/sliding-tabs";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { Spinner } from "../../components/ui/spinner";
import { formatBytes } from "../../shared/media";
import {
  AMBIENCES,
  AMBIENCE_LABELS,
  AUDIO_ACCEPT_ATTRIBUTE,
  MOTIONS_FOR,
  MOTION_LABELS,
  VIDEO_LENGTHS,
  defaultLivingRequest,
  livingUrls,
  suggestAmbience,
  videoSeconds,
  type Ambience,
  type LivingInventory,
  type LivingKind,
  type LivingRender,
  type LivingRequest,
  type LivingTrack,
} from "../../shared/living";
import type { FlipbookImage } from "../../shared/flipbook";
import { flipbookApi } from "./flipbook-client";
import composer from "../_editor/composer.module.css";
import styles from "./flipbook.module.css";

const KIND_LABEL: Record<LivingKind, string> = { character: "Character", flowing: "Flows", floating: "Floating", sky: "Sky" };

const STRENGTHS = [
  { id: "0.5", label: "Subtle" },
  { id: "1", label: "Normal" },
  { id: "1.6", label: "Strong" },
];

const DURATIONS = [
  { id: "2", label: "2 s" },
  { id: "4", label: "4 s" },
  { id: "6", label: "6 s" },
];

const SOUNDS = [
  { id: "none", label: "No sound" },
  { id: "ambience", label: "Ambience" },
  { id: "upload", label: "Your track" },
];

/** The first request for what was found: default motions, and the ambience that suits it. */
function starting(inventory: LivingInventory): LivingRequest {
  const ambience = suggestAmbience(inventory);
  return { ...defaultLivingRequest(inventory), audio: ambience ? { kind: "ambience", ambience } : { kind: "none" } };
}

export type LivingPreview = { readonly video: string | null; readonly busy: boolean; readonly highlight: string | null; readonly hasAudio?: boolean };

/**
 * "Animate as is": the picture stays exactly as drawn and only its own
 * pixels move. Finding what can move is the one paid step; every preview
 * after that is rendered locally from the stored masks.
 */
export function LivingPanel({ image, onPreview }: { readonly image: FlipbookImage; readonly onPreview: (preview: LivingPreview) => void }) {
  const [inventory, setInventory] = useState<LivingInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [finding, setFinding] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState<LivingRequest | null>(null);
  const [render, setRender] = useState<{ request: string; result: LivingRender } | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [track, setTrack] = useState<LivingTrack | null>(null);
  const [uploading, setUploading] = useState(false);
  const [opening, setOpening] = useState(false);
  const router = useRouter();
  const latest = useRef(0);
  const trackInput = useRef<HTMLInputElement>(null);

  const draw = async (next: LivingRequest) => {
    const ticket = ++latest.current;
    setRendering(true);
    setError(null);
    try {
      const result = await flipbookApi.renderLiving(image.id, next);
      if (ticket === latest.current) setRender({ request: JSON.stringify(next), result });
    } catch (failure) {
      if (ticket === latest.current) setError(failure instanceof Error ? failure.message : "We couldn’t render the animation.");
    } finally {
      if (ticket === latest.current) setRendering(false);
    }
  };

  // What was already found for this upload, if anything; then its first preview.
  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setInventory(null);
    setRender(null);
    setTrack(null);
    flipbookApi.livingTrack(image.id).then((found) => { if (!canceled) setTrack(found); }, () => undefined);
    flipbookApi.living(image.id).then(
      (found) => {
        if (canceled) return;
        setLoading(false);
        if (!found) return;
        const initial = starting(found);
        setInventory(found);
        setRequest(initial);
        void draw(initial);
      },
      () => { if (!canceled) setLoading(false); },
    );
    return () => { canceled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draw only reads the image id, which keys this effect
  }, [image.id]);

  useEffect(() => {
    onPreview({ video: render ? livingUrls.file(image.id, render.result.key, render.result.files[0].name) : null, busy: rendering || finding, highlight, hasAudio: render?.result.hasAudio });
  }, [image.id, render, rendering, finding, highlight, onPreview]);

  const find = async () => {
    setFinding(true);
    setError(null);
    try {
      const found = await flipbookApi.findLiving(image.id);
      const initial = starting(found);
      setInventory(found);
      setRequest(initial);
      if (found.layers.length) void draw(initial);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "We couldn’t look at your picture.");
    } finally {
      setFinding(false);
    }
  };

  const openInEditor = async (key: string) => {
    setOpening(true);
    setError(null);
    try {
      const { video } = await flipbookApi.livingToEditor(image.id, key);
      router.push(`/editor?v=${video.id}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "We couldn’t open the animation in the editor.");
      setOpening(false);
    }
  };

  const pickTrack = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const uploaded = await flipbookApi.uploadLivingTrack(image.id, file);
      setTrack(uploaded);
      setRequest((current) => current && { ...current, audio: { kind: "upload", version: uploaded.version } });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "We couldn’t use that track.");
    } finally {
      setUploading(false);
    }
  };

  const setSound = (kind: string) => setRequest((current) => {
    if (!current) return current;
    if (kind === "ambience") return { ...current, audio: { kind: "ambience", ambience: (inventory && suggestAmbience(inventory)) ?? "wind" } };
    if (kind === "upload") {
      if (track) return { ...current, audio: { kind: "upload", version: track.version } };
      trackInput.current?.click();
      return current;
    }
    return { ...current, audio: { kind: "none" } };
  });

  const change = (id: string, patch: Partial<LivingRequest["layers"][number]>) =>
    setRequest((current) => current && { ...current, layers: current.layers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)) });

  if (loading) return (
    <div className={styles.readingSkeleton}>
      <Skeleton shape="text" style={{ width: "80%" }} />
      <Skeleton shape="text" style={{ width: "56%" }} delay={60} />
    </div>
  );

  if (!inventory || !request) return (
    <section className={composer.effects}>
      <p className={composer.summary}>Your picture stays exactly as it is: nothing is redrawn. Focus finds what can move (hair, leaves, the sky) and moves only those pixels, in a seamless loop.</p>
      <div className={composer.submit}>
        <Button className={composer.generate} type="button" variant="ai" size="lg" onClick={find} disabled={finding} aria-busy={finding || undefined}>
          {finding ? <Spinner /> : <HugeiconsIcon icon={AiSearch02Icon} size={16} strokeWidth={1.75} />}
          {finding ? "Finding what can move…" : "Find what can move"}
        </Button>
        <p className={styles.hint}>One look at your picture and one cut-out per part it finds.</p>
        {error ? <p className={styles.hint} data-invalid="" role="alert">{error}</p> : null}
      </div>
    </section>
  );

  const current = JSON.stringify(request);
  const stale = !render || render.request !== current;
  const result = render?.result;

  return (
    <>
      <section className={composer.effects} aria-label="What moves">
        <span className={composer.groupLabel}><HugeiconsIcon icon={AiSearch02Icon} size={12} strokeWidth={1.75} />What moves</span>
        {inventory.layers.length ? (
          <ul className={styles.livingLayers}>
            {inventory.layers.map((layer) => {
              const choice = request.layers.find((entry) => entry.id === layer.id)!;
              const motions = MOTIONS_FOR[layer.kind];
              return (
                <li
                  key={layer.id}
                  className={styles.livingLayer}
                  onPointerEnter={() => setHighlight(layer.id)}
                  onPointerLeave={() => setHighlight((shown) => (shown === layer.id ? null : shown))}
                  onFocus={() => setHighlight(layer.id)}
                  onBlur={() => setHighlight((shown) => (shown === layer.id ? null : shown))}
                >
                  <div className={styles.livingLayerName}>
                    <span className="text-xs font-medium text-foreground">{layer.name.charAt(0).toUpperCase() + layer.name.slice(1)}</span>
                    <span className="text-[11px] text-muted-foreground">{KIND_LABEL[layer.kind]}{layer.pieces > 1 ? ` · ${layer.pieces}` : ""}</span>
                  </div>
                  <SlidingTabs
                    className={composer.tabs}
                    tabs={motions.map((motion) => ({ id: motion, label: MOTION_LABELS[motion] }))}
                    value={choice.motion}
                    onValueChange={(motion) => change(layer.id, { motion: motion as typeof choice.motion })}
                  />
                  {choice.motion !== "still" ? (
                    <SlidingTabs
                      className={composer.tabs}
                      tabs={STRENGTHS}
                      value={String(choice.strength)}
                      onValueChange={(strength) => change(layer.id, { strength: Number(strength) })}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.hint}>Focus didn’t find anything it can move in this picture without redrawing it. Try “Redraw a cycle”.</p>
        )}
        {inventory.stills.length ? <p className={styles.hint}>Stays as it is: {inventory.stills.join(", ")}.</p> : null}
      </section>

      {inventory.layers.length ? (
        <>
          <fieldset className={composer.effects}>
            <legend className={composer.label}>Wind</legend>
            <SlidingTabs
              className={composer.tabs}
              tabs={[{ id: "left", label: "To the left" }, { id: "right", label: "To the right" }]}
              value={request.wind}
              onValueChange={(wind) => setRequest({ ...request, wind: wind as LivingRequest["wind"] })}
            />
          </fieldset>
          <fieldset className={composer.effects}>
            <legend className={composer.label}>Loop length</legend>
            <SlidingTabs
              className={composer.tabs}
              tabs={DURATIONS}
              value={String(request.durationSeconds)}
              onValueChange={(seconds) => setRequest({ ...request, durationSeconds: Number(seconds) as LivingRequest["durationSeconds"] })}
            />
          </fieldset>

          <fieldset className={composer.effects}>
            <legend className={composer.label}>Sound</legend>
            <SlidingTabs className={composer.tabs} tabs={SOUNDS} value={request.audio.kind} onValueChange={setSound} />
            {request.audio.kind === "ambience" ? (
              <SlidingTabs
                className={composer.tabs}
                tabs={AMBIENCES.map((ambience) => ({ id: ambience, label: AMBIENCE_LABELS[ambience] }))}
                value={request.audio.ambience}
                onValueChange={(ambience) => setRequest({ ...request, audio: { kind: "ambience", ambience: ambience as Ambience } })}
              />
            ) : null}
            {request.audio.kind === "upload" || uploading ? (
              <div className={styles.buttonRow}>
                {track ? <span className={styles.pill}>{track.name} · {Math.round(track.durationSeconds)} s</span> : null}
                <Button type="button" variant="ghost" size="sm" onClick={() => trackInput.current?.click()} disabled={uploading}>
                  {uploading ? <Spinner /> : <HugeiconsIcon icon={Upload01Icon} size={14} strokeWidth={1.5} />}
                  {track ? "Replace track" : "Upload a track"}
                </Button>
              </div>
            ) : null}
            <input
              ref={trackInput}
              type="file"
              accept={AUDIO_ACCEPT_ATTRIBUTE}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void pickTrack(file); }}
            />
            <p className={styles.hint}>
              {request.audio.kind === "ambience" ? "Made by Focus from filtered noise: no AI, no stock files. It loops without a seam." : request.audio.kind === "upload" ? "MP3, M4A, WAV or OGG, up to a minute. Its end fades into its start." : "Meta’s models don’t make sound; add an ambience or your own track."}
            </p>
          </fieldset>
          <fieldset className={composer.effects}>
            <legend className={composer.label}>Video length</legend>
            <SlidingTabs
              className={composer.tabs}
              // Whole loops only, so a length shows what it really comes to.
              tabs={VIDEO_LENGTHS.map((seconds) => ({ id: String(seconds), label: seconds ? `${videoSeconds({ durationSeconds: request.durationSeconds, lengthSeconds: seconds })} s` : "One loop" }))}
              value={String(request.lengthSeconds)}
              onValueChange={(seconds) => setRequest({ ...request, lengthSeconds: Number(seconds) as LivingRequest["lengthSeconds"] })}
            />
          </fieldset>

          <div className={composer.submit}>
            <Button className={composer.generate} type="button" variant="ai" size="lg" onClick={() => void draw(request)} disabled={rendering || !stale} aria-busy={rendering || undefined}>
              {rendering ? <Spinner /> : <HugeiconsIcon icon={stale && render ? Refresh01Icon : AiPaintbrushIcon} size={16} strokeWidth={1.75} />}
              {rendering ? "Rendering…" : stale ? (render ? "Update preview" : "Render") : "Up to date"}
            </Button>
            {error ? <p className={styles.hint} data-invalid="" role="alert">{error}</p> : null}
            {result && !stale ? <p className={styles.hint}>Opening it in the video editor keeps it: signed in, it’s saved to your projects.</p> : null}
            {result && !stale ? (
              <div className={styles.buttonRow}>
                <Button type="button" variant="ghost" size="sm" onClick={() => void openInEditor(result.key)} disabled={opening}>
                  {opening ? <Spinner /> : <HugeiconsIcon icon={Video01Icon} size={14} strokeWidth={1.5} />}
                  Open in video editor
                </Button>
                {result.files.map((file) => (
                  <a key={file.name} href={livingUrls.file(image.id, result.key, file.name, true)} download={file.name} className={styles.livingDownload}>
                    <HugeiconsIcon icon={Download01Icon} size={14} strokeWidth={1.5} />
                    {file.type === "image/gif" ? "GIF" : "MP4"} · {formatBytes(file.bytes)}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
