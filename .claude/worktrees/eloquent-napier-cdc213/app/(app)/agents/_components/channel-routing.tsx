"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Alert } from "@/components/ui/alert";
import {
  WhatsappIcon,
  InstagramIcon,
  Globe02Icon,
  ArrowDown01Icon,
  CheckIcon,
  Loading03Icon,
  ShoppingBag01Icon,
  Calendar03Icon,
  CustomerSupportIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useT } from "@/lib/i18n/provider";
import { fetchJson } from "@/lib/api-error-message";
import { cn } from "@/lib/utils";
import { AGENT_SPECIALTIES } from "@/lib/agent-routing";
import type { Agent, AgentSpecialty, ChannelId } from "@/lib/types";
import { Card, CardDescription, CardHeader, CardTitle } from "../../../_components/dashboard-card";

// Which agent answers each channel.
//
// This is the switch that makes the capability picker matter: without an
// agent on the channel, an inbound WhatsApp message belongs to no agent, and
// "this agent may only take payments" has nothing to apply to. Per channel
// rather than per conversation so that a working setup costs one decision —
// point all three at the same agent and it behaves as a single agent.
//
// The control is the same searchable picker the capabilities and the model use
// next door, rather than a bare <Select>, for a reason beyond consistency: a
// Select renders *nothing at all* when its value matches none of its items,
// and that is exactly what a channel assigned to a since-deleted agent does.
// The card showed an empty box, and an empty box is indistinguishable from
// "unassigned" — while the runtime treats the two completely differently
// (`agentForSession` in lib/agent-scope.ts finds no agent and blocks action
// capabilities). The picker below names that state instead.

const UNASSIGNED = "__none__";

const CHANNEL_ICONS = {
  whatsapp: WhatsappIcon,
  instagram: InstagramIcon,
  web: Globe02Icon,
} as const;

const CHANNEL_LABELS: Record<ChannelId, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  web: "Web",
};

export function ChannelRouting({
  agents,
  onSaved,
}: {
  readonly agents: readonly Agent[];
  readonly onSaved?: () => void;
}) {
  const t = useT();
  const [channels, setChannels] = useState<ChannelId[]>([]);
  const [assignments, setAssignments] = useState<Partial<Record<ChannelId, string>>>({});
  const [saving, setSaving] = useState<ChannelId | null>(null);

  const load = useCallback(async () => {
    const result = await fetchJson<{
      channels: ChannelId[];
      assignments: Partial<Record<ChannelId, string>>;
    }>("/api/channels/agents", t);
    if (result.ok) {
      setChannels(result.data.channels);
      setAssignments(result.data.assignments);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const assign = async (channel: ChannelId, value: string) => {
    setSaving(channel);
    const agentId = value === UNASSIGNED ? null : value;
    const result = await fetchJson<{ assignments: Partial<Record<ChannelId, string>> }>(
      "/api/channels/agents",
      t,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel, agentId }),
      },
    );
    setSaving(null);
    if (result.ok) {
      setAssignments(result.data.assignments);
      onSaved?.();
    }
  };

  if (channels.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex-col gap-1">
        <CardTitle>{t("agents.routingTitle")}</CardTitle>
        <CardDescription>{t("agents.routingDesc")}</CardDescription>
      </CardHeader>

      <div className="grid gap-2 p-5 pt-0 @min-[560px]:grid-cols-2">
        {channels.map((channel) => (
          <AgentPicker
            agents={agents}
            assignedId={assignments[channel]}
            icon={CHANNEL_ICONS[channel]}
            key={channel}
            label={CHANNEL_LABELS[channel]}
            noneHint={t("agents.routingNoneHint")}
            noneLabel={t("agents.routingNone")}
            onAssign={(value) => void assign(channel, value)}
            pickDescription={t("agents.routingPickDescription", { channel: CHANNEL_LABELS[channel] })}
            pickTitle={t("agents.routingPick", { channel: CHANNEL_LABELS[channel] })}
            saving={saving === channel}
          />
        ))}
      </div>
    </Card>
  );
}

