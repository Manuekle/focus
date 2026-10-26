"use client";

import "./dashboard.css";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { PageContainer } from "../../_components/page-container";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton, DashboardSkeleton } from "@/components/ai-elements/skeleton";
import { fetchJson, type UiError } from "@/lib/api-error-message";
import { getChats, getChannels, getStats, getActivityData, mergeChats } from "@/lib/dashboard-store";
import { useT } from "@/lib/i18n/provider";
import { usePolling } from "@/lib/use-polling";
import { useBrowserStorageScope } from "@/lib/browser-storage-scope";
import type { Automation, ChatSummary } from "@/lib/types";
import type { OnboardingProfile } from "@/lib/onboarding/types";
import type { DashboardData } from "./dashboard-types";

const importContent = () => import("./dashboard-content").then((module) => ({ default: module.DashboardContent }));
let content: ReturnType<typeof importContent> | undefined;
const loadContent = () => content ??= importContent();
const DashboardContent = lazy(loadContent);

export default function DashboardPage() {
  const t = useT();
  const storageScope = useBrowserStorageScope();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [contentReady, setContentReady] = useState(false);

  // Fetch the renderer alongside the data, after the title has rendered.
  // Invisible charts no longer initialize behind the loading skeleton.
  useEffect(() => {
    let active = true;
    const ready = () => { if (active) setContentReady(true); };
    // A chunk failure is then surfaced by React.lazy to the route error boundary.
    loadContent().then(ready, ready);
    return () => { active = false; };
  }, []);

  const refresh = useCallback(async () => {
    const localChats = getChats(storageScope);
    const [autoResult, contactResult, channelResult, onboardingResult] = await Promise.all([
      fetchJson<{ automations?: Automation[] }>("/api/automations?limit=200", t),
      fetchJson<{ chats?: ChatSummary[] }>("/api/contacts?limit=200", t),
      fetchJson<{ status?: Record<string, boolean> }>("/api/channels/status", t),
      fetchJson<{ profile: OnboardingProfile | null }>("/api/onboarding", t),
    ]);
    const failure = [autoResult, contactResult, channelResult].find((result) => !result.ok);
    setError(failure && !failure.ok ? failure.error : null);
    const automations = autoResult.ok ? (autoResult.data.automations ?? []) : [];
    const merged = mergeChats(localChats, contactResult.ok ? (contactResult.data.chats ?? []) : []);
    const status = channelResult.ok ? (channelResult.data.status ?? {}) : {};
    setData({
      automations, chats: merged, stats: getStats(merged, automations),
      activity: getActivityData(merged), channels: getChannels(merged, status),
      onboardingProfile: onboardingResult.ok ? onboardingResult.data.profile : null,
    });
  }, [storageScope, t]);
  usePolling(refresh, 30_000);

  return <PageContainer
    // In the header, above every branch of the content: a failed load has to
    // be visible whether the dashboard fell back to the empty state, to stale
    // numbers, or is still on its skeleton.
    banner={<ErrorBanner layout="strip" error={error} onRetry={() => void refresh()} onDismiss={() => setError(null)} />}
    maxWidth="max-w-6xl"
    title={t("dashboard.title")}
    description={t("dashboard.subtitle")}
    actions={
      <Button variant="outline" size="sm" asChild>
        <Link href="/chat" aria-label={t("dashboard.newChat")}>
          <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={1.75} />
          <span className="hidden sm:inline">{t("dashboard.newChat")}</span>
        </Link>
      </Button>
    }
  >
    <Skeleton className="min-h-[600px]" isLoading={!data || !contentReady} skeleton={<DashboardSkeleton />}>
      {data && contentReady && <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent data={data} />
      </Suspense>}
    </Skeleton>
  </PageContainer>;
}
