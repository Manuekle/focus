"use client";

import { AnimatePresence, motion, type Variants } from "motion/react";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AuthBackdrop } from "@/app/_components/auth-backdrop";
import { OnboardingPlan } from "@/app/_components/onboarding-plan";
import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/icon";
import { OrukaTile } from "@/components/icons/oruka-mark";
import { useSound } from "@/components/sound-provider";
import { Button } from "@/components/ui/button";
import { FramedCard, FramedCardFooter, FramedCardPanel } from "@/components/ui/framed-card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { scopedBrowserStorageKey, useBrowserStorageScope } from "@/lib/browser-storage-scope";
import { useAppLocale, useI18n } from "@/lib/i18n/provider";
import { MINUTES_PER_CALL, MINUTES_PER_MESSAGE, onboardingInsights } from "@/lib/onboarding/insights";
import { recommendedOnboardingActions } from "@/lib/onboarding/recommendations";
import { recommendModules } from "@/lib/modules";
import type { OnboardingProfile } from "@/lib/onboarding/types";
import { cn } from "@/lib/utils";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ChatSpark01Icon,
  Clock01Icon,
  PencilEdit02Icon,
  Route01Icon,
  AiArtIcon,
} from "@hugeicons/core-free-icons";
import { ChoiceCard } from "./_components/choice-card";
import { ProfileReview, type ReviewStep, type SaveState } from "./_components/profile-review";
import { ProfileSummary } from "./_components/profile-summary";
import {
  CHAPTERS,
  EMPTY_ANSWERS,
  isAnswered,
  toProfile,
  visibleQuestions,
  type Answers,
  type ChoiceQuestion,
  type Question,
  type QuestionId,
  type TextQuestion,
} from "./_lib/questions";

type Stage =
  | { readonly kind: "welcome" }
  | { readonly kind: "question"; readonly id: QuestionId }
  | { readonly kind: "review" }
  | { readonly kind: "result" };

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Long enough to see the pick land, short enough not to feel like a wait. */
const AUTO_ADVANCE_MS = 340;

const DRAFT_KEY = "oruka:onboarding-answers:v1";

const stageKey = (stage: Stage) => (stage.kind === "question" ? `question:${stage.id}` : stage.kind);

/**
 * The first thing a new workspace sees: a short conversation about the
 * business, one question at a time, that ends in a profile and a plan.
 *
 * One question per screen is the point, not a style. Each answer is a tap —
 * single choices move on by themselves, the number keys pick an option, Enter
 * continues — so eight questions take about as long as the old three-field
 * form did, and every screen can speak to what the owner already said. Only
 * the name and the kind of business are required; every other question can be
 * skipped, and everything can be changed later.
 *
 * `preview` runs the whole flow with no account behind it — no settled check,
 * a simulated save — for the /dev/onboarding harness.
 */
