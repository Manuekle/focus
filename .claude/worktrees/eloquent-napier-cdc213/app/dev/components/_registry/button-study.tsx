"use client";

import { FigmaButtonsPreview, FigmaButtonEdges, FigmaButtonStates } from "../_components/figma-buttons-preview";
import type { Section } from "../_lib/types";

export function buttonStudy(locale?: string): Section {
  const en = locale === "en";
  return {
    id: "button-study",
    title: en ? "Approved buttons" : "Botones aprobados",
    desc: en
      ? "The approved Figma design, now shared across the app."
      : "El diseño aprobado de tu Figma, aplicado a los botones de la app.",
    entries: [{
      id: "figma-buttons",
      name: en ? "Buttons · Figma" : "Botones · Figma",
      source: "app/dev/components/_components/figma-button.tsx",
      importLine: 'import { FigmaButton } from "@/app/dev/components/_components/figma-button";',
      desc: en
        ? "The black Publish button and blue Ask AI button from your reference: 10 px corners, a fine gradient edge and a soft inner highlight. White buttons share the same shape with less visual weight."
        : "El negro de Publish y el azul de Ask AI de tu referencia: esquinas de 10 px, borde fino en degradado y un brillo interior suave. Los botones blancos comparten la forma con menos peso visual.",
      notes: [en
        ? 'The app uses Button from components/ui/button. Use variant="ai" for blue AI actions.'
        : 'La app usa Button de components/ui/button. Usa variant="ai" para las acciones azules de IA.'],
      demos: [
        {
          id: "figma-button-edges",
          title: en ? "Edge detail · enlarged" : "Detalle de los bordes · ampliado",
          code: `<FigmaButton variant="accent" size="sm">Pedir a IA</FigmaButton>\n<FigmaButton size="sm">Añadir</FigmaButton>\n<FigmaButton variant="outline" size="sm">Probar</FigmaButton>`,
          render: <FigmaButtonEdges />,
        },
        {
          id: "figma-button-preview",
          title: en ? "App and reference · light and dark" : "App y referencia · claro y oscuro",
          code: `<FigmaButton size="sm">Publicar</FigmaButton>\n<FigmaButton variant="outline" size="sm">Probar</FigmaButton>\n<FigmaButton variant="accent" size="sm">Pedir a IA</FigmaButton>`,
          render: <FigmaButtonsPreview />,
        },
        {
          id: "figma-button-states",
          title: en ? "Sizes, states and a working example" : "Tamaños, estados y un ejemplo que puedes pulsar",
          code: `<FigmaButton size="sm">Añadir</FigmaButton>\n<FigmaButton>Guardar cambios</FigmaButton>\n<FigmaButton disabled aria-busy>Guardar cambios</FigmaButton>`,
          render: <FigmaButtonStates />,
        },
      ],
    }],
  };
}
