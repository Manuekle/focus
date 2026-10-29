"use client";

/* eslint-disable @next/next/no-img-element -- private media requires browser session cookies */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Add01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Delete02Icon,
  Download04Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { confirmAction } from "../../components/ui/confirm-dialog";
import { SuggestionChip } from "../../components/ui/suggestion-chip";
import { ToggleChip } from "../../components/ui/toggle-chip";
import { Select } from "../../components/ui/select";
import { Spinner } from "../../components/ui/spinner";
import {
  IMAGE_ACCEPT_ATTRIBUTE,
  MAX_IMAGE_BYTES,
  hasAcceptedImageExtension,
} from "../../shared/flipbook";
import { characterUrls, type Character } from "../../shared/characters";
import { formatBytes } from "../../shared/media";
import { characterApi } from "./character-client";
import styles from "./characters.module.css";

const REFERENCE_ROLES = [
  { value: "outfit", label: "Outfit" },
  { value: "style", label: "Style" },
] as const;

const ELF_FIRST =
  "Keep Elf-chan’s blonde side braid, green eyes, long pointed ears, burgundy choker and soft anime line work. Keep her blue long-sleeved top and original front-facing view. Complete the full-body design with dark trousers and simple ankle boots, facing the camera.";
const CHANGES = [
  "Change the top to a forest-green coat. Keep her face, hair and pose.",
  "Add a small brown satchel. Keep the rest of the design.",
  "Make the outfit warmer for winter. Keep her identity and pose.",
];

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
  const [prompt, setPrompt] = useState(
    character.status === "failed"
      ? (character.job?.prompt ?? "")
      : character.versions.length
        ? ""
        : character.preset === "elf-chan"
          ? ELF_FIRST
          : "Keep the character exactly as drawn: same face, hair, outfit (every garment, legwear and shoes), colors, camera view and facing direction. Show the whole body on a plain background.",
  );
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [referenceRole, setReferenceRole] = useState<"outfit" | "style">(
    "outfit",
  );
  const inputRef = useRef<HTMLInputElement>(null);
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
  const promptKey = `focus:character-draft:${character.id}`;
  useEffect(() => {
    const draft = localStorage.getItem(promptKey);
    if (draft) setPrompt(draft);
  }, [promptKey]);
  useEffect(() => {
    localStorage.setItem(promptKey, prompt);
  }, [prompt, promptKey]);
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
    if (prompt.trim().length < 3) {
      setError(
        "Describe the design or the change in at least three characters.",
      );
      promptRef.current?.focus();
      return;
    }
    const key = JSON.stringify([prompt.trim(), selected?.id ?? null]);
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
      prompt: prompt.trim(),
      fromVersionId: selected?.id ?? null,
    };
    await run(() => characterApi.generate(character.id, request));
  };
  const upload = async (file: File) => {
    if (!hasAcceptedImageExtension(file.name) || file.size > MAX_IMAGE_BYTES) {
      setError(`Choose a PNG, JPEG or WebP image up to ${formatBytes(MAX_IMAGE_BYTES)}.`);
      return;
    }
    await run(() => characterApi.reference(character.id, file, referenceRole));
  };

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
            variant="ghost"
            size="sm"
            disabled={locked}
            onClick={() => void removeCharacter()}
          >
            <HugeiconsIcon icon={Delete02Icon} size={14} />
            Delete
          </Button>
          {selected ? (
            <>
              <Button variant="ghost" size="sm" asChild>
                <a
                  href={characterUrls.version(character.id, selected.id, true)}
                >
                  <HugeiconsIcon icon={Download04Icon} size={14} />
                  PNG
                </a>
              </Button>
              <Button size="sm" disabled={locked} asChild={!locked}>
                {locked ? (
                  <span>Use in Flipbook</span>
                ) : (
                  <Link
                    href={`/flipbook?character=${character.id}&version=${selected.id}`}
                  >
                    Use in Flipbook
                    <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
                  </Link>
                )}
              </Button>
            </>
          ) : null}
        </div>
      </div>
      <div className={styles.workspace}>
        <div className={styles.canvasColumn}>
          <div className={styles.canvasToolbar}>
            <span>{selected ? selected.name : "Original reference"}</span>
            <ToggleChip
              size="xs"
              selected={compare}
              disabled={!selected}
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
              <figcaption>{selected?.name ?? "Original reference"}</figcaption>
            </figure>
            {generating ? (
              <div className={styles.drawingStatus} role="status">
                <Spinner />
                <span>
                  Drawing your new version
                  <span>Your current design stays saved.</span>
                </span>
              </div>
            ) : null}
          </div>
          <section className={styles.history} aria-labelledby="versions-title">
            <div className={styles.sectionHeading}>
              <h2 id="versions-title">
                Versions <span>{character.versions.length}</span>
              </h2>
              <span>Every design stays here.</span>
            </div>
            {character.versions.length ? (
              <div className={styles.versionStrip}>
                {character.versions.map((entry) => (
                  <button
                    type="button"
                    key={entry.id}
                    className={styles.versionCard}
                    aria-pressed={entry.id === selected?.id}
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
                    {entry.id === selected?.id ? (
                      <small>Selected</small>
                    ) : (
                      <small>Use this version</small>
                    )}
                  </button>
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
        <aside
          className={styles.inspector}
          aria-label="Character design controls"
        >
          <form
            className={styles.editForm}
            onSubmit={(event) => {
              event.preventDefault();
              void generate();
            }}
          >
            <div>
              <span className={styles.eyebrow}>
                {selected ? "Refine your character" : "Your first design"}
              </span>
              <h2>
                {selected
                  ? "What would you change?"
                  : "Make room for the whole character."}
              </h2>
              <p>
                {selected
                  ? `Start from “${selected.name}”. The original stays as the reference for her identity.`
                  : "Create a full-body design ready for animation. The original guides the face, hair and style."}
              </p>
            </div>
            <label htmlFor="character-change">
              {selected ? "Describe the change" : "Describe the design"}
            </label>
            <textarea
              ref={promptRef}
              id="character-change"
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value);
                setError(null);
              }}
              rows={6}
              maxLength={1200}
              disabled={locked}
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={
                error ? "character-error" : "character-prompt-hint"
              }
              placeholder="Keep her face and hair. Change the coat to red…"
            />
            <span id="character-prompt-hint" className={styles.hint}>
              One image per change. Earlier versions stay saved.
            </span>
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
            ) : (
              <p className={styles.hint}>
                Missing parts of a cropped reference will be drawn. Check the
                new design before animating.
              </p>
            )}
          </form>
          {selected ? (
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
              <button
                type="button"
                className={styles.dangerLink}
                disabled={locked}
                onClick={async () => {
                  const confirmed = await confirmAction({
                    title: `Delete the version “${selected.name}”?`,
                    description: "This can’t be undone.",
                    confirmLabel: "Delete version",
                  });
                  if (confirmed)
                    void run(() =>
                      characterApi.update(character.id, {
                        action: "delete_version",
                        versionId: selected.id,
                      }),
                    );
                }}
              >
                Delete this version
              </button>
            </div>
          ) : null}
          <section
            className={styles.references}
            aria-labelledby="references-title"
          >
            <div className={styles.sectionHeading}>
              <h2 id="references-title">References</h2>
              <span>{character.references.length}/3</span>
            </div>
            <div className={styles.referenceRow}>
              {character.references.map((reference, i) => (
                <figure key={reference.id} className={styles.referenceItem}>
                  <img
                    src={characterUrls.reference(character.id, reference.id)}
                    alt={`${i === 0 ? "Original identity" : reference.role} reference for ${character.name}`}
                  />
                  {i > 0 ? (
                    <button
                      type="button"
                      className={styles.referenceRemove}
                      aria-label={`Remove the ${reference.role} reference`}
                      disabled={locked}
                      onClick={() =>
                        void run(() =>
                          characterApi.update(character.id, {
                            action: "remove_reference",
                            referenceId: reference.id,
                          }),
                        )
                      }
                    >
                      <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2.2} />
                    </button>
                  ) : null}
                  <figcaption>
                    {i === 0
                      ? "Original · kept"
                      : reference.role === "outfit"
                        ? "Outfit"
                        : "Style"}
                  </figcaption>
                </figure>
              ))}
            </div>
            <p className={styles.hint}>
              The original travels with every design. Outfit and style
              references help with specific details.
            </p>
            {character.references.length < 3 ? (
              <div className={styles.addReference}>
                <Select
                  id="reference-role"
                  aria-label="Supporting reference type"
                  value={referenceRole}
                  onValueChange={(value) =>
                    setReferenceRole(value as "outfit" | "style")
                  }
                  disabled={locked}
                  options={REFERENCE_ROLES}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={locked}
                  onClick={() => inputRef.current?.click()}
                >
                  <HugeiconsIcon icon={Add01Icon} size={13} />
                  Add reference
                </Button>
              </div>
            ) : null}
            <input
              ref={inputRef}
              type="file"
              accept={IMAGE_ACCEPT_ATTRIBUTE}
              className="sr-only"
              tabIndex={-1}
              aria-label="Upload a supporting reference"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void upload(file);
              }}
            />
          </section>
        </aside>
      </div>
    </>
  );
}
