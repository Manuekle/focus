import { NextResponse, type NextRequest } from "next/server";
import { AI_PROVIDERS, resolveProvider, type AiProvider } from "@/lib/ai-provider";
import {
  AI_PROVIDERS as ALL_PROVIDERS,
  MODEL_TASKS,
  isLocalProvider,
  modelTier,
  pickForTask,
  recommendedIds,
} from "@/lib/model-catalog";
import { getProviderReport } from "@/lib/provider-catalog";
import { readAccess } from "@/lib/model-access";
import { readTaskOverrides, writeTaskOverride, type TaskPin } from "@/lib/model-tasks";
import { createTaskModelResolver } from "@/lib/task-model";
import { getCredentialSync, warmCredentialCache } from "@/lib/credentials";
import { providerConfigured } from "@/lib/provider-auth";
import { hasTypesafe } from "@/lib/typesafe";
import { apiError, withApiErrors } from "@/lib/api-error";

// GET  /api/models        — models the active provider can serve, plus key health
// POST /api/models        — same, but re-checked now; { probe: true } also
//                           spends one token to find out whether the account
//                           can actually pay.
// PUT  /api/models        — pin one task to a model, or hand it back to the
//                           automatic pick with `model: null`.

export const maxDuration = 60;

function requestedProvider(request: NextRequest | undefined): AiProvider {
  const raw = request ? new URL(request.url).searchParams.get("provider") : null;
  return AI_PROVIDERS.includes(raw as AiProvider) ? (raw as AiProvider) : resolveProvider();
}

async function report(probe: boolean, force: boolean, request?: NextRequest) {
  await warmCredentialCache();
  const provider = requestedProvider(request);
  const health = await getProviderReport(provider, { probe, force });
  const recommended = recommendedIds(provider);
  const restricted = health.restricted ?? (await readAccess()).restricted;
  const usable = health.models.filter((model) => !(model.id in restricted));
  const overrides = await readTaskOverrides(provider);
  // One pass, in parallel: each of these may consult a different provider's
  // catalogue when its task is pinned across providers.
  const resolve = await createTaskModelResolver(provider, { overrides, restricted });
  const resolved = await Promise.all(MODEL_TASKS.map(resolve));
  // The owner console also honors the legacy installation-wide chat model.
  // Its label and connection badge must describe the route Eve will call.
  const explicitChat = getCredentialSync("AI_MODEL")?.trim();
  const chat = explicitChat
    ? { provider, modelId: explicitChat }
    : resolved[MODEL_TASKS.indexOf("chat")];
  const chatHealth = chat.provider === provider ? health : await getProviderReport(chat.provider);


  return NextResponse.json({
    provider,
    chatDefault: {
      ...chat, status: chatHealth.status, detail: chatHealth.detail, balanceUsd: chatHealth.balanceUsd,
    },
    status: health.status,
    detail: health.detail,
    balanceUsd: health.balanceUsd,
    billingChecked: health.billingChecked,
    checkedAt: health.checkedAt,
    restricted,
    models: health.models.map((model) => ({
      ...model,
      tier: modelTier(model),
      // Tag-aware, for the same reason `pickForTask` is: a ranking lists
      // `llama3.2` and the machine reports `llama3.2:3b`. Matching only the
      // exact id left every local model unmarked, so the picker recommended
      // nothing on the one provider whose list is short enough to read.
      recommended: recommended.has(model.id) || recommended.has(model.id.split(":")[0]),
      // Surfaced rather than hidden: "you cannot use this and here is why"
      // beats a model quietly missing from the list.
      restrictedReason: restricted[model.id],
    })),
    // What the app picks on its own for each kind of work, so the UI can show
    // the automatic choice next to the manual one.
    tasks: Object.fromEntries(
      MODEL_TASKS.map((task) => [task, pickForTask(provider, task, usable)]),
    ),
    // Only the tasks somebody pinned. Sent apart from `tasks` rather than
    // folded into it: the picker has to tell "you chose this" from "we chose
    // this for you", and a merged map loses exactly that.
    taskOverrides: overrides,
    // What each task will *actually* run on, pins and fallbacks applied. The
    // two maps above say what was chosen; this one says what happens.
    taskResolved: Object.fromEntries(
      MODEL_TASKS.map((task, index) => [task, resolved[index]]),
    ),
    // A pin whose provider no longer serves it is reported rather than
    // silently ignored: `resolveTaskModel` already falls back, but a Settings
    // page that keeps showing a dead model as the choice is how it stays dead.
    staleOverrides: MODEL_TASKS.filter((task, index) => {
      const pin = overrides[task];
      return Boolean(pin) && resolved[index].modelId !== pin?.model;
    }),
    // The rail: every provider the app knows, and whether this install has
    // what it needs to call one. Status is deliberately absent — asking six
    // providers to prove themselves on every page load would make Settings
    // wait on the slowest of them. The picker asks for one when you open it.
    // Whether Jev can be asked anything. The triage row in Settings is fixed
    // — it is the only engine for that work and no dropdown can change it —
    // but "fixed" was being drawn as `jev-latest` whether or not the install
    // had a TypeSafe key, so an install where every triage silently returned
    // null looked exactly like one where it worked. The integration degrades
    // quietly on purpose (see lib/triage.ts); the card is where that silence
    // has to end.
    triageConfigured: await hasTypesafe(),
    providers: await Promise.all(
      ALL_PROVIDERS.map(async (id) => ({
        id,
        // Local providers have an address with a default, so there is nothing
        // to configure and they are always offerable.
        configured: isLocalProvider(id) || providerConfigured(id),
        local: isLocalProvider(id),
      })),
    ),
  });
}

export const GET = withApiErrors(async function GET(request: NextRequest) {
  return report(false, false, request);
});

export const POST = withApiErrors(async function POST(request: NextRequest) {
  let body: { probe?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // A bodyless POST is a plain refresh.
  }
  return report(body.probe === true, true, request);
});

export const PUT = withApiErrors(async function PUT(request: NextRequest) {
  let body: { task?: unknown; model?: unknown; provider?: unknown };
  try {
    body = (await request.json()) as { task?: unknown; model?: unknown; provider?: unknown };
  } catch {
    return apiError("invalid_json");
  }

  const task = body.task;
  if (typeof task !== "string" || !MODEL_TASKS.includes(task as (typeof MODEL_TASKS)[number])) {
    return apiError("invalid_field", { field: "task" });
  }

  // `null` is the meaningful value here, not a missing one: it is how the UI
  // says "stop pinning this and go back to deciding for me".
  const model = body.model;
  if (model === null) {
    await writeTaskOverride(task as (typeof MODEL_TASKS)[number], null);
    return report(false, false, request);
  }
  if (typeof model !== "string" || model.length === 0) {
    return apiError("invalid_field", { field: "model" });
  }

  // The provider rides with the model. Without it a pin would mean "this id,
  // on whatever provider is active later", which is how a cross-provider
  // choice quietly becomes a model id its new provider never heard of.
  const pinned = body.provider;
  if (!ALL_PROVIDERS.includes(pinned as (typeof ALL_PROVIDERS)[number])) {
    return apiError("invalid_field", { field: "provider" });
  }

  const pin: TaskPin = { provider: pinned as TaskPin["provider"], model };
  await writeTaskOverride(task as (typeof MODEL_TASKS)[number], pin);
  return report(false, false, request);
});
