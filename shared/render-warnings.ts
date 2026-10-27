export const BREAK_FRAME_WARNING = "The subject barely extends beyond the frame. Try another frame size or a clip where the subject fills more of the image.";

export function missingSubjectMaskWarning(missing: number, total: number): string {
  return `${missing} of ${total} frames ${missing === 1 ? "has" : "have"} no subject mask. The effect treats ${missing === 1 ? "that frame" : "those frames"} entirely as background.`;
}

/** Saved renders can still contain warnings written before the app switched to English. */
export function englishRenderWarning(warning: string): string {
  const missing = /^(\d+) de (\d+) fotogramas no tienen máscara del sujeto; ahí el efecto trata todo como fondo\.$/.exec(warning);
  if (missing) return missingSubjectMaskWarning(Number(missing[1]), Number(missing[2]));
  if (warning === "Con este encuadre el sujeto apenas sale del marco. Prueba otro tamaño de marco o un clip donde el sujeto ocupe más espacio.") return BREAK_FRAME_WARNING;
  return warning;
}
