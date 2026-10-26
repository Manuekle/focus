import { NextResponse, type NextRequest } from "next/server";
import { getBusinessIdentity, type LegalPageKind } from "@/lib/business-profile-store";
import {
  BusinessIdentityError,
  clearLegalPage,
  importLegalPage,
  saveLegalPage,
} from "@/lib/business-identity";
import { apiError, withApiErrors } from "@/lib/api-error";

// POST   /api/business-profile/legal        — { url } read a page, without saving
// PUT    /api/business-profile/legal        — { kind, url?, text? } save and index it
// DELETE /api/business-profile/legal?kind=  — remove it and its indexed copy

// Saving indexes the text, which is a round of embedding calls.
export const maxDuration = 120;

const KINDS: readonly LegalPageKind[] = ["terms", "privacy"];

function readKind(value: unknown): LegalPageKind | null {
  return typeof value === "string" && KINDS.includes(value as LegalPageKind)
    ? (value as LegalPageKind)
    : null;
}

export const POST = withApiErrors(async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  const url = (body as { url?: unknown } | null)?.url;
  if (typeof url !== "string" || !url.trim()) return apiError("missing_field", { field: "url" });

  const result = await importLegalPage(url.trim());
  if (!result.ok) return apiError("upstream_failed", { detail: result.error, message: result.error });
  return NextResponse.json({ text: result.text });
});

export const PUT = withApiErrors(async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  if (!body || typeof body !== "object") return apiError("invalid_body");

  const input = body as { kind?: unknown; url?: unknown; text?: unknown };
  const kind = readKind(input.kind);
  if (!kind) return apiError("invalid_field", { field: "kind", message: "kind must be terms or privacy." });

  const identity = await getBusinessIdentity();
  try {
    const result = await saveLegalPage(kind, {
      url: typeof input.url === "string" ? input.url : "",
      text: typeof input.text === "string" ? input.text : "",
      previous: identity[kind],
    });
    return NextResponse.json({ identity: result.identity, indexWarning: result.indexWarning });
  } catch (error) {
    if (error instanceof BusinessIdentityError) {
      return apiError("missing_field", { field: "text", message: error.message });
    }
    throw error;
  }
});

export const DELETE = withApiErrors(async function DELETE(request: NextRequest) {
  const kind = readKind(new URL(request.url).searchParams.get("kind"));
  if (!kind) return apiError("invalid_field", { field: "kind", message: "kind must be terms or privacy." });

  const identity = await getBusinessIdentity();
  return NextResponse.json({ identity: await clearLegalPage(kind, identity[kind]) });
});
