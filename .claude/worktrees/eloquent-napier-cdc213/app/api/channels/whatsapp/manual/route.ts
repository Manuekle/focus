import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, withApiErrors } from "@/lib/api-error";
import { requireOwner } from "@/lib/owner-gate";
import { getCredential, saveCredentials } from "@/lib/credentials";
import { getWabaPhoneNumber } from "@/lib/meta-whatsapp";
import { MetaApiError } from "@/lib/meta-ads";
import { createNumber, updateNumber } from "@/lib/number-store";
import { toE164 } from "@/lib/phone-format";
import { whatsappEmbeddedAvailable } from "@/lib/whatsapp-connection";

export const GET = withApiErrors(async function GET(request: Request) {
  const denied = await requireOwner(request);
  if (denied) return denied;
  return NextResponse.json({
    phoneNumberId: await getCredential("WHATSAPP_PHONE_NUMBER_ID") ?? "",
    webhookPath: "/eve/v1/whatsapp",
    embeddedAvailable: whatsappEmbeddedAvailable(),
  });
});

const schema = z.object({
  accessToken: z.string().trim().min(10).max(4096),
  phoneNumberId: z.string().trim().regex(/^\d{5,30}$/),
  appSecret: z.string().trim().regex(/^[a-fA-F0-9]{32}$/),
  verifyToken: z.string().trim().min(8).max(256).regex(/^[A-Za-z0-9_-]+$/),
});

export const POST = withApiErrors(async function POST(request: Request) {
  const denied = await requireOwner(request, "Only the installation owner can connect WhatsApp.");
  if (denied) return denied;
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("invalid_json"); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return apiError("invalid_field", { field: parsed.error.issues[0]?.path[0]?.toString() });
  const input = parsed.data;
  let phone;
  try {
    phone = await getWabaPhoneNumber({ accessToken: input.accessToken, phoneNumberId: input.phoneNumberId });
  } catch (error) {
    // Do not return Meta's payload, which may reflect credentials.
    if (error instanceof MetaApiError) return apiError("upstream_failed");
    throw error;
  }
  const e164 = toE164(phone.displayPhoneNumber);
  if (!e164) return apiError("invalid_field", { field: "phoneNumberId" });

  const created = await createNumber({
    e164, label: phone.verifiedName || phone.displayPhoneNumber,
    capabilities: ["whatsapp"], provider: "meta", providerNumberId: phone.id,
  });
  if (!created.ok && created.reason !== "duplicate") return apiError("conflict");
  if (!created.ok) await updateNumber(created.holder.id, { provider: "meta", providerNumberId: phone.id });
  await saveCredentials({
    WHATSAPP_ACCESS_TOKEN: input.accessToken,
    WHATSAPP_PHONE_NUMBER_ID: phone.id,
    WHATSAPP_CONNECTION_MODE: "api",
    WHATSAPP_API_APP_SECRET: input.appSecret,
    WHATSAPP_API_VERIFY_TOKEN: input.verifyToken,
    WHATSAPP_API_VERIFIED_AT: "",
    // A previous shared-app WABA must not filter deliveries from this app.
    WHATSAPP_WABA_ID: "",
  });
  return NextResponse.json({ ok: true, e164 });
});
