"use client";

import { AiPaintbrushIcon, SparklesIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Disclosure } from "../../components/ui/disclosure";
import { EXPOSURE_FPS, currentInbetweenPlan, currentMotionCheck, denseInbetweenTargets, exposureSheet, plannedInbetweenTargets, playbackCycle, type DrawingFps, type Flipbook, type InbetweenEase } from "../../shared/flipbook";
import styles from "./flipbook.module.css";

const EASE_LABEL: Readonly<Record<InbetweenEase, string>> = { none: "even", in: "slows into the next", out: "eases out", in_out: "eases in and out" };

/**
 * In-betweens fill the time between the key poses. "Calculate" measures how
 * far the body moves across each gap and lets Muse Spark decide the speed,
 * how many in-betweens each gap needs and their spacing; nothing is drawn
 * until the animator makes them. Filling every slot at the pace stays under
 * Advanced, without Muse Spark. The cost is stated before anything is drawn;
 * past the budget, the editor's usual confirmation asks first.
 */
export function InbetweenPanel({
  flipbook,
  drawingFps,
  cycleSeconds,
  keysReady,
  disabled,
  onPlan,
  onDrawPlanned,
  onDraw,
  onCheckMotion,
  onFixMotion,
}: {
  readonly flipbook: Flipbook;
  readonly drawingFps: DrawingFps;
  readonly cycleSeconds?: number;
  /** Every key drawing is finished and registered. */
  readonly keysReady: boolean;
  readonly disabled: boolean;
  readonly onPlan: () => void;
  readonly onDrawPlanned: () => void;
  readonly onDraw: () => void;
  /** Measure the played loop step by step (free). */
  readonly onCheckMotion: () => void;
  /** Redraw the keys Muse Spark named to remove the jumps. */
  readonly onFixMotion: () => void;
}) {
  const plan = currentInbetweenPlan(flipbook);
  const planned = plannedInbetweenTargets(flipbook).length;
  const dense = denseInbetweenTargets(flipbook, drawingFps).length;
  const cycle = playbackCycle(flipbook, true);
  const current = cycle.filter((drawing) => drawing.inbetween).length;
  const sheet = exposureSheet(cycle, drawingFps, cycleSeconds);
  const actualFps = Math.round((sheet.drawings.length * EXPOSURE_FPS) / sheet.holds.reduce((sum, hold) => sum + hold, 0));
  const { used, limit } = flipbook.budget;
  const made = flipbook.inbetweens.filter((entry) => entry.status === "ready");
  const moved = made.filter((entry) => entry.method === "skeleton").length;
  const labels = new Map(flipbook.frames.map((frame) => [frame.id, frame.label]));
  const cost = (count: number) => {
    const over = Math.max(0, used + count - limit);
    if (!keysReady) return "Finish every key drawing first.";
    return over > 0
      ? `If none can be moved from the skeleton, that is ${over} past this animation’s budget (${used} of ${limit} used); you’ll be asked to confirm.`
      : `Drawings ${used}/${limit} used now; at most ${used + count}/${limit} after, since only the ones the skeleton can’t carry are drawn.`;
  };
  const noun = (count: number) => (count === 1 ? "in-between" : "in-betweens");

  return (
    <section className={styles.panel} aria-labelledby="inbetween-title">
      <div className={styles.panelHead}>
        <h2 id="inbetween-title" className={styles.panelTitle}>In-betweens</h2>
        <Badge>{actualFps} drawings/s</Badge>
      </div>
      <p className={styles.hint}>The poses between the key drawings, so the movement flows instead of jumping from key to key. Calculate measures how far the body moves in each part and Muse Spark decides the speed, how many in-betweens each part needs and how they are spaced. Each is first moved from the character’s skeleton; one the skeleton can’t carry cleanly is drawn by Muse Image.</p>
      {moved ? <p className="text-[11px] leading-4 text-muted-foreground" data-testid="inbetween-methods">{moved} of {made.length} moved from the skeleton{made.length - moved ? `, ${made.length - moved} drawn by Muse Image` : ""}.</p> : null}

      {plan ? (
        <div className="flex flex-col gap-2" data-testid="inbetween-plan">
          <p className="text-[12px] leading-5">{plan.summary || "In-betweens calculated."} <span className="text-muted-foreground">Cycle: {plan.cycleSeconds} s.</span></p>
          <ol className="flex flex-col gap-1 text-[11px] leading-4 text-muted-foreground">
            {plan.gaps.map((gap, index) => (
              <li key={gap.from} data-testid="inbetween-gap">
                <span className="text-foreground">{index + 1} → {(index + 1) % plan.gaps.length + 1}</span> · {gap.count} {noun(gap.count)} · {EASE_LABEL[gap.ease]}
                {gap.turn !== null ? ` · ${Math.round(gap.turn)}°` : ""} · {Math.round(gap.silhouette * 100)}% outline change
                {gap.note ? <span className="block">{labels.get(gap.from)} → {labels.get(gap.to)}: {gap.note}</span> : null}
              </li>
            ))}
          </ol>
          {planned ? (
            <>
              <Button size="sm" variant="ai" disabled={disabled || !keysReady} onClick={onDrawPlanned}>
                <HugeiconsIcon icon={AiPaintbrushIcon} size={14} strokeWidth={1.75} />Make {planned} {noun(planned)} · up to {planned} {planned === 1 ? "drawing" : "drawings"}
              </Button>
              <p className="text-[11px] leading-4 text-muted-foreground" data-testid="inbetween-cost">{cost(planned)}</p>
            </>
          ) : <p className={styles.hint}>Every calculated in-between is ready.</p>}
          <Button size="sm" variant="ghost" disabled={disabled || !keysReady} onClick={onPlan}>Calculate again</Button>
        </div>
      ) : (
        <>
          <Button size="sm" variant="ai" disabled={disabled || !keysReady} onClick={onPlan}>
            <HugeiconsIcon icon={SparklesIcon} size={14} strokeWidth={1.75} />Calculate in-betweens
          </Button>
          <p className="text-[11px] leading-4 text-muted-foreground" data-testid="inbetween-plan-hint">
            {keysReady ? "Muse Spark only reads the measurements: nothing is drawn and no drawing is used until you make them." : "Finish every key drawing first."}
            {current && flipbook.inbetweenPlan ? " The key drawings changed since the last calculation." : ""}
          </p>
        </>
      )}

      <MotionCheckBlock flipbook={flipbook} canCheck={keysReady && current > 0 && !planned} disabled={disabled} cost={cost} onCheck={onCheckMotion} onFix={onFixMotion} />

      <Disclosure title={`Advanced: fill every slot at ${drawingFps} keys/s, without Muse Spark`}>
        <div className="flex flex-col gap-2 text-[11px] leading-4 text-muted-foreground">
          {dense ? (
            <>
              <Button size="sm" variant="secondary" disabled={disabled || !keysReady} onClick={onDraw}>
                Make {dense} {noun(dense)} · up to {dense} {dense === 1 ? "drawing" : "drawings"}
              </Button>
              <p>{cost(dense)}{current ? " A redrawn or moved pose needs its in-between drawn again." : ""}</p>
            </>
          ) : <p>Every slot already has its in-between. Cycle length changes the speed without drawing them again.</p>}
        </div>
      </Disclosure>
    </section>
  );
}

