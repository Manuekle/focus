import { NextResponse, type NextRequest } from "next/server";
import { resolveProvider } from "@/lib/ai-provider";
import { clearChatModel, getChatModel, getPendingChatModel, setChatModel } from "@/lib/chat-model-store";
import { listModels } from "@/lib/provider-catalog";
import { readAccess } from "@/lib/model-access";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";

// GET    /api/chat-model?sessionId=  — the model this conversation runs on
// POST   /api/chat-model             — { model, sessionId? } set it
// DELETE /api/chat-model?sessionId=  — back to the default
//
// The agent reads the same store when it picks a model for a turn.

export const GET = withApiErrors(async function GET(request: NextRequest) {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  const model = sessionId ? await getChatModel(sessionId) : await getPendingChatModel();
  return NextResponse.json({ model: model ?? null });
});

export const POST = withApiErrors(async function POST(request: NextRequest) {
  let body: { model?: unknown; sessionId?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }

  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) return missingField("model");

  // Only ids the active provider actually serves: a typo here would surface
  // as a failed turn later, with nothing pointing back at this call.
  const provider = resolveProvider();
  const available = await listModels(provider);
  if (available.length > 0 && !available.some((entry) => entry.id === model)) {
    return apiError("model_unavailable", {
      detail: `Provider ${provider} does not serve model ${model}.`,
    });
  }

  const { restricted } = await readAccess();
  if (restricted[model]) {
    return apiError("model_unavailable", { detail: restricted[model] });
  }

  const sessionId = typeof body.sessionId === "string" && body.sessionId ? body.sessionId : undefined;
  await setChatModel(model, sessionId);
  return NextResponse.json({ ok: true, model, sessionId: sessionId ?? null });
});

export const DELETE = withApiErrors(async function DELETE(request: NextRequest) {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) return missingField("sessionId");
  await clearChatModel(sessionId);
  return NextResponse.json({ ok: true });
});
