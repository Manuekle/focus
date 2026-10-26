import { NextResponse, type NextRequest } from "next/server";
import { adminHostPassthrough, isAdminHost, isOperator } from "@/lib/admin-host";
import { SESSION_COOKIE, getSessionAccountEmail, verifySession } from "@/lib/auth/store";
import { isPublic } from "@/lib/public-paths";
import { SESSION_ACCOUNT_HEADER } from "@/lib/session-header";

// Re-exported: tests/middleware-public.test.ts and older callers import it from here.
export { isPublic };

/**
 * The gate.
 *
 * What it adds, precisely: the Next.js surface — the inbox, the contacts, the
 * model keys on Settings — had nothing in front of it. The Basic auth the
 * README describes guards the Eve channel, and `localDev()` waives it on
 * loopback; a reverse proxy can add another layer in front of everything. This
 * is the app's own lock, and the README already says Basic auth "is
 * appropriate for a controlled reference deployment, not identity".
 *
 * It runs on the Node runtime, not the edge one, because the real session
 * lookup happens here rather than in each page. The alternative — middleware
 * that only checks whether *some* cookie is present, with the real check in a
 * layout — leaves every API route ungated unless each one remembers to ask,
 * and "unless each one remembers" is how this kind of thing fails.
 *
 * Public by design, and each for a different reason:
 *
 *   The marketing pages, because they are the pitch. Someone who has not
 *   installed this yet has no account to log in with.
 *
 *   `/api/leads` and an automation's `/webhook`, because they are called by
 *   Meta and by whatever the operator wired up, not by a browser. A session
 *   cookie is not something a webhook can produce, so a shared secret stands
 *   in for one — and both routes require it rather than treating an absent
 *   secret as permission (see `verifySecret` in the leads route).
 *
 *   `/api/health`, because a monitor that has to log in is not a monitor.
 *
 *   `/f/<slug>` and `/api/f/<slug>`, because a form nobody can open collects
 *   nothing. Only published forms answer there, the route never returns the
 *   scoring, and it is rate-limited — see app/api/f/[slug]/route.ts.
 *
 *   `/api/demo-request`, the Enterprise "contact sales" form on /pricing — a
 *   prospect evaluating oruka has no account yet either. Same rate-limit
 *   shape as `/api/f/<slug>`; see app/api/demo-request/route.ts.
 *
 *   `/api/billing/webhook`, because Stripe calls it directly and carries no
 *   session cookie to send. Its own HMAC signature check over the raw body
 *   stands in for auth — see lib/stripe.ts's verifyStripeWebhookSignature.
 *
 *   `/api/cron/tick`, because QStash calls it on a clock with no session
 *   cookie; it verifies QStash's signed JWT (current or next signing key,
 *   bound to this exact URL) before running anything — see
 *   app/api/cron/tick/route.ts.
 *
 *   `/api/fleet`, because the oruka-fleet provisioner calls a hosted tenant
 *   with no session; each route checks the Bearer fleet token from the
 *   tenant's env and answers 404 on a self-hosted install — see
 *   isFleetRequest in lib/hosted.ts.
 *
 *   `/api/webhooks/elevenlabs`, same reasoning — ElevenLabs' post-call
 *   webhook calls it directly, verified by
 *   verifyElevenLabsWebhookSignature in lib/elevenlabs-agents.ts.
 *
 *   `/api/webhooks/stripe`, `/api/webhooks/mercadopago` and
 *   `/api/webhooks/shopify`, same reasoning
 *   again: the operator's own payment processor reporting that a link the
 *   agent sent was paid. Each verifies an HMAC over the raw body with the
 *   secret from Settings, and Mercado Pago additionally reads the payment
 *   back through its API before believing it.
 *
 *   `/api/payments/return` and `/pay`, where Stripe and Mercado Pago send a
 *   buyer back after paying. The buyer has no session; the route reads the
 *   named session or payment back from the processor before settling
 *   anything, and the page only reads the ledger.
 *
 *   `/eve`, because those are Eve's own routes and Eve does its own auth.
 *   Meta posts to `/eve/v1/whatsapp` and `/eve/v1/instagram` with no
 *   session cookie; each channel verifies an HMAC over the raw body with its
 *   App Secret before parsing anything. The browser
 *   chat protocol on `/eve/v1` carries the Basic auth in agent/channels/eve.ts,
 *   waived only on loopback. This also matches production, which runs with
 *   EVE_SELF_HOSTED=1: there Next never serves `/eve` at all and Caddy routes
 *   it straight to the Eve process, so gating it here only broke `next dev` —
 *   Meta's webhook verification got a 307 to /login.
 *
 * The list itself is lib/public-paths.ts, shared with workspace routing.
 *
 * admin.oruka.si is the operator's panel (lib/admin.ts) at the root of its own
 * host: there every page but signing in moves under /admin, and nothing is
 * public — not even `/`, which on www is the landing.
 *
 * Everything else — the inbox, the contacts, the model keys on Settings, and
 * every route under `/api` not named above — needs a session.
 */
