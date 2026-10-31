"use client";

import { useEffect, useState } from "react";
import { AiPaintbrushIcon, SparklesIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Disclosure } from "../../components/ui/disclosure";
import { Spinner } from "../../components/ui/spinner";
import { Textarea } from "../../components/ui/textarea";
import { useToast } from "../../components/toast-provider";
import { MAX_PROMPT_LENGTH, type FramePrompt, type PromptAnalysis, type RotoscopeRun } from "../../shared/rotoscope";
import fb from "../flipbook/flipbook.module.css";
import { rotoscopeApi } from "./rotoscope-client";
import styles from "./rotoscope.module.css";

/**
 * Trial and error on one frame's Muse Image prompt: the exact words an attempt was drawn with (or what the next
 * drawing gets), editable; Muse Spark reads the edit against the frame's images and the attempt's drawing and
 * suggests a rewrite; the edit draws the frame once (one Muse Image drawing), measured and reviewed like any attempt.
 */
export function PromptLab({ run, frame, attempt, canDraw, busy, onDraw }: {
  readonly run: RotoscopeRun;
  readonly frame: number;
  readonly attempt: number;
  readonly canDraw: boolean;
  readonly busy: boolean;
  readonly onDraw: (prompt: string) => void;
}) {
  const { toast } = useToast();
  const [loaded, setLoaded] = useState<FramePrompt | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<PromptAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    let stopped = false;
    setLoaded(null);
    setAnalysis(null);
    setError(null);
    rotoscopeApi.prompt(run.id, frame, attempt).then((next) => {
      if (stopped) return;
      setLoaded(next);
      setText(next.prompt);
    }, (cause: unknown) => { if (!stopped) setError(cause instanceof Error ? cause.message : "The prompt couldn’t be loaded."); });
    return () => { stopped = true; };
  }, [run.id, frame, attempt]);

  if (error) return <p className={fb.hint}>{error}</p>;
  if (!loaded) return <p className={`${fb.hint} flex items-center gap-2`}><Spinner className="size-3.5" />Loading the prompt…</p>;
  const edited = text.trim() !== loaded.prompt.trim();
  const analyze = async () => {
    setAnalyzing(true);
    try {
      setAnalysis(await rotoscopeApi.analyzePrompt(run.id, { frame, attempt, prompt: text }));
    } catch (cause) {
      toast({ title: "Couldn’t analyse the prompt", description: cause instanceof Error ? cause.message : "Try again.", status: "error" });
    } finally {
      setAnalyzing(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <span className={fb.sectionLabel}>Prompt · {loaded.sent ? `as attempt ${attempt} was drawn` : `frame ${frame}’s next drawing`}</span>
      <p className={fb.hint}>{loaded.sent
        ? "The exact words Muse Image got after the images below. Edit them and draw once to see what changes, or ask Muse Spark first."
        : `Attempt ${attempt} kept no prompt (the rig drew it, or it is older): this is what the next drawing gets.`}</p>
      <Disclosure title={`${loaded.images.length} images before the prompt`}>
        <ol className={styles.promptImages}>
          {loaded.images.map((role, i) => <li key={i}><strong className="font-medium text-foreground">Image {i + 1}.</strong> {role}</li>)}
        </ol>
      </Disclosure>
      <Textarea aria-label={`Prompt for frame ${frame}`} className={styles.promptText} value={text} maxLength={MAX_PROMPT_LENGTH} onChange={(event) => setText(event.target.value)} />
      <div className={fb.buttonRow}>
        <Button size="sm" variant="outline" disabled={analyzing || !text.trim()} onClick={() => void analyze()} title="Muse Spark reads this prompt with the frame’s images and this attempt’s drawing and checks: no drawing is made.">
          {analyzing ? <Spinner className="size-3.5" /> : <HugeiconsIcon icon={SparklesIcon} size={14} strokeWidth={1.75} />}Analyze with AI
        </Button>
        <Button size="sm" variant="ai" disabled={!canDraw || busy || !text.trim()} onClick={() => onDraw(text.trim())} title={`Draws frame ${frame} once with this prompt (one Muse Image drawing). It is measured and reviewed like any attempt; an approved drawing is only replaced if it passes.`}>
          <HugeiconsIcon icon={AiPaintbrushIcon} size={14} strokeWidth={1.75} />Draw once with this prompt
        </Button>
        {edited ? <Button size="sm" variant="ghost" onClick={() => setText(loaded.prompt)}>Reset</Button> : null}
      </div>
      {analysis ? (
        <div className={styles.promptAnalysis}>
          <p className="text-xs leading-5 text-foreground">{analysis.summary}</p>
          {analysis.issues.length ? (
            <ul className={styles.lessons}>
              {analysis.issues.map((issue, i) => (
                <li key={i} data-active="true">
                  <span className="text-foreground">{issue.problem}</span>
                  <span className={styles.lessonMeta}>Cause: {issue.cause}</span>
                  <span className={styles.lessonMeta}>Fix: {issue.fix}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {analysis.prompt.trim() && analysis.prompt.trim() !== text.trim() ? (
            <Button size="sm" variant="outline" className="w-fit" onClick={() => setText(analysis.prompt.trim())}>Use the suggested prompt</Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
