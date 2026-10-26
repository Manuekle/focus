"use client";

import { lazy, type ComponentProps } from "react";
import type { LicenseCreditCard as LicenseCard } from "@/components/ai-elements/license-credit-card";
import { DeferredDemo } from "./deferred-demo";
import { CAPABILITY_FRAME, frameAspect, SERVER_FRAME } from "./hairline/frames";

// Import each figure directly. Importing the registry bundled all six SVG
// machines and their geometry when only the first card was near the viewport.
const CAPABILITY_ART = {
  knowledge: lazy(() => import("./anatomy/knowledge-figure").then((module) => ({ default: module.KnowledgeFigure }))),
  handoff: lazy(() => import("./anatomy/handoff-figure").then((module) => ({ default: module.HandoffFigure }))),
  calendar: lazy(() => import("./anatomy/calendar-figure").then((module) => ({ default: module.CalendarFigure }))),
  leads: lazy(() => import("./anatomy/leads-figure").then((module) => ({ default: module.LeadsFigure }))),
  payments: lazy(() => import("./anatomy/payments-figure").then((module) => ({ default: module.PaymentsFigure }))),
  voice: lazy(() => import("./anatomy/voice-figure").then((module) => ({ default: module.VoiceFigure }))),
};
const ServerArt = lazy(() => import("./server-figure").then((module) => ({ default: module.ServerFigure })));
const CreditCard = lazy(() => import("@/components/ai-elements/license-credit-card").then((module) => ({ default: module.LicenseCreditCard })));

// The placeholders take the figures' own frames, so nothing moves when they
// mount. Copy stays server-rendered; decorative DOM and code wait until near view.
export function DeferredCapabilityArt({ id }: { id: "knowledge" | "handoff" | "calendar" | "leads" | "payments" | "voice" }) {
  const Art = CAPABILITY_ART[id];
  return (
    <DeferredDemo className="w-full" rootMargin="0px" style={{ aspectRatio: frameAspect(CAPABILITY_FRAME), contentVisibility: "auto" }}>
      <Art />
    </DeferredDemo>
  );
}

/** The machine, telling the page which part the pointer is on. */
export function DeferredServerArt({ onActive }: { onActive?: (part: string | null) => void }) {
  return (
    <DeferredDemo className="w-full" style={{ aspectRatio: frameAspect(SERVER_FRAME) }}>
      <ServerArt onActive={onActive} />
    </DeferredDemo>
  );
}

export function DeferredLicenseCard(props: ComponentProps<typeof LicenseCard>) {
  return <DeferredDemo className="mx-auto aspect-[1.586] w-full max-w-[23rem]"><CreditCard {...props} /></DeferredDemo>;
}
