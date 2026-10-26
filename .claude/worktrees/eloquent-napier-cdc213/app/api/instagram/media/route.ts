import { NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { getCredential } from "@/lib/credentials";
import { graphErrorMessage, listRecentMedia } from "@/lib/instagram-comments";

// The connected account's latest posts and reels, for picking which one a
// comment automation listens to.
export const GET = withApiErrors(async function GET() {
  if (!(await getCredential("INSTAGRAM_ACCESS_TOKEN"))?.trim()) return apiError("not_configured", { message: "Instagram is not connected." });
  const result = await listRecentMedia();
  if (!result.ok) return apiError("upstream_failed", { message: graphErrorMessage({ ok: false, status: result.status, body: result.body }) });
  return NextResponse.json({ media: result.media }, { headers: { "cache-control": "no-store" } });
});
