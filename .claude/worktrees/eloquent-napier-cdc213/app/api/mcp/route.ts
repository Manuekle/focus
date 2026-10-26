import { type NextRequest, NextResponse } from "next/server";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";
import {
  createServer,
  deleteServer,
  listPublicServers,
  toPublic,
  updateServer,
} from "@/lib/mcp-store";
import { readLocale, translate } from "@/lib/i18n/server";
import { requireOwner } from "@/lib/owner-gate";

// Connected MCP servers.
//
// Nothing on this route ever returns a `secret`. `listPublicServers` and
// `toPublic` strip it, and the form sends an absent field rather than an empty
// one when the operator has not retyped the token — so a save that only
// renames a server keeps it connected.
//
// Adding, editing and removing a server is owner-only: a server's tools are
// offered to every agent, with its token attached, so a server is a
// credential and a capability at once.

const OWNER_ONLY = "Only the installation owner can change MCP servers.";

export const GET = withApiErrors(async function GET() {
  return NextResponse.json({ servers: await listPublicServers() });
});

export const POST = withApiErrors(async function POST(request: NextRequest) {
  const denied = await requireOwner(request, OWNER_ONLY);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  const input = (body ?? {}) as { name?: string; url?: string; locale?: unknown };
  if (!input.name?.trim()) return missingField("name");
  if (!input.url?.trim()) return missingField("url");

  const result = await createServer(input as Parameters<typeof createServer>[0]);
  if (!result.ok) {
    // The store reports a dictionary key, not a sentence — the form validates
    // the same rules while you type, and only one of the two knows the reader's
    // language. See lib/mcp-url.ts.
    return apiError("invalid_field", {
      message: await translate(readLocale(input.locale), result.error),
    });
  }
  return NextResponse.json({ ok: true, server: toPublic(result.server) });
});

export const PUT = withApiErrors(async function PUT(request: NextRequest) {
  const denied = await requireOwner(request, OWNER_ONLY);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  const input = (body ?? {}) as { id?: string; locale?: unknown };
  if (!input.id) return missingField("id");

  const result = await updateServer(input.id, input as Parameters<typeof updateServer>[1]);
  if (!result.ok) {
    if (result.error === "not_found") return apiError("not_found");
    return apiError("invalid_field", {
      message: await translate(readLocale(input.locale), result.error),
    });
  }
  return NextResponse.json({ ok: true, server: toPublic(result.server) });
});

export const DELETE = withApiErrors(async function DELETE(request: NextRequest) {
  const denied = await requireOwner(request, OWNER_ONLY);
  if (denied) return denied;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return missingField("id");
  const deleted = await deleteServer(id);
  if (!deleted) return apiError("not_found");
  return NextResponse.json({ ok: true });
});
