"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Add01Icon, Delete02Icon, UserGroupIcon, UserMultiple02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { confirmAction } from "../../components/ui/confirm-dialog";
import { ProgressMeter } from "../../components/ui/progress-meter";
import { ScrollArea } from "../../components/ui/scroll-area";
import { useToast } from "../../components/toast-provider";
import { cn } from "../../lib/utils";
import { ACTION_SPECS, FLIPBOOK_TITLE_MAX, flipbookTitle, type CreateEnsembleRequest, type Flipbook, type FlipbookImage, type FlipbookSummary } from "../../shared/flipbook";
import { AccountButton } from "../_auth/account-button";
import { FacebookButton } from "../_auth/facebook-button";
import { LoginDialog } from "../_auth/login-dialog";
import { refreshSession, useSession } from "../_auth/session-client";
import { ago } from "../_editor/ago";
import { ModeSwitch } from "../_editor/mode-switch";
import { SidebarResizer, SidebarToggle, useSidebar } from "../_editor/sidebar-resizer";
import { SidebarListSkeleton } from "../_editor/studio-skeletons";
import { EnsembleCreate } from "./ensemble-create";
import { FlipbookCreate, type CreateOptions } from "./flipbook-create";
import { FlipbookApiError, flipbookApi, isActive, useFlipbook } from "./flipbook-client";
import { FlipbookEditor } from "./flipbook-editor";
import { FlipbookSkeleton } from "./flipbook-skeleton";
import { characterApi } from "../characters/character-client";
import { characterUrls, type CharacterSource } from "../../shared/characters";
import shell from "../editor/studio.module.css";
import styles from "./flipbook.module.css";

/**
 * Focus Flipbook: a creation mode next to video editing, in the same shell
 * as the editor: header with account, a sidebar with saved animations (or
 * the free-edit allowance), and the animation. The current animation lives
 * in the URL (?f=id), so a reload keeps every drawing.
 */
