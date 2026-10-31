"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { confirmAction } from "../../components/ui/confirm-dialog";
import { ScrollArea } from "../../components/ui/scroll-area";
import { useToast } from "../../components/toast-provider";
import { cn } from "../../lib/utils";
import { rotoscopeUrls, type RotoscopePhase, type RotoscopeRunSummary } from "../../shared/rotoscope";
import { AccountButton } from "../_auth/account-button";
import { FacebookButton } from "../_auth/facebook-button";
import { useSession } from "../_auth/session-client";
import { ago } from "../_editor/ago";
import { ModeSwitch } from "../_editor/mode-switch";
import { SidebarResizer, SidebarToggle, useSidebar } from "../_editor/sidebar-resizer";
import { MediaImage } from "../../components/ui/media-image";
import { SidebarListSkeleton } from "../_editor/studio-skeletons";
import { SidebarActivity } from "../_activity/sidebar-activity";
import shell from "../editor/studio.module.css";
import fb from "../flipbook/flipbook.module.css";
import { rotoscopeApi, useRotoscopeRun } from "./rotoscope-client";
import { RotoscopeCreate } from "./rotoscope-create";
import { RotoscopeEditor, RotoscopeEditorSkeleton } from "./rotoscope-editor";
import { BatchView } from "./batch-view";
import { AnimateNav } from "../_editor/animate-nav";

export const PHASE_LABELS: Record<RotoscopePhase, string> = {
  preparing: "Preparing",
  ready: "Ready",
  extending: "Adding frames",
  generating: "Drawing",
  stopping: "Stopping",
  failed: "Failed",
};

/**
 * Rotoscope: the video is cut into frames at a fixed rate and each frame is
 * redrawn with the user's character, strictly in order. Same studio as
 * Flipbook: the runs in the sidebar, the run as a three-column canvas.
 */
