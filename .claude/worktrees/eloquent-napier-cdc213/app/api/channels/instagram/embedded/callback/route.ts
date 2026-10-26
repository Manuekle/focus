import { type NextRequest, NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-error";
import { getCredential, saveCredentials } from "@/lib/credentials";
import { MetaApiError } from "@/lib/meta-ads";
import { channelReadiness } from "@/lib/channel-readiness";
import { isOwnerRequest } from "@/lib/owner-gate";
import { FleetCallError, isHosted, postToFleet } from "@/lib/hosted";
import { connectHostedChannels, hostedChannelStates, type HostedChannelState } from "@/lib/hosted-channels";
import {
  IG_STATE_COOKIE,
  exchangeForLongLivedToken,
  exchangeIgCode,
  getIgAccount,
  igEmbeddedCallbackUrl,
  subscribeIgApp,
} from "@/lib/meta-instagram";

// GET /api/channels/instagram/embedded/callback — Meta lands here.
//
// This URL runs inside the popup, never in the app: it finishes the whole
// exchange server-side (code → short token → 60-day token → account →
// webhook subscription → stored credentials) and answers with a page that
// posts the verdict to the opener and closes itself. The drawer listens for
// that message and paints done/error without a reload.
//
// On a hosted tenant the code → 60-day token half happens at the fleet,
// which alone holds the Instagram app secret (SEC-4).

function popupPage(payload: {
  ok: boolean;
  username?: string;
  /** English fallback sentence, the way `lib/api-error.ts` uses `message`. */
  message?: string;
  /** Dictionary key for it. The opener renders this, so the failure reads in
   *  whatever language the app is set to — a sentence written in this file
   *  would arrive in one language and stay in it. */
  messageKey?: string;
  /** Keys the channel still needs before its webhook mounts. Empty on a
   *  connection that can actually receive a DM. */
  missing?: readonly string[];
  /** Hosted tenants: where routing registration stands (ERR-1). Absent on self-hosted. */
  hosted?: HostedChannelState;
}): NextResponse {
  // JSON-encoded, with `<` neutralized so a Meta error string can never break
  // out of the script block.
  const encoded = JSON.stringify(payload).replace(/</g, "\\u003c");
  // This page posts its verdict to the opener and closes itself, so nothing
  // here is read for more than a frame. The opener owns the wording.
  const title = payload.ok ? "Instagram" : "Instagram";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><script>try{window.opener&&window.opener.postMessage(Object.assign({type:"IG_EMBEDDED_SIGNUP"},${encoded}),window.location.origin);}catch(e){}window.close();</script><noscript><p>Close this window and return to the app.</p></noscript></body></html>`;
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

export const GET = withApiErrors(async function GET(request: NextRequest) {
  // The start route is owner-only, and this is asked again rather than
  // inferred from the state cookie, which the browser can set for itself.
  // Before the exchange, so a refused code is never spent or stored.
  if (!(await isOwnerRequest(request))) {
    return popupPage({
      ok: false,
      messageKey: "numbers.igForbidden",
      message: "Only the installation owner can connect Instagram.",
    });
  }

  const params = request.nextUrl.searchParams;
  const code = params.get("code")?.trim();
  const state = params.get("state");
  const expected = request.cookies.get(IG_STATE_COOKIE)?.value;

  if (!code) {
    return popupPage({
      ok: false,
      messageKey: "numbers.igNoCode",
      message: "Meta returned no authorization code.",
    });
  }
  if (!state || !expected || state !== expected) {
    return popupPage({
      ok: false,
      messageKey: "numbers.igStateMismatch",
      message: "The response doesn't match the request (state).",
    });
  }

  const hosted = isHosted();
  const igAppId = (await getCredential("INSTAGRAM_APP_ID"))?.trim();
  const igSecret = hosted ? undefined : (await getCredential("INSTAGRAM_LOGIN_SECRET"))?.trim();
  if (!igAppId || (!hosted && !igSecret)) {
    return popupPage({
      ok: false,
      messageKey: "numbers.igAppMissing",
      message: "The Instagram app isn't registered on this installation.",
    });
  }

  try {
    const long = hosted
      ? await postToFleet<{ accessToken: string }>("/api/tenants/instagram", { action: "exchange", code })
      : await exchangeForLongLivedToken({
          igSecret: igSecret ?? "",
          shortToken: (await exchangeIgCode({ igAppId, igSecret: igSecret ?? "", redirectUri: igEmbeddedCallbackUrl(), code })).accessToken,
        });
    if (!long.accessToken) throw new Error("Instagram returned no token.");
    // Proves the new token can see the account before anything is stored.
    const account = await getIgAccount({ accessToken: long.accessToken });
    await subscribeIgApp({ accessToken: long.accessToken });
    await saveCredentials({
      INSTAGRAM_ACCESS_TOKEN: long.accessToken,
      INSTAGRAM_ACCOUNT_ID: account.id,
      // Dated so agent/schedules/instagram-token.ts knows when this 60-day
      // token needs renewing. Without it the channel goes quiet on day 61.
      INSTAGRAM_TOKEN_REFRESHED_AT: new Date().toISOString(),
      // Empty clears a previous account's name when this one reports none.
      INSTAGRAM_USERNAME: account.username ?? "",
    });
    // Credentials stored is not the same as a channel that receives DMs: on
    // a self-hosted install the Eve webhook answers only once the App Secret
    // and the verify token are there too, and neither arrives through this
    // login. (A hosted tenant needs only the account: SEC-4.)
    const readiness = await channelReadiness();
    // Hosted: map the account at the fleet's Instagram router now. The route
    // already exists, so this is the last step: no rebuild.
    let hostedState: HostedChannelState | undefined;
    if (hosted) {
      await connectHostedChannels({ channels: ["instagram"] });
      hostedState = (await hostedChannelStates())?.instagram;
    }
    const done = popupPage({
      ok: true,
      ...(account.username ? { username: account.username } : {}),
      missing: readiness.instagram.missing,
      ...(hostedState ? { hosted: hostedState } : {}),
    });
    done.cookies.delete(IG_STATE_COOKIE);
    return done;
  } catch (error) {
    const message =
      error instanceof MetaApiError || error instanceof FleetCallError
        ? error.message
        : error instanceof Error
          ? error.message
          : "The connection failed.";
    // An upstream sentence from Meta has no key of its own; the opener falls
    // back to it rather than to a key that names nothing.
    return popupPage({ ok: false, message });
  }
});
