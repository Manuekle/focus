import {
  createAgent,
  deleteAgent,
  getAgent,
  listAgents,
  toggleAgentStatus,
  updateAgent,
} from "@/lib/business-store";
import type { Agent, AgentBrief, AgentStatus } from "@/lib/types";
import { composePrompt, normalizeBrief, shouldRecompose } from "@/lib/agent-brief";
import { specialtiesOf } from "@/lib/agent-routing";
import { resolveProvider } from "@/lib/ai-provider";
import { listModels } from "@/lib/provider-catalog";
import { readAccess } from "@/lib/model-access";
import { deleteVoiceAgent, syncVoiceAgent } from "@/lib/elevenlabs-agents";
import { unassignNumbersForAgent } from "@/lib/number-store";
import { type NextRequest, NextResponse } from "next/server";
import { apiError, apiFailure, missingField, withApiErrors } from "@/lib/api-error";

/**
 * Accept a model only when the configured provider actually serves it.
 * Storing an id the provider does not have would fail much later, at the
 * agent's first run, with nothing pointing back here.
 *
 * Returns the id to store, or an error message to reject with. An empty
 * catalog (provider unreachable) is treated as "cannot disprove" and lets the
 * value through rather than blocking edits while the network is down.
 */
async function validateModel(model: unknown): Promise<{ value: string | null } | { error: string }> {
  if (model === undefined || model === null || model === "") return { value: null };
  if (typeof model !== "string") return { error: "model must be a string" };

  const provider = resolveProvider();
  const available = await listModels(provider);
  if (available.length > 0 && !available.some((entry) => entry.id === model)) {
    return { error: `El proveedor ${provider} no ofrece el modelo ${model}.` };
  }

  // Offered is not the same as allowed: a plan can list a model it will
  // refuse to run. The probe in Settings is what fills this in.
  const { restricted } = await readAccess();
  if (restricted[model]) return { error: restricted[model] };

  return { value: model };
}

/**
 * The builder saves a brief, not a prompt. Composing here rather than in the
 * browser is what keeps the two in step: the voice mirror, the templates and
 * the assistant all write through this route, and a prompt composed in one
 * client would drift from one composed in another.
 *
 * A prompt the owner has edited by hand is never recomposed — `promptCustomized`
 * on the brief says so, and the builder sets it the moment the textarea is
 * touched.
 */
function promptFor(
  brief: AgentBrief,
  explicitPrompt: string | undefined,
  previous: string,
  locale: unknown,
): string {
  if (explicitPrompt !== undefined) return explicitPrompt;
  if (!shouldRecompose(brief)) return previous;
  const composed = composePrompt(brief, { locale: locale === "en" ? "en" : "es" });
  return composed.trim().length > 0 ? composed : previous;
}

function readBrief(value: unknown): AgentBrief | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") return undefined;
  return normalizeBrief(value as Partial<AgentBrief>);
}

const AGENT_STATUSES: readonly AgentStatus[] = ["active", "inactive", "draft"];

async function removeVoiceRuntime(agent: Agent): Promise<void> {
  const mirrorId = agent.voice?.elevenlabsAgentId;
  if (!mirrorId) return;
  try {
    await deleteVoiceAgent(mirrorId, agent.voice?.toolIds);
  } catch (error) {
    // Local policy is authoritative and must still turn the agent off. A
    // stale upstream mirror cannot invoke our tools because the webhook also
    // checks active status, but this warning preserves the cleanup failure.
    console.warn(`[agents] could not remove voice mirror ${mirrorId}:`, error);
  }
}

export const GET = withApiErrors(async function GET() {
  const agents = await listAgents();
  return NextResponse.json({ agents });
});

