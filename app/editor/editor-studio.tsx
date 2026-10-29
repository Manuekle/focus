"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { confirmAction } from "../../components/ui/confirm-dialog";
import { ProgressMeter } from "../../components/ui/progress-meter";
import { cn } from "../../lib/utils";
import { ProjectDetailSchema, ProjectSummarySchema, type ProjectDetail, type ProjectSummary } from "../../shared/account";
import { ACTIVE_JOB_STATUSES, VideoAssetSchema, type EditJob, type EffectId, type VideoAsset } from "../../shared/schemas";
import { MAX_DURATION_SECONDS } from "../../shared/media";
import { AccountButton } from "../_auth/account-button";
import { FacebookButton } from "../_auth/facebook-button";
import { LoginDialog } from "../_auth/login-dialog";
import { useSession } from "../_auth/session-client";
import { ago } from "../_editor/ago";
import { readDraft, settleDraft } from "../_editor/draft";
import { effectEnabled, flipbookEnabled } from "../../shared/features";
import { EditorNotice } from "../_editor/editor-notice";
import { EditorView } from "../_editor/editor-view";
import { ModeSwitch } from "../_editor/mode-switch";
import { PLAN_EFFECT_LABEL } from "../_editor/job-panel";
import { SidebarResizer, SidebarToggle, useSidebar } from "../_editor/sidebar-resizer";
import { EditorSkeleton, SidebarListSkeleton } from "../_editor/studio-skeletons";
import { StudioUpload } from "../_editor/studio-upload";
import { useClipUpload } from "../_editor/use-clip-upload";
import styles from "./studio.module.css";

const STATUS_LABEL: Partial<Record<EditJob["status"], string>> = {
  completed: "Ready",
  failed: "Failed",
  canceled: "Canceled",
  awaiting_selection: "Pick a subject",
  awaiting_clarification: "Needs detail",
};

/**
 * The full editor: header with account, a sidebar with saved projects (or the
 * free-edit allowance), the clip with every edit made on it, and the AI
 * editor. The home page's instruction arrives through localStorage.
 */
