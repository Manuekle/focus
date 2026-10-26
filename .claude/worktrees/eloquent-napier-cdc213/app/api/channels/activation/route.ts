import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { isHosted } from "@/lib/hosted";
import { connectHostedChannels, hostedChannelStates } from "@/lib/hosted-channels";
import { requireOwner } from "@/lib/owner-gate";

// POST /api/channels/activation — the owner's "retry" on a hosted tenant:
// points Meta routing at this tenant again for the channel credentials saved
// now. Takes seconds and builds nothing (the routes always exist); safe to
// press repeatedly, since a channel already routed is left alone.
//
// Self-hosted installs register their own Meta webhook: 404.

export const POST = withApiErrors(async function POST(request: NextRequest) {
  if (!isHosted()) return apiError("not_found");
  const denied = await requireOwner(request, "Only the installation owner can activate channels.");
  if (denied) return denied;
  const outcome = await connectHostedChannels();
  if (Object.values(outcome.results).every((result) => result.status === "not_saved")) {
    return apiError("conflict", { message: "No channel credentials are saved yet." });
  }
  return NextResponse.json({ ok: outcome.ok, states: await hostedChannelStates() });
});
