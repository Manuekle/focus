import { type NextRequest, NextResponse } from "next/server";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";
import { getCredential, saveCredentials } from "@/lib/credentials";
import { MetaApiError } from "@/lib/meta-ads";
import {
  META_GRAPH_VERSION,
  exchangeEmbeddedSignupCode,
  getWabaPhoneNumber,
  listWabaPhoneNumbers,
  subscribeAppToWaba,
} from "@/lib/meta-whatsapp";
import { createNumber, updateNumber } from "@/lib/number-store";
import { channelReadiness } from "@/lib/channel-readiness";
import { toE164 } from "@/lib/phone-format";
import { requireOwner } from "@/lib/owner-gate";
import { disconnectChannel } from "@/lib/channel-disconnect";
import { FleetCallError, isHosted, postToFleet } from "@/lib/hosted";
import { connectHostedChannels, hostedChannelStates } from "@/lib/hosted-channels";
import { whatsappEmbeddedAvailable } from "@/lib/whatsapp-connection";

// WhatsApp Embedded Signup (one-click Meta connect).
//
// GET answers what the browser needs to open Meta's popup: the App ID and the
// WhatsApp Configuration ID. The App Secret never crosses this line — it stays
// server-side for the POST below.
//
// POST trades the popup's `code` for a business access token, verifies the
// WABA and the number against the Graph API, subscribes this app to the WABA
// (so webhooks start flowing), stores the credentials, and files the number
// in the directory as a `meta` line. The popup is the only place the operator
// types anything Meta-owned; nothing is pasted into Settings.
//
// On a hosted tenant the trade happens at the fleet, which alone holds
// Oruka's app secret (SEC-4): this tenant sends the code and gets the token.

export const GET = withApiErrors(async function GET() {
  const appId = (await getCredential("META_APP_ID"))?.trim();
  const configId = (await getCredential("META_WA_CONFIG_ID"))?.trim();
  const verifyTokenConfigured = Boolean((await getCredential("WHATSAPP_VERIFY_TOKEN"))?.trim());
  return NextResponse.json({
    configured: whatsappEmbeddedAvailable() && Boolean(appId && configId),
    available: whatsappEmbeddedAvailable(),
    ...(appId ? { appId } : {}),
    ...(configId ? { configId } : {}),
    version: META_GRAPH_VERSION,
    verifyTokenConfigured,
    // Hosted: Oruka operates the Meta app, redirect URIs and webhooks, so
    // the drawer hides those operator steps from the customer.
    hosted: isHosted(),
  });
});

type EmbeddedBody = {
  code?: unknown;
  wabaId?: unknown;
  phoneNumberId?: unknown;
  label?: unknown;
};

