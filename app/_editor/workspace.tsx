"use client";

import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown01Icon, ArrowRight01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { EASE_OUT } from "../../lib/ease";
import { useReducedMotion } from "../../lib/hooks/use-reduced-motion";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { useToast } from "../../components/toast-provider";
import { formatSeconds } from "../../shared/media";
import type { EffectId, VideoAsset } from "../../shared/schemas";
import { flipbookEnabled } from "../../shared/features";
import { AccountButton } from "../_auth/account-button";
import { useSession } from "../_auth/session-client";
import { EditorNotice } from "./editor-notice";
import { VideoColored24 } from "../../components/icons/VideoColored24";
import { ClipboardColored24 } from "../../components/icons/ClipboardColored24";
import { FeatherSparkleColored24 } from "../../components/icons/FeatherSparkleColored24";
import { ShapesColored24 } from "../../components/icons/ShapesColored24";
import { GithubIcon, XIcon } from "../../components/icons/social-icons";
import { HeroBadge } from "./hero-badge";
import { FlipbookDemo } from "./flipbook-demo";
import { HeroDemo } from "./hero-demo";
import { StudioUpload } from "./studio-upload";
import { useClipUpload } from "./use-clip-upload";
import styles from "./workspace.module.css";

/** The work in order, as the header tabs show it; any step can be the first. */
const HOW_STEPS = [
  { n: "01", title: "Bring a character", copy: "Design one, or start from a single illustration of your own.", Icon: ShapesColored24, href: "/characters", cta: "My characters" },
  { n: "02", title: "Give it a little life", copy: "Describe a movement, or follow a video: editable, or copied frame by frame.", Icon: FeatherSparkleColored24, href: "/flipbook", cta: "Animate" },
  { n: "03", title: "Make it yours", copy: "Every way ends in the Flipbook editor: fine-tune the drawings and export.", Icon: ClipboardColored24, href: "/flipbook", cta: null },
  { n: "04", title: "Put it in a video", copy: "Optional: track it in a clip, add effects and sound in the video editor.", Icon: VideoColored24, href: "/editor", cta: "Video editor" },
] as const;

// The composer (and zod with it) only matters once a clip exists, so it stays
// out of the first load. The chunk is warmed as soon as an upload or restore starts.
const loadComposer = () => import("./home-composer");
const HomeComposer = dynamic(() => import("./home-composer").then((module) => module.HomeComposer));

type Stage =
  | { readonly kind: "empty" }
  | { readonly kind: "uploading" }
  | { readonly kind: "ready"; readonly video: VideoAsset };

