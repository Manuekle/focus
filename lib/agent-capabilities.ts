// What an agent is allowed to do, expressed as things a business owner
// recognises rather than as the names of files in agent/tools/.
//
// The unit here is a *capability*, not a tool. "Cobrar" is one line in the
// picker and two tools underneath; "Agenda" is one line and one tool. Nobody
// configuring a receptionist should have to know that sending a saved photo
// and sending a generated one are different modules — and tying the picker to
// module names would break every saved agent the day a tool is split in two.
//
// Three separate things are kept apart on purpose:
//
//   `tools`        which Eve tools the capability unlocks. The runtime guard
//                  in lib/agent-scope.ts reads this and nothing else.
//   `credentials`  what has to be configured in Settings for the capability
//                  to do anything. Purely for the UI, which greys out a
//                  capability whose integration is missing instead of letting
//                  someone pick a payment link with no Stripe key.
//   `connections`  the same question answered from the Connections page, for
//                  integrations reachable either way. Also UI-only.
//   `i18n`         label and description keys.
//
// A capability with no `credentials` works on a bare installation.

type CredentialKey = string;
type ConnectionId = string;

export type CapabilityId =
  | "contacts"
  | "deals"
  | "handoff"
  | "knowledge"
  | "media"
  | "calendar"
  | "sheets"
  | "reminders"
  | "payments"
  | "shopify"
  | "http"
  | "automations"
  | "code";

/** UI category hues, aligned with matching workflow actions. */
export const CAPABILITY_HUES: Record<CapabilityId, number> = {
  contacts: 65,
  deals: 65,
  handoff: 65,
  knowledge: 250,
  media: 295,
  calendar: 220,
  sheets: 165,
  reminders: 345,
  payments: 295,
  shopify: 165,
  http: 220,
  automations: 295,
  code: 220,
};

export type Capability = {
  readonly id: CapabilityId;
  readonly labelKey: string;
  readonly descriptionKey: string;
  /** Eve tool names (the file slug in agent/tools/) this unlocks. */
  readonly tools: readonly string[];
  /**
   * Credentials that make this capability real. Any one of them counts —
   * payments works on Stripe *or* Mercado Pago, and demanding both would grey
   * out a perfectly good Latin American installation.
   */
  readonly credentials?: readonly CredentialKey[];
  /**
   * Accounts connected on the Connections page that make this capability real,
   * counted the same way `credentials` is: any one of them is enough. Some
   * integrations can be set up either way, and a capability that only looked
   * at Settings greyed itself out for an install that had done the newer,
   * easier half of the setup — see the calendar entry below.
   */
  readonly connections?: readonly ConnectionId[];
  /** Off unless explicitly chosen, and marked in the UI. The sandbox runs
   *  arbitrary code: fine for an internal analyst, not for the agent that
   *  answers strangers on WhatsApp. */
  readonly sensitive?: boolean;
};

