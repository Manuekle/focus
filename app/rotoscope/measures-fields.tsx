"use client";

import { Input } from "../../components/ui/input";
import { cn } from "../../lib/utils";
import { CharacterMeasuresSchema, MEASURE_LIMITS, type CharacterMeasures } from "../../shared/rotoscope";
import composer from "../_editor/composer.module.css";
import styles from "./rotoscope.module.css";

/** The measures as typed: empty strings for the ones left out. */
export type MeasuresDraft = { readonly heightCm: string; readonly weightKg: string; readonly personHeightCm?: string };

export const EMPTY_MEASURES: MeasuresDraft = { heightCm: "", weightKg: "", personHeightCm: "" };

export const draftOf = (measures: CharacterMeasures): MeasuresDraft => ({
  heightCm: measures.heightCm === null ? "" : String(measures.heightCm),
  weightKg: measures.weightKg === null ? "" : String(measures.weightKg),
  personHeightCm: measures.personHeightCm === null ? "" : String(measures.personHeightCm),
});

/** The typed measures, or what is wrong with them. */
export function parseMeasures(draft: MeasuresDraft): { readonly measures: CharacterMeasures } | { readonly error: string } {
  const number = (value: string | undefined) => (!value?.trim() ? null : Number(value.replace(",", ".")));
  const parsed = CharacterMeasuresSchema.safeParse({ heightCm: number(draft.heightCm), weightKg: number(draft.weightKg), personHeightCm: number(draft.personHeightCm) });
  return parsed.success ? { measures: parsed.data } : { error: `Heights go from ${MEASURE_LIMITS.heightCm.min} to ${MEASURE_LIMITS.heightCm.max} cm, the weight from ${MEASURE_LIMITS.weightKg.min} to ${MEASURE_LIMITS.weightKg.max} kg.` };
}

function Field({ id, label, unit, value, placeholder, limits, disabled, onChange }: {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly value: string;
  readonly placeholder: string;
  readonly limits: { readonly min: number; readonly max: number };
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
}) {
  const number = value.trim() ? Number(value.replace(",", ".")) : null;
  const invalid = number !== null && !(number >= limits.min && number <= limits.max);
  return (
    <label className={styles.measure} htmlFor={id}>
      <span className={composer.label}>{label}</span>
      <span className={styles.measureInput}>
        <Input id={id} type="number" inputMode="decimal" min={limits.min} max={limits.max} step="any" value={value} placeholder={placeholder} disabled={disabled} aria-invalid={invalid || undefined} onChange={(event) => onChange(event.target.value)} />
        <span className={styles.measureUnit}>{unit}</span>
      </span>
    </label>
  );
}

/**
 * The character's height and weight, given before it is analysed, and the video person's height: the character is
 * drawn that much taller or shorter than them (left empty, exactly as tall). `fields` picks which are shown.
 */
export function MeasuresFields({ id, value, onChange, fields = ["heightCm", "weightKg"], disabled, className }: {
  readonly id: string;
  readonly value: MeasuresDraft;
  readonly onChange: (value: MeasuresDraft) => void;
  readonly fields?: readonly (keyof MeasuresDraft)[];
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  return (
    <div className={cn(styles.measures, className)}>
      {fields.includes("heightCm") ? <Field id={`${id}-height`} label="Height" unit="cm" placeholder="160" value={value.heightCm} limits={MEASURE_LIMITS.heightCm} disabled={disabled} onChange={(heightCm) => onChange({ ...value, heightCm })} /> : null}
      {fields.includes("weightKg") ? <Field id={`${id}-weight`} label="Weight" unit="kg" placeholder="54" value={value.weightKg} limits={MEASURE_LIMITS.weightKg} disabled={disabled} onChange={(weightKg) => onChange({ ...value, weightKg })} /> : null}
      {fields.includes("personHeightCm") ? (
        <Field id={`${id}-person`} label="Video person" unit="cm" placeholder="same" value={value.personHeightCm ?? ""} limits={MEASURE_LIMITS.heightCm} disabled={disabled} onChange={(personHeightCm) => onChange({ ...value, personHeightCm })} />
      ) : null}
    </div>
  );
}
