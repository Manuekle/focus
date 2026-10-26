import type { EffectId } from "./schemas";

/** Upload → Describe → Identify → Track → Transform → Preview → Export */
export const FLOW_STEPS = [
  { id: "upload", label: "Subir" },
  { id: "describe", label: "Describir" },
  { id: "identify", label: "Identificar" },
  { id: "track", label: "Seguir" },
  { id: "transform", label: "Transformar" },
  { id: "preview", label: "Previsualizar" },
  { id: "export", label: "Exportar" },
] as const;
export type FlowStepId = (typeof FLOW_STEPS)[number]["id"];

export const EFFECTS: readonly {
  readonly id: EffectId;
  readonly name: string;
  readonly summary: string;
  /** Short, real instructions this effect handles well. */
  readonly examples: readonly string[];
}[] = [
  {
    id: "reality-shift",
    name: "Reality Shift",
    summary: "El sujeto conserva su color o su nitidez; el resto pasa a gris o se desenfoca.",
    examples: ["Deja al skater en color y el resto en gris", "Desenfoca todo menos el perro"],
  },
  {
    id: "break-the-frame",
    name: "Break the Frame",
    summary: "El video queda dentro de un marco y el sujeto sale por encima de su borde.",
    examples: ["Haz que la bailarina salga del cuadro", "Que el corredor rompa el marco"],
  },
  {
    id: "motion-echo",
    name: "Motion Echo",
    summary: "Copias del sujeto en instantes anteriores dibujan su recorrido. Mejor con cámara fija.",
    examples: ["Añade estelas al ciclista", "Dale una estela cinematográfica al bailarín"],
  },
];
