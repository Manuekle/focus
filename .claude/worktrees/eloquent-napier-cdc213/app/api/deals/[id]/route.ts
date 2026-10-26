import { deleteDeal, getDeal, updateDeal } from "@/lib/business-store";
import type { Deal, DealStage } from "@/lib/types";
import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { isStage, parseDate, parseValue } from "../route";

export const GET = withApiErrors(async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const deal = await getDeal(id);
  if (!deal) return apiError("not_found");
  return NextResponse.json({ deal });
});

/** Only what a screen owns. `contactId`, `createdAt` and `closedAt` are not
 *  here: the first would move a deal to a different person behind its own
 *  history, and the other two are the store's to stamp. */
const EDITABLE = [
  "title",
  "value",
  "currency",
  "stage",
  "expectedCloseAt",
  "notes",
  "source",
  "lostReason",
] as const;

export const PATCH = withApiErrors(async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  if (!body || typeof body !== "object") return apiError("invalid_body");

  const input = body as Record<string, unknown>;
  const updates: Partial<Omit<Deal, "id" | "contactId" | "createdAt">> = {};
  for (const key of EDITABLE) {
    if (input[key] !== undefined) (updates as Record<string, unknown>)[key] = input[key];
  }
  if (Object.keys(updates).length === 0) return apiError("nothing_to_update");

  if (updates.stage !== undefined && !isStage(updates.stage)) {
    return apiError("invalid_field", { field: "stage" });
  }
  if (updates.value !== undefined) {
    const value = parseValue(updates.value);
    if (value === undefined) return apiError("invalid_field", { field: "value" });
    (updates as { value?: number }).value = value;
  }
  if (updates.currency !== undefined) {
    const currency = String(updates.currency).trim().toUpperCase();
    if (!/^[A-Za-z]{3}$/.test(currency)) return apiError("invalid_field", { field: "currency" });
    (updates as { currency?: string }).currency = currency;
  }
  if (updates.expectedCloseAt !== undefined) {
    const parsed = parseDate(updates.expectedCloseAt);
    if (parsed === undefined) return apiError("invalid_field", { field: "expectedCloseAt" });
    (updates as { expectedCloseAt?: string }).expectedCloseAt = parsed ?? undefined;
  }
  if (updates.title !== undefined) {
    const title = String(updates.title).trim();
    if (!title) return apiError("invalid_field", { field: "title" });
    (updates as { title?: string }).title = title.slice(0, 200);
  }

  const deal = await updateDeal(id, updates as Partial<Omit<Deal, "id" | "contactId" | "createdAt">> & { stage?: DealStage });
  if (!deal) return apiError("not_found");
  return NextResponse.json({ ok: true, deal });
});

export const DELETE = withApiErrors(async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!(await deleteDeal(id))) return apiError("not_found");
  return NextResponse.json({ ok: true });
});
