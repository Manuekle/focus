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
  readonly example: string;
}[] = [
  {
    id: "reality-shift",
    name: "Reality Shift",
    summary: "Mantiene el sujeto en color y desenfoca o desatura el resto.",
    example: "Deja al skater en color y el fondo en blanco y negro",
  },
  {
    id: "break-the-frame",
    name: "Break the Frame",
    summary: "El sujeto sale del marco interior del video, con profundidad.",
    example: "Haz que la bailarina salga del cuadro",
  },
  {
    id: "motion-echo",
    name: "Motion Echo",
    summary: "Siluetas temporales del sujeto en movimiento, como una estela.",
    example: "Añade estelas de movimiento al corredor",
  },
];
