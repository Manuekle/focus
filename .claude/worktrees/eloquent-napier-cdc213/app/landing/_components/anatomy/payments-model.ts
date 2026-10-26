/**
 * The truth behind Fig 05.6, kept apart from the drawing so what the card
 * shows and what it says come from one place.
 *
 * What the product does. `send_payment_link` (`agent/tools/send_payment_link.ts`)
 * creates a one-time link for one item at the amount the person agreed, on the
 * processor the business has (Stripe or Mercado Pago, or the one the person
 * asked for), writes it into the ledger (`lib/payment-store.ts`) and hands the
 * URL back for the agent to send in its reply. When the processor's webhook
 * confirms the payment, `settlePaymentAndMarkContact` (`lib/payment-settle.ts`)
 * settles that ledger entry by its reference — once: a repeated delivery is a
 * duplicate — and notes the payment on the contact, without closing the
 * conversation.
 *
 * The drawing is a shop's cash railway. At the counter the agent writes the
 * line in the ledger and the ticket goes into a carrier, which runs out along
 * the wire to the processor's booth; there it is paid and stamped, and the
 * carrier runs back — the webhook — and the ledger's line is ticked.
 */

export const PROVIDERS = ["stripe", "mercadopago"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const PROVIDER_NAMES: Readonly<Record<Provider, string>> = { stripe: "Stripe", mercadopago: "Mercado Pago" };

/** What gets charged, one after another: the amount as agreed, the currency's code, the item. */
export const CHARGES = [
  { amount: "24.50", currency: "USD" },
  { amount: "120.00", currency: "USD" },
  { amount: "8.90", currency: "USD" },
  { amount: "45.00", currency: "USD" },
] as const;

/** Lines the ledger's page shows before it turns. */
export const LEDGER_LINES = 6;

/** Seconds for each part of a charge, on the page. */
export const STEPS = [
  ["write", 1.0],
  ["out", 1.3],
  ["pay", 1.5],
  ["stamp", 0.6],
  ["back", 1.3],
  ["settle", 0.9],
  ["rest", 1.0],
] as const;
export type Step = (typeof STEPS)[number][0];
export const CHARGE = STEPS.reduce((sum, [, seconds]) => sum + seconds, 0);

/** Which part of a charge is under way at `clock` seconds into it, and how far along. */
export function stepAt(clock: number): { step: Step; progress: number } {
  let t = clock;
  for (const [step, seconds] of STEPS) {
    if (t < seconds) return { step, progress: t / seconds };
    t -= seconds;
  }
  return { step: "rest", progress: 1 };
}

/** A ledger entry: pending until the webhook settles it. Settling twice changes nothing. */
export type Entry = { readonly charge: number; readonly provider: Provider; paid: boolean };

export function settle(entry: Entry): "settled" | "duplicate" {
  if (entry.paid) return "duplicate";
  entry.paid = true;
  return "settled";
}
