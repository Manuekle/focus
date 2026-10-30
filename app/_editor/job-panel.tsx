"use client";

import { Download02Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Disclosure } from "../../components/ui/disclosure";
import { ProgressMeter } from "../../components/ui/progress-meter";
import { Spinner } from "../../components/ui/spinner";
import { ToggleChip } from "../../components/ui/toggle-chip";
import { useEffect, useState, type ReactNode } from "react";
import { useToast } from "../../components/toast-provider";
import { cn } from "../../lib/utils";
import { RenderParamsSchema, type RenderParams, type RenderResult } from "../../shared/render";
import { englishRenderWarning } from "../../shared/render-warnings";
import type { EditJob, JobPhase, PlanEffect } from "../../shared/schemas";
import { AiEditor } from "./ai-editor";
import { EffectControls } from "./effect-controls";
import { EditorNotice } from "./editor-notice";

export const PLAN_EFFECT_LABEL: Record<PlanEffect, string> = {
  selective_color: "Selective color",
  background_blur: "Background blur",
  spotlight: "Spotlight",
  break_frame: "Break the Frame",
  motion_echo: "Motion Echo",
  time_freeze_echo: "Time Freeze",
};

function Step({ state, title, model }: { readonly state: "done" | "active" | "pending"; readonly title: string; readonly model: string }) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-lg border",
          state === "done" && "border-transparent bg-accent text-accent-foreground",
          state === "active" && "border-[color-mix(in_srgb,var(--primary)_45%,var(--border))] text-primary",
          state === "pending" && "border-border text-muted-foreground",
        )}
      >
        {state === "done" ? <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2} /> : state === "active" ? <Spinner className="size-3.5" /> : null}
      </span>
      <span className="min-w-0">
        <span className={cn("block text-sm", state === "pending" ? "text-muted-foreground" : "text-foreground")}>{title}</span>
        <span className="block text-xs text-muted-foreground">{model}</span>
      </span>
    </li>
  );
}

const PHASES: readonly { readonly id: JobPhase; readonly title: string; readonly model: string }[] = [
  { id: "understanding", title: "Understand your edit", model: "Muse Spark" },
  { id: "finding", title: "Find your subject", model: "SAM 3.1" },
  { id: "tracking", title: "Track the movement", model: "SAM 3.1 · frame by frame" },
  { id: "applying", title: "Apply your effect", model: "Focus compositor" },
  { id: "encoding", title: "Encode your MP4", model: "FFmpeg · H.264" },
];

export function ProcessingPanel({ job, onCancel, canceling }: { readonly job: EditJob; readonly onCancel: () => void; readonly canceling: boolean }) {
  // Steps light up from the job's real phase; nothing advances on a timer.
  const current = Math.max(0, PHASES.findIndex((phase) => phase.id === job.phase));
  // A re-render (a previous result exists) reuses the stored plan and masks.
  const rerender = job.status === "rendering" && job.render !== null;
  const percent = Math.round(job.progress * 100);
  // A re-render asked for in the AI editor shows that request, not the first instruction.
  const lastChat = rerender ? [...job.chat].reverse().find((message) => message.role === "user") : undefined;
  return (
    <section aria-label="Processing" className="flex flex-col gap-5">
      <div>
        <h2 className="text-sm font-medium">{job.status === "rendering" ? "Rendering your effect" : "Working on your instruction"}</h2>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">“{lastChat?.text ?? job.request.prompt}”</p>
      </div>
      <ol className="flex flex-col gap-3">
        {PHASES.map((phase, index) => (
          <Step
            key={phase.id}
            state={index < current ? "done" : index === current ? "active" : "pending"}
            title={phase.title}
            model={
              phase.id === "understanding" && job.plan
                ? `Subject: ${job.plan.target.concept}`
                : rerender && index < 3
                  ? "Saved from your previous edit"
                  : phase.model
            }
          />
        ))}
      </ol>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground tabular-nums">
          <p role="status" className="min-w-0 truncate">{job.detail ?? "Processing…"}</p>
          <span aria-hidden className="shrink-0 text-foreground">{percent}%</span>
        </div>
        <ProgressMeter size="sm" value={percent} aria-label="Progress" aria-valuetext={`${percent}%`} />
      </div>
      <Button variant="outline" onClick={onCancel} disabled={canceling} aria-busy={canceling}>
        {canceling ? <Spinner /> : null}
        Cancel
      </Button>
    </section>
  );
}

