"use client";

import { use } from "react";
import hairline from "@/app/landing/_components/hairline/hairline.module.css";
import { CalendarFigure } from "@/app/landing/_components/anatomy/calendar-figure";
import { HandoffFigure } from "@/app/landing/_components/anatomy/handoff-figure";
import { KnowledgeFigure } from "@/app/landing/_components/anatomy/knowledge-figure";
import { LeadsFigure } from "@/app/landing/_components/anatomy/leads-figure";
import { PaymentsFigure } from "@/app/landing/_components/anatomy/payments-figure";
import { VoiceFigure } from "@/app/landing/_components/anatomy/voice-figure";

/**
 * The Anatomy capability figures on their own: each one on the card's plate,
 * at the card's widest drawing (34rem) and at a phone's, in both themes, so a
 * change can be judged in every light without scrolling the landing to it.
 * `?fig=leads` shows one figure, `&theme=dark` one theme, `&width=390px` one
 * width: what a screenshot or a frame-time measurement wants on its own.
 *
 * Dev only, like everything under /dev — the layout 404s this in production.
 */

const FIGURES = {
  knowledge: KnowledgeFigure,
  handoff: HandoffFigure,
  leads: LeadsFigure,
  calendar: CalendarFigure,
  payments: PaymentsFigure,
  voice: VoiceFigure,
} as const;

function Plate({ dark, figure: Figure, width }: { readonly dark: boolean; readonly figure: () => React.ReactNode; readonly width: string }) {
  return (
    <div className={`${dark ? "dark" : ""} bg-background text-foreground`} data-plate={dark ? "dark" : "light"}>
      <div className={`${hairline.plate} relative px-3 pt-6 pb-6 sm:px-6 sm:pt-8`} style={{ width }}>
        <Figure />
      </div>
    </div>
  );
}

export default function AnatomyPreview({ searchParams }: { searchParams: Promise<{ fig?: string; theme?: string; width?: string }> }) {
  const { fig, theme, width } = use(searchParams);
  const names = (Object.keys(FIGURES) as (keyof typeof FIGURES)[]).filter((name) => !fig || name === fig);
  const plates = [
    { dark: false, width: "34rem" },
    { dark: true, width: "34rem" },
    { dark: false, width: "390px" },
    { dark: true, width: "390px" },
  ].filter((plate) => (!theme || (theme === "dark") === plate.dark) && (!width || width === plate.width));
  return (
    <main className="min-h-screen bg-background px-4 py-12">
      <header className="mx-auto max-w-[1180px]">
        <h1 className="font-sans text-lg font-medium">Fig 05 · Anatomy figures</h1>
        <p className="mt-2 text-sm text-muted-foreground">05.1 edge-notched card file · 05.2 tape machine with a manual override · 05.3 Geneva indexing table · 05.4 booking board with a go/no-go gauge · 05.5 telephone and kymograph · 05.6 cash railway</p>
      </header>
      {names.map((name) => (
        <div className="mx-auto mt-8 flex max-w-[1180px] flex-wrap items-start gap-6" data-figure={name} key={name}>
          {plates.map((plate) => (
            <Plate dark={plate.dark} figure={FIGURES[name]} key={`${plate.dark}-${plate.width}`} width={plate.width} />
          ))}
        </div>
      ))}
    </main>
  );
}
