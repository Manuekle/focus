"use client";

import "../product.css";
import { RemindersSkeleton } from "./page-skeleton";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  Timer01Icon,
  Delete01Icon,
  SearchIcon,
  Clock01Icon,
  CheckIcon,
  CancelCircleIcon,
} from "@hugeicons/core-free-icons";
import { PageContainer } from "../../_components/page-container";
import { Card, CardHeader, CardTitle, CardDescription } from "../../_components/dashboard-card";
import { KpiBars, KpiCard } from "../../_components/kpi-card";
import { CardCarousel } from "../../_components/card-carousel";
import { StatusBadge, type StatusVariant } from "../../_components/channel-badge";
import { Skeleton } from "@/components/ai-elements/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast-provider";
import { useI18n } from "@/lib/i18n/provider";
import { fetchJson, type UiError } from "@/lib/api-error-message";
import { ErrorBanner } from "@/components/ui/error-banner";
import { useSound } from "@/components/sound-provider";
import { fullTime, relativeTime, timeUntil } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Reminder, ReminderActivity, ReminderActivityType, ReminderStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";

/** Reminder status → the shared badge vocabulary the rest of the app uses. */
const STATUS_VARIANT: Record<ReminderStatus, StatusVariant> = {
  pending: "pending",
  // A claimed reminder: the worker holding it is talking to WhatsApp right
  // now. Seconds long in the normal case, and honest about the one state
  // where a reminder is neither waiting nor finished.
  sending: "in-progress",
  sent: "success",
  failed: "failed",
  cancelled: "expired",
};

const STATUS_LABEL: Record<ReminderStatus, string> = {
  // Singular: this one labels a single reminder, not the section of them.
  pending: "reminders.statusPending",
  sending: "reminders.statusSending",
  sent: "reminders.sent",
  failed: "reminders.failed",
  cancelled: "reminders.cancelled",
};

/** Still on its way out, so still part of the queue rather than history. */
const OPEN_STATUSES = new Set<ReminderStatus>(["pending", "sending"]);

