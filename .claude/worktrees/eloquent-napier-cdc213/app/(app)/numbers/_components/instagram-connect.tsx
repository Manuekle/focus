"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Alert } from "@/components/ui/alert";
import {
  CheckmarkCircle02Icon,
  InstagramIcon,
  Copy01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ConnectButton } from "@/components/connections/connect-button";
import { ChannelIncompleteNotice } from "./channel-incomplete-notice";
import { HostedActivationPanel } from "./hosted-activation-panel";
import type { HostedChannelState } from "@/lib/hosted-channels";
import { useT } from "@/lib/i18n/provider";
import { fetchJson, uiErrorMessage } from "@/lib/api-error-message";
import { notifyCredentialsChanged } from "@/lib/credentials-changed";
import { useSound } from "@/components/sound-provider";

// One-click Instagram connect through Business Login for Instagram.
//
// Unlike WhatsApp's Embedded Signup there is no business registration here:
// the popup authorizes the messaging permissions on a professional account,
// Meta redirects to this app's callback with a code, and the callback does
// the rest server-side (short token → 60-day token → account → webhook
// subscription → stored credentials). This drawer owns the pre-flight
// (professional account, login access, registered redirect URI) and the
// popup itself.

type Phase = "form" | "waiting" | "done" | "error";

type EmbeddedConfig = {
  configured?: boolean;
  redirectUri?: string;
  scopes?: string[];
  connected?: boolean;
  /** The connected account's @username, when known. */
  username?: string;
  verifyTokenConfigured?: boolean;
  /** Hosted tenant: Oruka runs the Meta app; no operator steps for the customer. */
  hosted?: boolean;
};

type SignupMessage = {
  type?: string;
  ok?: boolean;
  username?: string;
  message?: string;
  /** Dictionary key for `message`, set on the failures this app words itself.
   *  Absent when the sentence came from Meta, which has no key. */
  messageKey?: string;
  /** Credential keys the channel still needs before its webhook mounts. */
  missing?: string[];
  /** Hosted tenants: routing registration state. Absent on self-hosted. */
  hosted?: HostedChannelState;
};

