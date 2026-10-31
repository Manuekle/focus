"use client";

/* eslint-disable @next/next/no-img-element -- private media requires browser session cookies */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight01Icon,
  Delete02Icon,
  Download02Icon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { SlidingTabs } from "../../components/ai-elements/sliding-tabs";
import { Button } from "../../components/ui/button";
import { confirmAction } from "../../components/ui/confirm-dialog";
import { ScrollArea } from "../../components/ui/scroll-area";
import { SuggestionChip } from "../../components/ui/suggestion-chip";
import { ToggleChip } from "../../components/ui/toggle-chip";
import { Spinner } from "../../components/ui/spinner";
import {
  MAX_IMAGE_BYTES,
  hasAcceptedImageExtension,
} from "../../shared/flipbook";
import { CHARACTER_PRESETS, CHARACTER_VERSION_MAX, characterUrls, type Character, type CharacterVersion } from "../../shared/characters";
import { formatBytes } from "../../shared/media";
import composer from "../_editor/composer.module.css";
import { DockResizer, useDockWidth } from "../rotoscope/dock-resizer";
import roto from "../rotoscope/rotoscope.module.css";
import { characterApi } from "./character-client";
import { CharacterKitSection } from "./character-kit";
import { ReferenceSlots, referenceFor, referenceSummary, type ReferenceRole } from "./reference-slots";
import styles from "./characters.module.css";

const CHANGES = [
  "Change the top to a forest-green coat. Keep the face, hair and pose.",
  "Add a small brown satchel. Keep the rest of the design.",
  "Make the outfit warmer for winter. Keep the character’s identity and pose.",
];

type DockTab = "design" | "version" | "animation";
const DOCK_LABEL: Record<DockTab, string> = { design: "Design", version: "Version", animation: "Animation" };

const GENERIC_START =
  "Keep the character exactly as drawn: same face, hair, outfit (every garment, legwear and shoes), colors. Draw it front-on, facing the camera, in a neutral pose. Show the whole body on a plain background.";

/** The first design's prefilled direction, which follows the attached references so it never contradicts them. */
function starterPrompt(character: Character): string {
  const outfit = referenceFor(character, "outfit");
  const style = referenceFor(character, "style");
  if (outfit)
    return `Keep the character’s face, hair and proportions. Dress them in the outfit from the outfit photo${style ? ", drawn in the style of the style picture" : ""}. Draw it front-on, facing the camera, in a neutral pose. Show the whole body on a plain background.`;
  const base = character.preset ? CHARACTER_PRESETS[character.preset].prompt : GENERIC_START;
  return style ? `${base} Redraw it in the art style of the style picture.` : base;
}

