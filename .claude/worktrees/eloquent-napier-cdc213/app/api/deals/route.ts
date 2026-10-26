import { createDeal, getContact, listDeals } from "@/lib/business-store";
import { DEAL_STAGES } from "@/lib/deals";
import type { Deal, DealStage } from "@/lib/types";
import { type NextRequest, NextResponse } from "next/server";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";

/**
 * Deals: the sales pipeline.
 *
 * Kept apart from `/api/contacts` on purpose. A contact's `status` is where a
 * conversation stands and belongs to the inbox; a deal is money, and one
 * person can have several — a repeat customer with a closed job and an open
 * quote is the ordinary case, not the exception.
 */

/** ISO 4217 is three letters. Anything else would go straight into
 *  `Intl.NumberFormat`, which throws on a bad code. */
const CURRENCY = /^[A-Za-z]{3}$/;

export function isStage(value: unknown): value is DealStage {
  return typeof value === "string" && DEAL_STAGES.includes(value as DealStage);
}

/** A finite, non-negative amount rounded to cents. A deal worth `NaN` breaks
 *  every total on the pipeline screen at once. */
export function parseValue(input: unknown): number | undefined {
  const value = typeof input === "string" ? Number(input) : input;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0 || value > 1e12) return undefined;
  return Math.round(value * 100) / 100;
}

/** An ISO timestamp or a plain `YYYY-MM-DD`, normalized to the former. */
export function parseDate(input: unknown): string | undefined | null {
  if (typeof input !== "string" || input.trim() === "") return null;
  const parsed = new Date(input);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

export const GET = withApiErrors(async function GET(request: NextRequest) {
  const contactId = request.nextUrl.searchParams.get("contactId") ?? undefined;
  return NextResponse.json({ deals: await listDeals(contactId) });
});

export const POST = withApiErrors(async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  if (!body || typeof body !== "object") return apiError("invalid_body");

  const input = body as Record<string, unknown>;
  const contactId = typeof input.contactId === "string" ? input.contactId.trim() : "";
  if (!contactId) return missingField("contactId");
  // Checked rather than assumed: a deal against a contact that doesn't exist
  // is a row the pipeline can count but never open.
  if (!(await getContact(contactId))) {
    return apiError("not_found", { field: "contactId", message: "That contact doesn't exist." });
  }

  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return missingField("title");

  const value = parseValue(input.value ?? 0);
  if (value === undefined) return apiError("invalid_field", { field: "value" });

  const currency = typeof input.currency === "string" ? input.currency.trim().toUpperCase() : "";
  if (!CURRENCY.test(currency)) return apiError("invalid_field", { field: "currency" });

  if (input.stage !== undefined && !isStage(input.stage)) {
    return apiError("invalid_field", { field: "stage" });
  }

  const expectedCloseAt = parseDate(input.expectedCloseAt);
  if (expectedCloseAt === undefined) return apiError("invalid_field", { field: "expectedCloseAt" });

  const deal = await createDeal({
    contactId,
    title: title.slice(0, 200),
    value,
    currency,
    stage: input.stage as DealStage | undefined,
    expectedCloseAt: expectedCloseAt ?? undefined,
    notes: typeof input.notes === "string" ? input.notes.slice(0, 4000) : undefined,
    source: typeof input.source === "string" ? input.source.slice(0, 200) : undefined,
  } satisfies Parameters<typeof createDeal>[0]);

  return NextResponse.json({ ok: true, deal } satisfies { ok: true; deal: Deal });
});
