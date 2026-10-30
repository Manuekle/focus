"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Add01Icon, AiDrawingIcon, CheckIcon, Download02Icon, Film01Icon, Image02Icon, Video01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { ProgressMeter } from "../../components/ui/progress-meter";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Select } from "../../components/ui/select";
import { Slider } from "../../components/ui/slider";
import { Spinner } from "../../components/ui/spinner";
import { Switch } from "../../components/ui/switch";
import { useToast } from "../../components/toast-provider";
import { cn } from "../../lib/utils";
import { flipbookEnabled } from "../../shared/features";
import { characterUrls } from "../../shared/characters";
import { characterFile, handoffImageUrl } from "../characters/character-client";
import { CharacterPicker } from "../flipbook/character-picker";
import {
  ENGINE_LABELS,
  ENGINE_MIN_SECONDS,
  MUSE_DRAWING_FPS,
  THIRD_PARTY_ENGINES,
  PROGRESS_STAGES,
  isActiveStatus,
  referenceMotionUrls,
  type AnimationAsset,
  type AnimationJob,
  type Engine,
  type EngineAvailability,
  type ImportMethod,
  type JobStatus,
} from "../../shared/reference-motion";
import { AccountButton } from "../_auth/account-button";
import { FacebookButton } from "../_auth/facebook-button";
import { useSession } from "../_auth/session-client";
import { ago } from "../_editor/ago";
import { ModeSwitch } from "../_editor/mode-switch";
import { SidebarResizer, SidebarToggle, useSidebar } from "../_editor/sidebar-resizer";
import { SidebarListSkeleton } from "../_editor/studio-skeletons";
import { SidebarActivity } from "../_activity/sidebar-activity";
import shell from "../editor/studio.module.css";
import styles from "./animate.module.css";
import { animateApi, uploadAsset, useAnimationJob, type UploadHandle } from "./animate-client";
import { AnimateNav } from "../_editor/animate-nav";

const STAGE_LABELS: Record<JobStatus, string> = {
  queued: "Queued",
  validating: "Checking and trimming inputs",
  awaiting_gpu: "Waiting for the GPU",
  preprocessing: "Extracting poses",
  generating: "Generating the animation",
  postprocessing: "Encoding",
  uploading: "Receiving results",
  verifying: "Verifying the video",
  completed: "Ready",
  failed: "Failed",
  cancel_requested: "Cancelling",
  cancelled: "Cancelled",
};

type Upload = { readonly asset: AnimationAsset | null; readonly progress: number | null; readonly error: string | null };
const EMPTY: Upload = { asset: null, progress: null, error: null };

/**
 * Reference Motion: a character image follows a video's movement. The render
 * runs on the external GPU worker as a persisted job; the page only shows the
 * server's measured stages, so it can be left and reopened (?job=id).
 */
