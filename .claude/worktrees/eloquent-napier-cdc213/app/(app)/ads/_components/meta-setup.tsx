"use client";

// The Meta connection behind the Ads page.
//
// Before it works there are two different states that used to share one
// sentence ("set META_ACCESS_TOKEN in Settings"): nothing connected yet, where
// the answer is a Meta login, and a login that shared several ad accounts,
// where the answer is choosing one. A self-hosted install without the Meta
// app configured still gets the Settings route, because a Connect button
// there could only fail at Meta. Once it works, it stays on the page saying
// which ad account and Page the numbers come from.
//
// Laid out like Numbers' channels: nothing connected is an empty state with
// the brand connect button; anything connected is a card that says which
// account it is, whether it works, and what to do next.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { SkeletonBar } from "@/components/ai-elements/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { useToast } from "@/components/toast-provider";
import { MetaMark } from "@/app/landing/_components/brand-marks";
import { fetchJson, type UiError } from "@/lib/api-error-message";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { Card } from "../../../_components/dashboard-card";
import { ConnectButton } from "@/components/connections/connect-button";
import { ConnectionPill, type ConnectionTone } from "@/components/connections/connection-pill";

type AccountsResponse = {
  readonly oauthAvailable: boolean;
  readonly source: "oauth" | "manual" | null;
  readonly selected: { readonly adAccountId: string | null; readonly pageId: string | null };
  readonly adAccounts: readonly { id: string; name: string; currency?: string }[];
  readonly pages: readonly { id: string; name: string }[];
};

const NO_PAGE = "__none";
const CONNECT_URL = "/api/connections/meta/start?return=/ads";
/** Where a business portfolio gets its first ad account. */
const META_AD_ACCOUNTS_URL = "https://business.facebook.com/settings/ad-accounts";

/** A full navigation, not a fetch: Meta's dialog opens as a real page and the
 *  flow comes back to /ads. Same as the Connect buttons on Connections. */
function startMetaLogin() {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- OAuth needs a real document navigation; router.push can't carry the provider round-trip
  window.location.href = CONNECT_URL;
}