export const CAPABILITIES: readonly Capability[] = [
  {
    id: "contacts",
    labelKey: "capability.contacts",
    descriptionKey: "capability.contactsDesc",
    tools: ["upsert_contact", "update_contact"],
  },
  {
    id: "deals",
    labelKey: "capability.deals",
    descriptionKey: "capability.dealsDesc",
    // `pipeline` rides along with `deal` rather than adding a line to the
    // picker: an owner who granted "Oportunidades" meant the pipeline, and a
    // second checkbox for reading what the first one writes is a distinction
    // only this codebase cares about. The tool refuses on customer channels
    // regardless of capability — see agent/tools/pipeline.ts.
    tools: ["deal", "pipeline"],
  },
  {
    id: "handoff",
    labelKey: "capability.handoff",
    descriptionKey: "capability.handoffDesc",
    tools: ["transfer_human", "request_approval"],
  },
  {
    id: "knowledge",
    labelKey: "capability.knowledge",
    descriptionKey: "capability.knowledgeDesc",
    tools: ["search_knowledge"],
  },
  {
    id: "media",
    labelKey: "capability.media",
    descriptionKey: "capability.mediaDesc",
    tools: ["find_media", "send_media", "send_stored_media", "generate_media"],
  },
  {
    id: "calendar",
    labelKey: "capability.calendar",
    descriptionKey: "capability.calendarDesc",
    tools: ["calendar"],
    // Two ways in, and the connected account is the one people actually use:
    // it covers Calendar without a service account key or a calendar id, so
    // listing only those two credentials made a working setup read "not
    // configured" — see getGoogleToken in lib/google-auth.ts, where the
    // connection wins over the service account.
    credentials: ["GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_CALENDAR_ID"],
    connections: ["google"],
  },
  {
    id: "sheets",
    labelKey: "capability.sheets",
    descriptionKey: "capability.sheetsDesc",
    tools: ["log_to_sheet"],
    // Same two-path story as calendar: a connected account or the service
    // account both work, see getGoogleToken in lib/google-auth.ts.
    credentials: ["GOOGLE_SERVICE_ACCOUNT_JSON"],
    connections: ["google"],
  },
  {
    id: "reminders",
    labelKey: "capability.reminders",
    descriptionKey: "capability.remindersDesc",
    tools: ["reminder"],
  },
  {
    id: "payments",
    labelKey: "capability.payments",
    descriptionKey: "capability.paymentsDesc",
    tools: ["send_payment_link", "payment_status"],
    credentials: ["STRIPE_SECRET_KEY", "MERCADOPAGO_ACCESS_TOKEN"],
  },
  {
    id: "shopify",
    labelKey: "capability.shopify",
    descriptionKey: "capability.shopifyDesc",
    tools: ["shopify_orders", "shopify_products", "shopify_checkout"],
    credentials: ["SHOPIFY_ADMIN_ACCESS_TOKEN"],
  },
  {
    id: "http",
    labelKey: "capability.http",
    descriptionKey: "capability.httpDesc",
    tools: ["http_request"],
  },
  {
    id: "automations",
    labelKey: "capability.automations",
    descriptionKey: "capability.automationsDesc",
    tools: ["list_automations", "propose_automation", "propose_automation_update"],
  },
  {
    id: "code",
    labelKey: "capability.code",
    descriptionKey: "capability.codeDesc",
    tools: ["run_python"],
    sensitive: true,
  },
];

const BY_TOOL = new Map<string, CapabilityId>(
  CAPABILITIES.flatMap((capability) =>
    capability.tools.map((tool) => [tool, capability.id] as const),
  ),
);

/** The capability a tool belongs to, or `undefined` for a tool no capability
 *  gates — those stay available to every agent. */
export function capabilityForTool(toolName: string): CapabilityId | undefined {
  // Runtime MCP servers produce one dynamic tool per connection. Their slug
  // is not known at build time, but invoking them is the same external-system
  // authority as the generic HTTP tool and must never bypass that grant.
  if (toolName.startsWith("mcp_")) return "http";
  return BY_TOOL.get(toolName);
}

export function isCapabilityId(value: unknown): value is CapabilityId {
  return typeof value === "string" && CAPABILITIES.some((c) => c.id === value);
}

export function getCapability(id: CapabilityId): Capability {
  const found = CAPABILITIES.find((capability) => capability.id === id);
  if (!found) throw new Error(`Unknown capability: ${id}`);
  return found;
}

/**
 * What a saved agent's `tools` field means.
 *
 * The field predates this catalog and held whatever someone typed into a
 * comma-separated box — usually a tool name ("calendar", "upsert_contact"),
 * sometimes a capability id, sometimes prose. Reading it through this keeps
 * every agent saved before today working: a stored tool name resolves to the
 * capability that now owns it, and anything unrecognised is dropped rather
 * than silently granting or denying something.
 */
export function toCapabilityIds(stored: readonly string[]): CapabilityId[] {
  const ids = new Set<CapabilityId>();
  for (const entry of stored) {
    const value = entry.trim().toLowerCase();
    if (!value) continue;
    if (isCapabilityId(value)) {
      ids.add(value);
      continue;
    }
    const fromTool = capabilityForTool(value);
    if (fromTool) ids.add(fromTool);
  }
  return [...ids];
}
