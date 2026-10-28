import { z } from "zod";

export const CameraViewSchema = z.enum([
  "front",
  "three_quarter",
  "side",
  "back",
  "high",
  "low",
]);
export type CameraView = z.infer<typeof CameraViewSchema>;
export const ViewPreferenceSchema = z.enum([
  "original",
  ...CameraViewSchema.options,
]);
export type ViewPreference = z.infer<typeof ViewPreferenceSchema>;
export const VIEW_OPTIONS: readonly { value: ViewPreference; label: string }[] =
  [
    { value: "original", label: "Keep original view" },
    { value: "front", label: "Front · facing the camera" },
    { value: "three_quarter", label: "Three-quarter view" },
    { value: "side", label: "Side profile" },
    { value: "back", label: "Back · facing away" },
    { value: "high", label: "From above" },
    { value: "low", label: "From below" },
  ];
export function resolveCameraView(
  preference: ViewPreference | undefined,
  analysis: { view: string },
  prompt = "",
): CameraView {
  if (preference && preference !== "original") return preference;
  if (/from above|high.angle|desde arriba|picad[oa]/i.test(prompt))
    return "high";
  if (/from below|low.angle|desde abajo|contrapicad[oa]/i.test(prompt))
    return "low";
  if (/three.quarter|3\/4|tres cuartos/i.test(prompt)) return "three_quarter";
  if (
    /back view|from behind|facing away|de espaldas|vista trasera/i.test(prompt)
  )
    return "back";
  if (
    /front.facing|front view|facing (?:the )?camera|looking (?:at|toward|into) (?:the )?camera|de frente|frontal|mirando (?:a |hacia )?(?:la )?c[aá]mara/i.test(
      prompt,
    )
  )
    return "front";
  if (
    /side.view|side profile|\bprofile\b|de perfil|vista lateral/i.test(prompt)
  )
    return "side";
  return CameraViewSchema.safeParse(analysis.view).success
    ? (analysis.view as CameraView)
    : "front";
}
export function cameraDescription(
  view: CameraView,
  direction: "left" | "right",
): string {
  switch (view) {
    case "front":
      return "front view, face and torso facing the camera, looking toward the viewer; both sides of the face remain visible";
    case "back":
      return "back view, torso and head facing away from the camera; show the back of the head, never invent a front-facing face";
    case "three_quarter":
      return `three-quarter view, turned diagonally toward the ${direction}; retain visible facial depth rather than a flat profile`;
    case "high":
      return `high-angle view from above, keeping the character’s heading consistent with the reference; preserve foreshortening`;
    case "low":
      return `low-angle view from below, keeping the character’s heading consistent with the reference; preserve foreshortening`;
    case "side":
      return `strict side view (profile), facing ${direction}`;
  }
}
/** Phase mechanics describe the body; they must never force a camera angle. */
export function phaseForView(description: string, view: CameraView): string {
  if (view === "side") return description;
  let result = description
    .replace(/\bside view[:,]?\s*/gi, "")
    .replace(
      /The arm nearest the viewer|The near arm/gi,
      "The character’s right arm",
    );
  if (view === "front" || view === "back")
    result = result.replace(
      /The legs make an inverted V at their widest stride\./g,
      "Project the forward/backward stride in depth, with natural foreshortening; do not rotate the torso into profile.",
    );
  return result;
}
