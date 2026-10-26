"use client";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/provider";
import { fetchJson, uiErrorMessage, type UiError } from "@/lib/api-error-message";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

type Status = { ready: boolean; imported: boolean; messagingConfigured: boolean; tokenExpired?: boolean; messagingEnabled?: boolean; phone?: string };
export function WhatsAppVoicePanel({ agentId }: { agentId: string }) {
  const t = useT();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  useEffect(() => {
    let active = true;
    void fetchJson<Status>(`/api/elevenlabs/whatsapp?agentId=${encodeURIComponent(agentId)}`, t).then((result) => {
      if (!active) return;
      if (result.ok) { setStatus(result.data); setError(null); } else setError(result.error);
    });
    return () => { active = false; };
  }, [agentId, t]);
  return <section className="rounded-xl border border-border bg-card p-4" aria-label={t("voice.wa.title")}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-medium">{t("voice.wa.title")}</h2><StatusBadge status={status?.ready ? "connected" : "disconnected"} label={t(status?.ready ? "voice.wa.connected" : "voice.wa.pending")} /></div>
    {error ? <p className="text-xs text-muted-foreground" role="status">{uiErrorMessage(t, error)}</p> : <p className="text-xs leading-relaxed text-muted-foreground">{t(status?.ready ? "voice.wa.inboundReady" : status?.tokenExpired ? "voice.wa.tokenExpired" : "voice.wa.setup")}</p>}
    {status?.phone ? <p className="mt-2 font-mono text-xs">{status.phone}</p> : null}
    {!status?.ready ? <><p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("voice.wa.keepMessaging")}</p><Button variant="outline" size="sm" className="mt-3" asChild><a href="https://elevenlabs.io/docs/eleven-agents/whatsapp" target="_blank" rel="noreferrer">{t("voice.wa.guide")}</a></Button></> : null}
    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("voice.wa.outboundPermission")}</p>
  </section>;
}
