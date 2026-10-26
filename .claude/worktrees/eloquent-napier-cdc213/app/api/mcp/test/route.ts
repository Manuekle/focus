import { type NextRequest, NextResponse } from "next/server";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";
import { probeMcpServer } from "@/lib/mcp-client";
import { getServer, recordCheck, validateMcpUrl } from "@/lib/mcp-store";
import { readLocale, translate } from "@/lib/i18n/server";
import { rateLimit } from "@/lib/rate-limit";
import { requireOwner } from "@/lib/owner-gate";

// Connect to a server and list its tools.
//
// Worth its own route rather than folding into the save, for two reasons. A
// probe is a real outbound request to a host somebody typed, so it is rate
// limited on its own budget — a form with a Test button next to a URL field is
// otherwise a request forwarder. And it runs against an *unsaved* form too:
// finding out the token is wrong before the row exists is the difference
// between fixing a field and debugging a saved server that quietly does
// nothing.
//
// Owner-only, like the save it belongs to: probing a saved server sends its
// stored token, and a probe is an outbound request to a typed host.

export const POST = withApiErrors(async function POST(request: NextRequest) {
  const denied = await requireOwner(request, "Only the installation owner can test MCP servers.");
  if (denied) return denied;

  const limit = await rateLimit("mcp:test", request, { max: 20, windowMs: 5 * 60_000 });
  if (!limit.allowed) return apiError("rate_limited", { status: 429 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  const input = (body ?? {}) as {
    id?: string;
    url?: string;
    authKind?: "none" | "bearer" | "header";
    secret?: string;
    headerName?: string;
    allow?: string[];
    block?: string[];
    locale?: unknown;
  };

  // Two shapes. With an `id` the stored record is probed, secret included —
  // which is the only way to re-test a saved server, since the browser never
  // received its token. Without one, the form's own values are probed.
  if (input.id) {
    const server = await getServer(input.id);
    if (!server) return apiError("not_found");
    const probe = await probeMcpServer(server);
    const check = {
      ok: probe.ok,
      at: new Date().toISOString(),
      ...(probe.ok ? { tools: probe.tools.map((tool) => tool.name) } : {}),
      ...(probe.error ? { error: probe.error } : {}),
      ...(probe.errorKey ? { errorKey: probe.errorKey, errorParams: probe.errorParams } : {}),
    };
    await recordCheck(server.id, check);
    return NextResponse.json({
      ok: probe.ok,
      check,
      serverName: probe.serverName,
      tools: probe.tools,
    });
  }

  if (!input.url?.trim()) return missingField("url");
  const url = validateMcpUrl(input.url);
  if ("error" in url) {
    return apiError("invalid_field", {
      field: "url",
      message: await translate(readLocale(input.locale), url.error),
    });
  }

  const probe = await probeMcpServer({
    url: url.url,
    authKind: input.authKind ?? "none",
    ...(input.secret ? { secret: input.secret } : {}),
    ...(input.headerName ? { headerName: input.headerName } : {}),
    allow: input.allow ?? [],
    block: input.block ?? [],
  });
  return NextResponse.json({
    ok: probe.ok,
    serverName: probe.serverName,
    tools: probe.tools,
    ...(probe.error ? { error: probe.error } : {}),
    ...(probe.errorKey ? { errorKey: probe.errorKey, errorParams: probe.errorParams } : {}),
  });
});
