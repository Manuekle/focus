import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { getCredential } from "@/lib/credentials";
import {
  CommentAutomationInputError,
  createCommentAutomation,
  listCommentAutomations,
  parseCommentAutomationInput,
} from "@/lib/instagram-comment-automations";

// Instagram comment automations (lib/instagram-comment-automations.ts):
// the list, with whether Instagram is connected at all, and creating one.

export const GET = withApiErrors(async function GET() {
  const [automations, token, username] = await Promise.all([
    listCommentAutomations(),
    getCredential("INSTAGRAM_ACCESS_TOKEN"),
    getCredential("INSTAGRAM_USERNAME"),
  ]);
  return NextResponse.json(
    { automations, instagram: { connected: Boolean(token?.trim()), username: username?.trim() || null } },
    { headers: { "cache-control": "no-store" } },
  );
});

export const POST = withApiErrors(async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  try {
    const automation = await createCommentAutomation(parseCommentAutomationInput(body));
    return NextResponse.json({ automation }, { status: 201 });
  } catch (error) {
    if (error instanceof CommentAutomationInputError) return apiError("invalid_field", { field: error.field, message: error.message });
    throw error;
  }
});
