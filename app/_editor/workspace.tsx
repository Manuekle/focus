"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight01Icon, ArrowUpRight01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { EASE_OUT } from "../../lib/ease";
import { useReducedMotion } from "../../lib/hooks/use-reduced-motion";
import { HugeiconsIcon } from "../../components/icons/icon";
import type { FileUploadItem } from "../../components/motion/file-upload";
import { Button } from "../../components/ui/button";
import { useToast } from "../../components/toast-provider";
import { formatSeconds } from "../../shared/media";
import { VideoAssetSchema, type EffectId, type VideoAsset } from "../../shared/schemas";
import { EditorView } from "./editor-view";
import { EditorNotice } from "./editor-notice";
import { ClipboardColored24 } from "../../components/icons/ClipboardColored24";
import { FeatherSparkleColored24 } from "../../components/icons/FeatherSparkleColored24";
import { ShapesColored24 } from "../../components/icons/ShapesColored24";
import { GithubIcon, XIcon } from "../../components/icons/social-icons";
import { HeroAtmosphere } from "./hero-atmosphere";
import { StudioUpload, type UploadPhase } from "./studio-upload";
import { UploadError, checkFileLocally, uploadVideo } from "./upload";
import styles from "./workspace.module.css";

const HOW_STEPS = [
  { n: "01", copy: "Start with a clip you love the most.", Icon: ShapesColored24 },
  { n: "02", copy: "Describe the look. AI does the rest.", Icon: FeatherSparkleColored24 },
  { n: "03", copy: "Fine-tune, preview, export the clip.", Icon: ClipboardColored24 },
] as const;

type Failure = { readonly id: number; readonly message: string; readonly detail?: string; readonly retry?: () => void };

type Stage =
  | { readonly kind: "empty" }
  | { readonly kind: "uploading"; readonly item: FileUploadItem; readonly phase: UploadPhase }
  | { readonly kind: "ready"; readonly video: VideoAsset };

