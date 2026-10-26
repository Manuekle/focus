"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@/components/icons/icon";
import { MessageCircleIcon, ZapIcon, ChartAverageIcon, SendIcon, TrendingUpIcon, Add01Icon, Settings01Icon, AiElementsIcon, RocketIcon } from "@hugeicons/core-free-icons";
import { OnboardingPlan } from "../../_components/onboarding-plan";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardSeparator } from "../../_components/dashboard-card";
import { CardCarousel } from "../../_components/card-carousel";
import { ChannelIcon, ChannelBadge, ChannelStatusBadge, CHANNEL_LABELS } from "../../_components/channel-badge";
import { KpiBars, KpiCard, KpiSparkline, KpiSplit } from "../../_components/kpi-card";
import { AnimatedNumber, DonutChart, TimeSeries } from "../../_components/chart";
import { useT } from "@/lib/i18n/provider";
import { relativeTime } from "@/lib/format";
import { chatTitle } from "@/lib/dashboard-store";
import { eveChatStorageKey, useBrowserStorageScope } from "@/lib/browser-storage-scope";
import { stageChatSession } from "@/lib/chat-session-stage";
import type { ActivityPoint } from "@/lib/types";
import type { DashboardData } from "./dashboard-types";

export function DashboardContent({ data }: {
  readonly data: DashboardData;
}) {
  const t = useT();
  const router = useRouter();
  const chatStorageKey = eveChatStorageKey(useBrowserStorageScope());
  const { chats, channels, stats, automations, activity, onboardingProfile } = data;
  const recentChats = [...chats]
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
    .slice(0, 5);

  const activeAutomations = automations.filter((a) => a.status === "active");

  // The channel carrying the most conversations — the one fact the raw message
  // count leaves out, and the reason the tile says something instead of
  // restating itself with "across all channels".
  const leadChannel = stats?.channelBreakdown.length
    ? [...stats.channelBreakdown].sort((a, b) => b.count - a.count)[0]
    : undefined;

  // Replaces the old "response time" tile, which had no source of truth behind
  // it: `getStats` hard-codes that field to an em dash, so the tile could never
  // show a number. This one is derived from data the dashboard already has.
  const messagesPerChat =
    stats && stats.totalChats > 0 ? Math.round(stats.totalMessages / stats.totalChats) : 0;

  return (
    <div className="content-enter">
        {/* Empty state — first-time onboarding */}
        {chats.length === 0 && automations.length === 0 && (
          <div className="content-enter">
            <Card className="mb-8">
              {onboardingProfile ? (
                <div className="mx-auto max-w-2xl px-5 py-8 sm:px-8">
                  <div className="mb-5 flex items-start gap-3.5">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                      <HugeiconsIcon icon={RocketIcon} size={20} strokeWidth={1.6} />
                    </div>
                    <div>
                      <h2 className="font-cooper text-xl tracking-[-0.02em]">{t("dashboard.activationTitle")}</h2>
                      <p className="mt-1 max-w-lg text-sm leading-relaxed text-muted-foreground">
                        {t("dashboard.activationBody")}
                      </p>
                    </div>
                  </div>
                  <OnboardingPlan profile={onboardingProfile} />
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4 px-5 py-12 text-center">
                  <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                    <HugeiconsIcon icon={RocketIcon} size={24} strokeWidth={1.5} />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-base font-medium">{t("dashboard.emptyTitle")}</p>
                    <p className="max-w-sm text-sm text-muted-foreground">
                      {t("dashboard.emptyDescription")}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-3 pt-2">
                    <Button asChild>
                      <Link href="/chat">
                        <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={1.75} />
                        {t("dashboard.emptyStartChat")}
                      </Link>
                    </Button>
                    <Button variant="outline" asChild>
                      <Link href="/automations">
                        <HugeiconsIcon icon={AiElementsIcon} size={16} strokeWidth={1.75} />
                        {t("dashboard.emptyCreateAutomation")}
                      </Link>
                    </Button>
                    <Button variant="outline" asChild>
                      <Link href="/settings">
                        <HugeiconsIcon icon={Settings01Icon} size={16} strokeWidth={1.75} />
                        {t("dashboard.emptyConfigureChannels")}
                      </Link>
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* Stats grid — every tile's second line carries something the big
            number cannot say on its own: which channel is driving the volume,
            how many automations produced those replies, how many
            conversations the average is drawn from.

            Each tile also draws its own picture, and they are four different
            pictures because the four numbers are four different shapes: a
            share of the book that is live, where the volume came from, how
            much of it never needed a person, and the curve over the fortnight
            the average is taken from. */}
        {stats ? (
          <div className="mb-8">
            <CardCarousel stats label={t("carousel.stats")}>
              <div className="flex items-stretch gap-4" style={{ paddingInline: "2px" }}>
                <div className="min-w-[200px] flex-1">
                  <KpiCard
                    icon={MessageCircleIcon}
                    label={t("dashboard.conversations")}
                    value={stats.totalChats}
                    sub={
                      stats.activeChats === 0
                        ? t("dashboard.activeNowNone")
                        : stats.activeChats === 1
                          ? t("dashboard.activeNowOne")
                          : t("dashboard.activeNow", { count: stats.activeChats })
                    }
                    visual={
                      <KpiBars
                        ratio={stats.totalChats > 0 ? stats.activeChats / stats.totalChats : 0}
                        tone="positive"
                      />
                    }
                  />
                </div>
                <div className="min-w-[200px] flex-1">
                  <KpiCard
                    icon={SendIcon}
                    label={t("dashboard.messagesTotal")}
                    value={stats.totalMessages}
                    sub={
                      leadChannel
                        ? t("dashboard.leadChannel", {
                            channel: CHANNEL_LABELS[leadChannel.channel],
                            percentage: leadChannel.percentage,
                          })
                        : t("dashboard.noMessagesYet")
                    }
                    visual={
                      <KpiSplit
                        parts={stats.channelBreakdown.map((cb) => ({
                          tone: "neutral" as const,
                          value: cb.count,
                        }))}
                      />
                    }
                  />
                </div>
                <div className="min-w-[200px] flex-1">
                  <KpiCard
                    icon={ZapIcon}
                    label={t("dashboard.autoReplies")}
                    value={stats.automatedReplies}
                    sub={
                      activeAutomations.length === 0
                        ? t("dashboard.noAutomationsYet")
                        : activeAutomations.length === 1
                          ? t("dashboard.activeAutomationsOne")
                          : t("dashboard.activeAutomations", { count: activeAutomations.length })
                    }
                    visual={
                      <KpiBars
                        ratio={
                          stats.totalMessages > 0
                            ? stats.automatedReplies / stats.totalMessages
                            : 0
                        }
                      />
                    }
                  />
                </div>
                <div className="min-w-[200px] flex-1">
                  <KpiCard
                    icon={ChartAverageIcon}
                    label={t("dashboard.messagesPerChat")}
                    value={messagesPerChat}
                    sub={
                      stats.totalChats === 1
                        ? t("dashboard.overChatsOne")
                        : t("dashboard.overChats", { count: stats.totalChats })
                    }
                    visual={<KpiSparkline points={activity.map((point) => point.value)} />}
                  />
                </div>
              </div>
            </CardCarousel>
          </div>
        ) : null}

        {/* Two column: Activity chart + Channel breakdown */}
        <div className="mb-8 grid gap-4 lg:grid-cols-3">
          {/* Activity chart */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                <HugeiconsIcon icon={TrendingUpIcon} size={16} strokeWidth={1.75} />
              </div>
              <div className="min-w-0 flex-1">
                <CardTitle as="h2">{t("dashboard.weeklyActivity")}</CardTitle>
                <CardDescription>{t("dashboard.messagesByDay")}</CardDescription>
              </div>
              {/* The week's total belongs next to the chart it summarises —
                  the bars answer "when", this answers "how much". */}
              <p className="shrink-0 font-medium text-lg leading-none tabular-nums">
                <AnimatedNumber value={activity.reduce((sum, d) => sum + d.value, 0)} />
              </p>
            </CardHeader>
            <CardSeparator />
            <div className="px-4 py-6">
              <ActivityChart data={activity} />
            </div>
          </Card>

          {/* Channel breakdown */}
          <Card>
            <CardHeader>
              <div className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                <HugeiconsIcon icon={MessageCircleIcon} size={16} strokeWidth={1.75} />
              </div>
              <div>
                <CardTitle as="h2">{t("dashboard.channels")}</CardTitle>
                <CardDescription>{t("dashboard.channelBreakdown")}</CardDescription>
              </div>
              <AnimatedNumber className="ml-auto text-lg font-medium" value={stats?.channelBreakdown.reduce((sum, channel) => sum + channel.count, 0) ?? 0} />
            </CardHeader>
            <CardSeparator />
            <div className="px-5 py-4">
              {stats && stats.channelBreakdown.length > 0 ? (
                <DonutChart
                  data={stats.channelBreakdown.map((cb) => ({
                    key: cb.channel,
                    label: <ChannelBadge channel={cb.channel} />,
                    value: cb.count,
                    formatted: `${cb.count} (${cb.percentage}%)`,
                    formatValue: (value) => `${Math.round(value).toLocaleString()} (${cb.percentage}%)`,
                  }))}
                  emptyLabel={t("dashboard.noChannels")}
                />
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">{t("dashboard.noChannels")}</p>
              )}
            </div>
          </Card>
        </div>

        {/* Channels status */}
        <div className="mb-8">
          <h2 className="mb-4 text-sm font-medium">{t("dashboard.channelStatus")}</h2>
          {channels.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">{t("dashboard.noChannelStatus")}</p>
              <Button variant="outline" className="mt-3" asChild>
                <Link href="/settings">
                  <HugeiconsIcon icon={Settings01Icon} size={16} strokeWidth={1.75} />
                  {t("dashboard.emptyConfigureChannels")}
                </Link>
              </Button>
            </div>
          ) : (
            <CardCarousel label={t("dashboard.channels")}>
              <div className="flex items-stretch gap-4" style={{ paddingInline: "2px" }}>
                {channels.map((ch) => (
                  <div key={ch.id} className="min-w-[240px] flex-1">
                    <Card interactive>
                      <CardHeader>
                        <div className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                          <ChannelIcon channel={ch.id} />
                        </div>
                        <div className="flex-1">
                          <CardTitle>{ch.label}</CardTitle>
                          <CardDescription>
                            {ch.messageCount} {t("dashboard.messages")} · {ch.lastEvent ? relativeTime(ch.lastEvent) : ""}
                          </CardDescription>
                        </div>
                      </CardHeader>
                      <CardSeparator />
                      <div className="px-5 py-3">
                        <ChannelStatusBadge status={ch.status} />
                      </div>
                    </Card>
                  </div>
                ))}
              </div>
            </CardCarousel>
          )}
        </div>

        {/* Recent chats */}
        <div className="mb-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium">{t("dashboard.recentChats")}</h2>
            <Link
              href="/history"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("dashboard.viewAll")}
            </Link>
          </div>
          {recentChats.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">{t("dashboard.noChats")}</p>
              <Button variant="outline" className="mt-3" asChild>
                <Link href="/chat">
                  <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={1.75} />
                  {t("dashboard.emptyStartChat")}
                </Link>
              </Button>
            </div>
          ) : (
            <Card>
              <div className="divide-y divide-border">
                {recentChats.map((chat) => (
                <a
                  key={chat.id}
                  href="/chat"
                  // The row opens that conversation, the way the history list
                  // does: stage its session, then a client-side push. A plain
                  // link landed on an empty new chat.
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                    event.preventDefault();
                    stageChatSession(chat, chatStorageKey);
                    router.push("/chat");
                  }}
                  className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-accent/50"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                    <ChannelIcon channel={chat.channel} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {chatTitle(chat) ?? t("chats.newConversation")}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{chat.lastMessage}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {relativeTime(chat.lastMessageAt)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                      {chat.messageCount} {t("dashboard.messages")}
                    </p>
                  </div>
                </a>
              ))}
              </div>
            </Card>
          )}
        </div>

        {/* Active automations */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium">{t("dashboard.activeAutomationsTitle")}</h2>
            <Link
              href="/automations"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("dashboard.viewAll")}
            </Link>
          </div>
          {activeAutomations.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">{t("dashboard.noAutomations")}</p>
              <Button variant="outline" className="mt-3" asChild>
                <Link href="/automations">
                  <HugeiconsIcon icon={AiElementsIcon} size={16} strokeWidth={1.75} />
                  {t("dashboard.emptyCreateAutomation")}
                </Link>
              </Button>
            </div>
          ) : (
            <CardCarousel label={t("dashboard.activeAutomationsTitle")}>
              <div className="flex items-stretch gap-4" style={{ paddingInline: "2px" }}>
                {activeAutomations.slice(0, 4).map((auto) => (
                  <div key={auto.id} className="min-w-[260px] flex-1">
                    <Card interactive>
                      <CardHeader>
                        <div className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                          <HugeiconsIcon icon={ZapIcon} size={16} strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <CardTitle>{auto.name}</CardTitle>
                          <CardDescription>
                            {auto.responseCount} {t("automations.responses")} ·{" "}
                            {auto.lastTriggeredAt ? relativeTime(auto.lastTriggeredAt) : t("dashboard.never")}
                          </CardDescription>
                        </div>
                      </CardHeader>
                    </Card>
                  </div>
                ))}
              </div>
            </CardCarousel>
          )}
        </div>
    </div>
  );
}

// ── Activity chart ─────────────────────────────────────────────────

/**
 * Weekly message volume.
 *
 * A thin adapter over the shared time-series mark: the dashboard owns the
 * dictionary lookup and the tooltip sentence, the chart owns the geometry.
 */
function ActivityChart({ data }: { readonly data: ActivityPoint[] }) {
  const t = useT();
  return (
    <TimeSeries
      data={data.map((point) => ({
        key: point.labelKey,
        label: t(point.labelKey),
        value: point.value,
      }))}
      emptyLabel={t("dashboard.noActivity")}
      formatValue={(point) => (
        <>
          <span className="font-medium tabular-nums">{point.value}</span>{" "}
          {t("dashboard.messages")} · {point.label}
        </>
      )}
    />
  );
}
