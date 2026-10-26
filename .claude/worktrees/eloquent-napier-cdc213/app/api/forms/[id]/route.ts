import { deleteForm, getForm, listFormResponses, updateForm } from "@/lib/business-store";
import type { Form } from "@/lib/types";
import { type NextRequest, NextResponse } from "next/server";
import { assertPublicHttpsUrl } from "@/lib/http-guard";
import { parseScoring, parseSteps } from "@/lib/forms/schema";
import { apiError, withApiErrors } from "@/lib/api-error";

export const GET = withApiErrors(async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const form = await getForm(id);
  if (!form) return apiError("not_found");
  const responses = await listFormResponses(id);
  return NextResponse.json({ form, responses });
});

/** Only the fields a screen can actually change. Spreading the body straight
 *  into the record would let a caller rewrite `createdAt` or the id. */
const EDITABLE = [
  "name",
  "description",
  "status",
  "steps",
  "scoring",
  "thankYou",
  "slug",
  "webhookUrl",
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
  if (!body || typeof body !== "object") {
    return apiError("invalid_body");
  }
  const input = body as Record<string, unknown>;
  const updates: Partial<Omit<Form, "id" | "createdAt">> = {};
  for (const key of EDITABLE) {
    if (input[key] !== undefined) {
      (updates as Record<string, unknown>)[key] = input[key];
    }
  }
  if (Object.keys(updates).length === 0) return apiError("nothing_to_update");

  // Checked here rather than at delivery time: a webhook that silently never
  // fires is the worst version of this feature, so a URL the guard would
  // refuse is refused now, while someone is looking at the field.
  if (updates.webhookUrl !== undefined) {
    const raw = typeof updates.webhookUrl === "string" ? updates.webhookUrl.trim() : "";
    const mutable = updates as { webhookUrl?: string };
    if (raw === "") {
      mutable.webhookUrl = undefined;
    } else {
      try {
        assertPublicHttpsUrl(raw);
      } catch (cause) {
        return apiError("invalid_field", {
          message: cause instanceof Error ? cause.message : "Invalid webhook URL.",
        });
      }
      mutable.webhookUrl = raw;
    }
  }

  // The builder is the only caller that sends these, and it validates the
  // same rules before enabling its save button — but "the client checked" is
  // not a check. A step list that got through here reaches the public page,
  // which renders whatever it is handed.
  if (updates.steps !== undefined) {
    const parsed = parseSteps(updates.steps);
    if (!parsed.ok) {
      const [first] = parsed.issues;
      return apiError("invalid_field", {
        field: first?.path,
        message: first?.message ?? "The form's questions aren't in a shape this endpoint accepts.",
        detail: JSON.stringify(parsed.issues),
      });
    }
    (updates as { steps?: Form["steps"] }).steps = parsed.steps;
  }

  if (updates.scoring !== undefined) {
    const parsed = parseScoring(updates.scoring);
    if (!parsed.ok) {
      const [first] = parsed.issues;
      return apiError("invalid_field", {
        field: first?.path,
        message: first?.message ?? "Those score thresholds aren't usable.",
        detail: JSON.stringify(parsed.issues),
      });
    }
    (updates as { scoring?: Form["scoring"] }).scoring = parsed.scoring;
  }

  const form = await updateForm(id, updates);
  if (!form) return apiError("not_found");
  return NextResponse.json({ ok: true, form });
});

export const DELETE = withApiErrors(async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const removed = await deleteForm(id);
  if (!removed) return apiError("not_found");
  return NextResponse.json({ ok: true });
});
