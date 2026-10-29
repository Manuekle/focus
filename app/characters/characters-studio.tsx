"use client";

/* eslint-disable @next/next/no-img-element -- private media requires browser session cookies */

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Add01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Skeleton } from "../../components/ui/skeleton";
import {
  IMAGE_ACCEPT_ATTRIBUTE,
  MAX_IMAGE_BYTES,
  hasAcceptedImageExtension,
} from "../../shared/flipbook";
import type { Character, CharacterSummary } from "../../shared/characters";
import { formatBytes } from "../../shared/media";
import { AccountButton } from "../_auth/account-button";
import { LoginDialog } from "../_auth/login-dialog";
import { useSession } from "../_auth/session-client";
import { ModeSwitch } from "../_editor/mode-switch";
import { SidebarResizer, useSidebar } from "../_editor/sidebar-resizer";
import { CharacterApiError, characterApi } from "./character-client";
import { CharacterEditor } from "./character-editor";
import shell from "../editor/studio.module.css";
import styles from "./characters.module.css";

export function CharactersStudio({
  initialId,
}: {
  readonly initialId: string | null;
}) {
  const router = useRouter();
  const { session, loading } = useSession();
  const user = session?.user;
  const sidebar = useSidebar();
  const [list, setList] = useState<CharacterSummary[] | null>(null);
  const [character, setCharacter] = useState<Character | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [login, setLogin] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const createLock = useRef(false);
  const here = initialId ? `/characters?c=${initialId}` : "/characters";

  const loadList = useCallback(
    () =>
      characterApi
        .list()
        .then(setList)
        .catch((cause: unknown) =>
          setError(
            cause instanceof Error
              ? cause.message
              : "Your characters couldn’t be loaded.",
          ),
        ),
    [],
  );
  useEffect(() => {
    if (user) void loadList();
    else {
      setList(null);
      setCharacter(null);
    }
  }, [user, loadList]);
  useEffect(() => {
    if (!user || !initialId) return;
    let stopped = false;
    void characterApi
      .get(initialId)
      .then((value) => {
        if (!stopped) setCharacter(value);
      })
      .catch((cause: unknown) => {
        if (!stopped)
          setError(
            cause instanceof Error
              ? cause.message
              : "This character couldn’t be opened.",
          );
      });
    return () => {
      stopped = true;
    };
  }, [initialId, user]);
  useEffect(() => {
    if (character?.status !== "generating" || !user) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await characterApi.get(character.id);
        if (stopped) return;
        setCharacter(next);
        setError(null);
        if (next.status !== "generating") {
          void loadList();
          return;
        }
      } catch (cause) {
        if (!stopped)
          setError(
            cause instanceof Error
              ? cause.message
              : "Reconnecting to your character…",
          );
      }
      if (!stopped) timer = setTimeout(() => void poll(), 1800);
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [character?.id, character?.status, user, loadList]);

  const create = async (file?: File) => {
    if (!user) {
      setLogin(true);
      return;
    }
    if (createLock.current) return;
    if (
      file &&
      (!hasAcceptedImageExtension(file.name) || file.size > MAX_IMAGE_BYTES)
    ) {
      setError(`Choose a PNG, JPEG or WebP image up to ${formatBytes(MAX_IMAGE_BYTES)}.`);
      return;
    }
    createLock.current = true;
    setCreating(true);
    setError(null);
    try {
      const next = file
        ? await characterApi.create(file)
        : await characterApi.elf();
      router.push(`/characters?c=${next.id}`);
    } catch (cause) {
      if (cause instanceof CharacterApiError && cause.code === "login_required")
        setLogin(true);
      else
        setError(
          cause instanceof Error
            ? cause.message
            : "This character couldn’t be created.",
        );
    } finally {
      createLock.current = false;
      setCreating(false);
    }
  };
  const changed = (next: Character) => {
    setCharacter(next);
    if (next.status !== "generating") void loadList();
  };

  return (
    <div className={shell.studio}>
      <a className={styles.skip} href="#characters-main">
        Skip to characters
      </a>
      <header className={shell.header}>
        <div className={shell.headerStart}>
          <Link href="/" className={shell.brand} aria-label="Focus — Home">
            <Image src="/brand/focus-cat.webp" alt="" width={30} height={30} />
            <span>
              focus<span className={shell.brandDot}>.</span>
            </span>
          </Link>
          <span className={styles.headerLabel}>My characters</span>
        </div>
        <ModeSwitch current="flipbook" />
        <div className={shell.headerEnd}>
          <AccountButton session={session} next={here} />
        </div>
      </header>
      <div className={shell.body} {...sidebar.bodyProps}>
        <SidebarResizer sidebar={sidebar} />
        <aside
          className={`${shell.sidebar} ${styles.librarySidebar}`}
          aria-label="Character library"
        >
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start"
            disabled={creating || loading}
            onClick={() => {
              if (!user) setLogin(true);
              else fileRef.current?.click();
            }}
          >
            <HugeiconsIcon icon={Add01Icon} size={14} />
            New character
          </Button>
          <nav className={shell.sidebarNav} aria-label="Library">
            <Button asChild variant="ghost" size="sm" className="w-full justify-between font-normal text-muted-foreground hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground">
              <Link
                href="/characters"
                aria-current={!initialId ? "page" : undefined}
              >
                My characters <span>{list?.length ?? ""}</span>
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="w-full justify-start font-normal text-muted-foreground hover:text-foreground">
              <Link href="/flipbook">
                <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
                Back to Flipbook
              </Link>
            </Button>
          </nav>
          {user ? (
            <div className={styles.sideList}>
              <p className={shell.sideLabel}>Characters</p>
              {list === null ? (
                <Skeleton style={{ height: 54 }} />
              ) : (
                list.map((entry) => (
                  <Link
                    key={entry.id}
                    href={`/characters?c=${entry.id}`}
                    className={styles.sideCharacter}
                    aria-current={entry.id === initialId ? "page" : undefined}
                  >
                    <img src={entry.coverUrl} alt="" />
                    <span>
                      <strong>{entry.name}</strong>
                      <small>
                        {entry.status === "generating"
                          ? "Drawing a new version…"
                          : `${entry.versions} ${entry.versions === 1 ? "version" : "versions"}`}
                      </small>
                    </span>
                  </Link>
                ))
              )}
            </div>
          ) : (
            <p className={styles.sideNote}>
              Sign in to keep your references and every version together.
            </p>
          )}
        </aside>
        <main
          id="characters-main"
          className={`${shell.main} ${styles.main}`}
          tabIndex={-1}
        >
          {error ? (
            <div role="alert" className={styles.error}>
              {error}
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  if (user) {
                    void loadList();
                    if (initialId)
                      void characterApi
                        .get(initialId)
                        .then(setCharacter)
                        .catch((cause: unknown) =>
                          setError(
                            cause instanceof Error
                              ? cause.message
                              : "Try again.",
                          ),
                        );
                  }
                }}
              >
                Try again
              </button>
            </div>
          ) : null}
          {initialId && loading ? (
            <div
              className={styles.editorSkeleton}
              aria-label="Opening your character"
            >
              <Skeleton style={{ minHeight: 460 }} />
              <Skeleton style={{ minHeight: 300 }} />
            </div>
          ) : initialId && user ? (
            character ? (
              <CharacterEditor character={character} onChange={changed} />
            ) : !error ? (
              <div
                className={styles.editorSkeleton}
                aria-label="Opening your character"
              >
                <Skeleton style={{ minHeight: 460 }} />
                <Skeleton style={{ minHeight: 300 }} />
              </div>
            ) : null
          ) : (
            <>
              <div className={styles.pageHeading}>
                <div>
                  <p className={styles.eyebrow}>Your cast, kept together</p>
                  <h1>My characters</h1>
                  <p>
                    Start with a reference. Refine the details. Bring your
                    favorite version into Flipbook.
                  </p>
                </div>
                {Boolean(list?.length) && (
                  <Button
                    variant="outline"
                    disabled={creating}
                    onClick={() => fileRef.current?.click()}
                  >
                    <HugeiconsIcon icon={Add01Icon} size={14} />
                    Add a character
                  </Button>
                )}
              </div>
              {Boolean(list?.length) ? (
                <div className={styles.gallery}>
                  {list!.map((entry) => (
                    <Link
                      className={styles.characterCard}
                      key={entry.id}
                      href={`/characters?c=${entry.id}`}
                    >
                      <div className={styles.cardArt}>
                        <img src={entry.coverUrl} alt={entry.name} />
                      </div>
                      <div className={styles.cardCaption}>
                        <span>
                          <strong>{entry.name}</strong>
                          <small>
                            {entry.status === "generating"
                              ? "Drawing a new version…"
                              : `${entry.versions} saved ${entry.versions === 1 ? "version" : "versions"}`}
                          </small>
                        </span>
                        <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
                      </div>
                    </Link>
                  ))}
                </div>
              ) : null}
              <section
                className={styles.starter}
                aria-labelledby="elf-starter-title"
              >
                <div className={styles.starterCopy}>
                  <Badge size="sm">Start with a reference</Badge>
                  <h2 id="elf-starter-title">Meet Elf-chan.</h2>
                  <p>
                    A familiar face for your first character. Keep her original
                    reference, create a full-body design, then try a new outfit.
                  </p>
                  <Button
                    disabled={creating || loading}
                    aria-busy={creating}
                    onClick={() => void create()}
                  >
                    {creating ? "Opening Elf-chan…" : "Start with Elf-chan"}
                    <HugeiconsIcon icon={ArrowRight01Icon} size={15} />
                  </Button>
                  <button
                    className={styles.textButton}
                    type="button"
                    disabled={creating || loading}
                    onClick={() => {
                      if (!user) setLogin(true);
                      else fileRef.current?.click();
                    }}
                  >
                    Or upload your own reference
                  </button>
                  <small>
                    Nothing is generated until you choose Create design.
                  </small>
                </div>
                <div className={styles.starterArt}>
                  <Image
                    src="/characters/elf-chan.png"
                    alt="Elf-chan, with blonde braided hair, green eyes and pointed ears"
                    width={736}
                    height={1042}
                    priority
                  />
                  <span>Original reference</span>
                </div>
              </section>
            </>
          )}
        </main>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_ACCEPT_ATTRIBUTE}
        className="sr-only"
        tabIndex={-1}
        aria-label="Upload a character reference"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void create(file);
        }}
      />
      <LoginDialog
        open={login || Boolean(initialId && !loading && !user)}
        onOpenChange={(open) => {
          setLogin(open);
          if (!open && initialId && !user) router.push("/characters");
        }}
        next={here}
        reason="characters"
      />
    </div>
  );
}
