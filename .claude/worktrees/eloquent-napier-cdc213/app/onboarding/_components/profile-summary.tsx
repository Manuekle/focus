"use client";

import { animate, motion } from "motion/react";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { useEffect, useRef, type CSSProperties } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import badgeStyles from "@/components/ui/category-badge.module.css";
import { useI18n } from "@/lib/i18n/provider";
import { onboardingInsights } from "@/lib/onboarding/insights";
import type { OnboardingProfile } from "@/lib/onboarding/types";
import { cn } from "@/lib/utils";
import { AiArtIcon } from "@hugeicons/core-free-icons";
import { QUESTIONS, monogram, type ChoiceQuestion } from "../_lib/questions";
import styles from "../onboarding.module.css";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

const channelOptions = (QUESTIONS.find((question) => question.id === "channels") as ChoiceQuestion).options;

/**
 * The profile the answers add up to: who the business is, where its customers
 * write from, and what that volume costs in hours today.
 *
 * Every number is an estimate from a range the owner picked — the strip under
 * the card says how it was worked out — so nothing here claims more than the
 * owner told us.
 */
export function ProfileSummary({ profile }: { readonly profile: OnboardingProfile }) {
  const { locale, t } = useI18n();
  const reduce = useReducedMotion();
  const insights = onboardingInsights(profile);
  const numberFormat = new Intl.NumberFormat(locale === "en" ? "en-US" : "es-AR");

  const meta = [
    profile.industry && profile.industry !== "other" ? t(`onboarding.industry.${profile.industry}`) : null,
    profile.teamSize ? t(`onboarding.team.${profile.teamSize}`) : null,
  ].filter((part): part is string => Boolean(part));

  const stats = [
    insights.monthlyMessages !== null
      ? { format: (n: number) => `~${numberFormat.format(n)}`, id: "messages", value: insights.monthlyMessages }
      : null,
    insights.monthlyCalls !== null
      ? { format: (n: number) => `~${numberFormat.format(n)}`, id: "calls", value: insights.monthlyCalls }
      : null,
    insights.monthlyHours !== null
      ? { format: (n: number) => `~${numberFormat.format(n)} h`, id: "hours", value: insights.monthlyHours }
      : null,
  ].filter((stat): stat is NonNullable<typeof stat> => stat !== null);

  const insightKey = profile.responseTime
    ? `onboarding.result.insight.${profile.responseTime}`
    : "onboarding.result.insight.default";

  // Each block rises in after the one above it, so the card reads top to
  // bottom the first time it is seen. Reduced motion shows it settled.
  const rise = (order: number) =>
    reduce
      ? {}
      : {
          animate: { filter: "blur(0px)", opacity: 1, transform: "translateY(0px)" },
          initial: { filter: "blur(4px)", opacity: 0, transform: "translateY(8px)" },
          transition: { delay: 0.12 + order * 0.08, duration: 0.5, ease: EASE_OUT },
        };

  return (
    <div className="px-5 pt-6 pb-5 sm:px-7 sm:pt-7">
      <motion.div className="flex items-center gap-4" {...rise(0)}>
        <span
          aria-hidden="true"
          className={cn(
            "flex size-14 shrink-0 items-center justify-center rounded-2xl bg-foreground font-cooper text-[1.35rem] text-background tracking-[-0.02em]",
            styles.monogram,
          )}
        >
          {monogram(profile.businessName)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-cooper text-[1.6rem] leading-[1.15] tracking-[-0.025em]">{profile.businessName}</p>
          {meta.length > 0 ? <p className="mt-0.5 truncate text-muted-foreground text-sm">{meta.join(" · ")}</p> : null}
        </div>
      </motion.div>

      {profile.description ? (
        <motion.p className="mt-4 text-[15px] text-foreground/80 leading-relaxed" {...rise(1)}>
          {profile.description}
        </motion.p>
      ) : null}

      {profile.channels.length > 0 ? (
        <motion.ul aria-label={t("onboarding.result.channels")} className="mt-4 flex flex-wrap gap-1.5" {...rise(2)}>
          {profile.channels.map((id) => {
            const option = channelOptions.find((candidate) => candidate.id === id);
            return (
              <li
                className={cn("inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-medium text-xs", badgeStyles.badge)}
                key={id}
                style={{ "--category-hue": option?.hue } as CSSProperties}
              >
                {option?.icon ? <HugeiconsIcon aria-hidden="true" icon={option.icon} size={14} strokeWidth={1.75} /> : null}
                {t(`onboarding.channel.${id}`)}
              </li>
            );
          })}
        </motion.ul>
      ) : null}

      {stats.length > 0 ? (
        <motion.dl
          className={cn(
            "mt-5 grid gap-2",
            stats.length === 3 ? "grid-cols-3" : stats.length === 2 ? "grid-cols-2" : "grid-cols-1",
          )}
          {...rise(3)}
        >
          {stats.map((stat, index) => (
            <div
              className="flex min-w-0 flex-col-reverse justify-end rounded-xl border border-border/70 bg-muted/40 px-3 py-2.5 shadow-[var(--shadow-inset)]"
              key={stat.id}
            >
              <dt className="mt-0.5 text-[11.5px] text-muted-foreground leading-snug">
                {t(`onboarding.result.stat.${stat.id}`)}
              </dt>
              <dd className="font-heading font-medium text-[1.35rem] tabular-nums leading-tight tracking-[-0.02em] sm:text-2xl">
                <CountUp delay={0.35 + index * 0.1} format={stat.format} value={stat.value} />
              </dd>
            </div>
          ))}
        </motion.dl>
      ) : null}

      <motion.p
        className="mt-4 flex gap-2.5 rounded-xl bg-muted/55 px-3.5 py-3 text-[13.5px] leading-relaxed"
        {...rise(4)}
      >
        <HugeiconsIcon aria-hidden="true" className="mt-0.5 shrink-0" icon={AiArtIcon} size={16} strokeWidth={1.75} />
        <span>{t(insightKey)}</span>
      </motion.p>
    </div>
  );
}

/**
 * A number that counts up once, written straight into the DOM so a second of
 * frames does not re-render the card sixty times. Assistive tech reads the
 * settled value from the hidden twin, never the frames in between.
 */
function CountUp({
  delay,
  format,
  value,
}: {
  readonly delay: number;
  readonly format: (value: number) => string;
  readonly value: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const formatRef = useRef(format);
  useEffect(() => {
    formatRef.current = format;
  });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reduce) {
      node.textContent = formatRef.current(value);
      return;
    }
    node.textContent = formatRef.current(0);
    const controls = animate(0, value, {
      delay,
      duration: 1.1,
      ease: EASE_OUT,
      onUpdate: (latest) => {
        node.textContent = formatRef.current(Math.round(latest));
      },
    });
    return () => controls.stop();
  }, [delay, reduce, value]);

  return (
    <>
      <span aria-hidden="true" ref={ref} style={{ fontVariantNumeric: "tabular-nums" } as CSSProperties}>
        {format(value)}
      </span>
      <span className="sr-only">{format(value)}</span>
    </>
  );
}