export function SelectionPanel({
  job,
  frameCount,
  pending,
  onToggle,
  onSelectAll,
  onConfirm,
  unmatchedPoint,
  onSegmentPoint,
  busy,
}: {
  readonly job: EditJob;
  readonly frameCount: number;
  readonly pending: readonly string[];
  readonly onToggle: (objectId: string) => void;
  readonly onSelectAll: () => void;
  readonly onConfirm: () => void;
  readonly unmatchedPoint: boolean;
  readonly onSegmentPoint: () => void;
  readonly busy: boolean;
}) {
  const chosen = new Set(pending);
  return (
    <section aria-label="Choose a subject" className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-medium">Choose what stands out</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {job.detail ?? "Click subjects in the video to add or remove them, or choose from the list."}
          {job.plan?.target.description ? ` Hint: ${job.plan.target.description}.` : ""}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Detected subjects">
        {job.objects.map((object, index) => (
          <ToggleChip
            key={object.id}
            size="xs"
            selected={chosen.has(object.id)}
            onClick={() => onToggle(object.id)}
            title={`${object.framesPresent}/${frameCount} frames${object.meanConfidence !== null ? ` · confidence ${object.meanConfidence.toFixed(2)}` : ""}`}
            className="tabular-nums"
          >
            {object.source === "point" ? "Point" : "Subject"} {index + 1}
          </ToggleChip>
        ))}
      </div>
      {job.objects.length > 1 ? (
        <button type="button" onClick={onSelectAll} className="w-fit text-xs text-primary hover:underline">
          Select all {job.objects.length}
        </button>
      ) : null}
      {unmatchedPoint ? (
        <div className="rounded-xl border border-border bg-muted p-3">
          <p className="text-xs leading-5 text-foreground">No detected subject covers that point.</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={onSegmentPoint} disabled={busy}>
            Find the subject at this point
          </Button>
          <p className="mt-1.5 text-xs text-muted-foreground">Uses Meta AI to find another subject.</p>
        </div>
      ) : null}
      <Button onClick={onConfirm} disabled={pending.length === 0 || busy} aria-busy={busy}>
        {busy ? <Spinner /> : null}
        {pending.length > 1 ? `Use ${pending.length} subjects` : "Use selection"}
      </Button>
    </section>
  );
}