export default function RemindersPage() {
  const { t } = useI18n();
  const { cue } = useSound();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const { toast } = useToast();
  const reduce = useReducedMotion();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [activity, setActivity] = useState<ReminderActivity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<UiError | null>(null);

  const fetchReminders = useCallback(async () => {
    const result = await fetchJson<{ reminders?: Reminder[]; activity?: ReminderActivity[] }>("/api/reminders", t);
    if (result.ok) {
      setReminders(result.data.reminders ?? []);
      setActivity(result.data.activity ?? []);
      setError(null);
    } else {
      // A list that silently stays empty on a failed load reads as "you have
      // no reminders", which is the wrong thing to believe.
      setError(result.error);
    }
    setIsLoading(false);
  }, [t]);

  useEffect(() => {
    void fetchReminders();
  }, [fetchReminders]);

  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: t("reminders.confirmDelete") }))) return;
    // `close` falls shut — a deletion is a dismissal, not a win.
    cue("close");
    // Optimistic: the row exits immediately and comes back if the server
    // refuses, rather than the list sitting still until the round trip lands.
    const previous = reminders;
    setReminders((prev) => prev.filter((r) => r.id !== id));
    const result = await fetchJson(`/api/reminders?id=${encodeURIComponent(id)}`, t, {
      method: "DELETE",
    });
    if (!result.ok) {
      setReminders(previous);
      setError(result.error);
      toast({ title: t("common.somethingWentWrong"), description: t("common.somethingWentWrongDescription"), status: "error" });
    } else {
      await fetchReminders();
      toast({ title: t("common.deleted"), description: t("common.deletedDescription"), status: "success" });
    }
  };

  const counts = useMemo(
    () => ({
      pending: reminders.filter((r) => OPEN_STATUSES.has(r.status)).length,
      sent: reminders.filter((r) => r.status === "sent").length,
      cancelled: reminders.filter((r) => r.status === "cancelled").length,
    }),
    [reminders],
  );

  /** One status's share of every reminder, for the meter on its tile. */
  const share = (count: number) => (reminders.length > 0 ? count / reminders.length : 0);

  const matches = useCallback(
    (list: Reminder[]) => {
      const q = search.trim().toLowerCase();
      if (!q) return list;
      return list.filter((r) => r.message.toLowerCase().includes(q));
    },
    [search],
  );

  // Pending first and soonest-first — the list is a queue, so the next thing
  // to happen belongs at the top. History runs newest-first instead.
  const pending = useMemo(
    () =>
      matches(reminders.filter((r) => OPEN_STATUSES.has(r.status))).sort(
        (a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime(),
      ),
    [reminders, matches],
  );
  const history = useMemo(
    () =>
      matches(reminders.filter((r) => !OPEN_STATUSES.has(r.status))).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [reminders, matches],
  );
  const filteredActivity = useMemo(
    () => {
      const q = search.trim().toLowerCase();
      return activity
        .filter((entry) => !q || entry.reminder_message.toLowerCase().includes(q))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    },
    [activity, search],
  );

  const searching = search.trim().length > 0;
  const noMatches = searching && pending.length === 0 && history.length === 0 && filteredActivity.length === 0;

  return (
    <PageContainer
      maxWidth="max-w-6xl"
      title={t("reminders.title")}
      description={t("reminders.subtitle")}
      actions={reminders.length > 0 ? (
        <span className="inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-card px-3 text-[13px] font-medium shadow-[var(--shadow-inset)] md:h-7">
          <HugeiconsIcon icon={Clock01Icon} size={14} strokeWidth={1.75} className="text-muted-foreground" />
          <span>
            <span className="tabular-nums">{counts.pending}</span>{" "}
            {t("reminders.pending").toLowerCase()}
          </span>
        </span>
      ) : null}
    >
      {confirmDialog}
      <Skeleton
        className="min-h-[500px]"
        isLoading={isLoading}
        skeleton={<RemindersSkeleton />}
      >
        <div className="content-enter">
          <ErrorBanner
            className="mb-6"
            error={error}
            onRetry={() => void fetchReminders()}
            onDismiss={() => setError(null)}
          />

          {reminders.length === 0 && activity.length === 0 ? (
            <Card>
              <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                  <HugeiconsIcon icon={Timer01Icon} size={20} strokeWidth={1.75} />
                </div>
                <p className="text-sm font-medium">{t("reminders.emptyTitle")}</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  {t("reminders.emptyDescription")}
                </p>
              </div>
            </Card>
          ) : (
            <>
              {/* Stats bar */}
              <CardCarousel stats label={t("carousel.stats")}>
                <div className="mb-6 flex items-stretch gap-4" style={{ paddingInline: "2px" }}>
                  {/* Each second line says what happens next to that pile,
                      which is what someone reading a reminder count wants to
                      know — not a repeat of the status word above it. */}
                  <div className="min-w-[220px] flex-1">
                    <KpiCard
                      icon={Clock01Icon}
                      label={t("reminders.pending")}
                      sub={t(counts.pending > 0 ? "reminders.pendingSub" : "reminders.pendingSubNone")}
                      value={counts.pending}
                      visual={<KpiBars ratio={share(counts.pending)} tone="warning" />}
                    />
                  </div>
                  <div className="min-w-[220px] flex-1">
                    <KpiCard
                      icon={CheckIcon}
                      label={t("reminders.sentCount")}
                      sub={t(counts.sent > 0 ? "reminders.sentSub" : "reminders.sentSubNone")}
                      value={counts.sent}
                      visual={<KpiBars ratio={share(counts.sent)} tone="positive" />}
                    />
                  </div>
                  <div className="min-w-[220px] flex-1">
                    <KpiCard
                      icon={CancelCircleIcon}
                      label={t("reminders.cancelledCount")}
                      sub={t(counts.cancelled > 0 ? "reminders.cancelledSub" : "reminders.cancelledSubNone")}
                      value={counts.cancelled}
                      visual={<KpiBars ratio={share(counts.cancelled)} />}
                    />
                  </div>
                </div>
              </CardCarousel>

              {/* Search */}
              <div className="relative mb-4">
                <HugeiconsIcon
                  icon={SearchIcon}
                  size={16}
                  strokeWidth={1.75}
                  className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  aria-label={t("reminders.searchPlaceholder")}
                  placeholder={t("reminders.searchPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              {noMatches ? (
                <Card>
                  <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
                    <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                      <HugeiconsIcon icon={SearchIcon} size={20} strokeWidth={1.75} />
                    </div>
                    <p className="text-sm font-medium">{t("reminders.noResults")}</p>
                    <p className="max-w-xs text-xs text-muted-foreground">
                      {t("reminders.noResultsHint")}
                    </p>
                  </div>
                </Card>
              ) : (
                <div className="space-y-6">
                  <ReminderSection
                    title={t("reminders.pending")}
                    count={pending.length}
                    items={pending}
                    reduce={reduce}
                    onDelete={handleDelete}
                  />
                  <ReminderSection
                    title={t("reminders.history")}
                    count={history.length}
                    items={history}
                    reduce={reduce}
                  />
                  <ActivitySection items={filteredActivity} reduce={reduce} />
                </div>
              )}
            </>
          )}
        </div>
      </Skeleton>
    </PageContainer>
  );
}