export const POST = withApiErrors(async function POST(request: NextRequest) {
  // Stores the installation's one WhatsApp token and number: owner-only.
  const denied = await requireOwner(request, "Only the installation owner can connect WhatsApp.");
  if (denied) return denied;

  if (!whatsappEmbeddedAvailable()) return apiError("hosted_unavailable", { status: 503 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  const input = (body ?? {}) as EmbeddedBody;
  if (typeof input.code !== "string" || !input.code.trim()) return missingField("code");
  if (typeof input.wabaId !== "string" || !input.wabaId.trim()) return missingField("wabaId");

  const hosted = isHosted();
  const appId = (await getCredential("META_APP_ID"))?.trim();
  // WHATSAPP_APP_SECRET is the Meta App Secret: the same value the manual
  // setup pastes from App Settings > Basic. META_APP_SECRET (Meta Ads) stays
  // as fallback for installs that Registered one app for everything. A
  // hosted tenant holds neither: the fleet trades the code (SEC-4).
  const whatsappAppSecret = hosted ? undefined : (await getCredential("WHATSAPP_APP_SECRET"))?.trim();
  const appSecret = whatsappAppSecret || (!hosted ? (await getCredential("META_APP_SECRET"))?.trim() : undefined);
  if (!appId || (!hosted && !appSecret)) return apiError("not_configured");

  let accessToken: string;
  try {
    ({ accessToken } = hosted
      ? await postToFleet<{ accessToken: string }>("/api/tenants/whatsapp", { action: "exchange", code: input.code.trim() })
      : await exchangeEmbeddedSignupCode({ appId, appSecret: appSecret ?? "", code: input.code }));
    if (!accessToken) throw new FleetCallError("The fleet returned no token.", 502);
  } catch (error) {
    if (error instanceof MetaApiError || error instanceof FleetCallError) {
      return apiError("upstream_failed", { message: error.message });
    }
    throw error;
  }

  const wabaId = input.wabaId.trim();
  const numbers = await listWabaPhoneNumbers({ accessToken, wabaId });
  if (numbers.length === 0) return apiError("not_found", { message: "No phone numbers on this WhatsApp Business Account." });
  const wanted = typeof input.phoneNumberId === "string" ? input.phoneNumberId.trim() : "";
  const target = wanted ? numbers.find((entry) => entry.id === wanted) : numbers[0];
  if (!target) return apiError("not_found", { message: "That phone number is not on this WhatsApp Business Account." });

  // Proves the new token can actually see the number before anything is stored.
  const verified = await getWabaPhoneNumber({ accessToken, phoneNumberId: target.id });

  // A hosted tenant shares Oruka's Meta app, whose webhook is the fleet's
  // router: its WABA is mapped there and subscribed below, after the save
  // (SEC-4). A self-hosted install subscribes its own app now.
  if (!hosted) await subscribeAppToWaba({ accessToken, wabaId });

  await saveCredentials({
    WHATSAPP_CONNECTION_MODE: "embedded",
    WHATSAPP_ACCESS_TOKEN: accessToken,
    WHATSAPP_PHONE_NUMBER_ID: verified.id,
    WHATSAPP_WABA_ID: wabaId,
    // The exchange above just proved this secret belongs to the app Meta
    // signs this WABA's webhooks with, and the channel verifies that HMAC
    // with WHATSAPP_APP_SECRET specifically. An install that had only
    // META_APP_SECRET finished this signup, filed the number, showed "listo"
    // — and then mounted no webhook route at all, so no customer message
    // ever arrived. Copying the value across is what makes connecting mean
    // receiving. Never on a hosted tenant, which holds no Meta secret.
    ...(hosted || whatsappAppSecret ? {} : { WHATSAPP_APP_SECRET: appSecret }),
  });

  // File the line in the directory so agents can be bound to it. A pasted
  // display number that does not parse to E.164 still leaves working
  // credentials behind — the number entry is a courtesy, never the guarantee.
  const e164 = toE164(verified.displayPhoneNumber);
  let number: unknown = null;
  if (e164) {
    const label =
      (typeof input.label === "string" && input.label.trim()) ||
      verified.verifiedName ||
      verified.displayPhoneNumber;
    const created = await createNumber({
      e164,
      label,
      capabilities: ["whatsapp"],
      provider: "meta",
      providerNumberId: verified.id,
    });
    if (created.ok) {
      number = created.number;
    } else if (created.reason === "duplicate") {
      const updated = await updateNumber(created.holder.id, {
        provider: "meta",
        providerNumberId: verified.id,
      });
      number = updated.ok ? updated.number : created.holder;
    }
  }

  // Stored credentials are not the same thing as a live channel: the Eve
  // webhook only answers once every key it needs is present. Reporting what
  // is still missing is what keeps the drawer from painting a green tick over
  // a channel that cannot receive a single message.
  const readiness = await channelReadiness();
  // Hosted: map the WABA at the fleet's router and subscribe Oruka's app to
  // it now. Seconds, no rebuild; a refusal shows as `failed` with a retry,
  // and the tick retries on its own.
  const registration = hosted ? await connectHostedChannels({ channels: ["whatsapp"] }) : null;
  const hostedState = hosted ? (await hostedChannelStates())?.whatsapp : undefined;

  return NextResponse.json({
    ok: true,
    wabaId,
    phoneNumberId: verified.id,
    displayPhoneNumber: verified.displayPhoneNumber,
    ...(e164 ? { e164 } : {}),
    ...(number ? { number } : {}),
    channelReady: readiness.whatsapp.ready && (!hosted || hostedState?.state === "connected"),
    missing: readiness.whatsapp.missing,
    ...(hostedState ? { hosted: hostedState, registered: registration?.results.whatsapp.status === "registered" || registration?.results.whatsapp.status === "already" } : {}),
  });
});

// DELETE — disconnect WhatsApp: the account's credentials are removed and the
// webhook answers `channel_not_configured` from the next delivery. A
// configuration change only: no restart and no rebuild (lib/channel-disconnect.ts).
export const DELETE = withApiErrors(async function DELETE(request: Request) {
  const denied = await requireOwner(request, "Only the installation owner can disconnect WhatsApp.");
  if (denied) return denied;
  const result = await disconnectChannel("whatsapp");
  return NextResponse.json({ ok: true, warnings: result.warnings });
});
