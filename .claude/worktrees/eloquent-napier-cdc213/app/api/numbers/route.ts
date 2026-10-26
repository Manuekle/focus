import { type NextRequest, NextResponse } from "next/server";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";
import {
  assignNumber,
  checkNumber,
  createNumber,
  deleteNumber,
  listNumbers,
  updateNumber,
  type NumberResult,
} from "@/lib/number-store";
import { listAgents } from "@/lib/business-store";
import { readLocale, translate } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/dictionaries";

// The number directory.
//
// The interesting part of this route is what it refuses. Every write path
// funnels through the store's own uniqueness check, which runs inside the same
// read-modify-write as the save — so two browser tabs racing to bind the same
// line to two agents cannot both win.
//
// What arrives here is the *reason* it was refused, and this route's job is to
// turn that into a sentence that names the other agent rather than a generic
// 409. It words it in the caller's language, because the sentence has a
// subject ("Recepción already answers …") and no error code can carry that.

/** Which agent holds a number, by name, so a refusal can say so. */
async function holderName(agentId: string | null, locale: Locale): Promise<string> {
  if (!agentId) return translate(locale, "numbers.holderNobody");
  const agent = (await listAgents()).find((entry) => entry.id === agentId);
  return agent?.name ?? (await translate(locale, "numbers.holderDeleted"));
}

async function validateActiveAgent(agentId: unknown): Promise<NextResponse | null> {
  if (agentId === undefined || agentId === null || agentId === "") return null;
  if (typeof agentId !== "string") return apiError("invalid_field", { field: "agentId" });
  const agent = (await listAgents()).find((entry) => entry.id === agentId);
  if (!agent) return apiError("not_found", { message: "That agent no longer exists." });
  if (agent.status !== "active") {
    return apiError("conflict", { message: "Only an active agent can hold a number." });
  }
  return null;
}

async function respond(result: NumberResult, locale: Locale): Promise<NextResponse> {
  if (result.ok) return NextResponse.json({ ok: true, number: result.number });

  if (result.reason === "invalid_e164") {
    return apiError("invalid_field", {
      field: "e164",
      message: await translate(locale, "numbers.errorInvalid"),
    });
  }
  if (result.reason === "not_found") return apiError("not_found");

  const who = await holderName(result.holder.agentId, locale);
  const message = await translate(
    locale,
    result.reason === "duplicate"
      ? result.holder.agentId === null
        ? "numbers.errorDuplicateFree"
        : "numbers.errorDuplicateHeld"
      : "numbers.errorAgentBusy",
    { label: result.holder.label, agent: who, e164: result.holder.e164 },
  );
  return apiError("conflict", { message, detail: result.holder.id });
}

export const GET = withApiErrors(async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  // `?check=+549…` is the live validation the form calls while you type: it
  // answers "is this free" without creating anything.
  const check = params.get("check");
  if (check) {
    const locale = readLocale(params.get("locale"));
    const conflict = await checkNumber({
      e164: check,
      ignoreId: params.get("ignoreId") ?? undefined,
    });
    return NextResponse.json({
      available: !conflict,
      ...(conflict
        ? {
            conflict: conflict.conflict,
            holder: { id: conflict.number.id, label: conflict.number.label },
            holderAgent: await holderName(conflict.number.agentId, locale),
          }
        : {}),
    });
  }
  return NextResponse.json({ numbers: await listNumbers() });
});

export const POST = withApiErrors(async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  const input = body as { e164?: string; locale?: unknown; agentId?: unknown } | null;
  if (!input?.e164?.trim()) return missingField("e164");
  const invalidAgent = await validateActiveAgent(input.agentId);
  if (invalidAgent) return invalidAgent;
  return respond(
    await createNumber(input as Parameters<typeof createNumber>[0]),
    readLocale(input.locale),
  );
});

export const PUT = withApiErrors(async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  const input = body as {
    id?: string;
    agentId?: unknown;
    assign?: boolean;
    locale?: unknown;
  } | null;
  if (!input?.id) return missingField("id");
  const locale = readLocale(input.locale);
  const invalidAgent = await validateActiveAgent(input.agentId);
  if (invalidAgent) return invalidAgent;

  // Assignment is its own verb, not a field update: it is the one write with
  // an exclusivity rule, and routing it through the generic patch would put
  // that rule behind an `if` somebody eventually forgets.
  if (input.assign) {
    if (input.agentId !== null && typeof input.agentId !== "string") {
      return missingField("agentId");
    }
    return respond(await assignNumber(input.id, input.agentId), locale);
  }

  return respond(
    await updateNumber(input.id, input as Parameters<typeof updateNumber>[1]),
    locale,
  );
});

export const DELETE = withApiErrors(async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return missingField("id");
  const deleted = await deleteNumber(id);
  if (!deleted) return apiError("not_found");
  return NextResponse.json({ ok: true });
});