const SPECIALTY_ICONS: Record<AgentSpecialty, IconSvgElement> = {
  sales: ShoppingBag01Icon,
  booking: Calendar03Icon,
  support: CustomerSupportIcon,
};

/**
 * Which agent takes over each topic (lib/agent-routing.ts).
 *
 * Under the channels on purpose: the channel's agent opens every
 * conversation, and these are the hand-offs from it. Only active agents are
 * offered — a paused agent cannot take a conversation over, and the server
 * refuses it anyway. Saving answers with the whole agent list, because moving
 * a topic to one agent takes it off another.
 */
export function SpecialtyRouting({
  agents,
  onSaved,
}: {
  readonly agents: readonly Agent[];
  readonly onSaved?: () => void;
}) {
  const t = useT();
  const [saving, setSaving] = useState<AgentSpecialty | null>(null);
  const active = useMemo(() => agents.filter((agent) => agent.status === "active"), [agents]);

  const assign = async (specialty: AgentSpecialty, value: string) => {
    setSaving(specialty);
    const result = await fetchJson<{ agents: Agent[] }>("/api/agents/specialties", t, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ specialty, agentId: value === UNASSIGNED ? null : value }),
    });
    setSaving(null);
    if (result.ok) onSaved?.();
  };

  return (
    <Card>
      <CardHeader className="flex-col gap-1">
        <CardTitle>{t("agents.specialtyTitle")}</CardTitle>
        <CardDescription>{t("agents.specialtyDesc")}</CardDescription>
      </CardHeader>

      <div className="grid gap-2 p-5 pt-0 @min-[760px]:grid-cols-3">
        {AGENT_SPECIALTIES.map((specialty) => {
          const topic = t(`agents.specialty.${specialty}`);
          const holder = agents.find((agent) => agent.specialties?.includes(specialty));
          return (
            <div className="flex min-w-0 flex-col gap-1" key={specialty}>
              <AgentPicker
                agents={active}
                assignedId={holder?.id}
                icon={SPECIALTY_ICONS[specialty]}
                label={topic}
                noneHint={t("agents.specialtyNoneHint")}
                noneLabel={t("agents.specialtyNone")}
                onAssign={(value) => void assign(specialty, value)}
                pickDescription={t("agents.specialtyPickDescription", { topic: topic.toLowerCase() })}
                pickTitle={t("agents.specialtyPick", { topic: topic.toLowerCase() })}
                saving={saving === specialty}
              />
              <p className="px-1 text-[11px] text-muted-foreground">{t(`agents.specialtyHint.${specialty}`)}</p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/**
 * One row: who answers here — a channel, or a topic.
 *
 * Single-select, unlike the capability picker it is styled after — a channel
 * has exactly one agent, and pointing two at the same inbox is not a thing the
 * runtime can express; a topic likewise has one specialist. So this one closes
 * on a pick.
 */
function AgentPicker({
  agents,
  assignedId,
  icon,
  label,
  noneHint,
  noneLabel,
  onAssign,
  pickDescription,
  pickTitle,
  saving,
}: {
  readonly agents: readonly Agent[];
  readonly assignedId: string | undefined;
  readonly icon: IconSvgElement;
  readonly label: string;
  readonly noneHint: string;
  readonly noneLabel: string;
  readonly onAssign: (value: string) => void;
  readonly pickDescription: string;
  readonly pickTitle: string;
  readonly saving: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const assigned = useMemo(
    () => agents.find((agent) => agent.id === assignedId),
    [agents, assignedId],
  );
  /** Assigned to an agent that no longer exists. Worth naming: the channel
   *  reads as configured and behaves as unconfigured. */
  const dangling = Boolean(assignedId) && !assigned;

  const choose = (value: string) => {
    setOpen(false);
    if (value === (assignedId ?? UNASSIGNED)) return;
    onAssign(value);
  };

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          "border-border bg-card flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
          "hover:border-input hover:bg-accent/40 disabled:opacity-60",
        )}
        disabled={saving}
        onClick={() => setOpen(true)}
        type="button"
      >
        <HugeiconsIcon
          className="text-muted-foreground shrink-0"
          icon={icon}
          size={16}
          strokeWidth={1.75}
        />
        <span className="w-20 shrink-0 text-[13px] font-medium">{label}</span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[13px]",
            assigned ? "text-foreground"
            : dangling ? "text-amber-600 dark:text-amber-500"
            : "text-muted-foreground",
          )}
        >
          {assigned ? assigned.name : dangling ? t("agents.routingMissing") : noneLabel}
        </span>
        <HugeiconsIcon
          className={cn("shrink-0 text-muted-foreground", saving && "animate-spin")}
          icon={saving ? Loading03Icon : ArrowDown01Icon}
          size={14}
          strokeWidth={1.75}
        />
      </button>

      <CommandDialog
        className="[&_[data-slot=command]]:rounded-none [&_[data-slot=command]]:border-0 [&_[data-slot=command]]:bg-transparent [&_[data-slot=command]]:shadow-none [&_[data-slot=command-input-wrapper]]:mx-2 [&_[data-slot=command-input-wrapper]]:mt-1.5 [&_[data-slot=command-input-wrapper]]:h-10 [&_[data-slot=command-input-wrapper]]:rounded-lg [&_[data-slot=command-input-wrapper]]:border-0 [&_[data-slot=command-input-wrapper]]:bg-transparent [&_[data-slot=command-input-wrapper]]:px-0 [&_[cmdk-input]]:!h-10 [&_[cmdk-group]]:p-0 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2"
        closeClassName="top-3"
        description={pickDescription}
        onOpenChange={setOpen}
        open={open}
        title={pickTitle}
      >
        <CommandInput
          className="!h-10 rounded-lg border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          placeholder={t("agents.routingSearch")}
        />
        <CommandList className="mx-2 mb-2 max-h-[min(24rem,60vh)] py-[0.5em]">
          <CommandEmpty>{t("agents.routingNoneFound")}</CommandEmpty>
          <CommandGroup>
            <CommandItem onSelect={() => choose(UNASSIGNED)} value={noneLabel}>
              <AgentRow
                active={!assignedId}
                name={noneLabel}
                description={noneHint}
              />
            </CommandItem>
            {agents.map((agent) => (
              <CommandItem
                key={agent.id}
                onSelect={() => choose(agent.id)}
                value={`${agent.id} ${agent.name} ${agent.description ?? ""}`}
              >
                <AgentRow
                  active={agent.id === assignedId}
                  description={agent.description}
                  name={agent.name}
                />
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>

        {dangling ? (
          <Alert tone="warning" size="sm" role={null} className="mx-2 mb-2">
            {t("agents.routingMissingHelp")}
          </Alert>
        ) : null}
      </CommandDialog>
    </>
  );
}

/** One option in the dialog. Same shape as the capability rows next door, with
 *  one deliberate difference: the marker is round, not square. A square box
 *  promises you can tick several, and here you cannot — a channel has exactly
 *  one agent, so the control says so before you click it. */
function AgentRow({
  active,
  description,
  name,
}: {
  readonly active: boolean;
  readonly description?: string;
  readonly name: string;
}) {
  return (
    <>
      {/* Same `!` as the capability picker, and for the same reason: cmdk's
          wrappers size every svg inside an item, so an 11px tick renders at
          16px and fills its own box edge to edge. */}
      <span
        aria-hidden
        className={cn(
          "mt-px flex size-4 shrink-0 items-center justify-center self-start rounded-full border transition-colors",
          active ? "border-primary bg-primary text-primary-foreground" : "border-border",
        )}
      >
        {active ? (
          <HugeiconsIcon
            className="size-[11px]! text-primary-foreground"
            icon={CheckIcon}
            size={11}
            strokeWidth={2.5}
          />
        ) : null}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 leading-tight">
        <span className="text-[13px] font-medium">{name}</span>
        {description ? (
          <span className="text-muted-foreground line-clamp-2 text-[11px] leading-snug">
            {description}
          </span>
        ) : null}
      </span>
    </>
  );
}
