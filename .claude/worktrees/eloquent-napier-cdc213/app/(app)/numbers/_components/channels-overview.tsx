"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Comment01Icon, InstagramIcon, WhatsappIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Card } from "../../../_components/dashboard-card";
import { ChannelDisconnectButton } from "@/components/connections/channel-disconnect-button";
import { ConnectionPill } from "@/components/connections/connection-pill";
import { ConnectButton } from "@/components/connections/connect-button";
import { useT } from "@/lib/i18n/provider";
import { fetchJson } from "@/lib/api-error-message";
import type { HostedChannelState } from "@/lib/hosted-channels";
import { HostedActivationPanel } from "./hosted-activation-panel";

// The messaging channels this install has, as cards that stay on the page.
//
// The numbers list is phone lines, and Instagram is not one: before this, a
// connected Instagram left the page saying "no numbers yet" with a
// "Connect Instagram" button, so the owner reconnected to find out whether it
// worked (on a hosted tenant, a rebuild each time). Each card says which
// account the channel is, whether it receives messages, and who answers; a
// hosted channel still registering shows its progress inside its card, and
// every card can disconnect its channel (owner only, no rebuild).

export type Channel = "whatsapp" | "instagram";

export type ChannelRow = {
  readonly id: Channel;
  readonly connected: boolean;
  readonly missing: readonly string[];
  readonly hosted?: HostedChannelState;
  readonly account?: string;
};

type StatusResponse = { channels?: Array<ChannelRow | { id: "web" }> };

const isChannel = (row: { id: string }): row is ChannelRow => row.id === "whatsapp" || row.id === "instagram";

/** Channel rows from /api/channels/status; re-read whenever `refreshKey` changes. */
export function useChannelStatus(refreshKey: number) {
  const t = useT();
  const [rows, setRows] = useState<readonly ChannelRow[] | null>(null);
  const [assignments, setAssignments] = useState<Partial<Record<Channel, string>>>({});
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchJson<StatusResponse>("/api/channels/status", t),
      fetchJson<{ assignments?: Partial<Record<Channel, string>> }>("/api/channels/agents", t),
    ]).then(([status, agents]) => {
      if (cancelled) return;
      // A failed first read settles to "no channels" rather than staying
      // unknown: the numbers page waits on this before it leaves its skeleton.
      if (status.ok) setRows((status.data.channels ?? []).filter(isChannel));
      else setRows((current) => current ?? []);
      if (agents.ok) setAssignments(agents.data.assignments ?? {});
    });
    return () => {
      cancelled = true;
    };
  }, [t, refreshKey, reloads]);

  const reload = useCallback(() => setReloads((count) => count + 1), []);
  return { rows, assignments, reload };
}

/** Whether a channel needs a card: live, or a hosted channel on its way there. */
export function showsCard(row: ChannelRow): boolean {
  if (row.connected) return true;
  const state = row.hosted?.state;
  return Boolean(state && state !== "disconnected");
}

export function ChannelsOverview({
  rows,
  assignments,
  agentName,
  onManage,
  onActivated,
  onDisconnected,
  connectable,
  onConnect,
}: {
  readonly rows: readonly ChannelRow[] | null;
  readonly assignments: Partial<Record<Channel, string>>;
  readonly agentName: (id: string | null) => string | null;
  readonly onManage: (channel: Channel) => void;
  readonly onActivated: () => void;
  /** A channel was disconnected: re-read the channel state. */
  readonly onDisconnected: () => void;
  /** Channels this install offers: one not connected yet gets a compact card to connect it. */
  readonly connectable?: readonly Channel[];
  readonly onConnect?: (channel: Channel) => void;
}) {
  const t = useT();
  const visible = (rows ?? []).filter(showsCard);
  if (visible.length === 0) return null;
  const missing = (connectable ?? []).filter((id) => !visible.some((row) => row.id === id));

  return (
    <section className="mb-6 space-y-3" aria-labelledby="channels-heading">
      <h2 id="channels-heading" className="text-sm font-medium text-foreground">
        {t("numbers.channelsTitle")}
      </h2>
      {/* Two channels side by side: stacked at full width, two short rows
          took the whole page and said nothing more. */}
      <div className="grid gap-3 md:grid-cols-2">
      {visible.map((row) => {
        const live = row.connected;
        const pending = !live && row.hosted && row.hosted.state !== "connected";
        const agent = agentName(assignments[row.id] ?? null);
        const name = row.id === "whatsapp" ? "WhatsApp" : "Instagram";
        return (
          <Card key={row.id} className="flex flex-col gap-4 p-4 sm:p-5">
            <div className="flex flex-col gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/40">
                  <HugeiconsIcon icon={row.id === "whatsapp" ? WhatsappIcon : InstagramIcon} size={18} strokeWidth={1.75} />
                </span>
                <div className="min-w-0 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-foreground">
                    <span>{name}</span>
                    {row.account ? (
                      <span className="truncate font-normal text-muted-foreground">{row.account}</span>
                    ) : null}
                  </p>
                  {live ? (
                    agent ? (
                      <p className="text-xs text-muted-foreground">{t("numbers.channelAnsweredBy", { agent })}</p>
                    ) : (
                      <p className="text-xs text-[var(--status-pending-fg)]">
                        {t("numbers.channelNoAgent")}{" "}
                        <Link href="/agents" className="font-medium underline underline-offset-2">
                          {t("numbers.channelAssignAgent")}
                        </Link>
                      </p>
                    )
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill row={row} />
                <Button type="button" variant="outline" size="sm" onClick={() => onManage(row.id)}>
                  {t("numbers.channelManage")}
                </Button>
                <ChannelDisconnectButton channel={row.id} onDisconnected={onDisconnected} />
              </div>
            </div>
            {live && row.id === "instagram" ? (
              <Link
                href="/automations?tab=instagram"
                className="mt-auto flex items-center gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <HugeiconsIcon icon={Comment01Icon} size={14} strokeWidth={1.75} className="shrink-0" />
                <span className="min-w-0 flex-1">{t("numbers.igCommentAutomations")}</span>
              </Link>
            ) : null}
            {pending && row.hosted ? (
              <HostedActivationPanel channel={row.id} initial={row.hosted} onConnected={onActivated} />
            ) : null}
          </Card>
        );
      })}
      {missing.map((id) => (
        <Card key={id} className="flex flex-col items-center justify-center gap-3 border-dashed p-4 text-center sm:p-5">
          <div className="flex flex-col items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/40 text-muted-foreground">
              <HugeiconsIcon icon={id === "whatsapp" ? WhatsappIcon : InstagramIcon} size={18} strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{id === "whatsapp" ? "WhatsApp" : "Instagram"}</p>
              <p className="text-xs text-muted-foreground">{t("numbers.channelNotConnected")}</p>
            </div>
          </div>
          {onConnect ? (
            <ConnectButton tone={id} size="sm" onClick={() => onConnect(id)}>
              {t(id === "whatsapp" ? "numbers.metaConnect" : "numbers.igConnect")}
            </ConnectButton>
          ) : null}
        </Card>
      ))}
      </div>
    </section>
  );
}

function StatusPill({ row }: { readonly row: ChannelRow }) {
  const t = useT();
  const state = row.hosted?.state;
  if (row.connected) return <ConnectionPill tone="live">{t("numbers.channelLive")}</ConnectionPill>;
  if (state === "registering") {
    return <ConnectionPill tone="pending">{t("numbers.channelActivating")}</ConnectionPill>;
  }
  return <ConnectionPill tone="attention">{t("numbers.channelAttention")}</ConnectionPill>;
}