export const config = {
  runtime: "nodejs",
  // Static assets and Next's own internals never reach this.
  matcher: ["/((?!_next/static|_next/image|fonts|patterns|logos).*)"],
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isAdminHost(request.headers.get("host") ?? request.nextUrl.host)) {
    const insidePanel = pathname === "/admin" || pathname.startsWith("/admin/");
    if (!adminHostPassthrough(pathname) || insidePanel) {
      const token = request.cookies.get(SESSION_COOKIE)?.value;
      const email = (await verifySession(token)) ? await getSessionAccountEmail(token) : null;
      if (!isOperator(email)) {
        // No session, or one for an account that is not an operator (another
        // sign-in left in this browser): both get the login, never the panel's
        // 404. `next` even for `/`: the login's own default (/chat) is not a
        // panel page. A leftover session is dropped so the operator can sign in.
        const login = toLogin(request, pathname, { keepRoot: true });
        if (token) login.cookies.delete(SESSION_COOKIE);
        return login;
      }
      if (!insidePanel) {
        const url = request.nextUrl.clone();
        url.pathname = pathname === "/" ? "/admin" : `/admin${pathname}`;
        return NextResponse.rewrite(url, { request: { headers: await sessionHeaders(request, token) } });
      }
    }
  }

  if (isPublic(pathname)) {
    // Public routes read the session header too — the owner-only half of
    // /api/health, the rate limiter's account key — so an inbound copy is
    // dropped here as well. On a public path nothing verified a session, and
    // the header must say exactly that.
    if (!request.headers.has(SESSION_ACCOUNT_HEADER)) return NextResponse.next();
    const headers = new Headers(request.headers);
    headers.delete(SESSION_ACCOUNT_HEADER);
    return NextResponse.next({ request: { headers } });
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySession(token)) {
    return NextResponse.next({ request: { headers: await sessionHeaders(request, token) } });
  }

  // An API call gets a status it can act on. Bouncing `fetch` to an HTML login
  // page produces a parse error three layers away from the actual problem.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return toLogin(request, pathname);
}

/**
 * The verified session's account email travels as a header so owner-only
 * routes can gate on it without a second store read. The client's own copy
 * of that header is dropped first — this is the header's only writer, and
 * nothing downstream may trust an inbound value.
 */
async function sessionHeaders(request: NextRequest, token: string | undefined): Promise<Headers> {
  const accountEmail = await getSessionAccountEmail(token);
  const headers = new Headers(request.headers);
  headers.delete(SESSION_ACCOUNT_HEADER);
  if (accountEmail) headers.set(SESSION_ACCOUNT_HEADER, accountEmail);
  return headers;
}

function toLogin(request: NextRequest, pathname: string, options: { keepRoot?: boolean } = {}) {
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  // Where they were headed, so the login sends them back rather than dumping
  // everyone on the dashboard.
  if (pathname !== "/" || options.keepRoot) login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}