export function ReadyPanel({
  job,
  frameCount,
  onChangeSelection,
  onNewInstruction,
  onRender,
  controls,
  busy = false,
}: {
  readonly job: EditJob;
  readonly frameCount: number;
  readonly onChangeSelection: () => void;
  readonly onNewInstruction: () => void;
  readonly onRender?: () => void;
  readonly controls?: ReactNode;
  readonly busy?: boolean;
}) {
  const selected = job.objects.filter((object) => job.selection.includes(object.id));
  const coverage = Math.max(0, ...selected.map((object) => object.framesPresent));
  const reused = [job.reused.plan && "plan", job.reused.segmentation && "masks"].filter(Boolean).join(" and ");
  return (
    <section aria-label="Subject ready" className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <span className="grid size-7 place-items-center rounded-lg bg-accent text-accent-foreground">
          <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2} />
        </span>
        <h2 className="text-sm font-medium">Your subject is ready</h2>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">Subject</dt>
        <dd>{job.plan?.target.concept}</dd>
        <dt className="text-muted-foreground">Effect</dt>
        <dd>{job.plan ? PLAN_EFFECT_LABEL[job.plan.effect] : "—"}</dd>
        <dt className="text-muted-foreground">Selection</dt>
        <dd>
          {selected.length} {selected.length === 1 ? "subject" : "subjects"} of {job.objects.length}
        </dd>
        <dt className="text-muted-foreground">Tracking</dt>
        <dd className="tabular-nums">
          {coverage}/{frameCount} frames
        </dd>
        {reused ? (
          <>
            <dt className="text-muted-foreground">Reused</dt>
            <dd>{reused}, no extra cost</dd>
          </>
        ) : null}
      </dl>
      <p className="text-xs leading-5 text-muted-foreground">Your selection is saved, so you can keep editing without repeating the AI step.</p>
      {job.detail || job.error ? <p role={job.error ? "alert" : undefined} className="text-xs leading-5 text-muted-foreground">{job.error?.message ?? job.detail}</p> : null}
      {controls}
      {onRender ? (
        <Button onClick={onRender} disabled={busy} aria-busy={busy}>
          {busy ? <Spinner /> : null}
          {job.params?.effect === "time_freeze_echo" ? "Preview Time Freeze" : "Render effect"}
        </Button>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {job.status !== "failed" ? <Button variant="outline" size="sm" onClick={onChangeSelection}>
          {job.objects.length > 1 ? "Change subjects" : "Add a subject"}
        </Button> : null}
        <Button variant="ghost" size="sm" onClick={onNewInstruction}>
          New instruction
        </Button>
      </div>
    </section>
  );
}

export function ResultPanel({
  job,
  draft,
  onDraftChange,
  onApply,
  busy,
  onChangeSelection,
  onNewInstruction,
  onFillGaps,
  onEditFreezePoint,
  editingFreezePoint = false,
  chat,
}: {
  readonly job: EditJob & { readonly render: RenderResult };
  readonly onFillGaps: () => void;
  readonly onEditFreezePoint?: () => void;
  readonly editingFreezePoint?: boolean;
  readonly chat: {
    readonly pending: string | null;
    readonly disabled: boolean;
    readonly onSend: (message: string) => void;
    readonly onRestore: (messageId: string) => void;
    readonly onStartEdit: (instruction: string) => void;
  };
  readonly draft: RenderParams;
  readonly onDraftChange: (next: RenderParams) => void;
  readonly onApply: () => void;
  readonly busy: boolean;
  readonly onChangeSelection: () => void;
  readonly onNewInstruction: () => void;
}) {
  const render = job.render;
  // Restoring a suggestion can construct identical values in a different
  // key order. Compare the schema's canonical shape, including nested keys.
  const dirty = JSON.stringify(RenderParamsSchema.parse(draft)) !== JSON.stringify(RenderParamsSchema.parse(render.params));
  const temporal = draft.effect === "time_freeze_echo";
  // Unapplied changes open the hand controls; after that it is the person's to fold.
  const [fineTuneOpen, setFineTuneOpen] = useState(dirty);
  useEffect(() => { if (dirty) setFineTuneOpen(true); }, [dirty]);
  // The dedicated controls now explain the suggestion next to its marker.
  // Keep actual render warnings in the existing notice without duplicating
  // a long, persistent suggestion toast over the mobile timeline.
  const warnings = render.warnings.filter((warning) => !job.temporalSuggestion || !warning.startsWith(job.temporalSuggestion.reason)).map(englishRenderWarning);
  const adjustments = (
    <div className="flex flex-col gap-4">
      <EffectControls family={job.request.effect} value={draft} onChange={onDraftChange} />
      <Button variant="secondary" onClick={onApply} disabled={!dirty || busy} aria-busy={busy}>
        {busy ? <Spinner /> : null}
        Apply adjustments
      </Button>
      <p className="-mt-3 text-xs leading-4 text-muted-foreground">Uses your saved selection. No additional AI step.</p>
    </div>
  );
  return (
    <section aria-label="Result" className="flex flex-col gap-5">
      <div className="flex items-center gap-2.5">
        <span className="grid size-7 place-items-center rounded-lg bg-accent text-accent-foreground">
          <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{PLAN_EFFECT_LABEL[render.params.effect]} ready</h2>
          <p className="text-xs text-muted-foreground tabular-nums">
            {render.width}×{render.height} · {render.fps} fps · {render.durationSeconds.toFixed(1)} s · {job.plan?.target.concept}
          </p>
        </div>
      </div>

      {/* Phones get the same button in the fixed bottom bar instead. */}
      <DownloadButton url={render.urls.download} className="hidden lg:flex" />

      {temporal ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground tabular-nums">Freeze point · {((draft.trigger.timestampMs ?? 0) / 1000).toFixed(2)} s in the original clip{dirty ? " · unapplied changes" : ""}</p>
          {job.temporalSuggestion ? <p className="text-xs leading-5 text-muted-foreground">
            Suggested {job.temporalSuggestion.event === "jump_apex" ? "jump apex" : "peak motion"} · {Math.round(job.temporalSuggestion.confidence * 100)}% confidence. Review the moment before exporting.
          </p> : null}
          <Button variant="outline" size="sm" onClick={onEditFreezePoint} aria-pressed={editingFreezePoint}>
            {editingFreezePoint ? "Preview rendered video" : "Adjust freeze point"}
          </Button>
          {adjustments}
        </div>
      ) : null}

      {warnings.length ? (
        <EditorNotice
          status="warning"
          title="Review your result"
          description={[warnings.join(" "), render.framesWithoutMask > 0 ? "Uses Meta AI to complete only the missing frames." : ""].filter(Boolean).join(" ")}
          action={render.framesWithoutMask > 0 && !busy ? { label: "Complete subject tracking", onClick: onFillGaps } : undefined}
        />
      ) : null}

      <AiEditor messages={job.chat} current={render.params} {...chat} />

      {!temporal ? (
        <Disclosure title={<span className="text-foreground">Fine-tune by hand</span>} open={fineTuneOpen} onOpenChange={setFineTuneOpen}>
          <div className="mt-2 flex flex-col gap-4">
            {adjustments}
          </div>
        </Disclosure>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onChangeSelection}>
          {job.objects.length > 1 ? "Change subjects" : "Add a subject"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onNewInstruction}>
          New instruction
        </Button>
      </div>
    </section>
  );
}

/**
 * Fetches the edited MP4 with real byte progress, then hands it to the browser
 * as a file. Success is reported only after every byte arrived.
 */
export function DownloadButton({ url, className }: { readonly url: string; readonly className?: string }) {
  const [state, setState] = useState<{ kind: "idle" } | { kind: "downloading"; fraction: number | null } | { kind: "error"; message: string }>({ kind: "idle" });
  const { toast } = useToast();

  const start = async () => {
    setState({ kind: "downloading", fraction: 0 });
    try {
      const response = await fetch(url);
      if (!response.ok || !response.body) throw new Error("http");
      const total = Number(response.headers.get("content-length")) || 0;
      const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "focus.mp4";
      const reader = response.body.getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value as Uint8Array<ArrayBuffer>);
        received += value.length;
        setState({ kind: "downloading", fraction: total ? received / total : null });
      }
      const href = URL.createObjectURL(new Blob(chunks, { type: "video/mp4" }));
      const link = document.createElement("a");
      link.href = href;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
      setState({ kind: "idle" });
      toast({ title: "MP4 downloaded", description: name, status: "success" });
    } catch {
      setState({ kind: "error", message: "We couldn’t download your video. Check your connection and try again." });
    }
  };

  const downloading = state.kind === "downloading";
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Button size="lg" onClick={() => void start()} disabled={downloading} aria-busy={downloading}>
        {downloading ? <Spinner /> : <HugeiconsIcon icon={Download02Icon} size={16} strokeWidth={1.75} />}
        {downloading ? (state.fraction === null ? "Downloading…" : `Downloading · ${Math.round(state.fraction * 100)}%`) : "Download MP4"}
      </Button>
      {state.kind === "error" ? (
        <EditorNotice title="Video couldn’t be downloaded" description={state.message} action={{ label: "Retry", onClick: () => void start() }} />
      ) : null}
    </div>
  );
}
