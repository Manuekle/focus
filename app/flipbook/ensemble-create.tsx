"use client";

import { MediaThumb } from "../../components/ui/media-image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AiPaintbrushIcon, AiSearch02Icon, UserGroupIcon, UserIcon } from "@hugeicons/core-free-icons";
import { SlidingTabs } from "../../components/ai-elements/sliding-tabs";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { Spinner } from "../../components/ui/spinner";
import { SuggestionChip } from "../../components/ui/suggestion-chip";
import { cn } from "../../lib/utils";
import { VIEW_OPTIONS, type ViewPreference } from "../../shared/animation-view";
import type { CharacterSource, CharacterSummary } from "../../shared/characters";
import { ENSEMBLE_FPS, MAX_CAST, MAX_ENSEMBLE_SECONDS, MIN_CAST, MIN_ENSEMBLE_SECONDS, ensembleDrawings, type CreateEnsembleRequest } from "../../shared/flipbook";
import { useSession } from "../_auth/session-client";
import { CastStage } from "./cast-stage";
import { characterApi } from "../characters/character-client";
import view from "../_editor/editor-view.module.css";
import composer from "../_editor/composer.module.css";
import styles from "./flipbook.module.css";

const DETAIL_MAX = 500;

const SECONDS = Array.from({ length: MAX_ENSEMBLE_SECONDS - MIN_ENSEMBLE_SECONDS + 1 }, (_, index) => MIN_ENSEMBLE_SECONDS + index);

/** Starting points for what happens: the first is the fight the feature was made for. */
const IDEAS = [
  "They fight: one throws a punch, the other dodges and answers with a kick",
  "They dance together, mirroring each other’s steps",
  "One chases the other across the frame",
  "They meet, wave and hug",
] as const;

const SCENE_VIEWS = VIEW_OPTIONS.filter((option) => option.value !== "original");

/**
 * Several saved characters in one animation. Pick two to four, say what
 * happens, and how many seconds it lasts: the number of drawings follows from
 * the length at a fixed pace, and the cost is stated before anything is drawn.
 */
