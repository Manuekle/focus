"use client";

import { useRef, useState } from "react";
import { AiPaintbrushIcon, Image01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { ColorPicker } from "../../components/ui/color-picker";
import { MediaLightbox, ZoomButton, type LightboxMedia } from "../../components/ui/media-lightbox";
import { Spinner } from "../../components/ui/spinner";
import { ToggleChip } from "../../components/ui/toggle-chip";
import { BACKGROUND_PROMPT_MAX, IMAGE_ACCEPT_ATTRIBUTE, flipbookUrls, type BackgroundMotion, type Flipbook, type FlipbookBackground } from "../../shared/flipbook";
import styles from "./flipbook.module.css";

/** Starting points for the description: specific places draw better than "a park". */
const IDEAS: readonly string[] = [
  "a misty pine forest at dawn, soft light through the trees",
  "a rainy neon alley at night, wet pavement and glowing signs",
  "a cozy bedroom in the afternoon, sunlight through the window",
  "a seaside cliff at sunset with tide pools and warm clouds",
  "a castle courtyard in autumn with fallen leaves",
];

const MOTIONS: readonly { motion: BackgroundMotion; label: string; hint: string }[] = [
  { motion: "static", label: "Still", hint: "" },
  { motion: "scroll", label: "Slide", hint: "The scene slides behind the character at the length of its stride, so the feet stay planted while it seems to go somewhere." },
  { motion: "parallax", label: "Parallax", hint: "The sky drifts slowly while the ground and everything on it slide at the stride: depth from a single picture." },
  { motion: "zoom", label: "Slow zoom", hint: "The camera eases in and back out over the length of the clip, so the scene breathes behind the character." },
];

/** Whether the illustration came without a setting: transparent, or a plain backdrop. */
export function hasNoBackground(flipbook: Flipbook): boolean {
  return flipbook.source.hasAlpha || flipbook.analysis?.background === "plain";
}

/**
 * What the character stands on: transparency, a color, the uploaded scene,
 * an image, or a setting Muse Image draws for it, still or scrolling.
 */
export function BackgroundPanel({
  flipbook,
  background,
  onBackgroundChange,
  busy,
  generating,
  onGenerate,
  creatingScene,
  onCreateScene,
  onUploadBackground,
  onUploadReference,
  onRemoveReference,
  stamp,
}: {
  readonly flipbook: Flipbook;
  readonly background: FlipbookBackground;
  readonly onBackgroundChange: (background: FlipbookBackground) => void;
  readonly busy: boolean;
  readonly generating: boolean;
  readonly onGenerate: (prompt: string) => void;
  readonly creatingScene: boolean;
  readonly onCreateScene: () => void;
  readonly onUploadBackground: (file: File) => void;
  /** A picture of a place to draw one like; it is never the background itself. */
  readonly onUploadReference: (file: File) => void;
  readonly onRemoveReference: () => void;
  /** Changes whenever the scene or the uploaded image is replaced, so a previewed picture is never stale. */
  readonly stamp: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const referenceRef = useRef<HTMLInputElement>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const generated = flipbook.backgrounds.generated;
  const [prompt, setPrompt] = useState(generated?.prompt ?? "");
  const [motion, setMotion] = useState<BackgroundMotion>(background.kind === "generated" || background.kind === "scene" ? background.motion ?? "static" : "scroll");
  const moves = background.kind === "generated" || background.kind === "scene";
  const currentMotion = moves ? background.motion ?? "static" : motion;
  const color = background.kind === "color" ? background.color : "#ffffff";
  const sceneOffered = flipbook.analysis !== null && flipbook.analysis.background !== "plain" && !flipbook.source.hasAlpha;
  const bare = hasNoBackground(flipbook);
  // Parallax needs the sky split from the rest, which only exists when SAM found one.
  const depth = background.kind === "scene" ? flipbook.backgrounds.depth.scene : background.kind === "generated" ? flipbook.backgrounds.depth.generated : false;
  // Every picture available as a background, to look at before choosing it.
  const plates: readonly (LightboxMedia & { readonly kind: "image"; readonly id: "generated" | "scene" | "custom"; readonly label: string })[] = [
    ...(generated ? [{ id: "generated" as const, label: "Generated", kind: "image" as const, src: flipbookUrls.background(flipbook.id, "generated", generated.createdAt), alt: "The background Muse Image drew", caption: generated.prompt ? `Generated · “${generated.prompt}”` : "Generated background" }] : []),
    ...(flipbook.backgrounds.scene ? [{ id: "scene" as const, label: "Your scene", kind: "image" as const, src: flipbookUrls.background(flipbook.id, "scene", stamp), alt: "Your scene without the character", caption: "Your scene, redrawn without the character" }] : []),
    ...(flipbook.backgrounds.custom ? [{ id: "custom" as const, label: "Your image", kind: "image" as const, src: flipbookUrls.background(flipbook.id, "custom", stamp), alt: "The image you uploaded as a background", caption: "The image you uploaded" }] : []),
  ];
  const pickMotion = (next: BackgroundMotion) => {
    setMotion(next);
    if (background.kind === "generated" || background.kind === "scene") onBackgroundChange({ ...background, motion: next });
  };

  return (
    <section className={styles.panel} aria-labelledby="background-title">
      <h2 id="background-title" className={styles.panelTitle}>Background</h2>

      <div className={styles.chips}>
        <ToggleChip size="xs" selected={background.kind === "transparent"} onClick={() => onBackgroundChange({ kind: "transparent" })}>Transparent</ToggleChip>
        <ToggleChip size="xs" selected={background.kind === "color"} onClick={() => onBackgroundChange({ kind: "color", color })}>Color</ToggleChip>
        {background.kind === "color" ? (
          <ColorPicker value={color} label="Background color" onChange={(next) => onBackgroundChange({ kind: "color", color: next })} />
        ) : null}
        {generated ? (
          <ToggleChip size="xs" selected={background.kind === "generated"} onClick={() => onBackgroundChange({ kind: "generated", motion })}>Generated</ToggleChip>
        ) : null}
        {sceneOffered ? (
          flipbook.backgrounds.scene ? (
            <ToggleChip size="xs" selected={background.kind === "scene"} onClick={() => onBackgroundChange({ kind: "scene", motion })}>Your scene</ToggleChip>
          ) : (
            <Button size="xs" variant="outline" disabled={busy || creatingScene} onClick={onCreateScene} title="Muse Image redraws your illustration without the character, once (1 drawing).">
              {creatingScene ? <Spinner className="size-3" /> : <HugeiconsIcon icon={Image01Icon} size={12} strokeWidth={1.75} />}Use your scene
            </Button>
          )
        ) : null}
        {flipbook.backgrounds.custom ? (
          <ToggleChip size="xs" selected={background.kind === "custom"} onClick={() => onBackgroundChange({ kind: "custom" })}>Your image</ToggleChip>
        ) : null}
        <Button size="xs" variant="ghost" disabled={busy} onClick={() => fileRef.current?.click()}title="Use a picture of your own as the background, exactly as it is.">{flipbook.backgrounds.custom ? "Replace my image" : "Use my own image"}</Button>
        <input
          ref={fileRef} type="file" accept={IMAGE_ACCEPT_ATTRIBUTE} className="sr-only" tabIndex={-1} aria-hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onUploadBackground(file);
          }}
        />
      </div>

      {plates.length ? (
        <div className={styles.plates} role="list" aria-label="Available backgrounds">
          {plates.map((plate, position) => (
            <figure key={plate.id} role="listitem" data-active={background.kind === plate.id || undefined}>
              <ZoomButton className={styles.plate} label={`Open ${plate.label.toLowerCase()} background larger`} onOpen={() => setZoom(position)}>
                {/* eslint-disable-next-line @next/next/no-img-element -- media route */}
                <img src={plate.src} alt={plate.alt} />
              </ZoomButton>
              <figcaption>{plate.label}</figcaption>
            </figure>
          ))}
        </div>
      ) : null}
      <MediaLightbox items={plates} index={zoom} onIndexChange={setZoom} onClose={() => setZoom(null)} />
      {(background.kind === "scene" || background.kind === "generated" || background.kind === "custom") && (currentMotion === "static" || currentMotion === "zoom" || background.kind === "custom") ? (
        <div className={styles.controlRow}>
          <span className={styles.controlLabel}>Image fit</span>
          <div className={styles.chips} role="group" aria-label="Background image fit">
            <ToggleChip size="xs" selected={background.fit !== "cover"} onClick={() => onBackgroundChange({ ...background, fit: "contain" })}>Whole image</ToggleChip>
            <ToggleChip size="xs" selected={background.fit === "cover"} onClick={() => onBackgroundChange({ ...background, fit: "cover" })}>Fill frame</ToggleChip>
          </div>
          <p className={styles.hint}>Whole image keeps every edge visible. Fill frame crops the edges to fill the format.</p>
        </div>
      ) : null}

      {moves ? (
        <div className={styles.controlRow}>
          <span className={styles.controlLabel}>Motion</span>
          <div className={styles.chips}>
            {MOTIONS.filter((entry) => entry.motion !== "parallax" || depth).map((entry) => (
              <ToggleChip key={entry.motion} size="xs" selected={currentMotion === entry.motion} onClick={() => pickMotion(entry.motion)}>{entry.label}</ToggleChip>
            ))}
          </div>
        </div>
      ) : null}
      {moves && currentMotion !== "static" ? <p className={styles.hint}>{MOTIONS.find((entry) => entry.motion === currentMotion)?.hint}</p> : null}
      {moves && !depth ? <p className={styles.hint}>No sky was found in this picture, so it can’t move in two depths.</p> : null}

      <div className={styles.generate}>
        <p className={styles.sectionLabel}>{generated ? "Draw another background" : "Generate a background"}</p>
        {bare && !generated ? <p className={styles.hint}>Your drawing has no background. Describe a setting and Focus draws it in the same style, ready to stay still or move.</p> : null}
        <div className={styles.chips} role="group" aria-label="Ideas for the background">
          {IDEAS.map((idea) => (
            <ToggleChip key={idea} size="xs" className="h-auto min-h-7 max-w-full whitespace-normal py-1 text-left" selected={prompt === idea} disabled={busy || generating} onClick={() => setPrompt(idea)}>{idea.split(",")[0].replace(/^an? /, "")}</ToggleChip>
          ))}
        </div>
        <div className={styles.field}>
          <textarea
            className={styles.fieldInput}
            rows={2}
            maxLength={BACKGROUND_PROMPT_MAX}
            placeholder="Describe the place, the light and the mood. e.g. “a misty pine forest at dawn, soft light through the trees”"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={busy || generating}
            aria-label="Describe the background to generate"
          />
        </div>
        <div className={styles.referenceRow}>
          {flipbook.backgrounds.reference ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- media route */}
              <img className={styles.referenceThumb} src={flipbookUrls.background(flipbook.id, "bg-reference", stamp)} alt="The place you gave as a reference" />
              <span className={styles.hint}>Reference picture. The next background is painted inspired by it.</span>
              <Button size="xs" variant="ghost" disabled={busy || generating} onClick={onRemoveReference}>Remove</Button>
            </>
          ) : (
            <>
              <Button size="xs" variant="outline" disabled={busy || generating} onClick={() => referenceRef.current?.click()} title="Optional: a picture of the kind of place you want.">
                <HugeiconsIcon icon={Image01Icon} size={12} strokeWidth={1.75} />Add a reference picture
              </Button>
              <span className={styles.hint}>Optional. Focus takes its place, light and mood and paints a new one in your character’s style.</span>
            </>
          )}
          <input
            ref={referenceRef} type="file" accept={IMAGE_ACCEPT_ATTRIBUTE} className="sr-only" tabIndex={-1} aria-hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) onUploadReference(file);
            }}
          />
        </div>
        <Button size="sm" variant="ai" disabled={busy || generating} onClick={() => onGenerate(prompt.trim())} title="Muse Image draws one background in your character’s style (1 drawing).">
          {generating ? <Spinner className="size-3.5" /> : <HugeiconsIcon icon={AiPaintbrushIcon} size={14} strokeWidth={1.75} />}
          {generating ? "Drawing the background…" : generated ? "Draw again" : "Generate background"}
        </Button>
      </div>
    </section>
  );
}
