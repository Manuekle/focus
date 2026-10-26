"use client";

import "../product.css";
import { NumbersSkeleton } from "./page-skeleton";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  Delete01Icon,
  PencilEdit01Icon,
  SmartPhone01Icon,
  AlertCircleIcon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { PageContainer } from "../../_components/page-container";
import { Card } from "../../_components/dashboard-card";
import { KpiCard } from "../../_components/kpi-card";
import { CardCarousel } from "../../_components/card-carousel";
import { SkeletonBar } from "@/components/ai-elements/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast-provider";
import { useT } from "@/lib/i18n/provider";
import { fetchJson, uiErrorMessage, type UiError } from "@/lib/api-error-message";
import { ErrorBanner } from "@/components/ui/error-banner";
import { formatE164 } from "@/lib/phone-format";
import type { Agent, PhoneNumber } from "@/lib/types";
import { cn } from "@/lib/utils";
import { NewNumberMenu, TelephonyPanel, type TelephonyMode } from "./_components/telephony-panel";
import { NumberDialog, type NumberDraft } from "./_components/number-dialog";
import { WhatsAppConnect } from "./_components/whatsapp-connect";
import { InstagramConnect } from "./_components/instagram-connect";
import { ChannelsOverview, showsCard, useChannelStatus } from "./_components/channels-overview";
import { ConnectButton } from "@/components/connections/connect-button";

// One agent may answer several business lines and channels. A line has one
// assigned agent; sharing an agent between WhatsApp and voice is intentional.

const CAPABILITY_LABEL: Record<string, string> = {
  whatsapp: "numbers.capWhatsapp",
  sms: "numbers.capSms",
  voice: "numbers.capVoice",
  instagram: "numbers.capInstagram",
};

