import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import {
  CommentAutomationInputError,
  deleteCommentAutomation,
  parseCommentAutomationInput,
  setCommentAutomationStatus,
  updateCommentAutomation,
} from "@/lib/instagram-comment-automations";

type Context = { params: Promise<{ id: string }> };

async function jsonBody(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** Replaces the rule's editable fields. */
export const PUT = withApiErrors(async function PUT(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const body = await jsonBody(request);
  if (body === undefined) return apiError("invalid_json");
  try {
    const automation = await updateCommentAutomation(id, parseCommentAutomationInput(body));
    return automation ? NextResponse.json({ automation }) : apiError("not_found");
  } catch (error) {
    if (error instanceof CommentAutomationInputError) return apiError("invalid_field", { field: error.field, message: error.message });
    throw error;
  }
});

/** `{ status: "active" | "paused" }`: the list's on/off switch. */
export const PATCH = withApiErrors(async function PATCH(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const body = (await jsonBody(request)) as { status?: unknown } | undefined;
  if (body === undefined) return apiError("invalid_json");
  if (body.status !== "active" && body.status !== "paused") return apiError("invalid_field", { field: "status" });
  const automation = await setCommentAutomationStatus(id, body.status);
  return automation ? NextResponse.json({ automation }) : apiError("not_found");
});

export const DELETE = withApiErrors(async function DELETE(_request: NextRequest, context: Context) {
  const { id } = await context.params;
  return (await deleteCommentAutomation(id)) ? NextResponse.json({ ok: true }) : apiError("not_found");
});
