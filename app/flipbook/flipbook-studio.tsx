"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import { useToast } from "../../components/toast-provider";
import type { Flipbook, FlipbookImage } from "../../shared/flipbook";
import { AccountButton } from "../_auth/account-button";
import { LoginDialog } from "../_auth/login-dialog";
import { ModeSwitch } from "../_editor/mode-switch";
import { refreshSession, useSession } from "../_auth/session-client";
import { FlipbookCreate } from "./flipbook-create";
import { FlipbookApiError, flipbookApi, useFlipbook } from "./flipbook-client";
import { FlipbookEditor } from "./flipbook-editor";
import styles from "./flipbook.module.css";

/**
 * Focus Flipbook: a creation mode next to video editing. The current
 * animation lives in the URL (?f=id), so a reload keeps every drawing.
 */
export function FlipbookStudio({ flipbookId }: { readonly flipbookId: string | null }) {
  const { session } = useSession();
  const { toast } = useToast();
  const { flipbook, setFlipbook, loadError, pollError } = useFlipbook(flipbookId);
  const [creating, setCreating] = useState(false);
  const [login, setLogin] = useState(false);
  const here = flipbook ? `/flipbook?f=${flipbook.id}` : "/flipbook";
  const outOfFreeEdits = Boolean(session && !session.user && session.quota?.remaining === 0);

  useEffect(() => {
    const url = flipbook ? `/flipbook?f=${flipbook.id}` : "/flipbook";
    if (`${window.location.pathname}${window.location.search}` !== url && (flipbook || !flipbookId)) window.history.replaceState(null, "", url);
  }, [flipbook, flipbookId]);

  const create = async (image: FlipbookImage, prompt: string) => {
    if (outOfFreeEdits) return setLogin(true);
    setCreating(true);
    try {
      const next: Flipbook = await flipbookApi.create(image.id, prompt);
      setFlipbook(next);
      void refreshSession();
    } catch (error) {
      if (error instanceof FlipbookApiError && error.code === "login_required") setLogin(true);
      else toast({ title: "Couldn’t start the animation", description: error instanceof Error ? error.message : "Try again.", status: "error" });
    } finally {
      setCreating(false);
    }
  };

  const startOver = () => {
    window.history.replaceState(null, "", "/flipbook");
    window.location.reload();
  };

  return (
    <div className={styles.studio}>
      <header className={styles.header}>
        <div className={styles.headerStart}>
          <Link href="/" className={styles.brand} aria-label="Focus — Home">
            <Image src="/brand/focus-cat.webp" alt="" width={30} height={30} />
            <span>focus<span className={styles.brandDot}>.</span></span>
          </Link>
          <ModeSwitch current="flipbook" />
        </div>
        <div className={styles.headerEnd}>
          {flipbook ? <Button size="sm" variant="ghost" onClick={startOver}>New animation</Button> : null}
          <AccountButton session={session} next={here} />
        </div>
      </header>

      <main className={styles.main}>
        {pollError ? <p className={styles.hint} data-invalid="" role="status">{pollError}</p> : null}
        {flipbookId && !flipbook && !loadError ? (
          <div className="flex items-center gap-2 py-24 text-sm text-muted-foreground"><Spinner className="size-4" />Opening your animation…</div>
        ) : flipbook ? (
          <FlipbookEditor flipbook={flipbook} onChange={setFlipbook} onStartOver={startOver} />
        ) : (
          <>
            {loadError ? <p className={styles.hint} data-invalid="" role="alert">{loadError.message}</p> : null}
            <FlipbookCreate
              onCreate={(image, prompt) => void create(image, prompt)}
              creating={creating}
              blockedReason={outOfFreeEdits ? "You’ve used your free edits. Sign in with Facebook to keep going." : undefined}
            />
          </>
        )}
      </main>
      <LoginDialog open={login} onOpenChange={setLogin} next={here} reason="quota" />
    </div>
  );
}