export default function NumbersPage() {
  const t = useT();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [telephonyMode, setTelephonyMode] = useState<TelephonyMode>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [igConnectOpen, setIgConnectOpen] = useState(false);
  /** Bumped when a drawer closes, so the hosted activation status re-reads. */
  const [channelsKey, setChannelsKey] = useState(0);
  const channels = useChannelStatus(channelsKey);
  /** A channel with a card is managed from it; only the others offer "Connect". */
  const offers = (id: "whatsapp" | "instagram") => {
    const row = channels.rows?.find((entry) => entry.id === id);
    return !row || !showsCard(row);
  };
  /** With a channel card on screen, the missing channel gets its own card there, not a header button. */
  const hasChannelCards = Boolean(channels.rows?.some(showsCard));
  const [editing, setEditing] = useState<PhoneNumber | null>(null);
  const [error, setError] = useState<UiError | null>(null);

  const load = useCallback(async () => {
    const [numbersResult, agentsResult] = await Promise.all([
      fetchJson<{ numbers?: PhoneNumber[] }>("/api/numbers", t),
      fetchJson<{ agents?: Agent[] }>("/api/agents", t),
    ]);
    if (numbersResult.ok) {
      setNumbers(numbersResult.data.numbers ?? []);
      setError(null);
    } else {
      setError(numbersResult.error);
    }
    if (agentsResult.ok) setAgents(agentsResult.data.agents ?? []);
  }, [t]);

  useEffect(() => {
    void load().finally(() => setIsLoading(false));
  }, [load]);

  const agentName = useCallback(
    (id: string | null) =>
      id ? (agents.find((a) => a.id === id)?.name ?? t("numbers.holderDeleted")) : null,
    [agents, t],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return numbers;
    return numbers.filter(
      (number) =>
        number.e164.toLowerCase().includes(needle) ||
        number.label.toLowerCase().includes(needle) ||
        (agentName(number.agentId) ?? "").toLowerCase().includes(needle),
    );
  }, [numbers, search, agentName]);

  const assignedCount = numbers.filter((number) => number.agentId).length;
  const unassignedCount = numbers.length - assignedCount;
  /** KPIs and search only earn their space once there are more lines than fit in a glance. */
  const manyNumbers = numbers.length > 3;

  const save = useCallback(
    async (draft: NumberDraft): Promise<boolean> => {
      setSaving(true);
      const body = editing ? { id: editing.id, ...draft } : draft;
      const result = await fetchJson<{ number?: PhoneNumber }>("/api/numbers", t, {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setSaving(false);
      if (!result.ok) {
        toast({ title: uiErrorMessage(t, result.error), status: "error" });
        return false;
      }
      await load();
      toast({ title: editing ? t("numbers.updated") : t("numbers.created"), status: "success" });
      return true;
    },
    [editing, load, t, toast],
  );

  const assign = useCallback(
    async (number: PhoneNumber, agentId: string | null) => {
      const result = await fetchJson<{ number?: PhoneNumber }>("/api/numbers", t, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: number.id, assign: true, agentId }),
      });
      if (!result.ok) {
        // The refusal names the other agent, which is the whole point — a
        // generic "conflict" would send somebody hunting through the list.
        toast({ title: uiErrorMessage(t, result.error), status: "error" });
        return;
      }
      await load();
    },
    [load, t, toast],
  );

  const remove = useCallback(
    async (number: PhoneNumber) => {
      const ok = await confirm({
        title: t("numbers.deleteConfirm", { label: number.label }),
        description: t("numbers.deleteConfirmBody", { e164: formatE164(number.e164) }),
        confirmLabel: t("common.delete"),
      });
      if (!ok) return;
      const result = await fetchJson(`/api/numbers?id=${encodeURIComponent(number.id)}`, t, {
        method: "DELETE",
      });
      if (result.ok) {
        await load();
        toast({ title: t("common.deleted") });
      } else {
        toast({ title: uiErrorMessage(t, result.error), status: "error" });
      }
    },
    [confirm, load, t, toast],
  );

  // The channel cards and the header's connect buttons both read the channel
  // status, so the page waits for it as well: revealing first made them pop
  // in, and the buttons flash, a moment later.
  if (isLoading || channels.rows === null) {
    return (
      <PageContainer
        maxWidth="max-w-6xl"
        title={t("numbers.title")}
        description={t("numbers.subtitle")}
        actions={
          <span className="flex items-center gap-2" aria-hidden="true">
            <SkeletonBar className="h-8 w-32 rounded-lg md:h-7" />
            <SkeletonBar className="h-8 w-24 rounded-lg md:h-7" />
          </span>
        }
      >
        <NumbersSkeleton />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      banner={error ? (
          <ErrorBanner layout="strip" error={error} onRetry={() => void load()} />
        ) : null}
      maxWidth="max-w-6xl"
      title={t("numbers.title")}
      description={t("numbers.subtitle")}
      actions={(
        <>
          {numbers.length > 0 && offers("whatsapp") && !hasChannelCards ? (
            <ConnectButton
              tone="whatsapp"
              size="sm"
              onClick={() => setConnectOpen(true)}
            >
              {t("numbers.metaConnect")}
            </ConnectButton>
          ) : null}
          {numbers.length > 0 && offers("instagram") && !hasChannelCards ? (
            <ConnectButton
              tone="instagram"
              size="sm"
              onClick={() => setIgConnectOpen(true)}
            >
              {t("numbers.igConnect")}
            </ConnectButton>
          ) : null}
          <NewNumberMenu onMode={setTelephonyMode} onManual={() => { setEditing(null); setDialogOpen(true); }} />
        </>
      )}
    >
      <div className="content-enter">
        <ChannelsOverview
          rows={channels.rows}
          assignments={channels.assignments}
          agentName={agentName}
          onManage={(id) => (id === "whatsapp" ? setConnectOpen(true) : setIgConnectOpen(true))}
          onActivated={channels.reload}
          onDisconnected={channels.reload}
          connectable={(["whatsapp", "instagram"] as const).filter(offers)}
          onConnect={(id) => (id === "whatsapp" ? setConnectOpen(true) : setIgConnectOpen(true))}
        />

        <TelephonyPanel mode={telephonyMode} onMode={setTelephonyMode} agents={agents} numbers={numbers} onChanged={() => void load()} />

        {manyNumbers ? (
          <CardCarousel stats label={t("carousel.stats")}>
            <div className="mb-6 flex items-stretch gap-4" style={{ paddingInline: "2px" }}>
              <div className="min-w-[220px] flex-1">
                <KpiCard
                  icon={SmartPhone01Icon}
                  label={t("numbers.kpiTotal")}
                  value={numbers.length}
                  sub={t("numbers.kpiTotalSub")}
                />
              </div>
              <div className="min-w-[220px] flex-1">
                <KpiCard
                  icon={CheckmarkCircle02Icon}
                  label={t("numbers.kpiAssigned")}
                  value={assignedCount}
                  sub={t(assignedCount > 0 ? "numbers.kpiAssignedSub" : "numbers.kpiAssignedSubNone")}
                />
              </div>
              <div className="min-w-[220px] flex-1">
                <KpiCard
                  icon={AlertCircleIcon}
                  label={t("numbers.kpiFree")}
                  value={unassignedCount}
                  sub={t(unassignedCount > 0 ? "numbers.kpiFreeSub" : "numbers.kpiFreeSubNone")}
                />
              </div>
            </div>
          </CardCarousel>
        ) : null}

        {manyNumbers ? (
          <div className="mb-6">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("numbers.search")}
            />
          </div>
        ) : null}

        {numbers.length === 0 ? (
          <Card className="p-10 text-center">
            <HugeiconsIcon
              icon={SmartPhone01Icon}
              size={28}
              strokeWidth={1.5}
              className="mx-auto mb-3 text-muted-foreground"
            />
            <p className="text-sm font-medium text-foreground">{t("numbers.empty")}</p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
              {t("numbers.emptyHint")}
            </p>
            <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
              {offers("whatsapp") ? (
                <ConnectButton tone="whatsapp" onClick={() => setConnectOpen(true)}>
                  {t("numbers.metaConnect")}
                </ConnectButton>
              ) : null}
              {offers("instagram") ? (
                <ConnectButton tone="instagram" onClick={() => setIgConnectOpen(true)}>
                  {t("numbers.igConnect")}
                </ConnectButton>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
              className="mx-auto mt-3 block text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("numbers.addManually")}
            </button>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((number) => {
              return (
                <Card key={number.id} className="p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-mono text-sm text-foreground">
                          {formatE164(number.e164)}
                        </span>
                        <span className="text-sm text-muted-foreground">{number.label}</span>
                        {number.status === "inactive" ? (
                          <span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground">
                            {t("numbers.inactive")}
                          </span>
                        ) : null}
                      </div>
                      {/* Only what the line is for. The provider ("Meta (WhatsApp
                          Cloud)", "Twilio") is setup detail and lives in the edit
                          dialog with the rest of it. */}
                      <div className="flex flex-wrap gap-1.5">
                        {number.capabilities.map((capability) => (
                          <span
                            key={capability}
                            className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground"
                          >
                            {CAPABILITY_LABEL[capability]
                              ? t(CAPABILITY_LABEL[capability])
                              : capability}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex w-full items-center gap-2 sm:w-auto">
                      <Select
                        value={number.agentId ?? "none"}
                        onValueChange={(value) =>
                          void assign(number, value === "none" ? null : value)
                        }
                      >
                        <SelectTrigger
                          size="sm"
                          className={cn(
                            "min-w-0 flex-1 sm:w-44 sm:flex-none",
                            !number.agentId && "text-muted-foreground",
                          )}
                        >
                          <SelectValue placeholder={t("numbers.unassigned")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("numbers.unassigned")}</SelectItem>
                          {agents.map((agent) => (
                            <SelectItem key={agent.id} value={agent.id}>
                              {agent.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("numbers.dialogEditTitle")}
                        onClick={() => {
                          setEditing(number);
                          setDialogOpen(true);
                        }}
                      >
                        <HugeiconsIcon icon={PencilEdit01Icon} size={15} strokeWidth={1.75} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("common.delete")}
                        onClick={() => void remove(number)}
                      >
                        <HugeiconsIcon icon={Delete01Icon} size={15} strokeWidth={1.75} />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
            {filtered.length === 0 ? (
              <Card className="p-12 text-center text-sm text-muted-foreground">
                {t("numbers.noResults")} “{search}”.
              </Card>
            ) : null}
          </div>
        )}
      </div>

      {/* Remounted per target: without the key the dialog keeps the previous
          number's state and shows stale fields on the next open. */}
      <NumberDialog
        key={editing?.id ?? "new"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        agents={agents}
        onSave={save}
        saving={saving}
      />
      <WhatsAppConnect
        open={connectOpen}
        onOpenChange={(open) => {
          setConnectOpen(open);
          if (!open) setChannelsKey((key) => key + 1);
        }}
        onConnected={() => void load()}
      />
      <InstagramConnect
        open={igConnectOpen}
        onOpenChange={(open) => {
          setIgConnectOpen(open);
          if (!open) setChannelsKey((key) => key + 1);
        }}
        onConnected={() => void load()}
      />
      {confirmDialog}
    </PageContainer>
  );
}
