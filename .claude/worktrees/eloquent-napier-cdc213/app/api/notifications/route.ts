import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, withApiErrors } from "@/lib/api-error";
import { notificationOwnerEmail } from "@/lib/notification-owner";
import { requireNotificationOwner } from "@/lib/notification-access";
import { markAllRead, readNotifications, writePreferences } from "@/lib/notifications";
import { emailDeliveryReady } from "@/lib/notify-owner";
import { countsByTab } from "@/lib/notification-types";

// GET  /api/notifications — the feed, newest first, with counts and where
//                           email would go.
// POST /api/notifications — { op: "read_all" }.
// PUT  /api/notifications — email preferences (owner only).

/** Enough of the address to recognise it, not enough to harvest it. */
function maskEmail(email: string | undefined): string | null {
  if (!email) return null;
  const [name, domain] = email.split("@");
  if (!domain) return null;
  return `${name.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(name.length - 1, 6)))}@${domain}`;
}

export const GET = withApiErrors(async (request: NextRequest) => {
  const denied = await requireNotificationOwner(request);
  if (denied) return denied;
  const [{ items, preferences }, email, ready] = await Promise.all([
    readNotifications(), notificationOwnerEmail().catch(() => undefined), emailDeliveryReady(),
  ]);
  const ordered = [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return NextResponse.json({
    items: ordered,
    counts: countsByTab(items),
    preferences,
    delivery: { email: maskEmail(email), ready },
  }, { headers: { "Cache-Control": "private, no-store" } });
});

const action = z.object({ op: z.literal("read_all") });

export const POST = withApiErrors(async (request: NextRequest) => {
  const denied = await requireNotificationOwner(request);
  if (denied) return denied;
  const parsed = action.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("invalid_body");
  return NextResponse.json({ updated: await markAllRead() });
});

const preferences = z.object({
  email: z.object({ approvals: z.boolean(), handoffs: z.boolean(), team: z.boolean() }),
});

export const PUT = withApiErrors(async (request: NextRequest) => {
  // Where the owner's mail goes is the owner's setting.
  const denied = await requireNotificationOwner(request);
  if (denied) return denied;
  const parsed = preferences.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("invalid_body");
  return NextResponse.json({ preferences: await writePreferences(parsed.data) });
});