export function EditorStudio({ videoId, authNotice }: { readonly videoId: string | null; readonly authNotice: "failed" | "canceled" | null }) {
  const sidebar = useSidebar();
  const router = useRouter();
  const { session, refresh } = useSession();
  const user = session?.user ?? null;
  const here = videoId ? `/editor?v=${videoId}` : "/editor";

  const [video, setVideo] = useState<VideoAsset | null>(null);
  const [videoMissing, setVideoMissing] = useState(false);
  const [effect, setEffect] = useState<EffectId>("reality-shift");
  const [prompt, setPrompt] = useState("");
  const [autostart, setAutostart] = useState(false);
  const [draftRead, setDraftRead] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailSettled, setDetailSettled] = useState(false);
  const [openJob, setOpenJob] = useState<EditJob | null>(null);
  const [viewKey, setViewKey] = useState(0);
  const [login, setLogin] = useState<"quota" | "save" | null>(null);
  const [title, setTitle] = useState("");

  const { upload, failure: uploadFailure, start, cancel } = useClipUpload((uploaded) => router.push(`/editor?v=${uploaded.id}`));

  // The clip, and the draft the home page left for it.
  useEffect(() => {
    if (!videoId) {
      setDraftRead(true);
      return;
    }
    let canceled = false;
    const draft = readDraft(videoId);
    if (draft) {
      setPrompt(draft.prompt);
      setEffect(draft.effect);
      setAutostart(draft.autostart);
    }
    setDraftRead(true);
    fetch(`/api/videos/${videoId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (canceled) return;
        const parsed = VideoAssetSchema.safeParse(body);
        if (parsed.success) setVideo(parsed.data);
        else setVideoMissing(true);
      })
      .catch(() => { if (!canceled) setVideoMissing(true); });
    return () => { canceled = true; };
  }, [videoId]);

  const loadProjects = useCallback(async () => {
    const response = await fetch("/api/projects", { cache: "no-store" }).catch(() => null);
    const body = response?.ok ? await response.json() : null;
    const parsed = ProjectSummarySchema.array().safeParse(body);
    setProjects(parsed.success ? parsed.data : []);
  }, []);

  // Signed in with a clip open: the clip is saved to the account (with any
  // edits made before signing in), then its project is loaded.
  const loadDetail = useCallback(async (id: string) => {
    const created = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoId: id }) }).catch(() => null);
    const project = created?.ok ? ((await created.json()) as { id: string }) : null;
    if (!project) return null;
    const response = await fetch(`/api/projects/${project.id}`, { cache: "no-store" }).catch(() => null);
    const parsed = ProjectDetailSchema.safeParse(response?.ok ? await response.json() : null);
    // Keep disabled edits on disk; do not reopen their controls after rollback.
    return parsed.success ? { ...parsed.data, jobs: parsed.data.jobs.filter((job) => effectEnabled(job.request.effect)) } : null;
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadProjects();
  }, [user, loadProjects]);

  useEffect(() => {
    if (!session) return;
    if (!user || !video) {
      setDetailSettled(true);
      return;
    }
    let canceled = false;
    void loadDetail(video.id).then((next) => {
      if (canceled) return;
      setDetail(next);
      setTitle(next?.project.title ?? "");
      // Reopen the edit the person was on, unless a new instruction is about to start.
      const reopened = next && !autostart ? (next.jobs.find((job) => job.id === next.project.activeJobId) ?? next.jobs[0] ?? null) : null;
      if (reopened) {
        setOpenJob(reopened);
        setEffect(reopened.request.effect);
      }
      setDetailSettled(true);
      void loadProjects();
    });
    return () => { canceled = true; };
    // The project is resolved once per clip and account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, user?.id, video?.id]);

  // New jobs refresh the free-edit count and the project's history.
  const lastJob = useRef<string | null>(null);
  const onJobChange = useCallback(
    (job: EditJob | null) => {
      if (!job || !videoId) return;
      const draft = readDraft(videoId);
      if (draft?.autostart) settleDraft(draft);
      const key = `${job.id}:${job.status}`;
      if (lastJob.current === key) return;
      const isNew = !lastJob.current?.startsWith(job.id);
      lastJob.current = key;
      if (isNew) void refresh();
      if (user && video && (isNew || !ACTIVE_JOB_STATUSES.includes(job.status))) {
        void loadDetail(video.id).then((next) => next && setDetail(next));
        void loadProjects();
      }
    },
    [videoId, user, video, refresh, loadDetail, loadProjects],
  );

  const openEdit = (job: EditJob) => {
    setOpenJob(job);
    setEffect(job.request.effect);
    setAutostart(false);
    setViewKey((key) => key + 1);
    if (detail) void fetch(`/api/projects/${detail.project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activeJobId: job.id }) });
  };

  const saveTitle = () => {
    const next = title.trim();
    if (!detail || !next || next === detail.project.title) return;
    void fetch(`/api/projects/${detail.project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: next }) }).then(() => loadProjects());
  };

  const removeProject = async (project: ProjectSummary) => {
    const confirmed = await confirmAction({
      title: `Delete “${project.title}”?`,
      description: "Its clip and edits will expire within a day.",
    });
    if (!confirmed) return;
    await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
    if (project.videoId === videoId) router.push("/editor");
    else void loadProjects();
  };

  const editorReady = video && draftRead && session && detailSettled;

  return (
    <div className={styles.studio}>
      <header className={styles.header}>
        <div className={styles.headerStart}>
          <SidebarToggle sidebar={sidebar} ariaControls="editor-sidebar" />
          <Link href="/" className={styles.brand} aria-label="Focus — Home">
            <Image src="/brand/focus-cat.webp" alt="" width={30} height={30} />
            <span>focus<span className={styles.brandDot}>.</span></span>
          </Link>
          {detail ? (
            <input
              aria-label="Project name"
              className={styles.title}
              value={title}
              maxLength={80}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={saveTitle}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            />
          ) : video ? (
            <span className={styles.titleStatic}>{video.originalName}</span>
          ) : null}
          {detail ? <span className={styles.saved}>Saved to your projects</span> : null}
        </div>
        {flipbookEnabled() ? <ModeSwitch current="video" /> : <span />}
        <div className={styles.headerEnd}><AccountButton session={session} next={here} /></div>
      </header>

      <div className={styles.body} {...sidebar.bodyProps}>
        <SidebarResizer sidebar={sidebar} />
        <aside id="editor-sidebar" className={styles.sidebar} aria-label={user ? "Your projects" : "Account"}>
          <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => router.push("/editor")}>
            <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={1.75} />
            New clip
          </Button>

          {user ? (
            <nav className={styles.projects} aria-label="Projects">
              <p className={styles.sideLabel}>Projects</p>
              {projects === null ? (
                <SidebarListSkeleton label="Loading your projects" />
              ) : projects.length === 0 ? (
                <p className="px-2 text-xs leading-5 text-muted-foreground">Every clip you edit is saved here.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {projects.map((project) => (
                    <li key={project.id} className={cn(styles.project, project.videoId === videoId && styles.projectActive)}>
                      <Link href={`/editor?v=${project.videoId}`} className={styles.projectLink} aria-current={project.videoId === videoId ? "page" : undefined}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- poster served by the media route */}
                        <img src={project.posterUrl} alt="" className={styles.poster} />
                        <span className="min-w-0">
                          <span className="block truncate text-xs text-foreground">{project.title}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {project.edits} {project.edits === 1 ? "edit" : "edits"} · {ago(project.updatedAt)}
                          </span>
                        </span>
                      </Link>
                      <button type="button" className={styles.projectDelete} aria-label={`Delete ${project.title}`} onClick={() => void removeProject(project)}>
                        <HugeiconsIcon icon={Delete02Icon} size={13} strokeWidth={1.75} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </nav>
          ) : session?.quota ? (
            <section className={styles.guest} aria-label="Free edits">
              <p className="text-sm font-medium text-foreground">Free edits</p>
              <div className="flex items-baseline justify-between text-xs text-muted-foreground tabular-nums">
                <span>{session.quota.remaining === 0 ? "None left" : `${session.quota.remaining} left`}</span>
                <span>{session.quota.used}/{session.quota.limit} used</span>
              </div>
              <ProgressMeter size="sm" value={Math.round((session.quota.used / Math.max(1, session.quota.limit)) * 100)} aria-label="Free edits used" />
              <p className="text-xs leading-5 text-muted-foreground">Sign in to keep editing without limits and save every clip as a project.</p>
              <FacebookButton next={here} label="Sign in with Facebook" className="h-9 whitespace-nowrap px-3 text-[13px]" />
            </section>
          ) : null}
        </aside>

        <main className={styles.main}>
          {authNotice ? (
            <EditorNotice status="info" title={authNotice === "canceled" ? "Sign-in canceled" : "Sign-in didn’t finish"} description="You can keep using your free edits, or try signing in again." duration={6000} />
          ) : null}

          {!videoId ? (
            <section className={styles.empty} aria-label="New clip">
              <h1 className={styles.emptyTitle}>Start with a clip</h1>
              <p className="text-sm text-muted-foreground">MP4 or MOV, up to {MAX_DURATION_SECONDS} seconds. Then tell the AI what should stand out.</p>
              <div className={styles.drop}>
                <StudioUpload item={upload?.item} phase={upload?.phase} onFile={(file) => void start(file)} onCancel={cancel} />
              </div>
              {uploadFailure ? (
                <EditorNotice key={uploadFailure.id} title="Clip couldn’t be uploaded" description={[uploadFailure.message, uploadFailure.detail].filter(Boolean).join(" ")} action={uploadFailure.retry ? { label: "Retry", onClick: uploadFailure.retry } : undefined} />
              ) : null}
            </section>
          ) : videoMissing ? (
            <section className={styles.empty}>
              <h1 className={styles.emptyTitle}>This clip is no longer available</h1>
              <p className="text-sm text-muted-foreground">Clips outside a saved project expire after a day.</p>
              <Button className="w-fit" onClick={() => router.push("/editor")}>Upload a clip</Button>
            </section>
          ) : !editorReady ? (
            <EditorSkeleton />
          ) : (
            <>
              <EditorView
                key={`${video.id}:${viewKey}`}
                variant="page"
                video={video}
                effect={effect}
                onEffectChange={setEffect}
                prompt={prompt}
                onPromptChange={setPrompt}
                onReset={() => router.push("/editor")}
                initialJob={openJob}
                autostart={autostart && !openJob}
                onLoginRequired={() => setLogin("quota")}
                onJobChange={onJobChange}
              />
              {detail && detail.jobs.length > 0 ? (
                <section className={styles.history} aria-label="Edits on this clip">
                  <p className={styles.sideLabel}>Edits on this clip</p>
                  <ol className={styles.historyList}>
                    {detail.jobs.map((job) => (
                      <li key={job.id}>
                        <button type="button" className={cn(styles.edit, job.id === (openJob?.id ?? detail.project.activeJobId) && styles.editActive)} onClick={() => openEdit(job)}>
                          <span className="line-clamp-2 text-left text-xs leading-5 text-foreground">“{job.request.prompt}”</span>
                          <span className="text-[11px] text-muted-foreground">
                            {job.render ? PLAN_EFFECT_LABEL[job.render.params.effect] : job.plan ? PLAN_EFFECT_LABEL[job.plan.effect] : "—"}
                            {" · "}
                            {STATUS_LABEL[job.status] ?? "Working"}
                            {job.chat.length ? ` · ${Math.ceil(job.chat.length / 2)} AI turns` : ""}
                            {" · "}
                            {ago(job.updatedAt)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : !user ? (
                <section className={styles.history}>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Not saved: edits without an account expire after a day.{" "}
                    <button type="button" className="text-primary hover:underline" onClick={() => setLogin("save")}>Sign in with Facebook to save this project</button>
                  </p>
                </section>
              ) : null}
            </>
          )}
        </main>
      </div>
      <LoginDialog open={login !== null} onOpenChange={(open) => { if (!open) setLogin(null); }} next={here} reason={login ?? "save"} />
    </div>
  );
}
