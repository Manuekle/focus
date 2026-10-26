"use client";

import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { TextShimmer } from "@/components/motion/text-shimmer";
import { Button } from "@/components/ui/button";
import { Orb, type OrbState } from "@/components/ui/orb";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { Alert02Icon, ArrowLeft01Icon, Loading03Icon, Tick02Icon } from "@hugeicons/core-free-icons";

export const REVIEW_STEPS = ["business", "channels", "volume", "plan"] as const;
export type ReviewStep = (typeof REVIEW_STEPS)[number];
export type SaveState = "saving" | "saved" | "error";

/** How long each step holds, in ms. Uneven on purpose: a row of identical
 *  beats reads as a progress bar pretending to think. */
const DURATIONS: readonly number[] = [1000, 1150, 1300, 950];
const REDUCED_DURATION = 260;
const ORB_STATES: readonly OrbState[] = ["searching", "weaving", "solving", "shaping"];

const RING_RADIUS = 46;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * "Revisando tu perfil": the beat between the last answer and the summary.
 *
 * It is not a fake wait. The profile is saved while it runs, each row closes
 * on a detail read off the owner's own answers — their name, their channels,
 * their volume — and the last row cannot close until the save has actually
 * landed. If it fails, the row says so and offers a retry with every answer
 * still in place, instead of pretending and dropping them on the next screen.
 */
