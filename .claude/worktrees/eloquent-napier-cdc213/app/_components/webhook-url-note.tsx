"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Alert01Icon, Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { useT } from "@/lib/i18n/provider";
import { SITE_URL } from "@/lib/site";
import { useSound } from "@/components/sound-provider";

// The callback URL a channel's webhook has to be pointed at.
//
// This is the one value in the whole setup that nobody has to invent or fetch
// from a vendor — it is derived from where this installation is served and the
// channel's own name, and it never changes for a given deployment. It was
// still the thing people got wrong most often, because the path (`/eve/v1/…`,
// mounted by Eve, not by Next) appears nowhere in the UI: a webhook pointed at
// the bare domain verifies as a 404 and Meta reports only that verification
// failed.
//
// Rendered read-only on purpose. There is nothing here to configure.

/** Channels whose inbound webhook Eve mounts at `/eve/v1/<channel>`. */
export type WebhookChannel = "whatsapp" | "instagram";

/**
 * Whether an origin is one only this machine can resolve.
 *
 * `localhost` and `127.0.0.1` are the obvious cases; `*.localhost` is the one
 * worth spelling out, because a local HTTPS proxy makes an origin that looks
 * every bit like production (`https://oruka.localhost`) and satisfies every
 * "is it configured, is it https" check while still being unreachable from
 * Meta's servers.
 */
function isLocalOrigin(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

export function WebhookUrlNote({ channel }: { readonly channel: WebhookChannel }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const { cue } = useSound();
  const url = `${SITE_URL}/eve/v1/${channel}`;
  const local = isLocalOrigin(SITE_URL);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      cue("success", { emphasis: "subtle" });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The URL is on screen either way.
    }
  };

  return (
    <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{t("settings.webhookUrl")}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1"
        >
          <HugeiconsIcon
            icon={copied ? Tick02Icon : Copy01Icon}
            size={13}
            strokeWidth={1.75}
          />
          {copied ? t("settings.webhookUrlCopied") : t("settings.webhookUrlCopy")}
        </button>
      </div>

      {/* Wraps rather than truncates: a URL you cannot read whole is a URL you
          cannot check against the one already pasted into the dashboard. */}
      <code className="block font-mono text-[13px] leading-relaxed break-all text-foreground">
        {url}
      </code>

      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
        {t("settings.webhookUrlHelp")}
      </p>

      {local ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-[13px] leading-relaxed text-amber-700 dark:text-amber-400">
          <HugeiconsIcon
            icon={Alert01Icon}
            size={13}
            strokeWidth={1.75}
            className="mt-px shrink-0"
          />
          <span>{t("settings.webhookUrlLocal")}</span>
        </p>
      ) : null}
    </div>
  );
}