export function InstagramConnect({
  open,
  onOpenChange,
  onConnected,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConnected: () => void;
}) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>("form");
  const [config, setConfig] = useState<EmbeddedConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { cue } = useSound();
  const [refreshing, setRefreshing] = useState(false);
  const [missing, setMissing] = useState<readonly string[]>([]);
  const [hosted, setHosted] = useState<HostedChannelState | null>(null);
  const popup = useRef<Window | null>(null);
  const settled = useRef(false);

  useEffect(() => {
    if (!open) return;
    settled.current = false;
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as SignupMessage | null;
      if (data?.type !== "IG_EMBEDDED_SIGNUP" || settled.current) return;
      settled.current = true;
      popup.current?.close();
      popup.current = null;
      if (data.ok) {
        setUsername(data.username ?? null);
        setMissing(data.missing ?? []);
        setHosted(data.hosted ?? null);
        setPhase("done");
        setError(null);
        notifyCredentialsChanged();
        onConnected();
      } else {
        setError(
          data.messageKey
            ? t(data.messageKey, undefined, data.message)
            : (data.message ?? t("numbers.igFailed")),
        );
        setPhase("error");
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [open, onConnected, t]);

  // The popup closing with no verdict means the login was abandoned, not
  // completed — say so instead of spinning forever.
  useEffect(() => {
    if (!open || phase !== "waiting") return;
    const timer = setInterval(() => {
      if (popup.current?.closed && !settled.current) {
        settled.current = true;
        popup.current = null;
        setError(t("numbers.igCancelled"));
        setPhase("error");
      }
    }, 500);
    return () => clearInterval(timer);
  }, [open, phase, t]);

  useEffect(() => {
    if (!open) return;
    setPhase("form");
    setError(null);
    setUsername(null);
    setMissing([]);
    setHosted(null);
    setCopied(false);
    void fetchJson<EmbeddedConfig>("/api/channels/instagram/embedded", t).then((result) => {
      if (result.ok) setConfig(result.data);
    });
  }, [open, t]);

  const connect = useCallback(async () => {
    setPhase("waiting");
    setError(null);
    settled.current = false;
    const start = await fetchJson<{ url?: string }>(
      "/api/channels/instagram/embedded/start",
      t,
    );
    if (!start.ok || !start.data.url) {
      setError(start.ok ? t("numbers.igFailed") : uiErrorMessage(t, start.error));
      setPhase("error");
      return;
    }
    const win = window.open(start.data.url, "ig_embedded_signup", "width=600,height=700");
    if (!win) {
      setError(t("numbers.igPopupBlocked"));
      setPhase("error");
      return;
    }
    popup.current = win;
  }, [t]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const result = await fetchJson<{ ok: boolean }>(
      "/api/channels/instagram/embedded",
      t,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      },
    );
    setRefreshing(false);
    if (!result.ok) {
      setError(uiErrorMessage(t, result.error));
      setPhase("error");
      return;
    }
    setUsername(null);
    setHosted(null);
    setPhase("done");
    setError(null);
    notifyCredentialsChanged();
    onConnected();
  }, [onConnected, t]);

  const redirectUri = config?.redirectUri;
  const copyRedirect = useCallback(async () => {
    if (!redirectUri) return;
    try {
      await navigator.clipboard.writeText(redirectUri);
      cue("success", { emphasis: "subtle" });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The URL is on screen either way.
    }
  }, [redirectUri, cue]);

  const configured = config?.configured ?? true;
  const hostedInstall = config?.hosted === true;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-w-2xl">
        <DrawerHeader>
          <DrawerTitle icon={<HugeiconsIcon icon={InstagramIcon} size={18} strokeWidth={1.75} />}>
            {t("numbers.igTitle")}
          </DrawerTitle>
          <DrawerDescription>{t("numbers.igDescription")}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="min-h-0">
          <div className="space-y-4">
            {phase === "done" && hosted ? (
              <HostedActivationPanel channel="instagram" initial={hosted} />
            ) : null}

            {phase === "done" && !hosted ? (
              <Alert tone="success">
                {username
                  ? t("numbers.igDone", { username })
                  : t("numbers.igRefreshed")}
              </Alert>
            ) : null}

            {phase === "done" ? (
              <ChannelIncompleteNotice
                hosted={hostedInstall}
                missing={missing}
                settingsPath={t("numbers.igSettingsPath")}
              />
            ) : null}

            {phase === "error" && error ? (
              <Alert tone="error" role="alert">
                {error}
              </Alert>
            ) : null}

            {phase === "waiting" ? (
              <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-muted/40 px-5 py-4">
                <Spinner size={16} />
                <p className="text-sm text-muted-foreground">{t("numbers.igWaiting")}</p>
              </div>
            ) : null}

            {(phase === "form" || phase === "error") && config?.connected ? (
              <Alert tone="success" role={null}>
                {config.username
                  ? t("numbers.igConnectedAs", { username: config.username })
                  : t("numbers.igConnectedUnknown")}{" "}
                <span className="text-muted-foreground">{t("numbers.igSwitchHint")}</span>
              </Alert>
            ) : null}

            {phase === "form" || phase === "error" ? (
              <>
                <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                  <li className="flex gap-2">
                    <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[color:var(--status-success-fg)]" />
                    <span>{t("numbers.igReqPro")}</span>
                  </li>
                  <li className="flex gap-2">
                    <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[color:var(--status-success-fg)]" />
                    <span>{t("numbers.igReqLogin")}</span>
                  </li>
                  <li className="flex gap-2">
                    <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[color:var(--status-success-fg)]" />
                    <span>{t("numbers.igReqSession")}</span>
                  </li>
                  {hostedInstall ? null : (<li className="flex gap-2">
                    <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[color:var(--status-success-fg)]" />
                    <span>{t("numbers.igReqRedirect")}</span>
                  </li>)}
                </ul>

                {config?.redirectUri && !hostedInstall ? (
                  <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">{t("numbers.igRedirectUri")}</span>
                      <button
                        type="button"
                        onClick={copyRedirect}
                        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <HugeiconsIcon
                          icon={copied ? Tick02Icon : Copy01Icon}
                          size={13}
                          strokeWidth={1.75}
                        />
                        {copied ? t("settings.webhookUrlCopied") : t("settings.webhookUrlCopy")}
                      </button>
                    </div>
                    <code className="block font-mono text-[11px] leading-relaxed break-all text-foreground">
                      {config.redirectUri}
                    </code>
                  </div>
                ) : null}

                {!configured ? (
                  <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-500">
                    {hostedInstall ? (
                      t("numbers.hostedChannelUnavailable")
                    ) : (
                      <>
                        {t("numbers.igUnconfigured")}{" "}
                        <Link
                          href="/settings"
                          className="font-medium underline underline-offset-2"
                          onClick={() => onOpenChange(false)}
                        >
                          {t("numbers.metaGoSettings")}
                        </Link>
                      </>
                    )}
                  </p>
                ) : null}

                {config?.verifyTokenConfigured === false && !hostedInstall ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t("numbers.igVerifyHint")}
                  </p>
                ) : null}

                {config?.connected ? (
                  <p className="flex flex-wrap items-center gap-x-1.5 text-xs leading-relaxed text-muted-foreground">
                    <span>{t("numbers.igTokenExpiry")}</span>
                    {/* A secondary action, not a third footer button: the
                        nightly schedule renews the token on its own. */}
                    <button
                      type="button"
                      onClick={() => void refresh()}
                      disabled={refreshing || !configured}
                      className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2 transition-colors hover:text-foreground/80 disabled:opacity-50"
                    >
                      {refreshing ? <Spinner size={12} /> : null}
                      {t("numbers.igRefreshNow")}
                    </button>
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        </DrawerBody>
        <DrawerFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {phase === "done" ? t("numbers.metaClose") : t("common.cancel")}
          </Button>
          {phase === "done" ? null : phase === "waiting" ? (
            <ConnectButton tone="instagram" disabled>
              <Spinner size={14} />
              {t("numbers.metaConnecting")}
            </ConnectButton>
          ) : (
            <ConnectButton tone="instagram" onClick={() => void connect()} disabled={!configured}>
              {phase === "error"
                ? t("numbers.metaRetry")
                : config?.connected
                  ? t("numbers.igConnectOther")
                  : t("numbers.igConnect")}
            </ConnectButton>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
