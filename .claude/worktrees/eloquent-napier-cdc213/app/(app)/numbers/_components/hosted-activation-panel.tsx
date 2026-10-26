"use client";

import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Alert } from "@/components/ui/alert";
import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/lib/i18n/provider";
import { fetchJson, uiErrorMessage } from "@/lib/api-error-message";
import type { HostedChannelState } from "@/lib/hosted-channels";

// Where a hosted tenant's new WhatsApp or Instagram connection stands.
//
// The channel's webhook always exists, so after the popup the only step left
// is pointing Meta routing at this tenant, which the connect request does
// itself: normally this panel goes straight to "done". It says "connecting"
// rather than painting a green tick while routing is not registered yet
// (ERR-1), and offers a retry when Meta refused it. It polls the server,
// which derives the state from facts, so closing the drawer or reloading
// never loses track; the tick retries a failed registration on its own.

type Channel = "whatsapp" | "instagram";
type StatusResponse = { channels?: Array<{ id: string; hosted?: HostedChannelState }> };

const POLL_MS = 5_000;

export function HostedActivationPanel({
  channel,
  initial,
  onConnected,
}: {
  readonly channel: Channel;
  readonly initial: HostedChannelState;
  readonly onConnected?: () => void;
}) {
  const t = useT();
  const [state, setState] = useState<HostedChannelState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waiting = state.state === "registering";

  useEffect(() => {
    if (!waiting) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const result = await fetchJson<StatusResponse>("/api/channels/status", t);
      if (cancelled || !result.ok) return;
      const next = result.data.channels?.find((entry) => entry.id === channel)?.hosted;
      if (next) setState(next);
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [waiting, channel, t]);

  useEffect(() => {
    if (state.state === "connected") onConnected?.();
  }, [state.state, onConnected]);

  const activate = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await fetchJson<{ states?: Record<Channel, HostedChannelState> }>("/api/channels/activation", t, {
      method: "POST",
    });
    setBusy(false);
    if (!result.ok) {
      setError(uiErrorMessage(t, result.error));
      return;
    }
    const next = result.data.states?.[channel];
    if (next) setState(next);
  }, [channel, t]);

  if (state.state === "connected") {
    return (
      <Notice tone="ok">
        {t(channel === "whatsapp" ? "numbers.hostedConnectedWhatsapp" : "numbers.hostedConnectedInstagram")}
      </Notice>
    );
  }

  if (state.state === "failed") {
    return (
      <div className="space-y-3">
        <Notice tone="error">
          {t("numbers.hostedFailedRegister")}
          {state.message ? <span className="mt-1 block text-xs text-muted-foreground">{state.message}</span> : null}
          {error ? <span className="mt-1 block text-xs">{error}</span> : null}
        </Notice>
        <Button type="button" variant="outline" size="sm" onClick={activate} disabled={busy}>
          {busy ? <Spinner /> : null}
          {t("numbers.hostedRetry")}
        </Button>
      </div>
    );
  }

  if (state.state === "disconnected") return null;

  const steps = [
    { key: "saved", label: t("numbers.hostedStepSaved"), done: true, current: false },
    { key: "registering", label: t("numbers.hostedStepRegistering"), done: false, current: true },
  ];

  return (
    <div className="rounded-2xl border border-border px-5 py-4" aria-live="polite">
      <ol className="space-y-2.5">
        {steps.map((step) => (
          <li key={step.key} className="flex items-center gap-2.5 text-sm">
            {step.done ? (
              <HugeiconsIcon
                icon={CheckmarkCircle02Icon}
                size={16}
                strokeWidth={1.75}
                className="shrink-0 text-emerald-600 dark:text-emerald-400"
              />
            ) : step.current ? (
              <Spinner className="size-4 shrink-0" />
            ) : (
              <span className="size-4 shrink-0 rounded-full border border-border" aria-hidden />
            )}
            <span className={step.done || step.current ? "" : "text-muted-foreground"}>{step.label}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">{t("numbers.hostedActivatingHint")}</p>
    </div>
  );
}

function Notice({ tone, children }: { readonly tone: "ok" | "error"; readonly children: React.ReactNode }) {
  return <Alert tone={tone === "ok" ? "success" : "error"}>{children}</Alert>;
}