export function Workspace() {
  const [ready, setReady] = useState<VideoAsset | null>(null);
  const [effect, setEffect] = useState<EffectId>("reality-shift");
  const [prompt, setPrompt] = useState("");
  const uploadIdRef = useRef(0);
  const { session } = useSession();
  const studioRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | "auto">("auto");
  const { toast } = useToast();
  const { upload, failure, start: startUpload, cancel: cancelClip } = useClipUpload((video) => {
    setReady(video);
    toast({ title: "Your clip is ready", description: `${video.normalized.width}×${video.normalized.height} · ${formatSeconds(video.normalized.durationSeconds)}`, status: "success" });
  });
  const stage: Stage = upload ? { kind: "uploading" } : ready ? { kind: "ready", video: ready } : { kind: "empty" };
  const reducedMotion = useReducedMotion();
  const hasFlipbook = flipbookEnabled();
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


  // The current video lives in the URL (?v=id), so a reload keeps the clip
  // and every cached plan and mask that belongs to it.
  // Until the restore settles, the URL is left alone: otherwise the empty
  // first render would strip ?v before a remount (Strict Mode) can read it.
  const restoringRef = useRef(true);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("v");
    if (!id) {
      restoringRef.current = false;
      return;
    }
    const attempt = uploadIdRef.current;
    let canceled = false;
    void loadComposer();
    const schemas = import("../../shared/schemas");
    fetch(`/api/videos/${encodeURIComponent(id)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then(async (body) => {
        const { VideoAssetSchema } = await schemas;
        if (canceled) return;
        restoringRef.current = false;
        if (uploadIdRef.current !== attempt) return;
        const parsed = VideoAssetSchema.safeParse(body);
        if (parsed.success) setReady(parsed.data);
        else window.history.replaceState(null, "", window.location.pathname);
      })
      .catch(() => { if (!canceled) restoringRef.current = false; });
    return () => { canceled = true; };
  }, []);

  const stageKind = stage.kind;
  const readyId = ready?.id;
  useEffect(() => {
    if (restoringRef.current && stageKind === "empty") return;
    restoringRef.current = false;
    const url = stageKind === "ready" && readyId ? `${window.location.pathname}?v=${readyId}` : window.location.pathname;
    if (stageKind !== "uploading" && `${window.location.pathname}${window.location.search}` !== url) window.history.replaceState(null, "", url);
  }, [stageKind, readyId]);

  const start = useCallback((file: File) => {
    uploadIdRef.current += 1;
    setReady(null);
    void loadComposer();
    void startUpload(file);
  }, [startUpload]);

  const reset = useCallback(() => {
    if (ready) void fetch(`/api/videos/${ready.id}`, { method: "DELETE" }).catch(() => undefined);
    setReady(null);
    studioRef.current?.focus({ preventScroll: true });
  }, [ready]);

  const cancelUpload = useCallback(() => {
    uploadIdRef.current += 1;
    cancelClip();
    studioRef.current?.focus({ preventScroll: true });
  }, [cancelClip]);

  return (
    <div className={styles.workspace}>
      <a className={styles.skipLink} href="#home-content">Skip to content</a>
      <motion.header data-home-enter="" {...entrance(0, 6)} className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Focus — Home">
          <Image src="/brand/focus-cat.webp" alt="" width={38} height={38} />
          <span>focus<span className={styles.brandDot}>.</span></span>
        </Link>
        <nav className={styles.nav} aria-label="Main navigation">
          <Button asChild size="sm" variant="ghost" className={styles.navLink}><a href="#how-it-works">How it works</a></Button>
          <Button asChild size="sm" variant="ghost" className={styles.navLink}><a href="#video-effects">Video effects</a></Button>
          {hasFlipbook ? <Button asChild size="sm" variant="ghost" className={styles.navLink}><Link href="/characters">Characters</Link></Button> : null}
          {hasFlipbook ? <Button asChild size="sm" variant="ghost" className={styles.navLink}><Link href="/flipbook">Animate</Link></Button> : null}
          <AccountButton session={session} next={hasFlipbook ? "/flipbook" : "/editor"} />
        </nav>
      </motion.header>

        <main id="home-content" tabIndex={-1} className={styles.home}>
          <section className={styles.hero} aria-labelledby="home-title">
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}><HeroBadge /></p>
              <h1 id="home-title" className={styles.title}><span className={styles.titleLine}><span className={styles.titleWhite}>Your drawings.</span></span><br /><span className={styles.titleLine}><span className={styles.titleAccent}>In motion.</span></span></h1>
              <p className={styles.intro}>A wave, a dance, a whole little story.<br /><span>Bring your characters to life, one frame at a time.</span></p>
              <div className={styles.cta}>
                <Button asChild>{hasFlipbook ? <Link href="/characters">Create a character <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.75} /></Link> : <a href="#flipbook-demo">Explore flipbook <HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={1.75} /></a>}</Button>
                {hasFlipbook ? <Button asChild variant="outline"><Link href="/flipbook">Animate a drawing</Link></Button> : <Button asChild variant="outline"><a href="#video-effects">Explore video effects</a></Button>}
              </div>
            </div>
            <div className={styles.heroVisual}><FlipbookDemo /></div>
            <p className={styles.formats}>Made to keep. MP4 <span>·</span> GIF <span>·</span> Sprite sheets <span>·</span> PNG frames</p>
          </section>

          <section id="how-it-works" className={styles.how} aria-labelledby="how-title">
            <h2 id="how-title" className={styles.sectionTitle}>From a still to a story.</h2>
            <ol className={styles.footerSteps}>
              {HOW_STEPS.map(({ n, title, copy, Icon, href, cta }) => (
                <li key={n} className={styles.footerStep}>
                  <Icon className={styles.stepIcon} width={48} height={48} aria-hidden="true" />
                  <h3>{title}</h3>
                  <p>{copy}</p>
                  {cta && (hasFlipbook || href === "/editor") ? <Link href={href} className={styles.stepLink}>{cta} <HugeiconsIcon icon={ArrowRight01Icon} size={12} strokeWidth={1.75} /></Link> : null}
                </li>
              ))}
            </ol>
          </section>

          <section id="video-effects" className={styles.videoSection} aria-labelledby="video-title">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.sectionEyebrow}>A little more to play with</p>
                <h2 id="video-title" className={styles.sectionTitle}>Make your video stand out.</h2>
                <p className={styles.sectionDescription}>Keep your subject in color, let it break the frame, or give every move a trail.</p>
              </div>
              <Button asChild variant="outline"><Link href="/editor">Open video editor <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.5} /></Link></Button>
            </div>
            <HeroDemo />
          </section>

          <motion.section data-home-enter="" {...entrance(0.58)} ref={studioRef} id="studio" tabIndex={-1} className={styles.studio} aria-label="Video studio">
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
                      <HomeComposer video={stage.video} effect={effect} onEffectChange={setEffect} prompt={prompt} onPromptChange={setPrompt} onReset={reset} />
                    ) : (
                      <>
                        <StudioUpload item={upload?.item} phase={upload?.phase} onFile={start} onCancel={cancelUpload} />
                      </>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </motion.div>
          </motion.section>

          <section className={styles.concept} aria-labelledby="concept-title">
            <div className={styles.conceptCopy}>
              <p className={styles.sectionEyebrow}><Badge size="sm">In exploration</Badge>Subject effects</p>
              <h2 id="concept-title" className={styles.sectionTitle}>One subject. A new vibe.</h2>
              <p className={styles.sectionDescription}>Someone you’d rather keep out of focus? Choose a detected subject and give just them a glitch or distortion effect.</p>
              <p className={styles.conceptNote}>A look at what’s next. These effects aren’t available yet.</p>
            </div>
            <div className={styles.conceptFlow}>
              <p className={styles.conceptFlowTitle}>The idea</p>
              <ol>
                <li><span>1</span><div><h3>Find the subjects</h3><p>See detected people and objects across your clip.</p></div></li>
                <li><span>2</span><div><h3>Choose who changes</h3><p>Select a subject and keep everyone else as they are.</p></div></li>
                <li><span>3</span><div><h3>Give them an effect</h3><p>Glitch or distortion. Adjust the strength, then preview.</p></div></li>
              </ol>
            </div>
          </section>

          <footer className={styles.footer}>
            <div className={styles.footerBottom}>
              <p>Made for your little ideas.</p>
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
          </footer>
        </main>
      {failure ? <EditorNotice key={failure.id} title="Clip couldn’t be uploaded" description={[failure.message, failure.detail].filter(Boolean).join(" ")} action={failure.retry ? { label: "Retry", onClick: failure.retry } : undefined} /> : null}
    </div>
  );
}
