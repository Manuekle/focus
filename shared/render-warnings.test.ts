import { describe, expect, it } from "vitest";
import { BREAK_FRAME_WARNING, englishRenderWarning, missingSubjectMaskWarning } from "./render-warnings";

describe("saved render warnings", () => {
  it("shows the legacy missing-mask toast in English without losing its frame counts", () => {
    expect(englishRenderWarning("3 de 187 fotogramas no tienen máscara del sujeto; ahí el efecto trata todo como fondo."))
      .toBe("3 of 187 frames have no subject mask. The effect treats those frames entirely as background.");
    expect(englishRenderWarning("1 de 187 fotogramas no tienen máscara del sujeto; ahí el efecto trata todo como fondo."))
      .toBe("1 of 187 frames has no subject mask. The effect treats that frame entirely as background.");
  });

  it("translates the legacy frame warning and preserves other render details", () => {
    expect(englishRenderWarning("Con este encuadre el sujeto apenas sale del marco. Prueba otro tamaño de marco o un clip donde el sujeto ocupe más espacio."))
      .toBe(BREAK_FRAME_WARNING);
    const current = missingSubjectMaskWarning(5, 48);
    expect(englishRenderWarning(current)).toBe(current);
    const temporal = "Two echo moments have no reliable mask and were left out.";
    expect(englishRenderWarning(temporal)).toBe(temporal);
  });
});
