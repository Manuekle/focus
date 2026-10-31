"use client";

import { useState } from "react";
import { AiPaintbrushIcon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { MediaImage } from "../../components/ui/media-image";
import { Spinner } from "../../components/ui/spinner";
import { ToggleChip } from "../../components/ui/toggle-chip";
import { useToast } from "../../components/toast-provider";
import { GENERATOR_LABEL, GENERATORS, keptGenerator, LIVE_STAGES, measuresText, rotoscopeUrls, type RotoscopeAttempt, type RotoscopeRun } from "../../shared/rotoscope";
import fb from "../flipbook/flipbook.module.css";
import { rotoscopeApi, useRotoscopeBatch } from "./rotoscope-client";
import { PHASE_LABELS } from "./rotoscope-studio";
import styles from "./rotoscope.module.css";

const STAGE_LABEL: Record<(typeof LIVE_STAGES)[number], string> = {
  drawing: "Drawing",
  measuring: "Measuring",
  checking: "Checking",
  reviewing: "Reviewing",
  approved: "Approved",
  rejected: "Rejected",
};

/** The checks an attempt failed, by name; "every check" when it passed. */
const verdict = (attempt: RotoscopeAttempt) => {
  const failed = attempt.checks.filter((check) => !check.passed).map((check) => check.name);
  return failed.length ? failed.join(", ") : "every check";
};

/**
 * One frame of one character in the round on show. Drawn by two generators, both cut-outs side by side with the
 * one the checks kept marked; drawn by one, its drawing. The verdict is the kept drawing's.
 */
function BatchCell({ run, index, round }: { readonly run: RotoscopeRun; readonly index: number; readonly round: number | null }) {
  const frame = run.frames.find((entry) => entry.index === index);
  const attempt = frame ? (round !== null ? frame.attempts[round - 1] : undefined) ?? frame.attempts.at(-1) : undefined;
  const live = run.live?.frame === index ? run.live : null;
  if (live && (!attempt || round === null || live.attempt > attempt.attempt)) {
    return (
      <div className={`${fb.inspect} ${styles.batchImage}`}>
        {live.image ? <MediaImage src={rotoscopeUrls.media(run.id, "attempt", index, live.attempt)} alt={`Frame ${index} being checked`} /> : null}
        <span className={styles.drawingStatus}><Spinner className="size-3.5" />{STAGE_LABEL[live.stage]}</span>
      </div>
    );
  }
  if (!attempt) return <div className={`${fb.inspect} ${styles.batchImage}`}><span className={fb.stripEmpty}>Not drawn</span></div>;
  const pair = keptGenerator(attempt.checks);
  const version = `&v=${encodeURIComponent(attempt.at)}`;
  return (
    <figure className={styles.batchCell}>
      {pair ? (
        <div className={styles.batchPair}>
          {GENERATORS.map((by) => (
            <div key={by} className={styles.batchDrawing} data-kept={by === pair.kept || undefined}>
              <div className={`${fb.inspect} ${styles.batchImage}`} data-transparent="">
                <MediaImage src={`${rotoscopeUrls.drawn(run.id, index, attempt.attempt, by)}${version}`} alt={`Frame ${index} by ${GENERATOR_LABEL[by]}`} />
              </div>
              <span className={styles.batchLabel}>{GENERATOR_LABEL[by]}{by === pair.kept ? " · kept" : ""}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className={`${fb.inspect} ${styles.batchImage}`} data-transparent="">
          <MediaImage src={`${rotoscopeUrls.media(run.id, "attempt", index, attempt.attempt)}${version}`} alt={`Frame ${index}, attempt ${attempt.attempt}`} />
        </div>
      )}
      <figcaption className={styles.batchVerdict}>
        <Badge tone={attempt.passed ? "success" : "warning"} size="sm">{attempt.passed ? "Passed" : "Failed"}</Badge>
        <span title={attempt.checks.filter((check) => !check.passed).map((check) => `${check.name}: ${check.detail}`).join("\n")}>{verdict(attempt)}</span>
        {pair ? <span className={styles.batchLabel} title={`The other drawing failed: ${pair.over}`}>other: {pair.over}</span> : null}
      </figcaption>
    </figure>
  );
}

/**
 * A test batch: the same video's first frames drawn with each character, one row per character and one column per
 * frame, a round at a time. Drawn by Muse Image and Higgsfield both, every cell shows the two drawings side by side.
 * Another round draws every character's frames once more; a run opens on its own to animate the rest.
 */
export function BatchView({ batchId, onOpenRun }: { readonly batchId: string; readonly onOpenRun: (id: string) => void }) {
  const { toast } = useToast();
  const { batch, setBatch, error } = useRotoscopeBatch(batchId);
  const [starting, setStarting] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  if (error && !batch) return <Alert tone="error" size="sm">{error}</Alert>;
  if (!batch) return <div className={fb.progress}><Spinner className="size-4" /></div>;
  const working = batch.runs.some((run) => run.phase !== "ready" && run.phase !== "failed");
  const count = Math.max(1, ...batch.runs.map((run) => Math.max(run.batchFrames ?? 1, ...run.frames.filter((frame) => frame.attempts.length).map((frame) => frame.index))));
  const frames = Array.from({ length: count }, (_, i) => i + 1);
  const rounds = Math.max(0, ...batch.runs.flatMap((run) => run.frames.map((frame) => frame.attempts.length)));
  const round = picked !== null && picked <= rounds ? picked : rounds || null;
  const another = async () => {
    setStarting(true);
    try { setBatch(await rotoscopeApi.drawBatch(batch.id)); setPicked(null); }
    catch (cause) { toast({ title: "Couldn’t start another round", description: cause instanceof Error ? cause.message : "Try again.", status: "error" }); }
    finally { setStarting(false); }
  };
  const first = batch.runs[0];
  const dual = batch.runs.some((run) => run.frames.some((frame) => frame.attempts.some((attempt) => keptGenerator(attempt.checks))));
  return (
    <div className={fb.editor}>
      <div className={fb.editorHead}>
        <div className="min-w-0">
          <p className={fb.sectionLabel}>Test batch · {batch.runs.length} characters · frames 1–{count}{dual ? " · Muse Image and Higgsfield" : ""}</p>
          <h1 className={fb.editorTitle} title={first?.name}>{first?.name.split(" · ").slice(0, -1).join(" · ") || "Test batch"}</h1>
        </div>
        <div className={fb.headActions}>
          {rounds > 1 ? (
            <div className={fb.chips} role="group" aria-label="Round">
              {Array.from({ length: rounds }, (_, i) => i + 1).map((value) => (
                <ToggleChip key={value} size="xs" selected={value === round} onClick={() => setPicked(value)}>Round {value}</ToggleChip>
              ))}
            </div>
          ) : null}
          <Button size="sm" variant="ai" disabled={working || starting} onClick={() => void another()} title={`Every character draws frames 1–${count} once more${dual ? ", by both generators" : ""}.`}>
            {working || starting ? <Spinner className="size-3.5" /> : <HugeiconsIcon icon={AiPaintbrushIcon} size={14} strokeWidth={1.75} />}
            {working ? "Drawing…" : "Another round"}
          </Button>
        </div>
      </div>
      <div className={styles.batchTable} style={{ "--batch-frames": count } as React.CSSProperties}>
        <div className={styles.batchRow}>
          <div className={styles.batchWho}><span className={fb.sectionLabel}>Video</span></div>
          {frames.map((index) => (
            <figure key={index} className={styles.batchCell}>
              <div className={`${fb.inspect} ${styles.batchImage}`}>{first ? <MediaImage src={rotoscopeUrls.media(first.id, "source", index)} alt={`Video frame ${index}`} /> : null}</div>
              <figcaption className={styles.batchLabel}>Frame {index}</figcaption>
            </figure>
          ))}
        </div>
        {batch.runs.map((run) => {
          const measures = measuresText(run.measures);
          const status = run.live ? `Frame ${run.live.frame}: ${STAGE_LABEL[run.live.stage].toLowerCase()}` : run.phase === "preparing" ? run.log.at(-1)?.trim() || "Preparing…" : PHASE_LABELS[run.phase];
          return (
            <div key={run.id} className={styles.batchRow}>
              <div className={styles.batchWho}>
                <span className={styles.batchAvatar}><MediaImage src={rotoscopeUrls.media(run.id, "character")} alt="" iconSize={12} /></span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-foreground" title={run.name}>{run.name.split(" · ").at(-1)}</span>
                  <span className="block truncate text-[11px] text-muted-foreground" title={status}>{run.error ?? status}</span>
                  {measures ? <span className="block truncate text-[11px] text-muted-foreground">{measures}</span> : null}
                </span>
                <Button size="xs" variant="ghost" className="w-fit" onClick={() => onOpenRun(run.id)}>
                  <HugeiconsIcon icon={ArrowRight01Icon} size={13} strokeWidth={1.75} />Open run
                </Button>
              </div>
              {frames.map((index) => <BatchCell key={index} run={run} index={index} round={round} />)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