export function OnboardingFlow({
  initial,
  preview = false,
}: {
  readonly initial?: {
    readonly answers?: Partial<Answers>;
    readonly failFirstSave?: boolean;
    readonly stage?: Stage;
  };
  readonly preview?: boolean;
}) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const reduce = useReducedMotion();
  const { cue } = useSound();
  const storageScope = useBrowserStorageScope();
  const draftKey = scopedBrowserStorageKey(DRAFT_KEY, storageScope);

  const [answers, setAnswers] = useState<Answers>(() => ({ ...EMPTY_ANSWERS, ...initial?.answers }));
  /** Set once the owner touches the module picker, so going back and forth
   *  never re-ticks what they deliberately cleared. */
  const modulesChosen = useRef(false);
  const [stage, setStage] = useState<Stage>(() => initial?.stage ?? { kind: "welcome" });
  const [direction, setDirection] = useState<1 | -1>(1);
  const [saveState, setSaveState] = useState<SaveState>("saving");
  const [profile, setProfile] = useState<OnboardingProfile | null>(() =>
    initial?.stage?.kind === "result" || initial?.stage?.kind === "review"
      ? toProfile({ ...EMPTY_ANSWERS, ...initial?.answers })
      : null,
  );
  const [fieldError, setFieldError] = useState<string>();
  const [leaving, setLeaving] = useState(false);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const shakeRef = useRef<HTMLDivElement>(null);
  const advanceTimer = useRef<number | undefined>(undefined);
  const attempt = useRef(0);
  const navigated = useRef(false);
  const interacted = useRef(false);

  const questions = useMemo(() => visibleQuestions(answers), [answers]);
  const currentIndex = stage.kind === "question" ? questions.findIndex((question) => question.id === stage.id) : -1;
  const current: Question | undefined = currentIndex >= 0 ? questions[currentIndex] : undefined;

  // A bookmark or Back must not put an already-settled workspace through the
  // questions again. Only on mount, and only until the owner starts: a save at
  // the end would otherwise race its own redirect.
  useEffect(() => {
    if (preview) return;
    void fetch("/api/onboarding")
      .then((response) => response.json())
      .then((state: { settled: boolean }) => {
        if (state.settled && !interacted.current) router.replace("/dashboard");
      })
      .catch(() => null);
  }, [preview, router]);

  // Answers survive a refresh for the rest of the session, scoped to this
  // account and workspace like every other browser draft.
  useEffect(() => {
    if (initial) return;
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as { answers?: Partial<Answers>; at?: QuestionId };
      const restored = { ...EMPTY_ANSWERS, ...draft.answers };
      setAnswers(restored);
      if (draft.at && visibleQuestions(restored).some((question) => question.id === draft.at)) {
        setStage({ id: draft.at, kind: "question" });
      }
    } catch {
      // A draft that does not parse is a draft not worth keeping.
    }
  }, [draftKey, initial]);

  useEffect(() => {
    if (stage.kind !== "question" || preview) return;
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ answers, at: stage.id }));
    } catch {
      // Best-effort, like the rest of the browser drafts.
    }
  }, [answers, draftKey, preview, stage]);

  const clearDraft = useCallback(() => {
    try {
      sessionStorage.removeItem(draftKey);
    } catch {
      // Nothing to clear.
    }
  }, [draftKey]);

  useEffect(() => () => window.clearTimeout(advanceTimer.current), []);

  const go = useCallback((next: Stage, towards: 1 | -1) => {
    window.clearTimeout(advanceTimer.current);
    interacted.current = true;
    navigated.current = true;
    setFieldError(undefined);
    setDirection(towards);
    setStage(next);
  }, []);

  const save = useCallback(
    async (next: OnboardingProfile) => {
      const run = ++attempt.current;
      setSaveState("saving");
      try {
        if (preview) {
          await new Promise((resolve) => window.setTimeout(resolve, 900));
          if (initial?.failFirstSave && run === 1) throw new Error("simulated");
        } else {
          const response = await fetch("/api/onboarding", {
            body: JSON.stringify(next),
            headers: { "content-type": "application/json" },
            method: "POST",
          });
          if (!response.ok) throw new Error("save_failed");
        }
        if (run === attempt.current) {
          setSaveState("saved");
          clearDraft();
        }
      } catch {
        if (run === attempt.current) setSaveState("error");
      }
    },
    [clearDraft, initial?.failFirstSave, preview],
  );

  /** Moves past `from` using `withAnswers`, which may be newer than state. */
  const advance = useCallback(
    (from: QuestionId, withAnswers: Answers) => {
      const list = visibleQuestions(withAnswers);
      const index = list.findIndex((question) => question.id === from);
      const next = list[index + 1];
      if (next) {
        // Arriving at the module picker for the first time: tick what the
        // answers so far point to, so most owners only confirm.
        if (next.id === "modules" && !modulesChosen.current && withAnswers.modules.length === 0) {
          setAnswers({ ...withAnswers, modules: recommendModules(withAnswers) });
        }
        go({ id: next.id, kind: "question" }, 1);
        return;
      }
      const finished = toProfile(withAnswers);
      setProfile(finished);
      go({ kind: "review" }, 1);
      void save(finished);
    },
    [go, save],
  );

  const goBack = () => {
    if (stage.kind === "review") {
      const last = questions[questions.length - 1];
      if (last) go({ id: last.id, kind: "question" }, -1);
      return;
    }
    if (currentIndex <= 0) {
      go({ kind: "welcome" }, -1);
      return;
    }
    go({ id: questions[currentIndex - 1].id, kind: "question" }, -1);
  };

  const shake = () => {
    const node = shakeRef.current;
    if (!node || reduce) return;
    node.classList.remove("is-shaking");
    void node.offsetWidth;
    node.classList.add("is-shaking");
  };

  const submit = () => {
    if (!current) return;
    if (current.kind === "text" && current.required && !answers[current.id].trim()) {
      setFieldError(t("onboarding.error.business"));
      shake();
      fieldRef.current?.focus();
      return;
    }
    if (current.kind !== "text" && current.required && !isAnswered(current, answers)) {
      setFieldError(t("onboarding.error.choose"));
      return;
    }
    advance(current.id, answers);
  };

  const choose = (question: ChoiceQuestion, optionId: string) => {
    interacted.current = true;
    setFieldError(undefined);
    window.clearTimeout(advanceTimer.current);
    if (question.kind === "multi") {
      if (question.id === "modules") modulesChosen.current = true;
      const selected = answers[question.id] as string[];
      const nextList = selected.includes(optionId)
        ? selected.filter((candidate) => candidate !== optionId)
        : [...selected, optionId];
      setAnswers({ ...answers, [question.id]: nextList });
      return;
    }
    const next = { ...answers, [question.id]: optionId };
    setAnswers(next);
    advanceTimer.current = window.setTimeout(() => advance(question.id, next), reduce ? 120 : AUTO_ADVANCE_MS);
  };

  const setText = (question: TextQuestion, value: string) => {
    interacted.current = true;
    if (fieldError && value.trim()) setFieldError(undefined);
    setAnswers({ ...answers, [question.id]: value.slice(0, question.maxLength) });
  };

  // Number keys pick, Enter continues — only while nothing that takes typing
  // has focus, and never on top of a focused button's own Enter.
  useEffect(() => {
    if (stage.kind !== "question" && stage.kind !== "welcome") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='listbox'], [role='menu']")) return;
      if (event.key === "Enter" && !target?.closest("button, a")) {
        event.preventDefault();
        if (stage.kind === "welcome") go(firstQuestion(questions), 1);
        else submit();
        return;
      }
      if (stage.kind === "question" && current && current.kind !== "text" && /^[1-9]$/.test(event.key)) {
        const option = current.options[Number(event.key) - 1];
        if (!option) return;
        event.preventDefault();
        choose(current, option.id);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  const leave = async () => {
    setLeaving(true);
    window.clearTimeout(advanceTimer.current);
    clearDraft();
    if (preview) {
      setAnswers(EMPTY_ANSWERS);
      setProfile(null);
      go({ kind: "welcome" }, -1);
      setLeaving(false);
      return;
    }
    try {
      await fetch("/api/onboarding", {
        body: JSON.stringify({ skip: true }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    } finally {
      router.replace("/dashboard");
      router.refresh();
    }
  };

  const finish = () => {
    if (preview) {
      setAnswers(EMPTY_ANSWERS);
      setProfile(null);
      go({ kind: "welcome" }, -1);
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  };

  // The harness can open straight on the review; the save it waits on has to
  // start somewhere.
  const startedFromReview = useRef(false);
  useEffect(() => {
    if (startedFromReview.current || initial?.stage?.kind !== "review" || !profile) return;
    startedFromReview.current = true;
    void save(profile);
  }, [initial?.stage?.kind, profile, save]);

  const showResult = useCallback(() => {
    go({ kind: "result" }, 1);
    cue("success");
  }, [cue, go]);

  const reviewDetails = useMemo(
    () => (profile ? reviewDetailsFor(profile, t, locale) : null),
    [locale, profile, t],
  );

  const variants: Variants = reduce
    ? { center: { opacity: 1 }, enter: { opacity: 0 }, exit: { opacity: 0 } }
    : {
        center: { filter: "blur(0px)", opacity: 1, transform: "translateY(0px)" },
        enter: (towards: 1 | -1) => ({ filter: "blur(4px)", opacity: 0, transform: `translateY(${towards * 16}px)` }),
        exit: (towards: 1 | -1) => ({
          filter: "blur(4px)",
          opacity: 0,
          transform: `translateY(${towards * -12}px)`,
          transition: { duration: 0.16, ease: [0.4, 0, 1, 1] },
        }),
      };

  const canSkip = stage.kind === "welcome" || stage.kind === "question";
  const key = stageKey(stage);
  const headingId = `onboarding-${key.replace(":", "-")}-heading`;
  const hasEstimates = profile ? onboardingInsights(profile).monthlyHours !== null : false;

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden" id="main-content">
      <AuthBackdrop />

      <header className="relative z-10 flex items-center justify-between gap-4 px-4 pt-4 sm:px-6 sm:pt-5">
        <OrukaTile className="size-9" />
        {canSkip ? (
          <button
            className="min-h-8 rounded-md px-3 text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 disabled:opacity-50"
            disabled={leaving}
            onClick={() => void leave()}
            type="button"
          >
            {t("onboarding.skip")}
          </button>
        ) : null}
      </header>

      <div className="relative z-10 mx-auto flex w-full max-w-[35rem] flex-1 flex-col px-4 pt-[clamp(1.25rem,6vh,4rem)] pb-14 sm:px-6">
        <AnimatePresence initial={false} mode="popLayout">
          {stage.kind === "question" || stage.kind === "review" ? (
            <motion.div
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              key="progress"
              transition={{ duration: 0.2 }}
            >
              <ChapterProgress current={current} questions={questions} stage={stage} />
            </motion.div>
          ) : stage.kind === "result" && profile ? (
            <motion.div
              animate={{ opacity: 1, transform: "translateY(0px)" }}
              className="mb-6 text-center"
              initial={reduce ? false : { opacity: 0, transform: "translateY(8px)" }}
              key="result-header"
              transition={{ duration: 0.5, ease: EASE_OUT }}
            >
              <p className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
                {t("onboarding.result.eyebrow")}
              </p>
              <h1 className="mt-3 text-balance font-cooper text-[1.9rem] leading-[1.08] sm:text-[2.2rem] font-medium tracking-[-0.02em]">
                {t("onboarding.result.title", { business: profile.businessName })}
              </h1>
              <p className="mx-auto mt-2.5 max-w-[42ch] text-balance text-[15px] text-muted-foreground leading-relaxed">
                {t("onboarding.result.body")}
              </p>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <FramedCard
          aria-label={stage.kind === "result" ? t("onboarding.result.profileLabel") : undefined}
          aria-labelledby={stage.kind === "result" ? undefined : headingId}
          as="section"
        >
          <FramedCardPanel>
            <AutoHeight>
              <AnimatePresence custom={direction} initial={false} mode="wait">
                <motion.div
                  animate="center"
                  custom={direction}
                  exit="exit"
                  initial="enter"
                  key={key}
                  onAnimationComplete={(definition) => {
                    if (definition === "center" && navigated.current) focusStage(stage, headingRef, fieldRef);
                  }}
                  transition={{ duration: reduce ? 0.12 : 0.34, ease: EASE_OUT }}
                  variants={variants}
                >
                  {stage.kind === "welcome" ? (
                    <Welcome headingId={headingId} headingRef={headingRef} t={t} />
                  ) : null}

                  {stage.kind === "question" && current ? (
                    <QuestionScreen
                      answers={answers}
                      error={fieldError}
                      fieldRef={fieldRef}
                      headingId={headingId}
                      headingRef={headingRef}
                      onChoose={choose}
                      onSubmit={submit}
                      onText={setText}
                      question={current}
                      shakeRef={shakeRef}
                      t={t}
                    />
                  ) : null}

                  {stage.kind === "review" && reviewDetails ? (
                    <ProfileReview
                      details={reviewDetails}
                      headingId={headingId}
                      headingRef={headingRef}
                      onDone={showResult}
                      onEdit={goBack}
                      onRetry={() => profile && void save(profile)}
                      saveState={saveState}
                    />
                  ) : null}

                  {stage.kind === "result" && profile ? <ProfileSummary profile={profile} /> : null}
                </motion.div>
              </AnimatePresence>
            </AutoHeight>
          </FramedCardPanel>

          {stage.kind === "result" && !hasEstimates ? null : (
          <FramedCardFooter className="justify-between">
            {stage.kind === "welcome" ? (
              <>
                <span className="inline-flex items-center gap-1.5 pl-0.5">
                  <HugeiconsIcon aria-hidden="true" icon={Clock01Icon} size={14} strokeWidth={1.75} />
                  {t("onboarding.welcome.time")}
                </span>
                <Button onClick={() => go(firstQuestion(questions), 1)} size="sm" type="button">
                  {t("onboarding.welcome.start")}
                  <HugeiconsIcon icon={ArrowRight01Icon} size={16} strokeWidth={2} />
                </Button>
              </>
            ) : null}

            {stage.kind === "question" && current ? (
              <>
                <Button onClick={goBack} size="sm" type="button" variant="ghost">
                  <HugeiconsIcon icon={ArrowLeft01Icon} size={16} strokeWidth={2} />
                  {t("onboarding.back")}
                </Button>
                <span className="flex items-center gap-2.5">
                  <kbd className="hidden items-center gap-1 font-mono text-[10.5px] text-muted-foreground pointer-fine:inline-flex">
                    Enter <span aria-hidden="true">↵</span>
                  </kbd>
                  <ContinueButton
                    answered={isAnswered(current, answers)}
                    last={currentIndex === questions.length - 1}
                    onClick={submit}
                    required={current.required}
                    t={t}
                  />
                </span>
              </>
            ) : null}

            {stage.kind === "review" ? (
              <span className="inline-flex items-center gap-1.5 pl-0.5">
                <HugeiconsIcon aria-hidden="true" icon={AiArtIcon} size={14} strokeWidth={1.75} />
                {t("onboarding.review.footer")}
              </span>
            ) : null}

            {stage.kind === "result" ? (
              <span className="pl-0.5 leading-relaxed">
                {t("onboarding.result.estimateNote", {
                  perCall: String(MINUTES_PER_CALL),
                  perMessage: String(MINUTES_PER_MESSAGE),
                })}
              </span>
            ) : null}
          </FramedCardFooter>
          )}
        </FramedCard>

        {stage.kind === "result" && profile ? (
          <motion.section
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            aria-labelledby="onboarding-plan-heading"
            className="mt-4"
            initial={reduce ? false : { opacity: 0, transform: "translateY(12px)" }}
            transition={{ delay: reduce ? 0 : 0.55, duration: 0.55, ease: EASE_OUT }}
          >
            <FramedCard>
              <FramedCardPanel className="px-5 pt-5 pb-5 sm:px-7 sm:pt-6">
                <h2 className="font-cooper text-[1.3rem] font-medium tracking-[-0.02em]" id="onboarding-plan-heading">
                  {t("onboarding.result.planTitle")}
                </h2>
                <p className="mt-1 text-[13.5px] text-muted-foreground">
                  {t("onboarding.result.planHint", {
                    count: String(recommendedOnboardingActions(profile).length),
                  })}
                </p>
                <OnboardingPlan className="mt-4" profile={profile} />
              </FramedCardPanel>
              <FramedCardFooter className="justify-end">
                <Button onClick={finish} size="sm" type="button" variant="outline">
                  {t("onboarding.goDashboard")}
                  <HugeiconsIcon icon={ArrowRight01Icon} size={16} strokeWidth={2} />
                </Button>
              </FramedCardFooter>
            </FramedCard>
          </motion.section>
        ) : null}
      </div>
    </main>
  );
}

type Translate = ReturnType<typeof useI18n>["t"];

function firstQuestion(questions: readonly Question[]): Stage {
  return { id: questions[0]?.id ?? "businessName", kind: "question" };
}

/** Where focus lands once a new screen has settled: the field on a text
 *  question, the heading everywhere else, so a screen reader starts at the
 *  question rather than wherever the last button was. */
function focusStage(
  stage: Stage,
  headingRef: React.RefObject<HTMLHeadingElement | null>,
  fieldRef: React.RefObject<(HTMLInputElement & HTMLTextAreaElement) | null>,
) {
  if (stage.kind === "question" && fieldRef.current) {
    fieldRef.current.focus({ preventScroll: true });
    return;
  }
  headingRef.current?.focus({ preventScroll: true });
}

/**
 * Grows and shrinks with its content instead of jumping, so moving from a
 * two-line question to an eight-option grid reads as one card changing shape.
 */
function AutoHeight({ children }: { readonly children: ReactNode }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  const reduce = useReducedMotion();

  useLayoutEffect(() => {
    const node = innerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setHeight(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      animate={{ height }}
      className="overflow-hidden"
      initial={false}
      transition={reduce ? { duration: 0 } : { duration: 0.42, ease: EASE_OUT }}
    >
      <div ref={innerRef}>{children}</div>
    </motion.div>
  );
}

function ChapterProgress({
  current,
  questions,
  stage,
}: {
  readonly current: Question | undefined;
  readonly questions: readonly Question[];
  readonly stage: Stage;
}) {
  const { t } = useI18n();
  const position = current ? questions.indexOf(current) : questions.length;

  return (
    <div className="mb-4 px-1">
      <p className="sr-only" role="status">
        {current
          ? t("onboarding.questionOf", { current: String(position + 1), total: String(questions.length) })
          : t("onboarding.review.title")}
      </p>
      <ol aria-label={t("onboarding.progressLabel")} className="grid grid-cols-3 gap-2">
        {CHAPTERS.map((chapter) => {
          const inChapter = questions.filter((question) => question.chapter === chapter);
          const reached = inChapter.filter((question) => questions.indexOf(question) <= position).length;
          const fill = stage.kind === "review" ? 1 : inChapter.length === 0 ? 0 : reached / inChapter.length;
          const active = current?.chapter === chapter;
          return (
            <li className="min-w-0" key={chapter}>
              <span className="block h-1 overflow-hidden rounded-full bg-foreground/10">
                <span
                  className="block h-full origin-left rounded-full bg-foreground/70 motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.16,1,0.3,1)]"
                  style={{ transform: `scaleX(${fill})` }}
                />
              </span>
              <span
                className={cn(
                  "mt-2 block truncate font-mono text-[10px] uppercase tracking-[0.1em]",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {t(`onboarding.chapter.${chapter}`)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Welcome({
  headingId,
  headingRef,
  t,
}: {
  readonly headingId: string;
  readonly headingRef: React.Ref<HTMLHeadingElement>;
  readonly t: Translate;
}) {
  // The switch reads the visitor's own preference, past any pinned subtree —
  // the same rule as every other language control (lib/i18n/provider.tsx).
  const { locale, setLocale } = useAppLocale();
  const points: readonly [IconSvgElement, string][] = [
    [ChatSpark01Icon, t("onboarding.welcome.point1")],
    [Route01Icon, t("onboarding.welcome.point2")],
    [PencilEdit02Icon, t("onboarding.welcome.point3")],
  ];

  return (
    <div className="px-5 pt-6 pb-6 sm:px-8 sm:pt-8">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
          {t("onboarding.welcome.eyebrow")}
        </p>
        <div
          aria-label={t("onboarding.language")}
          className="flex rounded-[10px] border border-border bg-muted/60 p-0.5"
          role="group"
        >
          {(["es", "en"] as const).map((option) => (
            <button
              aria-pressed={locale === option}
              className={cn(
                "h-7 min-w-9 rounded-[8px] px-2 font-medium text-xs motion-safe:transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                locale === option
                  ? "bg-card text-foreground shadow-[var(--shadow-soft)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
              key={option}
              lang={option}
              onClick={() => setLocale(option)}
              title={option === "es" ? "Español" : "English"}
              type="button"
            >
              {option.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <h1
        className="mt-5 text-balance font-cooper text-[2rem] leading-[1.06] outline-none sm:text-[2.35rem] font-medium tracking-[-0.02em]"
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
      >
        {t("onboarding.welcome.title")}
      </h1>
      <p className="mt-3 text-pretty text-[15px] text-muted-foreground leading-relaxed">
        {t("onboarding.welcome.body")}
      </p>

      <ul className="mt-6 flex flex-col gap-2.5">
        {points.map(([icon, label]) => (
          <li className="flex items-center gap-3 text-sm" key={label}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
              <HugeiconsIcon aria-hidden="true" icon={icon} size={16} strokeWidth={1.75} />
            </span>
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuestionScreen({
  answers,
  error,
  fieldRef,
  headingId,
  headingRef,
  onChoose,
  onSubmit,
  onText,
  question,
  shakeRef,
  t,
}: {
  readonly answers: Answers;
  readonly error: string | undefined;
  readonly fieldRef: React.Ref<HTMLInputElement & HTMLTextAreaElement>;
  readonly headingId: string;
  readonly headingRef: React.Ref<HTMLHeadingElement>;
  readonly onChoose: (question: ChoiceQuestion, optionId: string) => void;
  readonly onSubmit: () => void;
  readonly onText: (question: TextQuestion, value: string) => void;
  readonly question: Question;
  readonly shakeRef: React.Ref<HTMLDivElement>;
  readonly t: Translate;
}) {
  const base = useId();
  const hintId = `${base}-hint`;
  const errorId = `${base}-error`;
  const business = answers.businessName.trim();
  const vars = { business };

  return (
    <div className="px-5 pt-6 pb-6 sm:px-7 sm:pt-7">
      {question.ack ? (
        <p className="mb-2 text-muted-foreground text-sm">{t(`onboarding.q.${question.id}.ack`, vars)}</p>
      ) : null}
      <h2
        className="text-balance font-cooper text-[1.6rem] leading-[1.12] outline-none sm:text-[1.8rem] font-medium tracking-[-0.02em]"
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
      >
        {t(`onboarding.q.${question.id}.title`, vars)}
      </h2>
      <p className="mt-2 text-pretty text-[14px] text-muted-foreground leading-relaxed" id={hintId}>
        {t(`onboarding.q.${question.id}.hint`, vars)}
      </p>

      <div className="mt-5">
        {question.kind === "text" ? (
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            <div className={cn("t-input-wrap flex flex-col gap-1.5", error && "is-error")}>
              <div className={cn("t-input rounded-xl", error && "is-error")} ref={shakeRef}>
                {question.multiline ? (
                  <Textarea
                    aria-describedby={[hintId, error ? errorId : null].filter(Boolean).join(" ")}
                    aria-labelledby={headingId}
                    className="min-h-24 resize-none text-[15px]"
                    maxLength={question.maxLength}
                    name={question.id}
                    onChange={(event) => onText(question, event.target.value)}
                    onKeyDown={(event) => {
                      // One sentence: Enter continues, Shift+Enter still breaks the line.
                      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        onSubmit();
                      }
                    }}
                    placeholder={t(`onboarding.q.${question.id}.placeholder`, vars)}
                    ref={fieldRef}
                    rows={3}
                    value={answers[question.id]}
                  />
                ) : (
                  <Input
                    aria-describedby={[hintId, error ? errorId : null].filter(Boolean).join(" ")}
                    aria-invalid={Boolean(error)}
                    aria-labelledby={headingId}
                    aria-required={question.required}
                    autoComplete="organization"
                    className="h-12 text-[15px]"
                    enterKeyHint="next"
                    maxLength={question.maxLength}
                    name={question.id}
                    onChange={(event) => onText(question, event.target.value)}
                    placeholder={t(`onboarding.q.${question.id}.placeholder`, vars)}
                    ref={fieldRef}
                    value={answers[question.id]}
                  />
                )}
              </div>
              <p className="t-error-msg text-destructive text-xs" id={errorId} role="alert">
                {error ?? ""}
              </p>
              {question.multiline ? (
                <p className="self-end font-mono text-[10.5px] text-muted-foreground tabular-nums">
                  {answers[question.id].length}/{question.maxLength}
                </p>
              ) : null}
            </div>
          </form>
        ) : (
          <>
            <div
              aria-describedby={hintId}
              aria-labelledby={headingId}
              className={cn(
                question.layout === "list" && "flex flex-col gap-2",
                question.layout === "grid" && "grid grid-cols-1 gap-2 min-[440px]:grid-cols-2",
                question.layout === "chips" && "grid grid-cols-2 gap-2 min-[440px]:grid-cols-3",
              )}
              role="group"
            >
              {question.options.map((option, index) => {
                const value = answers[question.id];
                const selected = Array.isArray(value) ? value.includes(option.id) : value === option.id;
                return (
                  <ChoiceCard
                    hint={question.hints ? t(`${question.hints}.${option.id}`) : undefined}
                    index={index}
                    key={option.id}
                    label={t(`${question.labels}.${option.id}`)}
                    layout={question.layout}
                    mode={question.kind}
                    onSelect={() => onChoose(question, option.id)}
                    option={option}
                    scale={question.options.length}
                    selected={selected}
                  />
                );
              })}
            </div>
            {error ? (
              <p className="mt-3 text-destructive text-xs" role="alert">
                {error}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function ContinueButton({
  answered,
  last,
  onClick,
  required,
  t,
}: {
  readonly answered: boolean;
  readonly last: boolean;
  readonly onClick: () => void;
  readonly required: boolean;
  readonly t: Translate;
}) {
  // An optional question left blank offers to skip it rather than pretending
  // there is something to continue with; the last one always leads to the
  // profile.
  const skipping = !answered && !required;
  return (
    <Button onClick={onClick} size="sm" type="button" variant={skipping && !last ? "outline" : "default"}>
      {last ? t("onboarding.seeProfile") : skipping ? t("onboarding.skipQuestion") : t("onboarding.continue")}
      <HugeiconsIcon icon={last ? AiArtIcon : ArrowRight01Icon} size={16} strokeWidth={2} />
    </Button>
  );
}

/** The one line each review row closes on, read off the owner's own answers. */
function reviewDetailsFor(profile: OnboardingProfile, t: Translate, locale: string): Record<ReviewStep, string> {
  const numberFormat = new Intl.NumberFormat(locale === "en" ? "en-US" : "es-AR");
  const list = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
  const insights = onboardingInsights(profile);
  const industry =
    profile.industry && profile.industry !== "other" ? t(`onboarding.industry.${profile.industry}`) : "";

  const channelNames = profile.channels.map((id) => t(`onboarding.channel.${id}`));
  const channels =
    channelNames.length === 0
      ? t("onboarding.review.detail.noChannels")
      : channelNames.length <= 3
        ? list.format(channelNames)
        : t("onboarding.review.detail.moreChannels", {
            count: String(channelNames.length - 2),
            first: channelNames.slice(0, 2).join(", "),
          });

  const messages = insights.monthlyMessages !== null ? numberFormat.format(insights.monthlyMessages) : null;
  const calls = insights.monthlyCalls !== null ? numberFormat.format(insights.monthlyCalls) : null;
  const volume =
    messages && calls
      ? t("onboarding.review.detail.volume", { calls, messages })
      : messages
        ? t("onboarding.review.detail.messagesOnly", { messages })
        : calls
          ? t("onboarding.review.detail.callsOnly", { calls })
          : t("onboarding.review.detail.noVolume");

  return {
    business: industry ? `${profile.businessName} · ${industry}` : profile.businessName,
    channels,
    plan: t("onboarding.review.detail.plan", { count: String(recommendedOnboardingActions(profile).length) }),
    volume,
  };
}