/**
 * The motion check, after the in-betweens: every played step measured by
 * outline. A jump is named with where it happens; Muse Spark's correction
 * says which keys it rewrites, and "Fix" redraws them (one drawing each),
 * keeps a new key only if it fits its neighbors better, remakes the
 * in-betweens and checks again.
 */
function MotionCheckBlock({ flipbook, canCheck, disabled, cost, onCheck, onFix }: {
  readonly flipbook: Flipbook;
  readonly canCheck: boolean;
  readonly disabled: boolean;
  readonly cost: (count: number) => string;
  readonly onCheck: () => void;
  readonly onFix: () => void;
}) {
  const check = currentMotionCheck(flipbook);
  if (!check) {
    if (!canCheck) return null;
    return (
      <div className="flex flex-col gap-1" data-testid="motion-check">
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onCheck}>Check the motion for jumps</Button>
        <p className="text-[11px] leading-4 text-muted-foreground">Measures every step of the loop. Nothing is drawn.</p>
      </div>
    );
  }
  const position = new Map(flipbook.order.map((frameId, index) => [frameId, index + 1] as const));
  const name = (drawingId: string) => {
    const key = position.get(drawingId as (typeof flipbook.order)[number]);
    if (key) return `drawing ${key}`;
    const entry = flipbook.inbetweens.find((candidate) => candidate.id === drawingId);
    return entry ? `an in-between of ${position.get(entry.from)} → ${position.get(entry.to)}` : drawingId;
  };
  const worst = check.snaps[0];
  const fixCount = check.fix?.frames.length ?? 0;
  // The in-betweens of every gap touching a rewritten key are made again; the ones the skeleton can't carry are drawn.
  const fixed = new Set<string>(check.fix?.frames.map((entry) => entry.frame) ?? []);
  const remade = currentInbetweenPlan(flipbook)?.gaps.filter((gap) => fixed.has(gap.from) || fixed.has(gap.to)).reduce((sum, gap) => sum + gap.count, 0) ?? 0;
  const keysNoun = fixCount === 1 ? "key" : "keys";
  return (
    <div className="flex flex-col gap-2" data-testid="motion-check">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium leading-5">Motion check</p>
        <Badge tone={check.snaps.length ? "warning" : "success"}>{check.snaps.length ? `${check.snaps.length} ${check.snaps.length === 1 ? "jump" : "jumps"}` : "Smooth"}</Badge>
      </div>
      {check.outcome ? <p className="text-[11px] leading-4" data-testid="motion-outcome">{check.outcome}</p> : null}
      {worst ? (
        <p className="text-[11px] leading-4 text-muted-foreground">
          The loop jumps from {name(worst.from)} to {name(worst.to)}: the outline changes {Math.round(worst.change * 100)}% in one step, where a smooth step changes about {Math.round(check.mean * 100)}%.
        </p>
      ) : <p className="text-[11px] leading-4 text-muted-foreground">No jumps: the largest step changes the outline {Math.round(check.worst * 100)}%.</p>}
      {check.snaps.length && check.fix ? (
        <>
          <p className="text-[12px] leading-5" data-testid="motion-fix-reply">{check.fix.reply}</p>
          <ul className="flex flex-col gap-1 text-[11px] leading-4 text-muted-foreground">
            {check.fix.frames.map((entry) => <li key={entry.frame}><span className="text-foreground">{position.get(entry.frame)}. {entry.label}</span>: {entry.summary}</li>)}
          </ul>
          <Button size="sm" variant="ai" disabled={disabled} onClick={onFix}>
            <HugeiconsIcon icon={AiPaintbrushIcon} size={14} strokeWidth={1.75} />Fix · {fixCount} {keysNoun}{remade ? ` + up to ${remade} in-betweens` : ""}
          </Button>
          <p className="text-[11px] leading-4 text-muted-foreground">A redrawn key is kept only if it fits between its neighbors better; otherwise the earlier one comes back. Each key is one drawing; about {remade || "the"} in-betweens around {fixCount === 1 ? "it are" : "them are"} made again, from the skeleton first and with Muse Image where it can’t, one drawing each. {cost(fixCount + remade)}</p>
        </>
      ) : check.snaps.length ? (
        <p className="text-[11px] leading-4 text-muted-foreground">Muse Spark found no key pose to change for this jump. Describe the pose you want in the chat, or check again.</p>
      ) : null}
      {check.snaps.length ? <Button size="sm" variant="ghost" disabled={disabled} onClick={onCheck}>Check again</Button> : null}
    </div>
  );
}
