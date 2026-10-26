"use client";

import Link from "next/link";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  Archive02Icon,
  ArrowReloadHorizontalIcon,
  ArrowUpRight01Icon,
  BubbleChatIcon,
  Clock01Icon,
  Mail01Icon,
  MailOpen01Icon,
  Timer01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { Card, CardDescription, CardHeader, CardTitle } from "../../_components/dashboard-card";
import { StatusBadge, type StatusVariant } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { RowAction } from "@/components/ui/row-action";
import { NotificationAvatar } from "@/components/notifications/agent-avatar";
import { useNotifications } from "@/components/notifications/notification-provider";
import { ApprovalControls, ApprovalOutcome, notificationDetail, useNotificationView } from "@/components/notifications/notification-row";
import { useI18n } from "@/lib/i18n/provider";
import { fullTime, relativeTime, timeUntil } from "@/lib/format";
import type { AppNotification, ApprovalStatus } from "@/lib/notification-types";
import { cn } from "@/lib/utils";

/** Approval status → the shared badge vocabulary the rest of the app uses. */
const APPROVAL_VARIANT: Record<ApprovalStatus, StatusVariant> = {
  pending: "pending",
  approved: "success",
  declined: "failed",
  expired: "expired",
};

/** One notification in the card anatomy reminders and automations use: the
 *  inner card holds who asked for what and the decision; the shell under it
 *  carries when, who and where, and the item's own actions. */
export function NotificationCard({ item, highlighted = false }: { readonly item: AppNotification; readonly highlighted?: boolean }) {
  const { t, locale } = useI18n();
  const { busy, mutate } = useNotifications();
  const { approval, status, pending, unread, actor, href, api, contact, subject, channel } = useNotificationView(item);
  const detail = notificationDetail(item, t);
  const markRead = () => { if (!item.readAt) void mutate(item.id, api, "PATCH", { op: "read" }); };
  const hasBody = Boolean(detail || approval?.proposedReply || approval?.note || approval?.followUp || pending);

  return (
    <Card className={cn(
      "scroll-mt-6 rounded-[20px] border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]",
      highlighted && "ring-2 ring-ring/40",
    )}>
      <article id={`notification-${item.id}`} aria-label={`${actor}: ${subject}`} aria-busy={busy === item.id} className="flex flex-col">
        <div className="overflow-hidden rounded-[14px] border border-border/50 bg-card shadow-xs">
          <CardHeader className={cn(hasBody && "pb-3")}>
            <NotificationAvatar actor={item.actor} type={item.type} quiet={!pending && !unread} />
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className={cn("min-w-0 [overflow-wrap:anywhere]", !unread && !pending && "text-muted-foreground")}>{subject}</CardTitle>
                {status ? <StatusBadge status={APPROVAL_VARIANT[status]} label={t(`notifications.status.${status}`)} /> : null}
              </div>
              <CardDescription>
                <span className="font-medium text-foreground/80">{actor}</span>
                <span aria-hidden="true"> · </span>
                {t(`notifications.kind.${item.type}`)}
              </CardDescription>
            </div>
            {unread ? <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" role="img" aria-label={t("notifications.unread")} /> : null}
          </CardHeader>

          {hasBody ? <div className="space-y-3 px-5 pb-5 sm:pl-[72px]">
            {detail ? <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap [overflow-wrap:anywhere]">{detail}</p> : null}
            {approval?.proposedReply ? <blockquote className="rounded-xl bg-muted/50 px-3.5 py-3 shadow-[var(--shadow-inset)]">
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">{t("notifications.proposedReply")}</p>
              <p className="text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{approval.proposedReply}</p>
            </blockquote> : null}
            {pending ? <ApprovalControls item={item} /> : <ApprovalOutcome item={item} />}
          </div> : null}
        </div>

        {/* Metadata + actions — outside the inner border, like every nested card */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 pt-2 pb-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <HugeiconsIcon icon={Clock01Icon} size={14} strokeWidth={1.75} />
              <time dateTime={item.createdAt} title={fullTime(item.createdAt, locale)}>{relativeTime(item.createdAt, locale)}</time>
            </span>
            {contact && contact !== subject ? <span className="inline-flex min-w-0 items-center gap-1.5">
              <HugeiconsIcon icon={UserIcon} size={14} strokeWidth={1.75} />
              <span className="truncate">{contact}</span>
            </span> : null}
            {channel ? <span className="inline-flex items-center gap-1.5">
              <HugeiconsIcon icon={BubbleChatIcon} size={14} strokeWidth={1.75} />
              {channel}
            </span> : null}
            {pending && approval ? <span className="inline-flex items-center gap-1.5 text-[color:var(--status-pending-fg)]">
              <HugeiconsIcon icon={Timer01Icon} size={14} strokeWidth={1.75} />
              {t("notifications.expires", { time: timeUntil(approval.expiresAt, locale) })}
            </span> : null}
          </div>
          <div className="flex items-center gap-1">
            {href ? <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
              <Link href={href} onClick={markRead}>
                {t(item.target?.kind === "contact" ? "notifications.openConversation" : item.target?.kind === "ads" ? "notifications.openAds" : "notifications.openTeam")}
                <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} strokeWidth={1.75} />
              </Link>
            </Button> : null}
            <RowAction
              icon={item.readAt ? Mail01Icon : MailOpen01Icon}
              label={t(item.readAt ? "notifications.markUnread" : "notifications.markRead")}
              disabled={Boolean(busy)}
              onClick={() => void mutate(item.id, api, "PATCH", { op: item.readAt ? "unread" : "read" })}
            />
            <RowAction
              icon={item.archivedAt ? ArrowReloadHorizontalIcon : Archive02Icon}
              label={t(item.archivedAt ? "notifications.restore" : "notifications.archive")}
              disabled={pending || Boolean(busy)}
              disabledLabel={pending ? t("notifications.archiveBlocked") : undefined}
              onClick={() => void mutate(item.id, api, "PATCH", { op: item.archivedAt ? "restore" : "archive" })}
            />
          </div>
        </div>
      </article>
    </Card>
  );
}
