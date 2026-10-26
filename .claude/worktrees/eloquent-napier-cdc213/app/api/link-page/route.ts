import { NextResponse, type NextRequest } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import {
  LinkPageError,
  createLinkPageForCurrentBusiness,
  getLinkPageEditorState,
  type LinkPagePatch,
  linkPageDefaults,
  syncLinkPageWithBusiness,
  updateLinkPageForCurrentBusiness,
} from "@/lib/link-pages";
import { getBusinessIdentity } from "@/lib/business-profile-store";
import type { LinkPageItem, LinkPageStatus, LinkPageTheme } from "@/lib/types";

// GET    /api/link-page — the active workspace's link page, if it exists,
//                          with the business values its blank fields inherit
// POST   /api/link-page — create the first page from the business identity
// PATCH  /api/link-page — save a draft or its publication state
// PUT    /api/link-page — pull the business profile back into the page

function errorResponse(error: LinkPageError) {
  switch (error.reason) {
    case "conflict":
      return apiError("conflict", { field: error.field, message: error.message });
    case "not_found":
      return apiError("not_found", { field: error.field, message: error.message });
    case "unpublishable":
      return apiError("unprocessable", { field: error.field, message: error.message });
    case "invalid":
      return apiError("invalid_field", { field: error.field, message: error.message });
  }
}

/** Keep untrusted JSON as unknown until the service validates every member. */
function patchFromBody(body: unknown): LinkPagePatch | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  const hasKnownKey = ["slug", "status", "profile", "theme", "style", "links"].some((key) => key in input);
  if (!hasKnownKey) return null;
  return {
    ...(input.slug !== undefined ? { slug: input.slug as string } : {}),
    ...(input.status !== undefined ? { status: input.status as LinkPageStatus } : {}),
    ...(input.profile !== undefined ? { profile: input.profile as LinkPagePatch["profile"] } : {}),
    ...(input.theme !== undefined ? { theme: input.theme as LinkPageTheme } : {}),
    // Forwarded as `unknown` on purpose: `normalizeLinkPageStyle` is the
    // validator, and it reads every field of whatever arrives. Leaving `style`
    // out of this list is how every colour, font and picture the operator
    // chose was dropped on save while the screen still showed the new one.
    ...(input.style !== undefined ? { style: input.style } : {}),
    ...(input.links !== undefined ? { links: input.links as readonly LinkPageItem[] } : {}),
  };
}

export const GET = withApiErrors(async function GET() {
  return NextResponse.json(await getLinkPageEditorState());
});

export const POST = withApiErrors(async function POST() {
  try {
    const page = await createLinkPageForCurrentBusiness();
    const identity = await getBusinessIdentity();
    return NextResponse.json(
      { page, defaults: linkPageDefaults(identity), hasLogo: Boolean(identity.logo) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof LinkPageError) return errorResponse(error);
    throw error;
  }
});

export const PUT = withApiErrors(async function PUT() {
  try {
    return NextResponse.json({ page: await syncLinkPageWithBusiness() });
  } catch (error) {
    if (error instanceof LinkPageError) return errorResponse(error);
    throw error;
  }
});

export const PATCH = withApiErrors(async function PATCH(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  const patch = patchFromBody(body);
  if (!patch) return apiError("nothing_to_update");
  try {
    return NextResponse.json({ page: await updateLinkPageForCurrentBusiness(patch) });
  } catch (error) {
    if (error instanceof LinkPageError) return errorResponse(error);
    throw error;
  }
});