export function RotoscopeStudio({ initialRunId, initialBatchId = null }: { readonly initialRunId: string | null; readonly initialBatchId?: string | null }) {
  const { session } = useSession();
  const user = session?.user ?? null;
  const { toast } = useToast();
  const sidebar = useSidebar();
  const [runId, setRunId] = useState(initialRunId);
  /** A test batch on show: its runs side by side, until one is opened. */
  const [batchId, setBatchId] = useState(initialBatchId);
  const { run, setRun, error: pollError } = useRotoscopeRun(runId);
  const [history, setHistory] = useState<RotoscopeRunSummary[] | null>(null);
  // The header field follows the run's name and saves on blur or Enter, as in Flipbook and the video editor.
  const [title, setTitle] = useState("");
  const savedName = run?.name ?? "";
  useEffect(() => { setTitle(savedName); }, [savedName]);
  const cancelRename = useRef(false);
  const saveTitle = () => {
    // Escape asks to drop the edit; the blur it causes must not save it.
    if (cancelRename.current) { cancelRename.current = false; return; }
    const next = title.trim();
    if (!run || !next || next === run.name) { setTitle(run?.name ?? ""); return; }
    rotoscopeApi.rename(run.id, next).then(
      (updated) => { setRun(updated); loadHistory(); },
      (cause) => { setTitle(run.name); toast({ title: "Couldn’t rename", description: cause instanceof Error ? cause.message : "Try again.", status: "error" }); },
    );
  };

  useEffect(() => {
    const url = runId ? `/rotoscope?run=${runId}` : batchId ? `/rotoscope?batch=${batchId}` : "/rotoscope";
    if (`${window.location.pathname}${window.location.search}` !== url) window.history.replaceState(null, "", url);
  }, [runId, batchId]);

  const loadHistory = useCallback(() => { void rotoscopeApi.list().then(setHistory, () => setHistory([])); }, []);
  useEffect(() => { if (user) loadHistory(); }, [user, loadHistory]);
  const settled = run ? `${run.id}:${run.phase}:${run.approved}:${run.total}` : null;
  useEffect(() => { if (user && settled) loadHistory(); }, [user, settled, loadHistory]);

  const remove = async (entry: RotoscopeRunSummary) => {
    const confirmed = await confirmAction({
      title: `Delete “${entry.name}”?`,
      description: "The run and every drawing are deleted immediately. This can’t be undone.",
    });
    if (!confirmed) return;
    try {
      await rotoscopeApi.remove(entry.id);
      if (entry.id === runId) setRunId(null);
      loadHistory();
    } catch (cause) {
      toast({ title: "Couldn’t delete", description: cause instanceof Error ? cause.message : "Try again.", status: "error" });
    }
  };

  return (
    <div className={cn(shell.studio, fb.studio)}>
      <header className={cn(shell.header, fb.header)}>
        <div className={shell.headerStart}>
          <SidebarToggle sidebar={sidebar} ariaControls="rotoscope-library" className={fb.sidebarToggle} />
          <Link href="/" className={shell.brand} aria-label="Focus — Home">
            <Image src="/brand/focus-cat.webp" alt="" width={30} height={30} />
            <span>focus<span className={shell.brandDot}>.</span></span>
          </Link>
          {run ? (
            <input
              aria-label="Run name"
              className={cn(shell.title, fb.headerTitle)}
              value={title}
              maxLength={80}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={saveTitle}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") { cancelRename.current = true; setTitle(run.name); event.currentTarget.blur(); }
              }}
            />
          ) : null}
          {run?.batch ? (
            <Button size="xs" variant="ghost" onClick={() => { setBatchId(run.batch); setRunId(null); }}>Back to test batch</Button>
          ) : run ? <span className={shell.saved}>Saved to your runs</span> : null}
        </div>
        <ModeSwitch current="animate" />
        <div className={shell.headerEnd}><AccountButton session={session} next={runId ? `/rotoscope?run=${runId}` : "/rotoscope"} /></div>
      </header>

      <div className={cn(shell.body, fb.body)} {...sidebar.bodyProps}>
        <SidebarResizer sidebar={sidebar} showToggle={false} />
        <aside id="rotoscope-library" className={cn(shell.sidebar, fb.sidebar)} aria-label="Your rotoscope runs">
          <div data-slot="sidebar-top" className={shell.sidebarTop}>
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => { setRunId(null); setBatchId(null); }}>
              <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={1.75} />
              New run
            </Button>
            <AnimateNav current="rotoscope" />
          </div>
          <ScrollArea className={shell.sidebarScroll} contentClassName={shell.sidebarContent}>
            {user ? (
              <nav className={shell.projects} aria-label="Runs">
                <p className={shell.sideLabel}>Runs</p>
                {history === null ? <SidebarListSkeleton label="Loading your runs" /> : history.length === 0 ? (
                  <p className="px-2 text-xs leading-5 text-muted-foreground">Every run you start is kept here.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {history.map((entry) => (
                      <li key={entry.id} className={cn(shell.project, entry.id === runId && shell.projectActive)}>
                        <button type="button" className={cn(shell.projectLink, "text-left")} aria-current={entry.id === runId ? "page" : undefined} onClick={() => setRunId(entry.id)}>
                          <span className={cn(shell.poster, "relative overflow-hidden")}>
                            <MediaImage src={rotoscopeUrls.media(entry.id, "character")} className="absolute inset-0 size-full object-contain" iconSize={14} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs text-foreground" title={entry.name}>{entry.name}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">{entry.total ? `${entry.approved}/${entry.total} frames` : PHASE_LABELS[entry.phase]}{entry.phase === "generating" ? " · drawing" : ""} · {ago(entry.createdAt)}</span>
                          </span>
                        </button>
                        <button type="button" className={shell.projectDelete} aria-label={`Delete ${entry.name}`} onClick={() => void remove(entry)}>
                          <HugeiconsIcon icon={Delete02Icon} size={13} strokeWidth={1.75} />
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

        <ScrollArea key={runId ?? (batchId ? `batch-${batchId}` : "create")} as="main" className={cn(shell.main, fb.main)} viewportClassName={fb.mainViewport} contentClassName={cn(fb.mainContent, "pt-4")}>
          {session && !user ? (
            <section className={shell.empty} aria-labelledby="rotoscope-title">
              <h1 id="rotoscope-title" className={shell.emptyTitle}>Test a video in Rotoscope</h1>
              <p className="text-sm text-muted-foreground">Sign in to check a video frame by frame with your character before animating it in Flipbook. Runs are saved to your account.</p>
              <FacebookButton next="/rotoscope" label="Sign in with Facebook" size="default" className="w-fit" />
            </section>
          ) : runId ? (
            run ? <RotoscopeEditor key={run.id} run={run} onChange={setRun} /> : pollError ? <Alert tone="error" size="sm">{pollError}</Alert> : <RotoscopeEditorSkeleton />
          ) : batchId ? (
            <BatchView batchId={batchId} onOpenRun={setRunId} />
          ) : (
            <RotoscopeCreate
              disabled={!user}
              onCreated={(created) => { setRun(created); setRunId(created.id); loadHistory(); }}
              onBatch={(created) => { setBatchId(created.id); loadHistory(); }}
            />
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
