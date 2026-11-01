import { z } from "zod";

// Content rights acknowledgement. The person says they own, or are allowed to
// use, the material they send for AI processing. It is a statement, not proof:
// nothing here verifies ownership or licensing.

/** Bump when the wording of the acknowledgement changes materially. */
export const RIGHTS_VERSION = "2026-10";

/** Sent with every request that starts processing user-provided material. */
export const RIGHTS_HEADER = "x-focus-rights-ack";

export const RIGHTS_ERROR_CODE = "rights_confirmation_required";

export const RIGHTS_COPY = {
  heading: "Content rights confirmation",
  label: "I confirm that I own this content or have the necessary rights and permissions to use it for AI processing, transformation, and animation.",
  link: "Learn about content rights",
  error: "Confirm that you have the rights to use this content before processing.",
  dialogTitle: "Use content you have permission to use",
  dialogLead: "You can upload:",
  dialogItems: [
    "Content you created and have the rights to use.",
    "Content whose owner has authorized your intended use.",
    "Content with a license permitting the intended processing and transformation.",
  ],
  dialogNotes: [
    "Giving credit to the original creator does not automatically grant permission.",
    "You are responsible for ensuring your use complies with applicable copyright laws, licenses, and platform policies.",
  ],
  dialogAction: "Got it",
} as const;

/** The stored acknowledgement: minimal on purpose, no identity. */
export const RightsRecordSchema = z.object({
  status: z.literal("confirmed"),
  version: z.string(),
  confirmedAt: z.iso.datetime(),
  /** What the acknowledgement was given for: an edit, run, animation or flipbook. */
  subjectKind: z.enum(["edit", "rotoscope", "animation", "flipbook"]),
  subjectId: z.string().max(120),
  assetIds: z.array(z.string().max(120)).max(32),
});
export type RightsRecord = z.infer<typeof RightsRecordSchema>;
export type RightsSubjectKind = RightsRecord["subjectKind"];

/** The header the browser sends once the box is checked. */
export function rightsHeaders(): Record<string, string> {
  return { [RIGHTS_HEADER]: RIGHTS_VERSION };
}

/** Identity of a picked file: replacing it with another file changes the key. */
export function fileRightsKey(file: { readonly name: string; readonly size: number; readonly lastModified: number }): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/** A key naming every asset a request uses; any change in the set changes the key. */
export function rightsAssetKey(parts: readonly (string | number | null | undefined)[]): string | null {
  if (!parts.length || parts.some((part) => part === null || part === undefined || part === "")) return null;
  return parts.join("|");
}
