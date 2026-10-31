"use client";

/* eslint-disable @next/next/no-img-element -- private media requires browser session cookies */

import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Disclosure } from "../../components/ui/disclosure";
import { Spinner } from "../../components/ui/spinner";
import { characterUrls, type Character, type CharacterKit } from "../../shared/characters";
import { measuresText } from "../../shared/rotoscope";
import { MeasuresFields, draftOf, parseMeasures, type MeasuresDraft } from "../rotoscope/measures-fields";
import { characterApi } from "./character-client";
import styles from "./characters.module.css";

const POLL_MS = 3000;
/** A version this young may still be starting its automatic preparation. */
const FRESH_MS = 2 * 60_000;

/**
 * The selected version's animation data: the character's height and weight, and what its sheet alone decides
 * (pose, description, pose sheet, palette, build), prepared once here so rotoscope runs of this version skip it.
 */
export function CharacterKitSection({
  character,
  versionId,
  locked,
  onChange,
}: {
  readonly character: Character;
  readonly versionId: string;
  readonly locked: boolean;
  readonly onChange: (next: Character) => void;
}) {
  const [kit, setKit] = useState<CharacterKit | null>(null);
  const [draft, setDraft] = useState<MeasuresDraft>(() => draftOf({ ...character.measures, personHeightCm: null }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preparing = kit?.status === "preparing";

  const createdAt = character.versions.find((entry) => entry.id === versionId)?.createdAt;
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setKit(null);
    setError(null);
    const load = (tries: number) =>
      characterApi.kit(character.id, versionId).then(
        (next) => {
          if (!live) return;
          setKit(next);
          // A version drawn moments ago starts its own preparation just after it is saved.
          if (next.status === "none" && tries > 0 && createdAt && Date.now() - Date.parse(createdAt) < FRESH_MS) timer = setTimeout(() => void load(tries - 1), POLL_MS);
        },
        (cause: unknown) => live && setError(cause instanceof Error ? cause.message : "The character data couldn’t be loaded."),
      );
    void load(3);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [character.id, versionId, createdAt]);
  // Prepared in the background: read again until it is ready or failed.
  useEffect(() => {
    if (!preparing) return;
    let live = true;
    const timer = setInterval(() => {
      characterApi.kit(character.id, versionId).then((next) => live && setKit(next), () => undefined);
    }, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [character.id, versionId, preparing]);

  /** Saves the typed height and weight when they changed; false when they don't parse. */
  const saveMeasures = async (): Promise<boolean> => {
    const parsed = parseMeasures(draft);
    if ("error" in parsed) {
      setError(parsed.error);
      return false;
    }
    const { heightCm, weightKg } = parsed.measures;
    if (heightCm === character.measures.heightCm && weightKg === character.measures.weightKg) return true;
    onChange(await characterApi.update(character.id, { action: "measures", heightCm, weightKg }));
    return true;
  };

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This change couldn’t be saved. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const prepare = () =>
    act(async () => {
      if (!(await saveMeasures())) return;
      setKit(await characterApi.prepareKit(character.id, versionId));
    });

  const body = measuresText(character.measures);
  const stale = kit?.status === "ready" && kit.measures && (kit.measures.heightCm !== character.measures.heightCm || kit.measures.weightKg !== character.measures.weightKg);
  const disabled = locked || busy || preparing;

  return (
    <section className={styles.kit} aria-labelledby="kit-title">
      <div className={styles.sectionHeading}>
        <h2 id="kit-title">Animation data</h2>
        <span>{kit?.status === "ready" ? "Ready" : preparing ? "Preparing…" : "Not prepared"}</span>
      </div>
      <div
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void act(async () => void (await saveMeasures()));
        }}
      >
        <MeasuresFields id="character-measures" value={draft} onChange={setDraft} disabled={locked || busy} />
      </div>
      <p className={styles.hint}>
        The character’s real height and weight{body ? ` (${body})` : ""}: every animation keeps that body.
      </p>
      {kit?.status === "ready" ? (
        <div className={styles.kitResult}>
          {kit.poseSheet ? (
            <figure>
              <img src={characterUrls.kitImage(character.id, versionId, "pose-sheet", kit.preparedAt ?? "")} alt={`${character.name} in four other poses`} />
              <figcaption>Pose sheet</figcaption>
            </figure>
          ) : null}
          {kit.palette ? (
            <figure>
              <img src={characterUrls.kitImage(character.id, versionId, "palette", kit.preparedAt ?? "")} alt={`Colour palette: ${kit.palette}`} />
              <figcaption>Palette</figcaption>
            </figure>
          ) : null}
          {kit.build ? <p className={styles.hint}>Body on the grid: {kit.build}</p> : null}
          {kit.description ? (
            <Disclosure title="Description" className={styles.kitDescription}>
              <p>{kit.description}</p>
            </Disclosure>
          ) : null}
          {kit.style ? (
            <Disclosure title="Art style" className={styles.kitDescription}>
              {kit.style.split("\n").map((line) => <p key={line}>{line}</p>)}
            </Disclosure>
          ) : null}
        </div>
      ) : null}
      {stale ? (
        <p className={styles.hint}>
          The height or weight changed since it was prepared. Rotoscope still reuses the pose, palette and build, and redraws the description and pose sheet for each run until you prepare it again.
        </p>
      ) : null}
      {error || kit?.error ? (
        <p className={styles.inlineError} role="alert">
          {error ?? kit?.error}
        </p>
      ) : null}
      <Button variant="outline" disabled={disabled} aria-busy={preparing || busy} onClick={() => void prepare()}>
        {preparing ? (
          <>
            <Spinner />
            Preparing…
          </>
        ) : kit?.status === "ready" ? (
          "Prepare again"
        ) : (
          "Prepare for animation"
        )}
      </Button>
      <p className={styles.hint}>
        Made on its own when a version is drawn, or by the first Rotoscope run of it: one Muse Image drawing and a few Muse Spark readings, once. Later runs of this version start without them.
      </p>
    </section>
  );
}