export function FlipbookStudio({ flipbookId, characterSource, together = false }: { readonly flipbookId: string | null; readonly characterSource?: CharacterSource; /** Several saved characters in one scene: the create screen picks them. */ readonly together?: boolean }) {
  const { session } = useSession();
  const user = session?.user ?? null;
  const { toast } = useToast();
  const sidebar = useSidebar();
  const { flipbook, setFlipbook, loadError, pollError } = useFlipbook(flipbookId);
  const [creating, setCreating] = useState(false);
  const [login, setLogin] = useState<"quota" | "save" | null>(null);
  const [saved, setSaved] = useState<FlipbookSummary[] | null>(null);
  const [title, setTitle] = useState("");
  const [imported, setImported] = useState<{ image: FlipbookImage; source: CharacterSource; name: string } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const sourcePath = characterSource ? `/flipbook?${together ? "together=1&" : ""}character=${characterSource.characterId}&version=${characterSource.versionId}` : together ? "/flipbook?together=1" : "/flipbook";
  const here = flipbook ? `/flipbook?f=${flipbook.id}` : sourcePath;
  const outOfFreeEdits = Boolean(session && !session.user && session.quota?.remaining === 0);
  const owned = Boolean(user && flipbook?.ownerId === user.id);

  useEffect(() => {
    const url = flipbook ? `/flipbook?f=${flipbook.id}` : sourcePath;
    if (`${window.location.pathname}${window.location.search}` !== url && (flipbook || !flipbookId)) window.history.replaceState(null, "", url);
  }, [flipbook, flipbookId, sourcePath]);

  useEffect(() => {
    if (!characterSource || !session || flipbookId || together) return;
    if (!user) { setImportError("Sign in to open this character version."); setLogin("save"); return; }
    let canceled = false;
    void characterApi.get(characterSource.characterId).then((character) => {
      const version = character.versions.find((entry) => entry.id === characterSource.versionId);
      if (!version) throw new Error("This character version no longer exists.");
      if (!canceled) setImported({ source: characterSource, name: character.name, image: { id: character.id, originalName: `${character.name} · ${version.name}`, width: version.width, height: version.height, hasAlpha: false, createdAt: version.createdAt, url: characterUrls.version(character.id, version.id) } });
    }).catch((error: unknown) => { if (!canceled) setImportError(error instanceof Error ? error.message : "This character couldn’t be opened."); });
    return () => { canceled = true; };
  }, [characterSource, session, user, flipbookId, together]);

  const loadSaved = useCallback(async () => {
    setSaved(await flipbookApi.list().catch(() => []));
  }, []);

  useEffect(() => {
    if (user) void loadSaved();
  }, [user, loadSaved]);

  // Signed in with an unsaved animation open (made before signing in): it is
  // saved to the account, like a clip in the editor. Once per animation.
  const claimed = useRef<string | null>(null);
  const flipbookIdNow = flipbook?.id;
  const unowned = Boolean(flipbook && !flipbook.ownerId);
  useEffect(() => {
    if (!user || !flipbookIdNow || !unowned || claimed.current === flipbookIdNow) return;
    claimed.current = flipbookIdNow;
    void flipbookApi.save(flipbookIdNow).then((next) => { setFlipbook(next); void loadSaved(); }, () => undefined);
  }, [user, flipbookIdNow, unowned, setFlipbook, loadSaved]);

  // The title field follows the animation; the sidebar refreshes when a run settles.
  const flipbookTitleNow = flipbook ? flipbookTitle(flipbook) : "";
  useEffect(() => setTitle(flipbookTitleNow), [flipbookIdNow, flipbookTitleNow]);
  const settledKey = flipbook ? `${flipbook.id}:${isActive(flipbook) ? "active" : flipbook.status}` : null;
  useEffect(() => {
    if (user && settledKey) void loadSaved();
  }, [user, settledKey, loadSaved]);

  const create = async (image: FlipbookImage, prompt: string, options: CreateOptions) => {
    if (outOfFreeEdits) return setLogin("quota");
    setCreating(true);
    try {
      const { motionFile, ...requestOptions } = options;
      const next: Flipbook = await flipbookApi.create(image.id, prompt, requestOptions);
      setFlipbook(next);
      if (motionFile) {
        try { setFlipbook(await flipbookApi.uploadMotion(next.id, motionFile)); }
        catch (error) { toast({ title: "Animation prepared; video upload failed", description: error instanceof Error ? error.message : "Upload the reference again in the editor.", status: "error" }); }
      }
      void refreshSession();
    } catch (error) {
      if (error instanceof FlipbookApiError && error.code === "login_required") setLogin("quota");
      else toast({ title: "Couldn’t start the animation", description: error instanceof Error ? error.message : "Try again.", status: "error" });
    } finally {
      setCreating(false);
    }
  };

  const createTogether = async (request: CreateEnsembleRequest) => {
    setCreating(true);
    try {
      setFlipbook(await flipbookApi.createEnsemble(request));
    } catch (error) {
      if (error instanceof FlipbookApiError && error.code === "login_required") setLogin("save");
      else toast({ title: "Couldn’t start the scene", description: error instanceof Error ? error.message : "Try again.", status: "error" });
    } finally {
      setCreating(false);
    }
  };

  // A fresh studio: the URL was replaced in place, so the router can't be relied on to remount.
  const startOver = () => {
    window.history.replaceState(null, "", "/flipbook");
    window.location.reload();
  };

  const saveTitle = () => {
    const next = title.trim();
    if (!flipbook || !owned || !next || next === flipbookTitle(flipbook)) return;
    void flipbookApi.save(flipbook.id, next).then((updated) => { setFlipbook(updated); void loadSaved(); }, () => setTitle(flipbookTitle(flipbook)));
  };

  const remove = async (entry: FlipbookSummary) => {
    const confirmed = await confirmAction({
      title: `Delete “${entry.title}”?`,
      description: "Its drawings and exports will expire within a day.",
    });
    if (!confirmed) return;
    await flipbookApi.unsave(entry.id).catch(() => undefined);
    if (entry.id === flipbook?.id) startOver();
    else void loadSaved();
  };

  return (
    <div className={cn(shell.studio, styles.studio)}>
      <header className={cn(shell.header, styles.header)}>
        <div className={shell.headerStart}>
          <SidebarToggle sidebar={sidebar} ariaControls="flipbook-library" className={styles.sidebarToggle} />
          <Link href="/" className={shell.brand} aria-label="Focus — Home">
            <Image src="/brand/focus-cat.webp" alt="" width={30} height={30} />
            <span>focus<span className={shell.brandDot}>.</span></span>
          </Link>
          {flipbook && owned ? (
            <input
              aria-label="Animation name"
              className={cn(shell.title, styles.headerTitle)}
              value={title}
              maxLength={FLIPBOOK_TITLE_MAX}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={saveTitle}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            />
          ) : flipbook ? (
            <span className={cn(shell.titleStatic, styles.headerTitle)}>{flipbookTitle(flipbook)}</span>
          ) : null}
          {owned ? <span className={shell.saved}>Saved to your animations</span> : null}
        </div>
        <ModeSwitch current="flipbook" />
        <div className={shell.headerEnd}><AccountButton session={session} next={here} /></div>
      </header>

      <div className={cn(shell.body, styles.body)} {...sidebar.bodyProps}>
        <SidebarResizer sidebar={sidebar} showToggle={false} />
        <aside id="flipbook-library" className={cn(shell.sidebar, styles.sidebar)} aria-label={user ? "Your animations" : "Account"}>
          <Button variant="outline" size="sm" className="w-full justify-start" onClick={startOver}>
            <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={1.75} />
            New animation
          </Button>

          <nav className={shell.sidebarNav} aria-label="Library">
            <Button asChild variant="ghost" size="sm" className="w-full justify-start font-normal text-muted-foreground hover:text-foreground">
              <Link href="/characters">
                <HugeiconsIcon icon={UserGroupIcon} size={14} strokeWidth={1.75} />
                My characters
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="w-full justify-start font-normal text-muted-foreground hover:text-foreground">
              <Link href="/flipbook?together=1" aria-current={together && !flipbook ? "page" : undefined} className="aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground">
                <HugeiconsIcon icon={UserMultiple02Icon} size={14} strokeWidth={1.75} />
                Animate together
              </Link>
            </Button>
          </nav>

          {user ? (
            <nav className={shell.projects} aria-label="Animations">
              <p className={shell.sideLabel}>Animations</p>
              {saved === null ? (
                <SidebarListSkeleton label="Loading your animations" />
              ) : saved.length === 0 ? (
                <p className="px-2 text-xs leading-5 text-muted-foreground">Every animation you make is saved here.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {saved.map((entry) => (
                    <li key={entry.id} className={cn(shell.project, entry.id === flipbook?.id && shell.projectActive)}>
                      <Link href={`/flipbook?f=${entry.id}`} className={shell.projectLink} aria-current={entry.id === flipbook?.id ? "page" : undefined}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- the illustration, from the media route */}
                        <img src={entry.posterUrl} alt="" className={cn(shell.poster, styles.posterContain)} />
                        <span className="min-w-0">
                          <span className="block truncate text-xs text-foreground">{entry.title}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {entry.action ? `${ACTION_SPECS[entry.action].label} · ` : ""}{entry.frames}/{entry.total} frames · {ago(entry.updatedAt)}
                          </span>
                        </span>
                      </Link>
                      <button type="button" className={shell.projectDelete} aria-label={`Delete ${entry.title}`} onClick={() => void remove(entry)}>
                        <HugeiconsIcon icon={Delete02Icon} size={13} strokeWidth={1.75} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </nav>
          ) : session?.quota ? (
            <section className={shell.guest} aria-label="Free edits">
              <p className="text-sm font-medium text-foreground">Free edits</p>
              <div className="flex items-baseline justify-between text-xs text-muted-foreground tabular-nums">
                <span>{session.quota.remaining === 0 ? "None left" : `${session.quota.remaining} left`}</span>
                <span>{session.quota.used}/{session.quota.limit} used</span>
              </div>
              <ProgressMeter size="sm" value={Math.round((session.quota.used / Math.max(1, session.quota.limit)) * 100)} aria-label="Free edits used" />
              <p className="text-xs leading-5 text-muted-foreground">Sign in to keep animating without limits and save every animation.</p>
              <FacebookButton next={here} label="Sign in with Facebook" className="h-9 whitespace-nowrap px-3 text-[13px]" />
            </section>
          ) : null}
        </aside>

        <ScrollArea as="main" className={cn(shell.main, styles.main)} viewportClassName={styles.mainViewport} contentClassName={cn(styles.mainContent, "pt-4")}>
          {pollError ? <p className={styles.hint} data-invalid="" role="status">{pollError}</p> : null}
          {!together && characterSource && !flipbook && importError ? <p className={styles.hint} role="alert">{importError} <Link href="/characters">Open my characters</Link></p> : !together && characterSource && !flipbook && !imported ? <FlipbookSkeleton /> : flipbookId && !flipbook && !loadError ? (
            <FlipbookSkeleton />
          ) : flipbook ? (
            <>
              <FlipbookEditor key={flipbook.id} flipbook={flipbook} onChange={setFlipbook} onStartOver={startOver} />
              {!user ? (
                <section className={shell.history}>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Not saved: animations without an account expire after a day.{" "}
                    <button type="button" className="text-primary hover:underline" onClick={() => setLogin("save")}>Sign in with Facebook to save this animation</button>
                  </p>
                </section>
              ) : null}
            </>
          ) : (
            <>
              {loadError ? <p className={styles.hint} data-invalid="" role="alert">{loadError.message}</p> : null}
              {together ? (
                <EnsembleCreate
                  initialCast={characterSource ? [characterSource] : undefined}
                  onCreate={(request) => void createTogether(request)}
                  creating={creating}
                  blockedReason={session && !user ? "Sign in with Facebook to animate your saved characters together." : undefined}
                />
              ) : <FlipbookCreate
                initialCharacter={imported ?? undefined}
                onCreate={(image, prompt, options) => void create(image, prompt, options)}
                creating={creating}
                blockedReason={outOfFreeEdits ? "You’ve used your free edits. Sign in with Facebook to keep going." : undefined}
              />}
            </>
          )}
        </ScrollArea>
      </div>
      <LoginDialog open={login !== null} onOpenChange={(open) => { if (!open) setLogin(null); }} next={here} reason={login ?? "save"} />
    </div>
  );
}
