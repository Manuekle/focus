import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { getSessionAccountEmail, SESSION_COOKIE } from "@/lib/auth/store";
import { getAccountMeta } from "@/lib/account-store";

// GET /api/account — the signed-in account's email, avatar status, and
// Google profile picture if the last sign-in used Google.
//
// Not under /api/auth/, which middleware.ts treats as public by design (it
// has to be, for the pre-session flows living there). This route needs a
// session, so it lives where the middleware's default gate already applies.

export const GET = withApiErrors(async function GET(request: NextRequest) {
  const email = await getSessionAccountEmail(request.cookies.get(SESSION_COOKIE)?.value);
  if (!email) return apiError("unauthorized");

  const meta = await getAccountMeta();
  return NextResponse.json({
    email,
    hasAvatar: Boolean(meta.avatar),
    googlePicture: meta.googlePicture ?? null,
  });
});