/** A change asked with an empty box when only references were attached: they are the change. */
function referencePrompt(character: Character): string | null {
  const outfit = referenceFor(character, "outfit");
  const style = referenceFor(character, "style");
  if (outfit && style) return "Wear the outfit from the outfit photo, drawn in the style of the style picture.";
  if (outfit) return "Wear the outfit from the outfit photo.";
  if (style) return "Redraw the character in the art style of the style picture.";
  return null;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function CharacterEditor({
  character,
  onChange,
}: {
  readonly character: Character;
  readonly onChange: (next: Character) => void;
}) {
  const selected =
    character.versions.find(
      (entry) => entry.id === character.selectedVersionId,
    ) ?? null;
  const original = character.references[0];
  const starter = starterPrompt(character);
  const [prompt, setPrompt] = useState(
    character.status === "failed"
      ? (character.job?.prompt ?? "")
      : character.versions.length
        ? ""
        : starter,
  );
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dockTab, setDockTab] = useState<DockTab>("design");
  const dock = useDockWidth("focus.characters.dock.width");
  const [dockOpen, setDockOpen] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 861px)").matches);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const operation = useRef<{ key: string; id: string } | null>(null);
  const submitLock = useRef(false);
  const generating = character.status === "generating";
  const locked = busy || generating;
  const router = useRouter();
  const base = character.versions[0];
  const comparison =
    base && base.id !== selected?.id
      ? { src: characterUrls.version(character.id, base.id), name: base.name }
      : {
          src: characterUrls.reference(character.id, original.id),
          name: "Original reference",
        };
  const currentImage = selected
    ? characterUrls.version(character.id, selected.id)
    : characterUrls.reference(character.id, original.id);
  const supports = character.references.slice(1).map((entry) => entry.id);
  const fallback = selected ? referencePrompt(character) : null;
  const promptKey = `focus:character-draft:${character.id}`;
  useEffect(() => {
    try {
      const draft = localStorage.getItem(promptKey);
      if (draft) setPrompt(draft);
    } catch {
      // Storage blocked: the draft simply isn't restored.
    }
  }, [promptKey]);
  useEffect(() => {
    try {
      localStorage.setItem(promptKey, prompt);
    } catch {
      // Not remembered; still typed.
    }
  }, [prompt, promptKey]);
  // An untouched first-design direction follows the references, so adding an outfit photo never leaves "keep the outfit" in the box.
  const lastStarter = useRef(starter);
  useEffect(() => {
    if (lastStarter.current === starter) return;
    setPrompt((current) => (current === lastStarter.current ? starter : current));
    lastStarter.current = starter;
  }, [starter]);
  useEffect(() => {
    if (
      selected &&
      selected.operationId === operation.current?.id &&
      !generating
    ) {
      setPrompt("");
      operation.current = null;
    }
  }, [selected, generating]);

  const run = async (action: () => Promise<Character>) => {
    if (submitLock.current || generating) return;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    try {
      onChange(await action());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "This change couldn’t be saved. Try again.",
      );
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  };
  const removeCharacter = async () => {
    const confirmed = await confirmAction({
      title: `Delete “${character.name}” and all ${character.versions.length} of its versions?`,
      description: "Animations already made from it keep their own copy.",
      confirmLabel: "Delete character",
    });
    if (!confirmed) return;
    submitLock.current = true;
    setBusy(true);
    try {
      await characterApi.remove(character.id);
      router.push("/characters");
    } catch (cause) {
      submitLock.current = false;
      setBusy(false);
      setError(
        cause instanceof Error
          ? cause.message
          : "This character couldn’t be deleted. Try again.",
      );
    }
  };
  const generate = async () => {
    const text = prompt.trim() || fallback || "";
    if (text.length < 3) {
      setError(
        "Describe the design or the change in at least three characters, or add an outfit or style photo.",
      );
      setDockTab("design");
      promptRef.current?.focus();
      return;
    }
    // The attached references are part of what is asked: another set is another change.
    const key = JSON.stringify([text, selected?.id ?? null, supports]);
    if (
      !operation.current ||
      operation.current.key !== key ||
      character.status === "failed" ||
      character.versions.some(
        (entry) => entry.operationId === operation.current?.id,
      )
    )
      operation.current = { key, id: crypto.randomUUID() };
    const request = {
      operationId: operation.current.id,
      prompt: text,
      fromVersionId: selected?.id ?? null,
    };
    await run(() => characterApi.generate(character.id, request));
  };
  const upload = async (file: File, role: ReferenceRole) => {
    if (!hasAcceptedImageExtension(file.name) || file.size > MAX_IMAGE_BYTES) {
      setError(`Choose a PNG, JPEG or WebP image up to ${formatBytes(MAX_IMAGE_BYTES)}.`);
      return;
    }
    await run(() => characterApi.reference(character.id, file, role));
  };
  const deleteVersion = async (version: CharacterVersion) => {
    const confirmed = await confirmAction({
      title: `Delete the version “${version.name}”?`,
      description:
        character.versions.length === 1
          ? "This can’t be undone. The original reference stays, and you can create a new design from it."
          : "This can’t be undone. Your other versions stay saved.",
      confirmLabel: "Delete version",
    });
    if (confirmed)
      await run(() =>
        characterApi.update(character.id, {
          action: "delete_version",
          versionId: version.id,
        }),
      );
  };
  const parent = selected?.parentId ? character.versions.find((entry) => entry.id === selected.parentId) : null;

  return (
    <>
      <div className={styles.editorHeading}>
        <div>
          <Link href="/characters" className={styles.breadcrumb}>
            My characters
          </Link>
          <input
            key={character.name}
            className={styles.nameInput}
            aria-label="Character name"
            defaultValue={character.name}
            maxLength={80}
            disabled={locked}
            onBlur={(event) => {
              const value = event.currentTarget.value.trim();
              if (value && value !== character.name)
                void run(() =>
                  characterApi.update(character.id, {
                    action: "rename",
                    name: value,
                  }),
                );
              else event.currentTarget.value = character.name;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          <h1 className="sr-only">{character.name} character studio</h1>
        </div>
        <div className={styles.editorActions}>
          <span className={styles.saved} role="status">
            {generating
              ? "Drawing a new version…"
              : busy
                ? "Saving…"
                : "Saved to your characters"}
          </span>
          <Button
            variant="danger"
            size="sm"
            disabled={locked}
            onClick={() => void removeCharacter()}
          >
            <HugeiconsIcon icon={Delete02Icon} size={14} />
            Delete
          </Button>
          {selected ? (
            <Button size="sm" disabled={locked} asChild={!locked}>
              {locked ? (
                <span>Animate</span>
              ) : (
                <Link
                  href={`/flipbook?character=${character.id}&version=${selected.id}`}
                >
                  Animate
                  <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
                </Link>
              )}
            </Button>
          ) : null}
        </div>
      </div>
      {/* Rotoscope's arrangement: the picture fills the room, the inspector docks on the right, the versions run underneath. */}
      <div className={styles.workspace}>
        <div className={styles.canvasRow} data-dock={dockOpen} style={dock.style}>
          <div className={styles.canvasCol}>
            <div className={styles.canvasToolbar}>
              <span>{selected ? selected.name : "Original reference"}</span>
              <ToggleChip
                size="xs"
                selected={compare}
                disabled={!selected}
                title={`Compare with ${comparison.name}`}
                onClick={() => setCompare(!compare)}
              >
                {compare ? "Close comparison" : "Compare"}
              </ToggleChip>
            </div>
            <div
              className={styles.artStage}
              data-compare={compare || undefined}
              aria-busy={generating}
            >
              {compare && (
                <figure>
                  <img
                    src={comparison.src}
                    alt={`${character.name}: ${comparison.name}`}
                  />
                  <figcaption>{comparison.name}</figcaption>
                </figure>
              )}
              <figure>
                <img
                  src={currentImage}
                  alt={`${character.name}: ${selected?.name ?? "original reference"}`}
                />
                {compare ? <figcaption>{selected?.name ?? "Original reference"}</figcaption> : null}
              </figure>
              {generating ? (
                <div className={styles.drawingStatus} role="status">
                  <Spinner />
                  <span title="Your current design stays saved.">Drawing new version…</span>
                </div>
              ) : null}
            </div>
            {/* The inspector closes from its own header; the canvas only offers to bring it back. */}
            {dockOpen ? null : (
              <Button size="icon-sm" variant="outline" className={styles.dockShow} aria-label="Show inspector" onClick={() => setDockOpen(true)}>
                <HugeiconsIcon icon={PanelRightOpenIcon} size={15} strokeWidth={1.75} />
              </Button>
            )}
          </div>
          {dockOpen ? <DockResizer dock={dock} /> : null}
          <aside className={roto.dock} data-open={dockOpen} aria-label="Character inspector">
            <div className={roto.dockInner}>
              <div className={roto.dockHead}>
                <SlidingTabs
                  className={`${composer.tabs} ${roto.dockTabs}`}
                  tabs={(selected ? (["design", "version", "animation"] as const) : (["design"] as const)).map((id) => ({ id, label: DOCK_LABEL[id] }))}
                  value={selected ? dockTab : "design"}
                  onValueChange={(id) => setDockTab(id as DockTab)}
                />
                <Button size="icon-xs" variant="ghost" className={styles.dockHide} aria-label="Hide inspector" onClick={() => setDockOpen(false)}>
                  <HugeiconsIcon icon={PanelRightCloseIcon} size={15} strokeWidth={1.75} />
                </Button>
              </div>
              <ScrollArea className={roto.dockScroll} viewportClassName={roto.dockViewport} contentClassName={roto.dockContent}>
                <div key={selected ? `${dockTab}-${selected.id}` : "design"} className={roto.swap}>
                  {!selected || dockTab === "design" ? (
                    <>
                      <form
                        className={styles.editForm}
                        onSubmit={(event) => {
                          event.preventDefault();
                          void generate();
                        }}
                      >
                        <label htmlFor="character-change">
                          {selected ? `What would you change in “${selected.name}”?` : "Describe the first design"}
                        </label>
                        <textarea
                          ref={promptRef}
                          id="character-change"
                          value={prompt}
                          onChange={(event) => {
                            setPrompt(event.target.value);
                            setError(null);
                          }}
                          rows={5}
                          maxLength={1200}
                          disabled={locked}
                          aria-invalid={Boolean(error) || undefined}
                          aria-describedby={
                            error ? "character-error" : "character-prompt-hint"
                          }
                          placeholder={fallback ?? "Keep her face and hair. Change the coat to red…"}
                        />
                        {selected ? null : (
                          <p className={styles.hint}>
                            The original guides the face, hair and style. Any angle or pose in it is redrawn front-on in a neutral pose, and missing parts of a cropped reference are drawn.
                          </p>
                        )}
                        {selected ? (
                          <div
                            className={styles.suggestions}
                            aria-label="Suggested changes"
                          >
                            {CHANGES.map((change, i) => (
                              <SuggestionChip
                                size="xs"
                                key={change}
                                disabled={locked}
                                onClick={() => {
                                  setPrompt(change);
                                  promptRef.current?.focus();
                                }}
                              >
                                {["Try a new coat", "Add a satchel", "Winter outfit"][i]}
                              </SuggestionChip>
                            ))}
                          </div>
                        ) : null}
                        <div className={styles.referencesBlock}>
                          <div className={styles.sectionHeading}>
                            <h3>Take from a photo</h3>
                          </div>
                          <ReferenceSlots
                            character={character}
                            locked={locked}
                            onUpload={(file, role) => void upload(file, role)}
                            onRemove={(referenceId) =>
                              void run(() =>
                                characterApi.update(character.id, {
                                  action: "remove_reference",
                                  referenceId,
                                }),
                              )
                            }
                          />
                          <p className={styles.hint}>{referenceSummary(character)}</p>
                        </div>
                        <div className={styles.composeFooter}>
                          {error || character.error ? (
                            <p
                              id="character-error"
                              className={styles.inlineError}
                              role="alert"
                            >
                              {error ?? character.error?.message}
                            </p>
                          ) : null}
                          <Button
                            variant="ai"
                            type="submit"
                            disabled={locked}
                            aria-busy={generating || busy}
                          >
                            {generating ? (
                              <>
                                <Spinner />
                                Drawing…
                              </>
                            ) : selected ? (
                              "Generate change"
                            ) : (
                              "Create design"
                            )}
                          </Button>
                          <span id="character-prompt-hint" className={styles.hint}>
                            {selected
                              ? "One image per change. Earlier versions and the original stay saved."
                              : "One image. Check the new design before animating."}
                          </span>
                        </div>
                      </form>
                    </>
                  ) : dockTab === "version" ? (
                    <div className={styles.versionDetails}>
                      <label htmlFor="character-version-name">Version name</label>
                      <input
                        key={selected.id + selected.name}
                        id="character-version-name"
                        defaultValue={selected.name}
                        maxLength={60}
                        disabled={locked}
                        onBlur={(event) => {
                          const name = event.currentTarget.value.trim();
                          if (name && name !== selected.name)
                            void run(() =>
                              characterApi.update(character.id, {
                                action: "rename_version",
                                versionId: selected.id,
                                name,
                              }),
                            );
                          else event.currentTarget.value = selected.name;
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                      <p className={styles.hint}>
                        Name a look, like “Everyday” or “Winter”.
                      </p>
                      <dl className={styles.versionFacts}>
                        <dt>Drawn</dt>
                        <dd>{dateFormat.format(new Date(selected.createdAt))}</dd>
                        <dt>From</dt>
                        <dd>{parent ? parent.name : "The original reference"}</dd>
                        <dt>Size</dt>
                        <dd>{selected.width} × {selected.height}</dd>
                      </dl>
                      {selected.prompt ? (
                        <div className={styles.versionPrompt}>
                          <span>What was asked</span>
                          <p>{selected.prompt}</p>
                        </div>
                      ) : null}
                      <div className={styles.versionActions}>
                        <Button variant="outline" size="sm" asChild>
                          <a href={characterUrls.version(character.id, selected.id, true)}>
                            <HugeiconsIcon icon={Download02Icon} size={14} />
                            Download PNG
                          </a>
                        </Button>
                        <button
                          type="button"
                          className={styles.dangerLink}
                          disabled={locked}
                          onClick={() => void deleteVersion(selected)}
                        >
                          Delete this version
                        </button>
                      </div>
                    </div>
                  ) : (
                    <CharacterKitSection
                      key={character.id}
                      character={character}
                      versionId={selected.id}
                      locked={locked}
                      onChange={onChange}
                    />
                  )}
                </div>
              </ScrollArea>
            </div>
          </aside>
        </div>
        <section className={styles.history} aria-labelledby="versions-title">
          <div className={styles.sectionHeading}>
            <h2 id="versions-title">
              Versions <span>{character.versions.length} of {CHARACTER_VERSION_MAX}</span>
            </h2>
            <span>Every design stays here. Select one to change, compare or animate it.</span>
          </div>
          {character.versions.length ? (
            <div className={styles.versionStrip}>
              {character.versions.map((entry) => (
                <div key={entry.id} className={styles.versionItem}>
                  <button
                    type="button"
                    className={styles.versionCard}
                    aria-pressed={entry.id === selected?.id}
                    title={entry.prompt}
                    disabled={locked}
                    onClick={() =>
                      void run(() =>
                        characterApi.update(character.id, {
                          action: "select",
                          versionId: entry.id,
                        }),
                      )
                    }
                  >
                    <img
                      src={characterUrls.version(character.id, entry.id)}
                      alt=""
                    />
                    <span>{entry.name}</span>
                  </button>
                  <button
                    type="button"
                    className={`${styles.quietDelete} ${styles.versionDelete}`}
                    aria-label={`Delete the version “${entry.name}”`}
                    title="Delete this version"
                    disabled={locked}
                    onClick={() => void deleteVersion(entry)}
                  >
                    <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.8} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.emptyHistory}>
              Your first design will appear here. The original reference is
              always kept.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