export function ReferenceMotionStudio({ initialJobId }: { readonly initialJobId: string | null }) {
  const { session } = useSession();
  const user = session?.user ?? null;
  const { toast } = useToast();
  const sidebar = useSidebar();
  const [jobId, setJobId] = useState(initialJobId);
  const { job, setJob, error: pollError } = useAnimationJob(jobId);
  const [history, setHistory] = useState<AnimationJob[] | null>(null);
  const [engines, setEngines] = useState<EngineAvailability | null>(null);
  const [character, setCharacter] = useState<Upload>(EMPTY);
  const [driving, setDriving] = useState<Upload>(EMPTY);
  const [start, setStart] = useState(0);
  const [duration, setDuration] = useState(3);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [resolution, setResolution] = useState<"480p" | "720p">("480p");
  const [fps, setFps] = useState<16 | 24>(24);
  const [interpolation, setInterpolation] = useState(false);
  const [useAudio, setUseAudio] = useState(false);
  const [seed, setSeed] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const uploads = useRef<UploadHandle[]>([]);
  const key = useRef(crypto.randomUUID());

  useEffect(() => {
    const url = jobId ? `/animate?job=${jobId}` : "/animate";
    if (`${window.location.pathname}${window.location.search}` !== url) window.history.replaceState(null, "", url);
  }, [jobId]);

  const loadHistory = useCallback(() => { void animateApi.list().then(setHistory, () => setHistory([])); }, []);
  useEffect(() => {
    if (!user) return;
    loadHistory();
    void animateApi.engines().then((state) => { setEngines(state); setEngine((current) => current ?? state.defaultEngine); setDuration((current) => Math.min(current, state.maxSegmentSeconds)); }, () => setEngines(null));
  }, [user, loadHistory]);
  const settled = job && !isActiveStatus(job.status) ? `${job.id}:${job.status}` : null;
  useEffect(() => { if (user && settled) loadHistory(); }, [user, settled, loadHistory]);
  useEffect(() => () => uploads.current.forEach((handle) => handle.abort()), []);

  const pick = (kind: "character" | "driving") => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (kind === "character") setSavedCharacter(null);
    send(kind, file);
  };
  const [savedCharacter, setSavedCharacter] = useState<string | null>(null);
  /** A saved character's version, or an image handed over from Flipbook, uploaded like a picked file. */
  const pickSaved = (url: string, name: string, savedId: string | null) => {
    setSavedCharacter(savedId);
    setCharacter({ asset: null, progress: 0, error: null });
    characterFile(url, name).then((file) => send("character", file), (cause: unknown) => setCharacter({ asset: null, progress: null, error: cause instanceof Error ? cause.message : "This character couldn’t be loaded." }));
  };
  const params = useSearchParams();
  const handoff = handoffImageUrl({ character: params.get("character"), version: params.get("version"), image: params.get("image") });
  const handedOff = useRef(false);
  useEffect(() => {
    if (!user || !handoff || handedOff.current) return;
    handedOff.current = true;
    pickSaved(handoff, "character", params.get("character"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the URL the page opened with
  }, [user, handoff]);
  const send = (kind: "character" | "driving", file: File) => {
    const set = kind === "character" ? setCharacter : setDriving;
    set({ asset: null, progress: 0, error: null });
    const handle = uploadAsset(kind, file, (progress) => set((current) => ({ ...current, progress })));
    uploads.current.push(handle);
    handle.promise.then(
      (asset) => {
        set({ asset, progress: null, error: null });
        if (kind === "driving") { setStart(0); setUseAudio(false); }
      },
      (cause: unknown) => set({ asset: null, progress: null, error: cause instanceof Error ? cause.message : "Upload failed." }),
    );
  };

  const maxSegment = engines?.maxSegmentSeconds ?? 3;
  const videoSeconds = driving.asset?.durationSeconds ?? 0;
  const minSegment = engine ? ENGINE_MIN_SECONDS[engine] : 1;
  const segment = Math.max(minSegment, Math.min(duration, Math.floor(videoSeconds) || duration));
  const zeroGpu = engine === "wan-zerogpu";
  const chosenResolution = zeroGpu ? "480p" : resolution;
  const lastStart = Math.max(0, Math.floor((videoSeconds - segment) * 10) / 10);
  const engineReady = Boolean(engines?.ready && engine && engines.engines.includes(engine));
  const blocked = !user ? "Sign in to animate a character." : !character.asset ? "Upload a character image." : !driving.asset ? "Upload a movement video." : !engineReady ? "The animation engine isn’t available." : videoSeconds < minSegment ? `This engine needs a video of at least ${minSegment} s.` : null;

  const generate = async () => {
    if (blocked || !character.asset || !driving.asset || !engine) return;
    setSubmitting(true);
    try {
      const parsedSeed = Number.parseInt(seed, 10);
      const next = await animateApi.create({
        characterAssetId: character.asset.id,
        drivingVideoAssetId: driving.asset.id,
        engine,
        startSeconds: Math.min(start, lastStart),
        durationSeconds: segment,
        resolution: chosenResolution,
        outputFps: fps,
        interpolation,
        useAudio,
        ...(Number.isInteger(parsedSeed) && parsedSeed >= 0 ? { seed: parsedSeed } : {}),
        idempotencyKey: key.current,
      });
      key.current = crypto.randomUUID();
      setJob(next);
      setJobId(next.id);
      loadHistory();
    } catch (cause) {
      toast({ title: "Couldn’t start the animation", description: cause instanceof Error ? cause.message : "Try again.", status: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const act = async (action: "cancel" | "retry") => {
    if (!job) return;
    try { setJob(await animateApi[action](job.id)); }
    catch (cause) { toast({ title: action === "cancel" ? "Couldn’t cancel" : "Couldn’t retry", description: cause instanceof Error ? cause.message : "Try again.", status: "error" }); }
  };

  return (
    <div className={shell.studio}>
      <header className={shell.header}>
        <div className={shell.headerStart}>
          <SidebarToggle sidebar={sidebar} ariaControls="animate-library" />
          <Link href="/" className={shell.brand} aria-label="Focus — Home">
            <Image src="/brand/focus-cat.webp" alt="" width={30} height={30} />
            <span>focus<span className={shell.brandDot}>.</span></span>
          </Link>
        </div>
        <ModeSwitch current="animate" />
        <div className={shell.headerEnd}><AccountButton session={session} next={jobId ? `/animate?job=${jobId}` : "/animate"} /></div>
      </header>

      <div className={shell.body} {...sidebar.bodyProps}>
        <SidebarResizer sidebar={sidebar} showToggle={false} />
        <aside id="animate-library" className={shell.sidebar} aria-label="Your renders">
          <ScrollArea className={shell.sidebarScroll} contentClassName={shell.sidebarContent}>
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setJobId(null)}>
              <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={1.75} />
              New render
            </Button>
            <AnimateNav current="motion" />
            {user ? (
              <nav className={shell.projects} aria-label="Renders">
                <p className={shell.sideLabel}>Renders</p>
                {history === null ? <SidebarListSkeleton label="Loading your renders" /> : history.length === 0 ? (
                  <p className="px-2 text-xs leading-5 text-muted-foreground">Every render you start is kept here.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {history.map((entry) => (
                      <li key={entry.id} className={cn(shell.project, entry.id === jobId && shell.projectActive)}>
                        <button type="button" className={cn(shell.projectLink, "text-left")} aria-current={entry.id === jobId ? "page" : undefined} onClick={() => setJobId(entry.id)}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- the uploaded character, from the media route */}
                          <img src={entry.status === "completed" && entry.outputs.some((output) => output.name === "preview.webp") ? referenceMotionUrls.output(entry.id, "preview.webp") : referenceMotionUrls.asset(entry.characterAssetId)} alt="" className={shell.poster} onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
                          <span className="min-w-0">
                            <span className="block truncate text-xs text-foreground">{ENGINE_LABELS[entry.engine]} · {entry.config.durationSeconds} s</span>
                            <span className="block text-[11px] text-muted-foreground">{STAGE_LABELS[entry.status]} · {ago(entry.createdAt)}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </nav>
            ) : null}
          </ScrollArea>
          <SidebarActivity />
        </aside>

        <ScrollArea as="main" className={shell.main} contentClassName={styles.content}>
          {session && !user ? (
            <section className={styles.section}>
              <h1 className={styles.title}>Reference Motion</h1>
              <p className={styles.hint}>Sign in to make a character follow the movement of a video. Renders use a GPU and are saved to your account.</p>
              <FacebookButton next="/animate" label="Sign in with Facebook" className="h-9 w-fit px-3 text-[13px]" />
            </section>
          ) : jobId ? (
            job ? <JobView job={job} onAction={(action) => void act(action)} onNew={() => setJobId(null)} /> : pollError ? <p className={styles.hint} data-invalid="">{pollError}</p> : <Spinner />
          ) : (
            <>
              <section className={styles.section}>
                <h1 className={styles.title}>Reference Motion</h1>
                <p className={styles.hint}>Your character copies the movement of a video. Start with {maxSegment} seconds where arms and legs are clearly visible. Use only images and videos you have the rights to.</p>
              </section>

              <section className={styles.section} aria-labelledby="rm-character">
                <h2 id="rm-character" className={styles.label}>1 · Character</h2>
                <div className={styles.row}>
                  {character.asset ? (
                    // eslint-disable-next-line @next/next/no-img-element -- the normalized upload
                    <img src={referenceMotionUrls.asset(character.asset.id)} alt="Character reference" className={styles.thumb} />
                  ) : null}
                  <div className={styles.stack}>
                    <FilePick accept="image/png,image/jpeg,image/webp" label={character.asset ? "Replace image" : "Upload image"} icon={Image02Icon} onChange={pick("character")} busy={character.progress !== null} />
                    {character.progress !== null ? <ProgressMeter size="sm" value={character.progress * 100} aria-label="Image upload" /> : null}
                    {character.asset ? <p className={styles.hint}>{character.asset.originalName} · {character.asset.width}×{character.asset.height}</p> : <p className={styles.hint}>PNG, JPEG or WebP. One full-body character on a plain background works best.</p>}
                    {character.error ? <p className={styles.hint} data-invalid="">{character.error}</p> : null}
                  </div>
                </div>
                <CharacterPicker title="Or pick one of your characters" selected={savedCharacter} onPick={(entry) => pickSaved(characterUrls.version(entry.id, entry.selectedVersionId), entry.name, entry.id)} />
              </section>

              <section className={styles.section} aria-labelledby="rm-motion">
                <h2 id="rm-motion" className={styles.label}>2 · Movement</h2>
                {driving.asset ? <SegmentPicker asset={driving.asset} start={Math.min(start, lastStart)} duration={segment} lastStart={lastStart} onStart={setStart} /> : null}
                <div className={styles.stack}>
                  <FilePick accept="video/mp4,video/quicktime" label={driving.asset ? "Replace video" : "Upload video"} icon={Video01Icon} onChange={pick("driving")} busy={driving.progress !== null} />
                  {driving.progress !== null ? <ProgressMeter size="sm" value={driving.progress * 100} aria-label="Video upload" /> : null}
                  {driving.asset ? <p className={styles.hint}>{driving.asset.originalName} · {driving.asset.width}×{driving.asset.height} · {driving.asset.durationSeconds?.toFixed(1)} s</p> : <p className={styles.hint}>MP4 or MOV with one person whose whole body stays in frame.</p>}
                  {driving.error ? <p className={styles.hint} data-invalid="">{driving.error}</p> : null}
                </div>
              </section>

              <section className={styles.section} aria-labelledby="rm-settings">
                <h2 id="rm-settings" className={styles.label}>3 · Settings</h2>
                <div className={styles.grid}>
                  <Field label="Engine">
                    <Select aria-label="Engine" value={engine ?? ""} onValueChange={(value) => setEngine(value as Engine)} disabled={!engines?.engines.length} placeholder="No engine available" options={(engines?.engines ?? []).map((value) => ({ value, label: ENGINE_LABELS[value] }))} />
                  </Field>
                  <Field label="Segment">
                    <Select aria-label="Segment length" value={String(segment)} onValueChange={(value) => setDuration(Number(value))} options={[1, 2, 3].filter((value) => value <= maxSegment && value >= minSegment).map((value) => ({ value: String(value), label: `${value} s` }))} />
                  </Field>
                  <Field label="Resolution">
                    <Select aria-label="Resolution" value={chosenResolution} disabled={zeroGpu} onValueChange={(value) => setResolution(value as "480p" | "720p")} options={[{ value: "480p", label: "480p" }, { value: "720p", label: "720p" }]} />
                  </Field>
                  <Field label="Frame rate">
                    <Select aria-label="Frame rate" value={String(fps)} onValueChange={(value) => setFps(Number(value) as 16 | 24)} options={[{ value: "24", label: "24 fps" }, { value: "16", label: "16 fps" }]} />
                  </Field>
                  <Field label="Seed">
                    <input className={styles.input} inputMode="numeric" placeholder="Random" value={seed} onChange={(event) => setSeed(event.target.value.replace(/\D/g, "").slice(0, 10))} aria-label="Seed" />
                  </Field>
                </div>
                <div className={styles.toggles}>
                  <label className={styles.toggle}><Switch checked={interpolation} onCheckedChange={setInterpolation} label="RIFE interpolation" /> Also make a RIFE-interpolated version (A/B, experimental)</label>
                  <label className={styles.toggle}><Switch checked={useAudio} onCheckedChange={setUseAudio} disabled={!driving.asset?.hasAudio} label="Keep audio" /> Keep the video’s audio</label>
                </div>
              </section>

              <section className={styles.section} aria-labelledby="rm-preflight">
                <h2 id="rm-preflight" className={styles.label}>4 · Before generating</h2>
                <Preflight engines={engines} engine={engine} />
                {blocked ? <p className={styles.hint}>{blocked}</p> : null}
                <Button className="w-fit" disabled={Boolean(blocked) || submitting} onClick={() => void generate()}>
                  {submitting ? <Spinner /> : null}
                  Generate {segment} s
                </Button>
              </section>
            </>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}

function Field({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return <div className={styles.field}><span className={styles.fieldLabel}>{label}</span>{children}</div>;
}

function FilePick({ accept, label, icon, onChange, busy }: { readonly accept: string; readonly label: string; readonly icon: typeof Image02Icon; readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void; readonly busy: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={input} type="file" accept={accept} className="sr-only" onChange={onChange} tabIndex={-1} aria-hidden />
      <Button variant="outline" size="sm" className="w-fit" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Spinner /> : <HugeiconsIcon icon={icon} size={14} strokeWidth={1.75} />}
        {label}
      </Button>
    </>
  );
}

/** Scrub to the start of the segment; the preview loops only that segment. */
function SegmentPicker({ asset, start, duration, lastStart, onStart }: { readonly asset: AnimationAsset; readonly start: number; readonly duration: number; readonly lastStart: number; readonly onStart: (value: number) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.currentTime = start;
    const loop = () => { if (element.currentTime >= start + duration || element.currentTime < start - 0.1) element.currentTime = start; };
    element.addEventListener("timeupdate", loop);
    return () => element.removeEventListener("timeupdate", loop);
  }, [start, duration]);
  return (
    <div className={styles.segment}>
      <video ref={video} src={referenceMotionUrls.asset(asset.id)} poster={`${referenceMotionUrls.asset(asset.id)}?poster=1`} className={styles.video} muted playsInline autoPlay loop aria-label="Movement video, selected segment" />
      <div className={styles.stack}>
        <Slider aria-label="Segment start" aria-valuetext={`${start.toFixed(1)} seconds`} min={0} max={Math.max(lastStart, 0.1)} step={0.1} value={[start]} disabled={lastStart === 0} onValueChange={([value]) => onStart(value ?? 0)} />
        <p className={cn(styles.hint, "tabular-nums")}>Segment {start.toFixed(1)}–{(start + duration).toFixed(1)} s of {asset.durationSeconds?.toFixed(1)} s</p>
      </div>
    </div>
  );
}

function Preflight({ engines, engine }: { readonly engines: EngineAvailability | null; readonly engine: Engine | null }) {
  if (!engines) return <p className={styles.hint}>Checking the animation engine…</p>;
  if (!engines.configured) return <p className={styles.hint} data-invalid="">No GPU worker is configured for this deployment.</p>;
  if (!engines.ready) return <p className={styles.hint} data-invalid="">{engines.detail ?? "The animation engine isn’t ready."}</p>;
  const gpu = engines.gpu?.name ? `${engines.gpu.name}${engines.gpu.vramTotalMb ? ` · ${Math.round(engines.gpu.vramTotalMb / 1024)} GB` : ""}` : "GPU not reported";
  return (
    <ul className={styles.facts}>
      <li>Engine: {engine ? ENGINE_LABELS[engine] : "—"}{engine === "fake" ? " — checks the pipeline, draws no animation" : ""}</li>
      {engine && THIRD_PARTY_ENGINES.includes(engine) ? <li className={styles.warning}>Your image and the selected video segment are uploaded to a public Hugging Face demo run by a third party, under its free daily GPU quota. It can be busy, out of quota or changed without notice. Use only material you’re allowed to share.</li> : null}
      <li>Worker: {gpu}{engines.gpuHourlyUsd != null ? ` · USD ${engines.gpuHourlyUsd.toFixed(2)}/h listed` : ""}</li>
      <li>Cost is measured after the render from GPU time; it isn’t estimated in advance.</li>
    </ul>
  );
}

/**
 * Opens the render in Flipbook. By default Muse Image draws every frame there
 * from the character, following the render at each tick; the render's own
 * frames can also be imported as they are (cut out by their flat background,
 * or by one paid SAM 3.1 pass). Once per method: asking again opens it.
 */
function OpenInFlipbook({ job }: { readonly job: AnimationJob }) {
  const { toast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<ImportMethod | null>(null);
  const [withSam, setWithSam] = useState(job.flipbookImport === "sam");
  const asRendered: ImportMethod = withSam ? "sam" : "background";
  const made = (method: ImportMethod) => (job.flipbookId && job.flipbookImport === method ? job.flipbookId : null);
  const open = async (method: ImportMethod) => {
    const existing = made(method);
    if (existing) {
      router.push(`/flipbook?f=${existing}`);
      return;
    }
    setBusy(method);
    try {
      const { flipbookId } = await animateApi.toFlipbook(job.id, method);
      router.push(`/flipbook?f=${flipbookId}`);
    } catch (cause) {
      toast({ title: "Couldn’t open in Flipbook", description: cause instanceof Error ? cause.message : "Try again.", status: "error" });
      setBusy(null);
    }
  };
  return (
    <section className={styles.section}>
      <h2 className={styles.label}>Draw it with Muse Image</h2>
      <p className={styles.hint}>
        This render is the movement. In Flipbook, Muse Image draws each frame from your character, following the render at that instant: {job.config.durationSeconds * MUSE_DRAWING_FPS} drawings, {MUSE_DRAWING_FPS} per second. You confirm them there before any is drawn.
      </p>
      <div className={styles.row}>
        <Button variant="ai" size="sm" disabled={busy !== null} onClick={() => void open("muse")}>
          {busy === "muse" ? <Spinner /> : <HugeiconsIcon icon={AiDrawingIcon} size={14} strokeWidth={1.75} />}
          {made("muse") ? "Open the Muse flipbook" : "Draw with Muse in Flipbook"}
        </Button>
      </div>
      <div className={styles.row}>
        <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void open(asRendered)}>
          {busy === asRendered ? <Spinner /> : <HugeiconsIcon icon={Film01Icon} size={14} strokeWidth={1.75} />}
          {made(asRendered) ? "Open the rendered frames" : "Import the rendered frames instead"}
        </Button>
        <label className={styles.toggle}>
          <Switch checked={withSam} onCheckedChange={setWithSam} disabled={busy !== null} label="Cut out with SAM 3.1" />
          Background isn’t plain: cut out with SAM 3.1 (one paid pass)
        </label>
      </div>
    </section>
  );
}

function JobView({ job, onAction, onNew }: { readonly job: AnimationJob; readonly onAction: (action: "cancel" | "retry") => void; readonly onNew: () => void }) {
  const active = isActiveStatus(job.status);
  const reached = PROGRESS_STAGES.indexOf(job.status);
  const has = useMemo(() => new Set(job.outputs.map((output) => output.name)), [job.outputs]);
  const end = job.config.startSeconds + job.config.durationSeconds;
  return (
    <>
      <section className={styles.section}>
        <h1 className={styles.title}>{job.status === "completed" ? "Your animation" : STAGE_LABELS[job.status]}</h1>
        <p className={styles.hint}>
          {ENGINE_LABELS[job.engine]} · {job.config.durationSeconds} s from {job.config.startSeconds.toFixed(1)} s · {job.config.resolution} · {job.config.outputFps} fps · seed {job.config.seed}{job.attempt > 1 ? ` · attempt ${job.attempt}` : ""}
        </p>
        {job.synthetic ? <p className={styles.hint} data-warning="">Test engine: this render is your character moved rigidly with the tracked skeleton, not an animation. Draw it with Muse Image below to animate it from these poses.</p> : null}
      </section>

      {active || job.status === "failed" || job.status === "cancelled" ? (
        <section className={styles.section} aria-live="polite">
          <ProgressMeter value={job.progress * 100} tone={job.status === "failed" ? "critical" : "ok"} aria-label="Render progress" aria-valuetext={STAGE_LABELS[job.status]} />
          <ol className={styles.stages}>
            {PROGRESS_STAGES.map((stage, index) => (
              <li key={stage} data-state={index < reached || job.status === "completed" ? "done" : stage === job.status ? "current" : "pending"}>
                {index < reached ? <HugeiconsIcon icon={CheckIcon} size={14} strokeWidth={1.75} /> : stage === job.status ? <Spinner /> : <span className={styles.dot} aria-hidden />}
                <span>{STAGE_LABELS[stage]}</span>
                {stage === job.status && job.workerDetail ? <span className={styles.detail}>{job.workerDetail}</span> : (job.timings[stage] ?? job.workerTimings[stage]) != null ? <span className={styles.detail}>{(job.timings[stage] ?? job.workerTimings[stage])!.toFixed(1)} s</span> : null}
              </li>
            ))}
          </ol>
          {job.error ? <p className={styles.hint} data-invalid="">{job.error.code} · {job.error.message}</p> : null}
          <div className={styles.row}>
            {active ? <Button variant="outline" size="sm" disabled={job.status === "cancel_requested"} onClick={() => onAction("cancel")}>Cancel</Button> : null}
            {!active && job.error?.recoverable ? <Button size="sm" onClick={() => onAction("retry")}>Retry</Button> : null}
            {!active ? <Button variant="ghost" size="sm" onClick={onNew}>New render</Button> : null}
          </div>
        </section>
      ) : null}

      {job.status === "completed" ? (
        <>
          <section className={styles.compare} aria-label="Result beside the original">
            <figure>
              <video src={referenceMotionUrls.output(job.id, "animation.mp4")} className={styles.video} controls autoPlay loop muted playsInline />
              <figcaption className={styles.hint}>Result</figcaption>
            </figure>
            <figure>
              <video src={`${referenceMotionUrls.asset(job.drivingVideoAssetId)}#t=${job.config.startSeconds},${end}`} className={styles.video} controls muted playsInline />
              <figcaption className={styles.hint}>Original segment</figcaption>
            </figure>
            {has.has("pose_overlay.mp4") ? (
              <figure>
                <video src={referenceMotionUrls.output(job.id, "pose_overlay.mp4")} className={styles.video} controls loop muted playsInline />
                <figcaption className={styles.hint}>Detected poses</figcaption>
              </figure>
            ) : null}
            {has.has("animation_rife.mp4") ? (
              <figure>
                <video src={referenceMotionUrls.output(job.id, "animation_rife.mp4")} className={styles.video} controls loop muted playsInline />
                <figcaption className={styles.hint}>RIFE variant (A/B)</figcaption>
              </figure>
            ) : null}
          </section>
          {flipbookEnabled() ? <OpenInFlipbook job={job} /> : null}
          <section className={styles.section}>
            <div className={styles.row}>
              <Button asChild variant="outline" size="sm"><a href={referenceMotionUrls.output(job.id, "animation.mp4", true)}><HugeiconsIcon icon={Download02Icon} size={14} strokeWidth={1.75} />MP4</a></Button>
              {has.has("frames.zip") ? <Button asChild variant="outline" size="sm"><a href={referenceMotionUrls.output(job.id, "frames.zip", true)}>PNG sequence</a></Button> : null}
              {has.has("render_report.json") ? <Button asChild variant="ghost" size="sm"><a href={referenceMotionUrls.output(job.id, "render_report.json", true)}>Render report</a></Button> : null}
              {has.has("quality_report.json") ? <Button asChild variant="ghost" size="sm"><a href={referenceMotionUrls.output(job.id, "quality_report.json", true)}>Pose quality</a></Button> : null}
            </div>
            <ul className={styles.facts}>
              {job.verification ? <li>Verified: {job.verification.codec} {job.verification.pixelFormat} · {job.verification.width}×{job.verification.height} · {job.verification.fps} fps · {job.verification.frames} frames · {job.verification.durationSeconds.toFixed(2)} s</li> : null}
              <li>GPU: {job.gpu?.name ?? "not reported"}{job.gpu?.peakVramMb != null ? ` · peak ${Math.round(job.gpu.peakVramMb)} MB` : ""}{job.gpuSeconds != null ? ` · ${Math.round(job.gpuSeconds)} s` : ""}{job.estimatedCostUsd != null ? ` · ≈ USD ${job.estimatedCostUsd.toFixed(3)}` : ""}</li>
              <li>Total: {Object.values(job.timings).reduce((sum, value) => sum + value, 0).toFixed(1)} s</li>
            </ul>
            <Button variant="ghost" size="sm" className="w-fit" onClick={onNew}>New render</Button>
          </section>
        </>
      ) : null}
    </>
  );
}
