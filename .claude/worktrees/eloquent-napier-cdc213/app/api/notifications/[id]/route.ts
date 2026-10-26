import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, withApiErrors } from "@/lib/api-error";
import { requireNotificationOwner } from "@/lib/notification-access";
import { trustedSessionEmail } from "@/lib/session-header";
import { activeBusinessId } from "@/lib/business-scope";
import { withWorkspace } from "@/lib/workspace-context";
import { PendingApprovalError, decideApproval, updateNotification } from "@/lib/notifications";
import { deliverApprovalFollowUp } from "@/lib/approval-resolution";

// PATCH /api/notifications/[id] — { op: read | unread | archive | restore }.
// POST  /api/notifications/[id] — { decision: approve | decline, note? }: the
//       owner's answer to an agent's request. The decision is stored at once;
//       the agent writes and sends the customer's follow-up after the
//       response, and the panel reads how that went on its next poll.

type Context = { params: Promise<{ id: string }> };
export const maxDuration = 120;

const patch = z.object({ op: z.enum(["read", "unread", "archive", "restore"]) });

export const PATCH = withApiErrors(async (request: NextRequest, context: Context) => {
  const denied = await requireNotificationOwner(request);
  if (denied) return denied;
  const { id } = await context.params;
  const parsed = patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("invalid_body");
  let item;
  try {
    item = await updateNotification(id, parsed.data.op);
  } catch (error) {
    if (error instanceof PendingApprovalError) return apiError("conflict", { detail: "pending_approval" });
    throw error;
  }
  if (!item) return apiError("not_found");
  return NextResponse.json({ item });
});

const decision = z.object({
  decision: z.enum(["approve", "decline"]),
  note: z.string().max(500).optional(),
});

export const POST = withApiErrors(async (request: NextRequest, context: Context) => {
  // Approving a discount or a refund is the business's decision, not a
  // channel visitor's: the same gate as the team and channel settings.
  const denied = await requireNotificationOwner(request);
  if (denied) return denied;
  const { id } = await context.params;
  const parsed = decision.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("invalid_body");
  const result = await decideApproval(id, parsed.data.decision, trustedSessionEmail(request.headers), parsed.data.note);
  if (!result.ok) {
    return result.reason === "not_found" ? apiError("not_found") : apiError("conflict", { detail: result.reason });
  }
  if (result.item.approval?.followUp) {
    const workspaceId = await activeBusinessId();
    after(() => withWorkspace(workspaceId, () => deliverApprovalFollowUp(result.item)));
  }
  return NextResponse.json({ item: result.item });
});
