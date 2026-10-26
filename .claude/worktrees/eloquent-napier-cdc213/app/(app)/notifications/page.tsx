"use client";

import "../product.css";
import Link from "next/link";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/icon";
import {
  BellIcon,
  AiReplaceIcon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Mail01Icon,
  Settings01Icon,
  Timer01Icon,
  UserIcon,
  ZapIcon,
} from "@hugeicons/core-free-icons";
import { PageContainer } from "../../_components/page-container";
import { Card } from "../../_components/dashboard-card";
import { KpiBars, KpiCard } from "../../_components/kpi-card";
import { CardCarousel } from "../../_components/card-carousel";
import { Skeleton } from "@/components/ai-elements/skeleton";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import { ProductFigure } from "@/components/hairline/product-figure";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorBanner } from "@/components/ui/error-banner";
import { NotificationSettings, NotificationTabLabel } from "@/components/notifications/notification-center";
import { useNotifications, type SystemAlert } from "@/components/notifications/notification-provider";
import { useT } from "@/lib/i18n/provider";
import { effectiveApprovalStatus, isPendingApproval, tabOf, type AppNotification, type NotificationTab } from "@/lib/notification-types";
import { cn } from "@/lib/utils";
import { NotificationCard } from "./notification-card";
import { NotificationsSkeleton } from "./page-skeleton";

const TABS = ["inbox", "general", "archived"] as const;

const ALERT_ICON: Record<SystemAlert["id"], IconSvgElement> = {
  ai: AiReplaceIcon, waiting: UserIcon, due: Timer01Icon, drafts: ZapIcon,
};

export default function NotificationsPage() {
  const t = useT();
  return (
    <Suspense
      fallback={
        <PageContainer maxWidth="max-w-6xl" icon={BellIcon} title={t("notifications.pageTitle")} description={t("notifications.pageDescription")}>
          <NotificationsSkeleton />
        </PageContainer>
      }
    >
      <NotificationsView />
    </Suspense>
  );
}

function NotificationsView() {
  const t = useT();
  const focusId = useSearchParams().get("item") ?? undefined;
  const { data, counts, loading, error, busy, mutate, refresh, alerts } = useNotifications();
  const [tab, setTab] = useState<NotificationTab>("inbox");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focused, setFocused] = useState<string | undefined>();

  const all = data?.items ?? [];
  const target = all.find((item) => item.id === focusId);
  const targetTab = target ? tabOf(target) : undefined;

  // A linked item opens its own tab once, as soon as the feed has it; after
  // that the tabs are the reader's again.
  if (focusId && targetTab && focused !== focusId) {
    setFocused(focusId);
    setTab(targetTab);
  }
  useEffect(() => {
    if (!focused) return;
    document.getElementById(`notification-${focused}`)?.scrollIntoView({ block: "center" });
  }, [focused]);

  const items = all.filter((item) => tabOf(item) === tab);
  const approvals = all.filter((item) => item.approval);
  const pendingCount = approvals.filter((item) => isPendingApproval(item)).length;
  const resolvedCount = approvals.filter((item) => {
    const status = effectiveApprovalStatus(item.approval!);
    return status === "approved" || status === "declined";
  }).length;
  const active = all.filter((item) => !item.archivedAt);
  const unreadCount = active.filter((item) => !item.readAt).length;
  const share = (count: number, of: number) => (of > 0 ? count / of : 0);
  const tabCount = (id: NotificationTab) => counts[id] + (id === "general" ? alerts.length : 0);
  const showAlerts = tab === "general" && alerts.length > 0;

  return (
    <PageContainer
      maxWidth="max-w-6xl"
      icon={BellIcon}
      title={t("notifications.pageTitle")}
      description={t("notifications.pageDescription")}
      actions={
        <>
          <Button variant="outline" size="sm" aria-label={t("notifications.readAll")} disabled={unreadCount === 0 || Boolean(busy)} onClick={() => void mutate("read_all", "/api/notifications", "POST", { op: "read_all" })}>
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} strokeWidth={1.75} />
            <span className="hidden sm:inline">{t("notifications.readAll")}</span>
          </Button>
          <Button variant="outline" size="sm" aria-label={t("notifications.preferences.open")} onClick={() => setSettingsOpen(true)}>
            <HugeiconsIcon icon={Settings01Icon} size={16} strokeWidth={1.75} />
            <span className="hidden sm:inline">{t("notifications.preferences.open")}</span>
          </Button>
        </>
      }
    >
    <Skeleton className="min-h-[500px]" isLoading={loading} skeleton={<NotificationsSkeleton />}>
      <div className="content-enter">
        <ErrorBanner className="mb-6" error={error} onRetry={() => void refresh()} />

        {all.length > 0 ? (
          <CardCarousel stats label={t("carousel.stats")}>
            <div className="mb-6 flex items-stretch gap-4" style={{ paddingInline: "2px" }}>
              <div className="min-w-[220px] flex-1">
                <KpiCard
                  icon={Clock01Icon}
                  label={t("notifications.kpi.pending")}
                  sub={t(pendingCount > 0 ? "notifications.kpi.pendingSub" : "notifications.kpi.pendingSubNone")}
                  value={pendingCount}
                  visual={<KpiBars ratio={share(pendingCount, approvals.length)} tone="warning" />}
                />
              </div>
              <div className="min-w-[220px] flex-1">
                <KpiCard
                  icon={Mail01Icon}
                  label={t("notifications.kpi.unread")}
                  sub={t(unreadCount > 0 ? "notifications.kpi.unreadSub" : "notifications.kpi.unreadSubNone")}
                  value={unreadCount}
                  visual={<KpiBars ratio={share(unreadCount, active.length)} />}
                />
              </div>
              <div className="min-w-[220px] flex-1">
                <KpiCard
                  icon={CheckmarkCircle02Icon}
                  label={t("notifications.kpi.resolved")}
                  sub={t(resolvedCount > 0 ? "notifications.kpi.resolvedSub" : "notifications.kpi.resolvedSubNone")}
                  value={resolvedCount}
                  visual={<KpiBars ratio={share(resolvedCount, approvals.length)} tone="positive" />}
                />
              </div>
            </div>
          </CardCarousel>
        ) : null}

        {/* Three tabs with counts outgrow a phone; the bar scrolls instead of clipping. */}
        <div className="x-fade mb-6 overflow-x-auto scrollbar-hide">
          <SlidingTabs
            value={tab}
            onValueChange={(value) => setTab(value as NotificationTab)}
            tabs={TABS.map((id) => ({
              id,
              label: <NotificationTabLabel label={t(`notifications.tabs.${id}`)} count={tabCount(id)} />,
            }))}
          />
        </div>

        {items.length === 0 && !showAlerts ? (
          <Card>
            <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
              <ProductFigure kind={tab === "archived" ? "empty-archive" : "channels"} className="h-24 w-36" />
              <p className="text-sm font-medium">{t(`notifications.empty.${tab}`)}</p>
              <p className="max-w-xs text-xs text-muted-foreground">{t(`notifications.emptyHint.${tab}`)}</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-6">
            {showAlerts ? <SystemAlerts alerts={alerts} /> : null}
            {tab === "inbox" ? (
              <>
                <NotificationSection title={t("notifications.section.pending")} items={items.filter((item) => isPendingApproval(item))} focusId={focusId} />
                <NotificationSection title={t("notifications.section.recent")} items={items.filter((item) => !isPendingApproval(item))} focusId={focusId} />
              </>
            ) : (
              <NotificationSection title={tab === "general" ? t("notifications.section.activity") : undefined} items={items} focusId={focusId} />
            )}
          </div>
        )}

        {focusId && data && !target ? <p role="status" className="mt-4 text-xs text-muted-foreground">{t("notifications.notFound")}</p> : null}
      </div>
    </Skeleton>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle icon={<HugeiconsIcon icon={Settings01Icon} size={18} strokeWidth={1.75} />}>
              {t("notifications.preferences.title")}
            </DialogTitle>
            <DialogDescription>{t("notifications.preferences.description")}</DialogDescription>
          </DialogHeader>
          <NotificationSettings className="" />
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