export function ProfileReview({
  details,
  headingId,
  headingRef,
  onDone,
  onEdit,
  onRetry,
  saveState,
}: {
  readonly details: Record<ReviewStep, string>;
  readonly headingId?: string;
  readonly headingRef?: React.Ref<HTMLHeadingElement>;
  readonly onDone: () => void;
  readonly onEdit: () => void;
  readonly onRetry: () => void;
  readonly saveState: SaveState;
}) {
  const t = useT();
  const reduce = useReducedMotion();
  const last = REVIEW_STEPS.length - 1;
  const [active, setActive] = useState(0);
  const [lastHeld, setLastHeld] = useState(false);
  const complete = active === last && lastHeld && saveState === "saved";
  const failed = active === last && saveState === "error";
  const hold = (index: number) => (reduce ? REDUCED_DURATION : DURATIONS[index]);

  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  // One timer per step. The last step's timer only marks that it has been on
  // screen long enough to read; closing it also needs the save.
  useEffect(() => {
    const timer = window.setTimeout(
      () => (active < last ? setActive(active + 1) : setLastHeld(true)),
      reduce ? REDUCED_DURATION : DURATIONS[active],
    );
    return () => window.clearTimeout(timer);
  }, [active, last, reduce]);

  useEffect(() => {
    if (!complete) return;
    const timer = window.setTimeout(() => onDoneRef.current(), reduce ? 250 : 900);
    return () => window.clearTimeout(timer);
  }, [complete, reduce]);

  // The ring fills across each step at that step's pace, and parks just short
  // of full while the save is still out — it only closes when the row does.
  const progress = complete ? 1 : active < last ? (active + 1) / REVIEW_STEPS.length : 0.93;
  const ringTransition = complete
    ? "stroke-dashoffset 360ms cubic-bezier(0.16, 1, 0.3, 1)"
    : `stroke-dashoffset ${hold(active)}ms linear`;

  return (
    <div aria-busy={!complete && !failed} className="flex flex-col items-center px-5 pt-8 pb-6 text-center sm:px-8 sm:pt-10">
      <div className="relative flex size-[104px] items-center justify-center">
        <svg aria-hidden="true" className="-rotate-90 absolute inset-0" height={104} viewBox="0 0 104 104" width={104}>
          <circle className="stroke-border" cx={52} cy={52} fill="none" r={RING_RADIUS} strokeWidth={2} />
          <circle
            className={cn(failed ? "stroke-destructive" : "stroke-foreground")}
            cx={52}
            cy={52}
            fill="none"
            r={RING_RADIUS}
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={RING_LENGTH * (1 - progress)}
            strokeLinecap="round"
            strokeWidth={2}
            style={{ transition: reduce ? "none" : ringTransition }}
          />
        </svg>
        <AnimatePresence initial={false} mode="popLayout">
          {complete ? (
            <motion.span
              animate={{ opacity: 1, scale: 1 }}
              className="flex size-16 items-center justify-center rounded-full bg-foreground text-background shadow-[var(--shadow-elevated)]"
              initial={reduce ? false : { opacity: 0, scale: 0.6 }}
              key="done"
              transition={reduce ? { duration: 0 } : { type: "spring", bounce: 0.45, visualDuration: 0.4 }}
            >
              <HugeiconsIcon icon={Tick02Icon} size={28} strokeWidth={2.4} />
            </motion.span>
          ) : (
            <motion.span
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              initial={false}
              key="orb"
              transition={{ duration: 0.2 }}
            >
              <Orb size={64} state={ORB_STATES[Math.min(active, ORB_STATES.length - 1)]} />
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <h2
        className="mt-6 font-cooper text-[1.65rem] leading-[1.1] outline-none font-medium tracking-[-0.02em]"
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
      >
        {complete ? (
          t("onboarding.review.done")
        ) : failed ? (
          t("onboarding.review.errorTitle")
        ) : (
          <TextShimmer duration={2.2}>{t("onboarding.review.title")}</TextShimmer>
        )}
      </h2>
      <p className="mt-2 max-w-[36ch] text-balance text-[14px] text-muted-foreground leading-relaxed">
        {failed ? t("onboarding.review.errorBody") : t("onboarding.review.body")}
      </p>

      <ol className="mt-7 flex w-full max-w-sm flex-col gap-1 text-left">
        {REVIEW_STEPS.map((step, index) => {
          const status =
            index < active || (index === last && complete)
              ? "done"
              : index === active
                ? failed
                  ? "error"
                  : "active"
                : "pending";
          return (
            <li className="flex items-start gap-3 rounded-xl px-2 py-2" key={step}>
              <StepIcon reduce={Boolean(reduce)} status={status} />
              <div className="min-w-0 flex-1 pt-px">
                <p
                  className={cn(
                    "text-sm leading-5 motion-safe:transition-colors motion-safe:duration-300",
                    status === "pending" ? "text-muted-foreground/70" : "text-foreground",
                    status === "done" && "font-medium",
                  )}
                >
                  {status === "active" ? (
                    <TextShimmer duration={1.8}>{t(`onboarding.review.step.${step}`)}</TextShimmer>
                  ) : (
                    t(`onboarding.review.step.${step}`)
                  )}
                </p>
                <AnimatePresence initial={false}>
                  {status === "done" ? (
                    <motion.p
                      animate={{ height: "auto", opacity: 1 }}
                      className="overflow-hidden text-muted-foreground text-xs leading-5"
                      initial={reduce ? false : { height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    >
                      {details[step]}
                    </motion.p>
                  ) : null}
                </AnimatePresence>
              </div>
            </li>
          );
        })}
      </ol>

      {failed ? (
        <div className="mt-5 flex w-full max-w-sm flex-col-reverse gap-2 sm:flex-row" role="alert">
          <Button className="sm:flex-1" onClick={onEdit} type="button" variant="outline">
            <HugeiconsIcon icon={ArrowLeft01Icon} size={16} strokeWidth={2} />
            {t("onboarding.review.edit")}
          </Button>
          <Button className="sm:flex-1" onClick={onRetry} type="button">
            <HugeiconsIcon icon={Loading03Icon} size={16} strokeWidth={2} />
            {t("onboarding.review.retry")}
          </Button>
        </div>
      ) : null}

      <p aria-live="polite" className="sr-only" role="status">
        {complete ? t("onboarding.review.done") : failed ? t("onboarding.review.errorTitle") : t("onboarding.review.title")}
      </p>
    </div>
  );
}

function StepIcon({ reduce, status }: { readonly reduce: boolean; readonly status: "pending" | "active" | "done" | "error" }) {
  return (
    <span aria-hidden="true" className="relative flex size-5 shrink-0 items-center justify-center">
      <AnimatePresence initial={false} mode="popLayout">
        {status === "done" ? (
          <motion.span
            animate={{ opacity: 1, scale: 1 }}
            className="flex size-5 items-center justify-center rounded-full bg-foreground text-background"
            initial={reduce ? false : { opacity: 0, scale: 0.4 }}
            key="done"
            transition={reduce ? { duration: 0 } : { type: "spring", bounce: 0.5, visualDuration: 0.3 }}
          >
            <HugeiconsIcon icon={Tick02Icon} size={12} strokeWidth={2.8} />
          </motion.span>
        ) : status === "error" ? (
          <motion.span
            animate={{ opacity: 1, scale: 1 }}
            className="flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
            initial={reduce ? false : { opacity: 0, scale: 0.6 }}
            key="error"
          >
            <HugeiconsIcon icon={Alert02Icon} size={12} strokeWidth={2.4} />
          </motion.span>
        ) : status === "active" ? (
          <motion.span animate={{ opacity: 1 }} initial={{ opacity: 0 }} key="active">
            <Spinner aria-hidden="true" className="text-foreground" role="presentation" size={16} />
          </motion.span>
        ) : (
          <motion.span
            animate={{ opacity: 1 }}
            className="size-1.5 rounded-full bg-muted-foreground/35"
            initial={false}
            key="pending"
          />
        )}
      </AnimatePresence>
    </span>
  );
}