/** One titled group of reminder rows. Renders nothing when empty, so a page
 *  with no history doesn't carry a lone heading over blank space. */
function ReminderSection({
  title,
  count,
  items,
  reduce,
  onDelete,
}: {
  readonly title: string;
  readonly count: number;
  readonly items: readonly Reminder[];
  readonly reduce: boolean | null;
  readonly onDelete?: (id: string) => void;
}) {
  if (count === 0) return null;
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {title}
        <span className="tabular-nums text-muted-foreground">{count}</span>
      </h2>
      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {items.map((reminder) => (
            <motion.div
              key={reminder.id}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, x: -16 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              layout
            >
              <ReminderRow reminder={reminder} onDelete={onDelete} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}

/** A reminder, in the same card anatomy the automations list uses: an inset
 *  icon tile, title + description, a status badge, and the row's actions. */
function ReminderRow({
  reminder,
  onDelete,
}: {
  readonly reminder: Reminder;
  readonly onDelete?: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const done = !OPEN_STATUSES.has(reminder.status);

  return (
    <Card className="rounded-[20px] border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]">
      <div className="flex flex-col">
        <div className="overflow-hidden rounded-[14px] border border-border/50 bg-card shadow-xs">
          <CardHeader>
            <div
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-xl shadow-[var(--shadow-inset)]",
                done ? "bg-muted text-muted-foreground" : "bg-accent text-foreground",
              )}
            >
              <HugeiconsIcon icon={Timer01Icon} size={16} strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className={cn("truncate", done && "text-muted-foreground")}>
                  {reminder.message}
                </CardTitle>
                <StatusBadge
                  status={STATUS_VARIANT[reminder.status]}
                  label={t(STATUS_LABEL[reminder.status])}
                />
              </div>
              <CardDescription>
                {t("reminders.scheduledFor")} {fullTime(reminder.datetime, locale)}
              </CardDescription>
            </div>
          </CardHeader>
        </div>

        {/* Metadata + actions — outside the inner border */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 pt-2 pb-0.5">
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            {/* A pending reminder is in the future, so it counts down. A closed
                one has its outcome in the badge already — repeating it here would
                just be the same word twice on one card. */}
            {done ? null : (
              <span className="inline-flex items-center gap-1.5">
                <HugeiconsIcon icon={Clock01Icon} size={14} strokeWidth={1.75} />
                {timeUntil(reminder.datetime, locale)}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              {t("reminders.created")} · {relativeTime(reminder.created_at, locale)}
            </span>
          </div>
          {onDelete ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  onClick={() => void onDelete(reminder.id)}
                  aria-label={t("reminders.delete")}
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive"
                >
                  <HugeiconsIcon icon={Delete01Icon} size={16} strokeWidth={1.75} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("reminders.delete")}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

const ACTIVITY_STATUS: Record<ReminderActivityType, StatusVariant> = {
  created: "pending",
  sent: "success",
  failed: "failed",
  cancelled: "expired",
  deleted: "expired",
};

const ACTIVITY_LABEL: Record<ReminderActivityType, string> = {
  created: "reminders.activityCreated",
  sent: "reminders.activitySent",
  failed: "reminders.activityFailed",
  cancelled: "reminders.activityCancelled",
  deleted: "reminders.activityDeleted",
};

function ActivitySection({
  items,
  reduce,
}: {
  readonly items: readonly ReminderActivity[];
  readonly reduce: boolean | null;
}) {
  const { t, locale } = useI18n();
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {t("reminders.activity")}
        <span className="tabular-nums text-muted-foreground">{items.length}</span>
      </h2>
      <div className="space-y-3">
        <AnimatePresence initial={false}>
          {items.map((entry) => (
            <motion.div
              key={entry.id}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card className="rounded-[20px] border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]">
                <div className="overflow-hidden rounded-[14px] border border-border/50 bg-card shadow-xs">
                  <div className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <StatusBadge
                      status={ACTIVITY_STATUS[entry.type]}
                      label={t(ACTIVITY_LABEL[entry.type] as Parameters<typeof t>[0])}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{entry.reminder_message}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {relativeTime(entry.created_at, locale)}
                    </span>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
