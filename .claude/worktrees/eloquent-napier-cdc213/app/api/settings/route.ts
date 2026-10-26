import {
  CREDENTIAL_GROUPS,
  getCredentialPreviews,
  getCredentialSources,
  getMaskedCredentials,
  getStoredCredentials,
  isPasswordCredential,
  saveCredentials,
  type CredentialKey,
} from "@/lib/credentials";
import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { invalidateProviderReports } from "@/lib/provider-catalog";
import { PROVIDER_CREDENTIAL_KEY } from "@/lib/model-catalog";
import { requireOwner } from "@/lib/owner-gate";
import { ollamaUrlProblem, validateOllamaBaseUrl } from "@/lib/ollama-url";
import { isHosted } from "@/lib/hosted";
import { isManagedMetaSetting, withoutManagedMetaSettings } from "@/lib/hosted-meta-settings";
import { SENDER_EMAIL_PATTERN } from "@/lib/email-sender";

// GET /api/settings — which credentials are configured (masked), the real
// value for every non-secret field (a phone number id, a hostname — nothing
// worth hiding), and a short preview instead of the real value for every
// secret field (API keys, tokens, passwords). A secret's full value is never
// sent back once saved: the form shows what was typed this session, or
// nothing, never what the server holds — see lib/credentials.ts's
// `isPasswordCredential`/`getCredentialPreviews`.
// POST /api/settings — saves credential values to the local store, and
// answers with the same shape GET does so the form can repaint from the
// server's own view instead of asking the operator to reload the page.
// Owner-only, like export and import: the store is installation-wide, so one
// save re-points the model, the channels and the allowlist for everyone.

/** Every key whose value decides which model answers, and with whose key. */
const MODEL_KEYS: ReadonlySet<string> = new Set<string>([
  "AI_PROVIDER",
  "AI_MODEL",
  ...Object.values(PROVIDER_CREDENTIAL_KEY),
]);

/** The one payload both verbs return: what is set, where it came from, the
 *  non-secret values, and a masked preview for every secret. */
async function settingsPayload() {
  const hosted = isHosted();
  const groups = hosted ? CREDENTIAL_GROUPS
    .filter((group) => group.id !== "whatsapp" && group.id !== "instagram")
    .map((group) => ({ ...group, fields: group.fields.filter((field) => !isManagedMetaSetting(field.key)) }))
    : CREDENTIAL_GROUPS;
  const visible = <T,>(values: Record<string, T>) => hosted ? withoutManagedMetaSettings(values) : values;
  const [masked, stored, previews, sources] = await Promise.all([
    getMaskedCredentials(),
    getStoredCredentials(),
    getCredentialPreviews(),
    getCredentialSources(),
  ]);

  // Non-secret values, from the store *and* from the environment. A hostname
  // or an account id set through .env is configured and working; showing its
  // box empty told the operator the opposite.
  const values: Record<string, string> = {};
  for (const group of groups) {
    for (const field of group.fields) {
      if (isPasswordCredential(field.key)) continue;
      const value = stored[field.key] ?? process.env[field.key];
      if (value !== undefined) values[field.key] = value;
    }
  }

  return {
    hosted,
    credentials: visible(masked),
    // Only values explicitly saved through the UI count as "configured" for the
    // badge — environment-provided secrets are real and working, but the badge
    // should reflect whether the operator set them up from this app. The
    // "from env" hint in the form already communicates the env origin.
    configured: visible(Object.fromEntries(
      Object.entries(sources)
        .filter(([, source]) => source === "store")
        .map(([key]) => [key, true]),
    )),
    sources: visible(sources),
    values,
    previews: visible(previews),
    groups,
  };
}

export const GET = withApiErrors(async function GET() {
  return NextResponse.json(await settingsPayload());
});

export const POST = withApiErrors(async function POST(request: NextRequest) {
  const denied = await requireOwner(request, "Only the installation owner can change settings.");
  if (denied) return denied;

  let body: Record<string, string>;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError("invalid_body");
  if (isHosted() && Object.keys(body).some(isManagedMetaSetting)) {
    return apiError("hosted_managed_channel");
  }

  // Only accept known credential keys to prevent arbitrary writes.
  const knownKeys = new Set<string>(
    CREDENTIAL_GROUPS.flatMap((g) => g.fields.map((f) => f.key)),
  );

  const updates: Partial<Record<CredentialKey, string>> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!knownKeys.has(key)) continue;
    if (typeof value !== "string") continue;
    // Empty string clears; non-empty sets.
    updates[key as CredentialKey] = value;
  }

  // The Ollama address becomes the model client's base URL, so an address off
  // the local network is refused here as well as on every read.
  for (const key of ["SMTP_FROM", "RESEND_FROM_EMAIL"] as const) {
    const value = updates[key]?.trim();
    if (value && !new RegExp(SENDER_EMAIL_PATTERN).test(value)) {
      return apiError("invalid_field", { field: key, message: "Use a valid sender address without no-reply." });
    }
    if (updates[key] !== undefined) updates[key] = value ?? "";
  }

  if (updates.OLLAMA_BASE_URL) {
    const checked = validateOllamaBaseUrl(updates.OLLAMA_BASE_URL);
    if ("error" in checked) {
      return apiError("invalid_field", { field: "OLLAMA_BASE_URL", message: ollamaUrlProblem(checked.error) });
    }
    updates.OLLAMA_BASE_URL = checked.url;
  }

  // Channel credentials take effect on the next webhook: the routes always
  // exist and read the store per request (lib/channel-runtime.ts). Hosted
  // tenants never get here with one (refused above); they connect through
  // the one-click flows, which register Meta routing themselves.
  await saveCredentials(updates);

  // A model key that just changed has to be re-checked against the provider on
  // the very next read: the catalog is cached for a minute, and a stale
  // "missing" right after a save is indistinguishable from a key that never
  // saved at all.
  if (Object.keys(updates).some((key) => MODEL_KEYS.has(key))) {
    invalidateProviderReports();
  }

  return NextResponse.json({ ok: true, ...(await settingsPayload()) });
});