export const POST = withApiErrors(async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  if (!body || typeof body !== "object") {
    return apiError("invalid_body");
  }
  const input = body as {
    name?: string;
    description?: string;
    systemPrompt?: string;
    tools?: string[];
    iconKey?: string;
    model?: unknown;
    brief?: unknown;
    status?: unknown;
    locale?: unknown;
    specialties?: unknown;
  };
  if (!input.name?.trim()) {
    return missingField("name");
  }
  const model = await validateModel(input.model);
  if ("error" in model) {
    return apiError("model_unavailable", { detail: model.error });
  }
  const brief = readBrief(input.brief);
  const status = AGENT_STATUSES.includes(input.status as AgentStatus)
    ? (input.status as AgentStatus)
    : undefined;
  const agent = await createAgent({
    name: input.name.trim(),
    description: input.description?.trim() ?? "",
    systemPrompt: brief
      ? promptFor(brief, input.systemPrompt?.trim(), "", input.locale)
      : (input.systemPrompt?.trim() ?? ""),
    tools: input.tools ?? [],
    ...(input.iconKey ? { iconKey: input.iconKey } : {}),
    model: model.value,
    ...(brief ? { brief } : {}),
    ...(status ? { status } : {}),
    ...(specialtiesOf(input.specialties).length ? { specialties: specialtiesOf(input.specialties) } : {}),
  });
  return NextResponse.json({ ok: true, agent });
});

export const PUT = withApiErrors(async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  if (!body || typeof body !== "object") {
    return apiError("invalid_body");
  }
  const input = body as {
    agentId?: string;
    name?: string;
    description?: string;
    systemPrompt?: string;
    tools?: string[];
    model?: unknown;
    status?: Agent["status"];
    toggleStatus?: boolean;
    brief?: unknown;
    locale?: unknown;
    specialties?: unknown;
  };
  if (!input.agentId) {
    return missingField("agentId");
  }
  const existing = await getAgent(input.agentId);
  if (!existing) return apiError("not_found");

  if (input.toggleStatus) {
    const toggled = await toggleAgentStatus(input.agentId);
    if (!toggled) return apiError("not_found");
    if (toggled.status !== "active") {
      await unassignNumbersForAgent(input.agentId);
      await removeVoiceRuntime(existing);
    }
    return NextResponse.json({ ok: true, agent: toggled });
  }

  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.description !== undefined) updates.description = input.description.trim();
  if (input.tools !== undefined) updates.tools = input.tools;
  // Unknown values are dropped rather than refused: the list only ever widens
  // which conversations reach this agent, and a stale client should not lose
  // the rest of its save over one.
  if (input.specialties !== undefined) updates.specialties = specialtiesOf(input.specialties);
  if (input.brief !== undefined) {
    const brief = readBrief(input.brief);
    if (!brief) return apiError("invalid_body", { detail: "brief must be an object" });
    updates.brief = brief;
    // The prompt follows the brief unless this same request carries one, or
    // the owner has taken the prompt over by hand.
    updates.systemPrompt = promptFor(
      brief,
      input.systemPrompt?.trim(),
      existing.systemPrompt,
      input.locale,
    );
  } else if (input.systemPrompt !== undefined) {
    updates.systemPrompt = input.systemPrompt.trim();
  }
  if (input.model !== undefined) {
    const model = await validateModel(input.model);
    if ("error" in model) {
      return apiError("model_unavailable", { detail: model.error });
    }
    updates.model = model.value;
  }
  if (input.status !== undefined) {
    if (!AGENT_STATUSES.includes(input.status)) {
      return apiError("invalid_field", { field: "status" });
    }
    updates.status = input.status;
  }

  // A provider-owned live-transfer tool cannot consult our webhook gate.
  // Propagate capability changes before claiming they have been saved.
  if (input.tools !== undefined && existing.voice?.enabled && existing.voice.elevenlabsAgentId &&
    existing.voice.transferPhoneNumber && (updates.status ?? existing.status) === "active") {
    try {
      updates.voice = await syncVoiceAgent({ ...existing, ...updates } as Agent, existing.voice);
    } catch (error) {
      return apiFailure(error, "upstream_failed");
    }
  }
  const updated = await updateAgent(input.agentId, updates as Partial<Omit<Agent, "id" | "createdAt">>);
  if (!updated) {
    return apiError("not_found");
  }
  if (updated.status !== "active") {
    await unassignNumbersForAgent(input.agentId);
    await removeVoiceRuntime(existing);
  }
  return NextResponse.json({ ok: true, agent: updated });
});

export const DELETE = withApiErrors(async function DELETE(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get("agentId");
  if (!agentId) {
    return missingField("agentId");
  }
  const existing = await getAgent(agentId);
  if (!existing) return apiError("not_found");
  const deleted = await deleteAgent(agentId);
  if (!deleted) {
    return apiError("not_found");
  }
  await unassignNumbersForAgent(agentId);
  await removeVoiceRuntime(existing);
  return NextResponse.json({ ok: true });
});
