"use client";

import type { ReactNode } from "react";
import { CalendarFigure } from "./anatomy/calendar-figure";
import { HandoffFigure } from "./anatomy/handoff-figure";
import { KnowledgeFigure } from "./anatomy/knowledge-figure";
import { LeadsFigure } from "./anatomy/leads-figure";
import { PaymentsFigure } from "./anatomy/payments-figure";
import { VoiceFigure } from "./anatomy/voice-figure";

/**
 * The capability cards' drawings: six Anatomy figures (`./anatomy/`), each a
 * small machine whose working is the capability, every number on it taken
 * from a model of what the product actually does (the `*-model.ts` beside
 * each figure).
 *
 * 01 · knowledge — a card file: cards rise on a selector rod by how close each
 *      passage is to the question.
 * 02 · handoff — a tape machine: the motor lets go of the conversation when a
 *      person's crank takes it.
 * 03 · calendar — a booking board: a 30-minute gauge drops into every free
 *      slot, then presses the booking in.
 * 04 · leads — an indexing table on a Geneva drive: one poll every five
 *      minutes takes every waiting lead in.
 * 05 · payments — a cash railway: the link runs out to the processor and the
 *      webhook runs it back, paid.
 * 06 · voice — a telephone and a kymograph: the agent answers and every call
 *      is written down.
 *
 * All six draw in the same 400 × 268 frame, so the cards hold drawings of one
 * size and the placeholder that waits for them keeps the same shape.
 */
export const CAPABILITY_FIGURES = {
  knowledge: KnowledgeFigure,
  handoff: HandoffFigure,
  calendar: CalendarFigure,
  leads: LeadsFigure,
  payments: PaymentsFigure,
  voice: VoiceFigure,
} satisfies Record<string, () => ReactNode>;
