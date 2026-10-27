"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeftRightIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { FileUpload } from "../../components/motion/file-upload";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import { formatBytes } from "../../shared/media";
import { IMAGE_ACCEPT_ATTRIBUTE, MAX_IMAGE_BYTES, hasAcceptedImageExtension, type FlipbookImage } from "../../shared/flipbook";
import { FlipbookApiError, uploadCharacter, type UploadHandle } from "./flipbook-client";
import styles from "./flipbook.module.css";

const IDEAS = ["Walk to the right", "Run across the screen to the left", "Shadowbox: a jab and a cross", "Walk in place, relaxed"] as const;

/** Step one: the illustration and how it should move. */
export function FlipbookCreate({
  onCreate,
  creating,
  blockedReason,
}: {
  readonly onCreate: (image: FlipbookImage, prompt: string) => void;
  readonly creating: boolean;
  readonly blockedReason?: string;
}) {
  const [image, setImage] = useState<FlipbookImage | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const handle = useRef<UploadHandle | null>(null);

  useEffect(() => () => handle.current?.abort(), []);

  const start = (file: File) => {
    setError(null);
    if (!hasAcceptedImageExtension(file.name)) return setError("Upload a PNG, JPEG or WebP image.");
    if (file.size > MAX_IMAGE_BYTES) return setError(`This image is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_IMAGE_BYTES)}.`);
    handle.current?.abort();
    setProgress(0);
    const next = uploadCharacter(file, setProgress);
    handle.current = next;
    next.promise.then(
      (uploaded) => { if (handle.current === next) { setImage(uploaded); setProgress(null); } },
      (failure) => {
        if (handle.current !== next) return;
        setProgress(null);
        if (failure instanceof FlipbookApiError && failure.code === "aborted") return;
        setError(failure instanceof Error ? failure.message : "We couldn’t upload your image.");
      },
    );
  };

  const canSubmit = Boolean(image) && prompt.trim().length >= 3 && !creating && !blockedReason;

  return (
    <section className={styles.create} aria-labelledby="flipbook-title">
      <header className={styles.createHead}>
        <h1 id="flipbook-title" className={styles.createTitle}>Make your drawings move.</h1>
        <p className={styles.createSubtitle}>Turn a single illustration into a frame-by-frame animation.</p>
      </header>

      <div className={styles.createBody}>
        <div className={styles.createDrop}>
          {image ? (
            <figure className={styles.createPreview}>
              <div className={styles.referenceImage} data-transparent={image.hasAlpha || undefined}>
                {/* eslint-disable-next-line @next/next/no-img-element -- media route */}
                <img src={image.url} alt="Your character illustration" />
              </div>
              <figcaption className={styles.fileRow}>
                <span className="min-w-0 truncate text-xs text-foreground" title={image.originalName}>{image.originalName}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{image.width}×{image.height}</span>
                <Button size="xs" variant="ghost" onClick={() => setImage(null)}><HugeiconsIcon icon={ArrowLeftRightIcon} size={12} strokeWidth={1.5} />Change</Button>
              </figcaption>
            </figure>
          ) : progress !== null ? (
            <div className={styles.uploading} aria-busy="true">
              <Spinner className="size-4" />
              <span>{progress >= 1 ? "Checking your image…" : `Uploading · ${Math.round(progress * 100)}%`}</span>
              <Button size="xs" variant="ghost" onClick={() => { handle.current?.abort(); handle.current = null; setProgress(null); }}>Cancel</Button>
            </div>
          ) : (
            <FileUpload
              variant="centered"
              multiple={false}
              maxFiles={1}
              accept={IMAGE_ACCEPT_ATTRIBUTE}
              value={[]}
              onFilesAdded={(_items, files) => { if (files[0]) start(files[0]); }}
              title="Drop a character illustration."
              description={`PNG, JPEG or WebP · up to ${formatBytes(MAX_IMAGE_BYTES)} · full body, side view works best`}
              browseLabel="Choose an image"
              browseVariant="default"
              classNames={{ root: styles.upload, dropzone: styles.dropzone }}
            />
          )}
          {error ? <p className={styles.hint} data-invalid="" role="alert">{error}</p> : null}
        </div>

        <div className={styles.createForm}>
          <label className={styles.sectionLabel} htmlFor="flipbook-prompt">How should it move?</label>
          <div className={styles.field}>
            <textarea
              id="flipbook-prompt"
              className={styles.fieldInput}
              rows={3}
              maxLength={500}
              placeholder="Describe how your character should move..."
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canSubmit && image) onCreate(image, prompt.trim());
              }}
            />
          </div>
          <div className={styles.chips}>
            {IDEAS.map((idea) => (
              <button key={idea} type="button" className={styles.idea} onClick={() => setPrompt(idea)}>{idea}</button>
            ))}
          </div>
          <p className={styles.hint}>Walks, runs and fighting combos, one character at a time. Focus draws eight poses from your character, cuts them out and lines them up; you can redraw any frame.</p>
          <Button className="w-full" disabled={!canSubmit} aria-busy={creating || undefined} onClick={() => image && onCreate(image, prompt.trim())}>
            {creating ? <Spinner className="size-4" /> : null}Create animation.
          </Button>
          {blockedReason ? <p className={styles.hint} data-invalid="">{blockedReason}</p> : null}
        </div>
      </div>
    </section>
  );
}