export function MetaSetup({
  ready,
  picking,
  onPick,
  onCancel,
  onReady,
  quietError = false,
}: {
  /** The Ads API answers with this account: show it, not the picker. */
  readonly ready: boolean;
  /** The picker is open over an account that already works. */
  readonly picking: boolean;
  /** Open the picker ("Change account"). */
  readonly onPick: () => void;
  /** Close the picker without choosing. */
  readonly onCancel: () => void;
  /** An ad account is now chosen: reload the page's data. */
  readonly onReady: () => void;
  /**
   * The page header already shows a failure. Both reads usually fail for the
   * same reason (the workspace is unavailable, the network is down), and the
   * same sentence twice in a row reads as two problems. The page's retry
   * remounts this component, so nothing is lost by staying quiet.
   */
  readonly quietError?: boolean;
}) {
  const t = useT();
  const { toast } = useToast();
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [account, setAccount] = useState<string>("");
  const [page, setPage] = useState<string>(NO_PAGE);
  const [saving, setSaving] = useState(false);
  // Bumped by the error banner's retry, so the read runs again.
  const [attempt, setAttempt] = useState(0);
  const cardRef = useRef<HTMLElement>(null);

  // "Choose a Page" on the leads tab opens the picker up here, possibly above
  // the fold: bring it to where the person is looking.
  useEffect(() => {
    if (picking) cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [picking]);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<AccountsResponse>("/api/ads/accounts", t).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setData(result.data);
      setAccount(result.data.selected.adAccountId ?? result.data.adAccounts[0]?.id ?? "");
      setPage(result.data.selected.pageId ?? (result.data.pages.length === 1 ? result.data.pages[0].id : NO_PAGE));
    });
    return () => {
      cancelled = true;
    };
  }, [t, attempt]);

  const save = async () => {
    setSaving(true);
    const result = await fetchJson<{ ok: true }>("/api/ads/accounts", t, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ adAccountId: account, pageId: page === NO_PAGE ? null : page }),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast({ title: t("ads.setup.saved"), status: "success" });
    onReady();
  };

  if (error) {
    if (quietError) return null;
    return (
      <ErrorBanner
        className="mb-6"
        error={error}
        onRetry={() => {
          setError(null);
          setData(null);
          setAttempt((count) => count + 1);
        }}
      />
    );
  }
  if (!data) return <SetupSkeleton />;

  // Nothing connected: the empty state, with the one action that fixes it.
  if (!data.source) {
    return (
      <Card className="mb-6 px-6 py-12 text-center">
        <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl border border-border bg-muted/40">
          <MetaMark size={26} />
        </span>
        <p className="text-sm font-medium text-foreground">{t("ads.setup.connectTitle")}</p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
          {data.oauthAvailable ? t("ads.setup.connectBody") : t("ads.notConfigured")}
        </p>
        <div className="mt-5 flex justify-center">
          {data.oauthAvailable ? (
            <ConnectButton tone="meta" onClick={startMetaLogin}>
              {t("ads.setup.connect")}
            </ConnectButton>
          ) : (
            <Button asChild variant="outline">
              <Link href="/settings">{t("ads.setup.openSettings")}</Link>
            </Button>
          )}
        </div>
      </Card>
    );
  }

  // Connected, but the login shared no ad account at all. Reconnecting only
  // helps if one exists, so the card also says where one is created.
  if (data.adAccounts.length === 0) {
    return (
      <ConnectionCard
        cardRef={cardRef}
        tone="attention"
        status={t("ads.setup.statusAttention")}
        summary={t("ads.setup.noAccountsTitle")}
        summaryTone="attention"
        action={
          data.source === "oauth" ? (
            <Button type="button" variant="outline" size="sm" onClick={startMetaLogin}>
              {t("ads.setup.reconnect")}
            </Button>
          ) : null
        }
      >
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("ads.setup.noAccountsBody")}{" "}
          <a
            className="font-medium text-foreground underline underline-offset-2"
            href={META_AD_ACCOUNTS_URL}
            rel="noreferrer"
            target="_blank"
          >
            {t("ads.setup.createAccount")}
          </a>
        </p>
      </ConnectionCard>
    );
  }

  const chosen = data.adAccounts.find((option) => option.id === data.selected.adAccountId);
  const chosenPage = data.pages.find((option) => option.id === data.selected.pageId);

  // Working: which account and Page the numbers below come from.
  if (ready && !picking && data.selected.adAccountId) {
    return (
      <ConnectionCard
        cardRef={cardRef}
        tone="live"
        status={t("ads.setup.statusConnected")}
        account={
          chosen
            ? `${chosen.name}${chosen.currency ? ` · ${chosen.currency}` : ""}`
            : data.selected.adAccountId
        }
        summary={
          data.selected.pageId
            ? t("ads.setup.leadsFrom", { page: chosenPage?.name ?? data.selected.pageId })
            : t("ads.setup.noPage")
        }
        action={
          <Button type="button" variant="outline" size="sm" onClick={onPick}>
            {t("ads.setup.change")}
          </Button>
        }
      />
    );
  }

  return (
    <ConnectionCard
      cardRef={cardRef}
      tone="live"
      status={t("ads.setup.statusConnected")}
      summary={t("ads.setup.chooseBody")}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
          {t("ads.setup.adAccount")}
          <Select value={account} onValueChange={setAccount}>
            <SelectTrigger aria-label={t("ads.setup.adAccount")} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data.adAccounts.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                  {option.currency ? ` · ${option.currency}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
          {t("ads.setup.page")}
          <Select value={page} onValueChange={setPage}>
            <SelectTrigger aria-label={t("ads.setup.page")} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PAGE}>{t("ads.setup.noPage")}</SelectItem>
              {data.pages.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs font-normal text-muted-foreground">{t("ads.setup.pageHint")}</span>
        </label>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {ready && data.selected.adAccountId ? (
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            {t("common.cancel")}
          </Button>
        ) : null}
        <Button onClick={() => void save()} disabled={!account || saving}>
          {saving ? <Spinner size={14} /> : null}
          {t("ads.setup.save")}
        </Button>
      </div>
    </ConnectionCard>
  );
}

/** The Meta connection as a card, the same shape as a channel on Numbers:
 *  brand mark, what is connected, its state, and the next step below. */
function ConnectionCard({
  cardRef,
  tone,
  status,
  account,
  summary,
  summaryTone,
  action,
  children,
}: {
  readonly cardRef?: React.Ref<HTMLElement>;
  readonly tone: ConnectionTone;
  readonly status: string;
  /** The connected account, beside the name — like a channel's handle. */
  readonly account?: string;
  readonly summary: string;
  readonly summaryTone?: "attention";
  readonly action?: React.ReactNode;
  readonly children?: React.ReactNode;
}) {
  const t = useT();
  return (
    <section ref={cardRef} className="mb-6 scroll-mt-6 space-y-3" aria-labelledby="ads-connection-heading">
      <h2 id="ads-connection-heading" className="text-sm font-medium text-foreground">
        {t("ads.setup.connectionTitle")}
      </h2>
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/40">
              <MetaMark size={18} />
            </span>
            <div className="min-w-0 space-y-0.5">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-foreground">
                <span>Meta</span>
                {account ? <span className="truncate font-normal text-muted-foreground">{account}</span> : null}
              </p>
              <p
                className={cn(
                  "text-xs",
                  summaryTone === "attention"
                    ? "text-amber-700 dark:text-amber-500"
                    : "text-muted-foreground",
                )}
              >
                {summary}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ConnectionPill tone={tone}>{status}</ConnectionPill>
            {action}
          </div>
        </div>
        {children ? <div className="mt-4 space-y-4 border-t border-border pt-4">{children}</div> : null}
      </Card>
    </section>
  );
}

/** The connection card's outline while /api/ads/accounts answers. */
function SetupSkeleton() {
  return (
    <div className="t-skel-pulse-self mb-6 space-y-3">
      <SkeletonBar className="h-4 w-20" />
      <Card className="p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <SkeletonBar className="size-9 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonBar className="h-3.5 w-24" />
            <SkeletonBar className="h-3" width="55%" />
          </div>
          <SkeletonBar className="hidden h-7 w-28 rounded-full sm:block" />
        </div>
      </Card>
    </div>
  );
}
