"use client";

/* eslint-disable @next/next/no-img-element -- private media requires browser session cookies */

import { useRef } from "react";
import { Cancel01Icon, PaintBrush01Icon, Shirt01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { IMAGE_ACCEPT_ATTRIBUTE, MAX_IMAGE_BYTES } from "../../shared/flipbook";
import { characterUrls, type Character } from "../../shared/characters";
import { formatBytes } from "../../shared/media";
import styles from "./characters.module.css";

export type ReferenceRole = "outfit" | "style";

const SLOTS = [
  { role: "outfit", label: "Outfit", icon: Shirt01Icon, empty: "Add an outfit photo", caption: "Wears these clothes" },
  { role: "style", label: "Style", icon: PaintBrush01Icon, empty: "Add a style picture", caption: "Drawn in this style" },
] as const;

/** The supporting reference holding a role, the latest when older data kept two. */
export function referenceFor(character: Character, role: ReferenceRole) {
  return character.references.slice(1).findLast((entry) => entry.role === role) ?? null;
}

/**
 * The images every change is drawn from: the original (always sent, never removed) and one slot each for an
 * outfit photo and a style picture. A filled slot is applied to every change until it is removed.
 */
export function ReferenceSlots({
  character,
  locked,
  onUpload,
  onRemove,
}: {
  readonly character: Character;
  readonly locked: boolean;
  readonly onUpload: (file: File, role: ReferenceRole) => void;
  readonly onRemove: (referenceId: string) => void;
}) {
  const inputs = useRef<Partial<Record<ReferenceRole, HTMLInputElement | null>>>({});
  const original = character.references[0];

  return (
    <div className={styles.slots}>
      <figure className={styles.slot}>
        <div className={styles.slotArt}>
          <img src={characterUrls.reference(character.id, original.id)} alt={`Original reference for ${character.name}`} />
        </div>
        <figcaption>
          <strong>Original</strong>
          <span>Face and hair</span>
        </figcaption>
      </figure>
      {SLOTS.map((slot) => {
        const reference = referenceFor(character, slot.role);
        return (
          <figure key={slot.role} className={styles.slot} data-filled={Boolean(reference) || undefined}>
            {reference ? (
              <div className={styles.slotArt}>
                <img src={characterUrls.reference(character.id, reference.id)} alt={`${slot.label} reference: ${reference.name}`} />
              </div>
            ) : (
              <button
                type="button"
                className={`${styles.slotArt} ${styles.slotEmpty}`}
                disabled={locked}
                onClick={() => inputs.current[slot.role]?.click()}
              >
                <HugeiconsIcon icon={slot.icon} size={18} strokeWidth={1.6} />
                <span>{slot.empty}</span>
              </button>
            )}
            <figcaption>
              <strong>{slot.label}</strong>
              {reference ? (
                <span className={styles.slotActions}>
                  <button type="button" className={styles.slotReplace} disabled={locked} onClick={() => inputs.current[slot.role]?.click()}>
                    Replace
                  </button>
                  <button
                    type="button"
                    className={styles.quietDelete}
                    aria-label={`Remove the ${slot.label.toLowerCase()} reference`}
                    title="Remove"
                    disabled={locked}
                    onClick={() => onRemove(reference.id)}
                  >
                    <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
                  </button>
                </span>
              ) : (
                <span>Optional</span>
              )}
            </figcaption>
            <input
              ref={(element) => {
                inputs.current[slot.role] = element;
              }}
              type="file"
              accept={IMAGE_ACCEPT_ATTRIBUTE}
              className="sr-only"
              tabIndex={-1}
              aria-label={`Upload an ${slot.label.toLowerCase()} reference (PNG, JPEG or WebP up to ${formatBytes(MAX_IMAGE_BYTES)})`}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) onUpload(file, slot.role);
              }}
            />
          </figure>
        );
      })}
    </div>
  );
}

/** What the attached references will do to the next change, said in one line under the slots. */
export function referenceSummary(character: Character): string {
  const outfit = referenceFor(character, "outfit");
  const style = referenceFor(character, "style");
  if (outfit && style) return "Every change wears the outfit photo and is drawn in the style picture, until you remove them.";
  if (outfit) return "Every change wears the clothes from the outfit photo, until you remove it. Any photo works: only the clothing is taken.";
  if (style) return "Every change is drawn in the style picture’s line work and colouring, until you remove it.";
  return `The original is always sent for face and hair. Add a photo to take its outfit or its art style (PNG, JPEG or WebP up to ${formatBytes(MAX_IMAGE_BYTES)}).`;
}
