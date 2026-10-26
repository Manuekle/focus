"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/app/_components/dashboard-card";
import { ChannelDisconnectButton } from "@/components/connections/channel-disconnect-button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { WhatsAppMark, InstagramMark } from "@/app/landing/_components/brand-marks";
import { fetchJson, type UiError } from "@/lib/api-error-message";
import { useCredentialsChanged } from "@/lib/credentials-changed";
import { useT } from "@/lib/i18n/provider";
import type { ChannelRow } from "../../numbers/_components/channels-overview";

export function HostedChannelCards() {
  const t = useT();
  const [rows, setRows] = useState<readonly ChannelRow[] | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useCredentialsChanged(refresh);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ channels: Array<ChannelRow | { id: "web" }> }>("/api/channels/status", t).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setRows(result.data.channels.filter((row): row is ChannelRow => row.id !== "web"));
        setError(null);
      } else {
        setRows(null);
        setError(result.error);
      }
    });
    return () => { cancelled = true; };
  }, [t, revision]);

  return (
    <>
      {(["whatsapp", "instagram"] as const).map((id) => {
        const row = rows?.find((channel) => channel.id === id);
        const state = row?.hosted?.state;
        const label = row?.connected ? t("numbers.channelLive")
          : state === "registering" ? t("numbers.channelActivating")
          : state === "failed" ? t("numbers.channelAttention")
          : error ? t("numbers.channelAttention")
          : !rows ? t("settings.hostedChannelLoading") : t("settings.hostedChannelDisconnected");
        const name = id === "whatsapp" ? "WhatsApp" : "Instagram";
        return (
          <Card key={id} className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                {id === "whatsapp" ? <WhatsAppMark size={18} /> : <InstagramMark size={18} />}
                {name}
              </h3>
              <Badge variant="secondary">{label}</Badge>
            </div>
            {row?.account ? <p className="break-all text-sm">{row.account}</p> : null}
            <p className="text-sm text-muted-foreground">{t("settings.hostedChannelDescription")}</p>
            <ErrorBanner error={error} />
            <div className="mt-auto flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/numbers">{t("settings.hostedChannelManage", { channel: name })}</Link>
              </Button>
              {state && state !== "disconnected" ? <ChannelDisconnectButton channel={id} onDisconnected={refresh} /> : null}
              {error ? <Button type="button" variant="ghost" size="sm" onClick={refresh}>{t("settings.hostedChannelRetry")}</Button> : null}
            </div>
          </Card>
        );
      })}
    </>
  );
}
