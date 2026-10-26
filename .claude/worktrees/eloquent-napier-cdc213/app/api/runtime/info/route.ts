import { type NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-error";
import { fetchEveInfo } from "@/lib/eve-info";

// What the runtime actually loaded.
//
// A proxy rather than a direct browser fetch, and deliberately: `/eve/v1/info`
// is authorized by the eve channel (agent/channels/eve.ts), which in
// production expects the app's own session cookie. Forwarding the incoming
// request's cookie is what makes this work off localhost — without it the page
// would report the runtime as unreachable when it is merely private.
//
// The response is never cached. The whole value of this endpoint is that it
// reflects the process as it is right now, after dynamic resolvers ran.
export const GET = withApiErrors(async function GET(request: NextRequest) {
  const result = await fetchEveInfo({
    cookie: request.headers.get("cookie"),
    // The origin the browser reached us on. Under withEve() the runtime is
    // mounted in this same server, so that origin serves /eve/v1 too — and it
    // is reachable, which the configured public URL is not always.
    requestOrigin: request.nextUrl.origin,
  });
  return NextResponse.json(result, {
    headers: { "cache-control": "no-store" },
  });
});
