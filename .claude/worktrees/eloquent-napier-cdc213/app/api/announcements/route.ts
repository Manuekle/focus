import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, withApiErrors } from "@/lib/api-error";
import { isAnnouncementId } from "@/lib/announcement-content";
import { pendingAnnouncements, recordAnnouncement } from "@/lib/announcements";
import { isOwnerRequest } from "@/lib/owner-gate";
import { trustedSessionEmail } from "@/lib/session-header";

// /api/announcements — what the operator announces to this tenant
// (lib/announcements.ts), for the signed-in account.
//
//   GET                          the ones this account has not followed or
//                                dismissed yet, newest first
//   POST {id, action}            seen | clicked | dismissed; the first of each
//                                counts, repeats are no-ops
//
// Empty on any install the fleet does not configure.

export const GET = withApiErrors(async function GET(request: NextRequest) {
  const email = trustedSessionEmail(request.headers);
  if (!email) return apiError("unauthorized");
  const announcements = await pendingAnnouncements(email, { isOwner: await isOwnerRequest(request) });
  return NextResponse.json({ announcements }, { headers: { "cache-control": "no-store" } });
});

const actionSchema = z.object({
  id: z.string().refine(isAnnouncementId),
  action: z.enum(["seen", "clicked", "dismissed"]),
});

export const POST = withApiErrors(async function POST(request: NextRequest) {
  const email = trustedSessionEmail(request.headers);
  if (!email) return apiError("unauthorized");
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("invalid_body");
  const recorded = await recordAnnouncement(email, parsed.data.id, parsed.data.action);
  return recorded ? NextResponse.json({ ok: true }) : apiError("not_found");
});