export function Workspace() {
  const [stage, setStage] = useState<Stage>({ kind: "empty" });
  const [failure, setFailure] = useState<Failure | null>(null);
  const [effect, setEffect] = useState<EffectId>("reality-shift");
  const [prompt, setPrompt] = useState("");
  const abortRef = useRef<(() => void) | null>(null);
  const uploadIdRef = useRef(0);
  const studioRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | "auto">("auto");
  const { toast } = useToast();
  const reducedMotion = useReducedMotion();
  const entrance = (delay: number, distance = 12) => ({
    initial: reducedMotion ? false as const : { opacity: 0, y: distance },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reducedMotion ? 0 : 0.5, delay: reducedMotion ? 0 : delay, ease: EASE_OUT },
  });

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setContentHeight(element.getBoundingClientRect().height));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    uploadIdRef.current += 1;
    abortRef.current?.();
  }, []);

  // The current video lives in the URL (?v=id), so a reload keeps the clip
  // and every cached plan and mask that belongs to it.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("v");
    if (!id) return;
    const attempt = uploadIdRef.current;
    let canceled = false;
    fetch(`/api/videos/${encodeURIComponent(id)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (canceled || uploadIdRef.current !== attempt) return;
        const parsed = VideoAssetSchema.safeParse(body);
        if (parsed.success) setStage({ kind: "ready", video: parsed.data });
        else window.history.replaceState(null, "", window.location.pathname);
      })
      .catch(() => undefined);
    return () => { canceled = true; };
  }, []);

  useEffect(() => {
    const url = stage.kind === "ready" ? `${window.location.pathname}?v=${stage.video.id}` : window.location.pathname;
    if (stage.kind !== "uploading" && `${window.location.pathname}${window.location.search}` !== url) window.history.replaceState(null, "", url);
  }, [stage]);

  const start = useCallback(async (file: File) => {
    const attempt = ++uploadIdRef.current;
    abortRef.current?.();
    abortRef.current = null;
    setFailure(null);
    const base: FileUploadItem = { id: `${Date.now()}`, name: file.name, size: file.size, type: file.type, file };
    setStage({ kind: "uploading", phase: "checking", item: { ...base, status: "uploading", progress: 0 } });
    try {
      await checkFileLocally(file);
      if (uploadIdRef.current !== attempt) return;
      setStage({ kind: "uploading", phase: "sending", item: { ...base, status: "uploading", progress: 0 } });
      const handle = uploadVideo(file, (fraction) => {
        if (uploadIdRef.current !== attempt) return;
        setStage({
          kind: "uploading",
          // Bytes are in; FFprobe and FFmpeg are now running on the server.
          phase: fraction >= 1 ? "preparing" : "sending",
          item: { ...base, status: "uploading", progress: Math.round(fraction * 100) },
        });
      });
      abortRef.current = handle.abort;
      const video = await handle.promise;
      if (uploadIdRef.current !== attempt) return;
      setStage({ kind: "ready", video });
      toast({ title: "Your clip is ready", description: `${video.normalized.width}×${video.normalized.height} · ${formatSeconds(video.normalized.durationSeconds)}`, status: "success" });
    } catch (error) {
      if (uploadIdRef.current !== attempt) return;
      setStage({ kind: "empty" });
      if (error instanceof UploadError && error.code === "aborted") return;
      setFailure({
        id: attempt,
        message: error instanceof Error ? error.message : "We couldn’t upload your video. Try again.",
        detail: error instanceof UploadError ? error.detail : undefined,
        retry: () => void start(file),
      });
    } finally {
      if (uploadIdRef.current === attempt) abortRef.current = null;
    }
  }, [toast]);

  const reset = useCallback(() => {
    if (stage.kind === "ready") {
      void fetch(`/api/videos/${stage.video.id}`, { method: "DELETE" }).catch(() => undefined);
    }
    setStage({ kind: "empty" });
    setFailure(null);
    studioRef.current?.focus({ preventScroll: true });
  }, [stage]);

  const cancelUpload = useCallback(() => {
    uploadIdRef.current += 1;
    abortRef.current?.();
    abortRef.current = null;
    setStage({ kind: "empty" });
    setFailure(null);
    studioRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className={styles.workspace}>
      <a className={styles.skipLink} href="#studio">Skip to studio</a>
      <motion.header data-home-enter="" {...entrance(0, 6)} className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Focus — Home">
          <Image src="/brand/focus-cat.webp" alt="" width={38} height={38} />
          <span>focus<span className={styles.brandDot}>.</span></span>
        </Link>
        <nav className={styles.nav} aria-label="Main navigation">
          <Button asChild size="sm"><a href="#studio">Open studio <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} strokeWidth={1.75} /></a></Button>
        </nav>
      </motion.header>

        <main className={styles.home}>
          <section className={styles.hero} aria-labelledby="home-title">
            <HeroAtmosphere />
            <motion.p data-home-enter="" {...entrance(0.04, 6)} className={styles.eyebrow}><span aria-hidden />Small clips. Big possibilities.</motion.p>
            <h1 id="home-title" className={styles.title}>
              <motion.span data-home-enter="" {...entrance(0.1, 16)} className={`${styles.titleLine} ${styles.titleWhite}`}>Make anything</motion.span>
              <br />
              <motion.span data-home-enter="" {...entrance(0.2, 16)} className={`${styles.titleLine} ${styles.titleAccent}`}>stand out</motion.span>
            </h1>
            <motion.p data-home-enter="" {...entrance(0.28, 8)} className={styles.intro}>Your clip. Your words. A whole new look.<br /><span>Put the spotlight on what matters with AI.</span></motion.p>
          </section>

          <motion.section data-home-enter="" {...entrance(0.34)} ref={studioRef} id="studio" tabIndex={-1} className={styles.studio} aria-label="Video studio">
            <ol className={styles.steps} aria-label="Editing steps">
              <li data-complete={stage.kind === "ready"} aria-current={stage.kind !== "ready" ? "step" : undefined}>
                <span className={styles.stepNumber}>{stage.kind === "ready" ? <HugeiconsIcon icon={Tick02Icon} size={12} strokeWidth={2} /> : "1"}</span>Add a clip
              </li>
              <li className={styles.stepArrow} aria-hidden="true"><HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.5} /></li>
              <li aria-current={stage.kind === "ready" ? "step" : undefined}><span className={styles.stepNumber}>2</span>Make it yours</li>
            </ol>
            <p role="status" className="sr-only">{stage.kind === "ready" ? "Clip ready. Step 2 of 2: make it yours." : stage.kind === "uploading" ? "Uploading your clip. Your editing options will appear when it is ready." : "Step 1 of 2: add a clip to begin."}</p>
            <motion.div className={styles.stageViewport} animate={{ height: contentHeight }} transition={{ duration: reducedMotion ? 0 : 0.3, ease: EASE_OUT }}>
              <div ref={contentRef} className={styles.stageContent}>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={stage.kind === "ready" ? stage.video.id : stage.kind}
                    data-studio-step={stage.kind}
                    initial={reducedMotion ? false : { opacity: 0, y: 8, filter: "blur(4px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: reducedMotion ? 0 : -4, filter: reducedMotion ? "blur(0px)" : "blur(4px)", transition: { duration: reducedMotion ? 0 : 0.15 } }}
                    transition={{ duration: reducedMotion ? 0 : 0.3, ease: EASE_OUT }}
                  >
                    {stage.kind === "ready" ? (
                      <EditorView video={stage.video} effect={effect} onEffectChange={setEffect} prompt={prompt} onPromptChange={setPrompt} onReset={reset} />
                    ) : (
                      <>
                        <StudioUpload item={stage.kind === "uploading" ? stage.item : undefined} phase={stage.kind === "uploading" ? stage.phase : undefined} onFile={(file) => void start(file)} onCancel={cancelUpload} />
                      </>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </motion.div>
          </motion.section>

          <motion.footer data-home-enter="" {...entrance(0.42, 8)} id="how-it-works" className={styles.footer} aria-labelledby="how-title">
            <h2 id="how-title" className={styles.footerTitle}>From a clip to<br />something different</h2>
            <ol className={styles.footerSteps}>
              {HOW_STEPS.map(({ n, copy, Icon }) => (
                <li key={n} className={styles.footerStep}>
                  <Icon className={styles.stepIcon} width={56} height={56} aria-hidden="true" />
                  <span className={styles.stepIndex}>{n}</span>
                  <p>{copy}</p>
                </li>
              ))}
            </ol>
            <div className={styles.footerBottom}>
              <p>A little focus changes everything.</p>
              <div className={styles.footerSocial}>
                <span>Made to stand out.</span>
                <a className={styles.footerSocialLink} href="https://github.com/Manuekle/focus" target="_blank" rel="noreferrer" aria-label="GitHub — Manuekle/focus">
                  <GithubIcon />
                </a>
                <a className={styles.footerSocialLink} href="https://x.com/manu_jsx" target="_blank" rel="noreferrer" aria-label="X — @manu_jsx">
                  <XIcon />
                </a>
              </div>
            </div>
          </motion.footer>
        </main>
      {failure ? <EditorNotice key={failure.id} title="Clip couldn’t be uploaded" description={[failure.message, failure.detail].filter(Boolean).join(" ")} action={failure.retry ? { label: "Retry", onClick: failure.retry } : undefined} /> : null}
    </div>
  );
}
