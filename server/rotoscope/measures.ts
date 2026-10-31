import { CharacterMeasuresSchema, type CharacterMeasures } from "../../shared/rotoscope";
import { AppError } from "../errors";

/** The measures fields of a run's form (empty strings for the ones left out), checked against MEASURE_LIMITS. */
export function measuresFrom(fields: { readonly heightCm: string; readonly weightKg: string; readonly personHeightCm: string }): CharacterMeasures {
  const number = (value: string) => (value.trim() === "" ? null : Number(value.replace(",", ".")));
  const parsed = CharacterMeasuresSchema.safeParse({ heightCm: number(fields.heightCm), weightKg: number(fields.weightKg), personHeightCm: number(fields.personHeightCm) });
  if (!parsed.success) throw new AppError("INPUT_INVALID", 400, "Heights go from 50 to 250 cm and the weight from 10 to 300 kg.");
  return parsed.data;
}