export function EnsembleCreate({
  onCreate,
  creating,
  blockedReason,
  initialCast,
}: {
  readonly onCreate: (request: CreateEnsembleRequest) => void;
  readonly creating: boolean;
  readonly blockedReason?: string;
  readonly initialCast?: readonly CharacterSource[];
}) {
  const { session } = useSession();
  const signedIn = Boolean(session?.user);
  const [list, setList] = useState<CharacterSummary[] | null>(null);
  const [pickedIds, setPickedIds] = useState<string[]>(() => initialCast?.map((source) => source.characterId) ?? []);
  const [seconds, setSeconds] = useState(2);
  const [cameraView, setCameraView] = useState<ViewPreference>("side");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    characterApi.list().then((next) => live && setList(next)).catch(() => live && setList([]));
    return () => { live = false; };
  }, [signedIn]);

  const ready = useMemo(() => list?.filter((entry) => entry.status !== "generating" && entry.selectedVersionId) ?? [], [list]);
  const picked = pickedIds.flatMap((id) => ready.find((entry) => entry.id === id) ?? []);
  const full = picked.length >= MAX_CAST;
  const drawings = ensembleDrawings(seconds);
  const prompt = detail.trim();
  const canSubmit = signedIn && picked.length >= MIN_CAST && prompt.length >= 3 && !creating && !blockedReason;

  const toggle = (id: string) => setPickedIds((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : current.length >= MAX_CAST ? current : [...current, id]));

  const submit = () => {
    if (!canSubmit) return;
    onCreate({
      cast: picked.map((entry): CharacterSource => ({ characterId: entry.id, versionId: entry.selectedVersionId! })),
      prompt,
      seconds,
      view: cameraView,
    });
  };

  return (
    <div className={view.editor} data-variant="page">
      <h1 id="flipbook-title" className="sr-only">Animate characters together</h1>
      <section aria-label="The scene" className={cn(view.preview, styles.scene)} data-empty={picked.length ? undefined : ""}>
        {picked.length ? (
          <CastStage cast={picked} />
        ) : (
          <div className={styles.castEmpty}>
            {/* The empty stage: one slot per character the scene can hold. */}
            <div className={styles.castSlots} aria-hidden="true">
              {Array.from({ length: MAX_CAST }, (_, index) => (
                <span key={index} className={styles.castSlot} data-optional={index >= MIN_CAST || undefined}>
                  <HugeiconsIcon icon={UserIcon} size={22} strokeWidth={1.5} />
                </span>
              ))}
            </div>
            <p className={styles.castEmptyTitle}>{signedIn ? "Build your scene" : "Animate your characters together"}</p>
            <p className={styles.castEmptyText}>{signedIn ? `Pick ${MIN_CAST} to ${MAX_CAST} characters on the right, then say what happens between them.` : "Sign in to put your characters in one scene."}</p>
          </div>
        )}
      </section>

      <aside className={view.controls}>
        <form className={composer.composer} onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <div className={composer.group} role="group" aria-labelledby="cast-label">
            <span id="cast-label" className={composer.groupLabel}>
              <HugeiconsIcon icon={UserGroupIcon} size={12} strokeWidth={1.75} />Characters in the scene · {picked.length}/{MAX_CAST}
            </span>
            {signedIn && list === null ? (
              <div className={styles.pickerRow} aria-busy="true"><Skeleton className={styles.pickerSkeleton} /><Skeleton className={styles.pickerSkeleton} /></div>
            ) : ready.length ? (
              <ul className={styles.pickerRow}>
                {ready.map((entry) => {
                  const position = pickedIds.indexOf(entry.id);
                  return (
                    <li key={entry.id}>
                      <button type="button" className={cn(styles.pickerItem, styles.castItem)} aria-pressed={position >= 0} disabled={full && position < 0} onClick={() => toggle(entry.id)}>
                        <MediaThumb src={entry.coverUrl} className={styles.pickerCover} />
                        <span className="min-w-0">
                          <span className="block truncate text-xs text-foreground">{entry.name}</span>
                          <span className="block text-[11px] text-muted-foreground">{position >= 0 ? "In the scene" : `${entry.versions} ${entry.versions === 1 ? "version" : "versions"}`}</span>
                        </span>
                        {position >= 0 ? <span className={styles.castBadge} aria-label={`Character ${position + 1}`}>{position + 1}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={styles.pickerEmpty}>
                <HugeiconsIcon icon={UserGroupIcon} size={14} strokeWidth={1.75} />
                {signedIn ? <>You need at least two saved characters. <Link href="/characters" className="text-primary hover:underline">Open my characters</Link></> : "Sign in to use the characters you saved."}
              </p>
            )}
            {signedIn && ready.length === 1 ? <p className={styles.hint}>You have one saved character. <Link href="/characters" className="text-primary hover:underline">Design another</Link> to animate them together.</p> : null}
            {picked.length ? <p className={styles.hint}>Each one is drawn from its selected version, which is kept with the animation.</p> : null}
          </div>

          <div className={composer.instruction}>
            <label htmlFor="ensemble-detail" className={composer.label}>What happens?</label>
            <div className={composer.field} data-filled={detail ? "" : undefined}>
              <textarea
                id="ensemble-detail"
                className={cn(composer.textarea, styles.detailInput)}
                rows={3}
                maxLength={DETAIL_MAX}
                placeholder="e.g. “a fight: the first one throws a punch and the other ducks and kicks back”"
                value={detail}
                onChange={(event) => setDetail(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
                }}
              />
              <div className={composer.hint}>
                <span className={composer.hintKeys}><kbd>Enter</kbd> to create · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</span>
                <span className="tabular-nums">{detail.length}/{DETAIL_MAX}</span>
              </div>
            </div>
          </div>

          <div className={composer.group} role="group" aria-label="Ideas for the scene">
            <span className={composer.groupLabel}><HugeiconsIcon icon={AiSearch02Icon} size={12} strokeWidth={1.75} />Try</span>
            <div className={composer.chips}>
              {IDEAS.map((idea) => <SuggestionChip size="xs" key={idea} onClick={() => setDetail(idea)} className={composer.chip}>{idea}</SuggestionChip>)}
            </div>
          </div>

          <fieldset className={composer.effects}>
            <legend className={composer.label}>How long</legend>
            <SlidingTabs
              className={composer.tabs}
              tabs={SECONDS.map((value) => ({ id: String(value), label: `${value} s` }))}
              value={String(seconds)}
              onValueChange={(id) => setSeconds(Number(id))}
            />
            <p className={composer.summary} aria-live="polite">{seconds} {seconds === 1 ? "second" : "seconds"} at {ENSEMBLE_FPS} drawings a second: {drawings} drawings.</p>
          </fieldset>

          <div className={composer.group}>
            <label htmlFor="ensemble-camera-view" className={composer.label}>Camera view</label>
            <Select id="ensemble-camera-view" value={cameraView} options={SCENE_VIEWS} onValueChange={(value) => setCameraView(value as ViewPreference)} />
            <p className={styles.hint}>The camera stays fixed through the whole scene: the characters move inside the frame.</p>
          </div>

          <div className={styles.cost} aria-live="polite">
            <span>Cost: <strong>{drawings}</strong> Muse Image drawings, one per beat of the scene.</span>
            <span>Longer scenes take longer to draw.</span>
          </div>

          <div className={composer.submit}>
            <Button className={composer.generate} type="submit" variant="ai" size="lg" disabled={!canSubmit} aria-busy={creating || undefined}>
              {creating ? <Spinner /> : <HugeiconsIcon icon={AiPaintbrushIcon} size={16} strokeWidth={1.75} />}
              Create {seconds} s scene
            </Button>
            {blockedReason ? <p className={composer.blocked}>{blockedReason}</p> : null}
          </div>
        </form>
      </aside>
    </div>
  );
}
