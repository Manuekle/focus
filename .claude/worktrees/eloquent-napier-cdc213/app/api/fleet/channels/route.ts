import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { isFleetRequest } from "@/lib/hosted";
import { hostedChannelStates, savedChannelFingerprints } from "@/lib/hosted-channels";

// GET /api/fleet/channels — each channel's state and which credentials are
// saved (fingerprints only, never a credential), for the operator's
// diagnostics. The fleet also gets the states on every tick. Fleet token
// only; 404 for anyone else and on self-hosted.
//
// Channel activation is gone: the routes always exist, so the fleet no longer
// rebuilds a tenant to connect a channel, and `/register` and `/failure` went
// with it.

export const GET = withApiErrors(async function GET(request: NextRequest) {
  if (!isFleetRequest(request)) return apiError("not_found");
  return NextResponse.json({
    saved: await savedChannelFingerprints(),
    states: await hostedChannelStates(),
  });
});
