import { NextResponse, type NextRequest } from "next/server";
import { getBusinessIdentity, saveBusinessIdentity } from "@/lib/business-profile-store";
import { getCredential, saveCredentials } from "@/lib/credentials";
import { isOwnerRequest } from "@/lib/owner-gate";
import {
  CALL_VOLUMES,
  CONTACT_CHANNELS,
  CRMS,
  GOALS,
  INDUSTRIES,
  MAX_DESCRIPTION_CHARS,
  MESSAGE_VOLUMES,
  markOnboardingActionStarted,
  ONBOARDING_ACTION_IDS,
  RESPONSE_TIMES,
  TEAM_SIZES,
  crmHost,
  getProfile,
  isSettled,
  saveProfile,
  skip,
} from "@/lib/onboarding/store";
import { MODULE_IDS } from "@/lib/modules";
import { saveEnabledModules } from "@/lib/modules-store";

/** Whether to show the flow, and the answers if it has already been done. */
export async function GET() {
  return NextResponse.json({ profile: await getProfile(), settled: await isSettled() });
}

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === "string" && allowed.includes(value as T);

/** A skipped optional answer arrives as "" or not at all; both mean skipped. */
const optionalOneOf = (value: unknown, allowed: readonly string[]) =>
  value === undefined || value === "" || oneOf(value, allowed);

const optionalListOf = (value: unknown, allowed: readonly string[]) =>
  value === undefined || (Array.isArray(value) && value.every((item) => oneOf(item, allowed)));

const optionalText = (value: unknown) => value === undefined || typeof value === "string";

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const list = (value: unknown): string[] => (Array.isArray(value) ? [...new Set(value as string[])] : []);

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  if (body?.skip === true) {
    await skip();
    return NextResponse.json({ ok: true });
  }

  if (body?.action === "started") {
    if (!oneOf(body.actionId, ONBOARDING_ACTION_IDS)) {
      return NextResponse.json({ error: "invalid_action" }, { status: 400 });
    }
    if (!(await getProfile())) {
      return NextResponse.json({ error: "profile_required" }, { status: 409 });
    }
    await markOnboardingActionStarted(body.actionId);
    return NextResponse.json({ ok: true });
  }

  // Validated here rather than trusted from the form: this route is reachable
  // by anything holding a session, and a stored value outside these sets would
  // resurface as an unknown translation key wherever the profile is drawn. The
  // failing field is named so a client can say which answer to fix.
  const checks: readonly [string, boolean][] = [
    ["businessName", typeof body?.businessName === "string" && body.businessName.trim().length > 0],
    ["industry", oneOf(body?.industry, INDUSTRIES)],
    ["description", optionalText(body?.description)],
    ["channels", optionalListOf(body?.channels, CONTACT_CHANNELS)],
    ["messageVolume", optionalOneOf(body?.messageVolume, MESSAGE_VOLUMES)],
    ["callVolume", optionalOneOf(body?.callVolume, CALL_VOLUMES)],
    ["teamSize", optionalOneOf(body?.teamSize, TEAM_SIZES)],
    ["responseTime", optionalOneOf(body?.responseTime, RESPONSE_TIMES)],
    ["goals", optionalListOf(body?.goals, GOALS)],
    ["crm", optionalOneOf(body?.crm, CRMS.map((crm) => crm.id))],
    ["modules", optionalListOf(body?.modules, MODULE_IDS)],
  ];
  const invalid = checks.find(([, valid]) => !valid);
  if (!body || invalid) {
    return NextResponse.json({ error: "invalid", field: invalid?.[0] ?? null }, { status: 400 });
  }

  const businessName = text(body.businessName).slice(0, 120);
  const description = text(body.description).replace(/\s+/g, " ").slice(0, MAX_DESCRIPTION_CHARS);
  const channels = list(body.channels);

  await saveProfile({
    activation: { startedActionIds: [] },
    businessName,
    industry: body.industry as string,
    description,
    channels,
    messageVolume: text(body.messageVolume),
    // A call count only means something while the phone is one of the channels.
    callVolume: channels.includes("phone") ? text(body.callVolume) : "",
    teamSize: text(body.teamSize),
    responseTime: text(body.responseTime),
    goals: list(body.goals),
    crm: text(body.crm),
    modules: list(body.modules),
  });

  // The menu the owner asked for. Only when the form sent the question at
  // all: a client from before modules leaves the menu whole rather than
  // emptying it.
  if (Array.isArray(body.modules)) await saveEnabledModules(list(body.modules));

  // The name and the one-line description are what the agent introduces the
  // business with (agent/instructions/business-profile.ts), so they seed the
  // identity — but only where it is still blank. Whatever the owner typed on
  // the Knowledge page, or a later pass through this flow, wins over it.
  // Best-effort: the profile is saved either way, and the identity can always
  // be filled in by hand.
  await seedIdentity(businessName, description).catch(() => undefined);

  // The one answer that changes the machine. `http_request` refuses any host
  // that is not on this list, so picking a CRM here saves the owner finding
  // its API hostname themselves later. The profile is per business, but the
  // allowlist is installation-wide, so only the owner's answer widens it —
  // anyone else's onboarding still saves, and leaves the list alone.
  const host = crmHost(text(body.crm));
  if (host && (await isOwnerRequest(request))) {
    const current = (await getCredential("HTTP_ALLOWLIST")) ?? "";
    const hosts = current.split(",").map((entry) => entry.trim()).filter(Boolean);
    if (!hosts.includes(host)) {
      await saveCredentials({ HTTP_ALLOWLIST: [...hosts, host].join(", ") });
    }
  }

  return NextResponse.json({ ok: true });
}

async function seedIdentity(name: string, description: string): Promise<void> {
  const identity = await getBusinessIdentity();
  const patch: { name?: string; description?: string } = {};
  if (!identity.name.trim()) patch.name = name;
  if (description && !identity.description.trim()) patch.description = description;
  if (patch.name !== undefined || patch.description !== undefined) await saveBusinessIdentity(patch);
}