/** One titled group of notification cards. Renders nothing when empty, so a
 *  tab with nothing pending doesn't carry a lone heading over blank space. */
function NotificationSection({ title, items, focusId }: {
  readonly title?: string;
  readonly items: readonly AppNotification[];
  readonly focusId?: string;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      {title ? <SectionTitle title={title} count={items.length} /> : null}
      <div className="space-y-3">
        {items.map((item) => <NotificationCard key={item.id} item={item} highlighted={item.id === focusId} />)}
      </div>
    </section>
  );
}

function SectionTitle({ title, count }: { readonly title: ReactNode; readonly count: number }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
      {title}
      <span className="tabular-nums">{count}</span>
    </h2>
  );
}

/** State that needs doing, above the feed of what the agents did. */
function SystemAlerts({ alerts }: { readonly alerts: readonly SystemAlert[] }) {
  const t = useT();
  return (
    <section>
      <SectionTitle title={t("notifications.system.title")} count={alerts.length} />
      <Card className="divide-y divide-border/60">
        {alerts.map((alert) => (
          <Link key={alert.id} href={alert.href} className="group flex items-center gap-3 px-5 py-3.5 transition-colors duration-150 hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none">
            <span className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-xl shadow-[var(--shadow-inset)]",
              alert.id === "ai" ? "bg-[var(--status-pending-bg)] text-[color:var(--status-pending-fg)]" : "bg-muted text-muted-foreground",
            )}>
              <HugeiconsIcon icon={ALERT_ICON[alert.id]} size={16} strokeWidth={1.75} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{t(alert.labelKey)}</span>
              {alert.hintKey ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{t(alert.hintKey)}</span> : null}
            </span>
            {alert.count ? <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md bg-muted px-1.5 text-xs font-medium tabular-nums shadow-[var(--shadow-inset)]">{alert.count}</span> : null}
            <HugeiconsIcon icon={ArrowRight01Icon} size={16} strokeWidth={1.75} className="shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none" />
          </Link>
        ))}
      </Card>
    </section>
  );
}
