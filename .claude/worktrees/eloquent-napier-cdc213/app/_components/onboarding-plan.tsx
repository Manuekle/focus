"use client";

import Link from "next/link";
import { useState } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/icon";
import {
  ArrowRight01Icon,
  Calendar03Icon,
  CallIcon,
  ChatSpark01Icon,
  CheckmarkCircle02Icon,
  InboxIcon,
  LibraryIcon,
  Megaphone01Icon,
  ZapIcon,
} from "@hugeicons/core-free-icons";
import {
  onboardingActionHref,
  onboardingChatDraft,
  recommendedOnboardingActions,
  actionNeedsConnection,
} from "@/lib/onboarding/recommendations";
import type { OnboardingActionId, OnboardingProfile } from "@/lib/onboarding/types";
import {
  requestNewChat,
  saveOnboardingChatDraft,
  useBrowserStorageScope,
} from "@/lib/browser-storage-scope";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

const ACTION_ICONS: Record<OnboardingActionId, IconSvgElement> = {
  chat: ChatSpark01Icon,
  inbox: InboxIcon,
  ads: Megaphone01Icon,
  automations: ZapIcon,
  knowledge: LibraryIcon,
  commerce: Calendar03Icon,
  voice: CallIcon,
};

export function OnboardingPlan({
  className,
  profile,
}: {
  readonly className?: string;
  readonly profile: OnboardingProfile;
}) {
  const { locale, t } = useI18n();
  const storageScope = useBrowserStorageScope();
  const [started, setStarted] = useState<readonly OnboardingActionId[]>(
    profile.activation.startedActionIds,
  );
  const actions = recommendedOnboardingActions(profile);
  // The owner's own first goal is the priority the chat opens with; with no
  // goal picked, the plan's first suggestion stands in for it.
  const priority = profile.goals[0] ?? actions.find((action) => action !== "chat");

  const rememberStart = (action: OnboardingActionId) => {
    if (!started.includes(action)) setStarted((current) => [...current, action]);
    void fetch("/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "started", actionId: action }),
    }).catch(() => null);
  };

  const startChat = () => {
    saveOnboardingChatDraft(
      storageScope,
      onboardingChatDraft({
        businessName: profile.businessName,
        channels: profile.channels.map((id) => ({ id, label: t(`onboarding.channel.${id}`) })),
        description: profile.description,
        industryLabel:
          profile.industry && profile.industry !== "other"
            ? t(`onboarding.industry.${profile.industry}`)
            : undefined,
        locale,
        messageVolumeLabel: profile.messageVolume ? t(`onboarding.messages.${profile.messageVolume}`) : undefined,
        priorityLabel: priority ? t(`onboarding.action.${priority}.priority`) : undefined,
      }),
    );
    requestNewChat(storageScope);
    rememberStart("chat");
  };

  return (
    <ol className={cn("flex flex-col gap-2.5", className)}>
      {actions.map((action, index) => {
        const isStarted = started.includes(action);
        // The first step is the one that needs nothing connected; it says so
        // until it has been started.
        const isFirst = index === 0 && !isStarted;
        const needsConnection = actionNeedsConnection(action);
        return (
          <li key={action}>
            <Link
              className={cn(
                "group flex items-center gap-3 rounded-xl border p-3.5 text-left shadow-[var(--shadow-inset)]",
                "motion-safe:transition-[border-color,background-color,transform] motion-safe:duration-200",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                isStarted
                  ? "border-input bg-muted/60"
                  : "border-border bg-card hover:border-input hover:bg-muted/40 motion-safe:hover:-translate-y-px",
                isFirst && "border-foreground/20",
              )}
              href={onboardingActionHref(action)}
              onClick={() => (action === "chat" ? startChat() : rememberStart(action))}
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-xl",
                  isStarted || isFirst ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
                )}
              >
                {isStarted ? (
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} strokeWidth={1.8} />
                ) : (
                  <HugeiconsIcon icon={ACTION_ICONS[action]} size={18} strokeWidth={1.75} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium text-sm">
                    {t(`onboarding.action.${action}.title`)}
                  </span>
                  {isStarted || isFirst ? (
                    <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.1em]">
                      {t(isStarted ? "onboarding.plan.started" : "onboarding.plan.first")}
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-muted-foreground text-xs leading-relaxed">
                  {t(`onboarding.action.${action}.body`)}
                </span>
                {needsConnection ? (
                  <span className="mt-1 block text-muted-foreground text-xs">
                    {t("onboarding.plan.connectionNeeded")}
                  </span>
                ) : null}
              </span>
              <span className="flex size-8 shrink-0 items-center justify-center text-muted-foreground">
                <HugeiconsIcon
                  className="motion-safe:transition-transform motion-safe:duration-200 group-hover:translate-x-0.5"
                  icon={ArrowRight01Icon}
                  size={16}
                  strokeWidth={2}
                />
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
