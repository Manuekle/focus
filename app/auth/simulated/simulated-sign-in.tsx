"use client";

import Image from "next/image";
import Link from "next/link";
import { useId, useState } from "react";
import { FacebookIcon } from "../../../components/icons/social-icons";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Spinner } from "../../../components/ui/spinner";
import { ApiErrorBodySchema } from "../../../shared/schemas";

/**
 * Development only. Plays the part of Facebook's dialog: the name you type
 * becomes a local account (the same name always returns to the same account).
 * The real flow runs through Meta's Graph API once FACEBOOK_APP_ID is set.
 */
export function SimulatedSignIn({ state }: { readonly state: string }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/facebook/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, name }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const parsed = ApiErrorBodySchema.safeParse(body);
        const code = parsed.success ? parsed.data.error.code : "";
        throw new Error(
          code === "auth_expired"
            ? "This sign-in expired. Start again from Focus."
            : code === "invalid_name"
              ? "Type your name (2 characters or more)."
              : code === "auth_not_configured"
                ? "Sign-in isn’t configured on this server (FOCUS_SESSION_SECRET)."
                : "Sign-in failed. Try again.",
        );
      }
      window.location.assign(typeof body?.next === "string" ? body.next : "/editor");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Sign-in failed. Try again.");
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4">
      <form
        className="page-enter flex w-full max-w-sm flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-float)]"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void submit();
        }}
      >
        <div className="flex items-center gap-3">
          <Image src="/brand/focus-cat.webp" alt="" width={32} height={32} className="rounded-[9px] border border-border" />
          <span aria-hidden className="text-muted-foreground">→</span>
          <span className="grid size-8 place-items-center rounded-full bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)]">
            <FacebookIcon width={18} height={18} />
          </span>
        </div>
        <div>
          <h1 className="font-[family-name:var(--font-sn-pro)] text-lg font-semibold tracking-[-0.02em] text-foreground">Continue to Focus with Facebook</h1>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-foreground">Simulated</span> Local development: no data goes to Facebook. Your name creates a local account.
          </p>
        </div>
        {state ? (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={nameId} className="text-xs text-muted-foreground">
                Name on your profile
              </label>
              <Input
                id={nameId}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={60}
                autoFocus
                autoComplete="name"
                className="h-10"
                placeholder="Alex Morgan"
              />
            </div>
            <Button type="submit" size="lg" disabled={busy || name.trim().length < 2} aria-busy={busy || undefined} className="w-full gap-2">
              {busy ? <Spinner className="size-4" /> : <FacebookIcon width={16} height={16} />}
              Continue as {name.trim() || "…"}
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">This page opens from “Continue with Facebook” in Focus.</p>
        )}
        {error ? <p role="alert" className="text-sm text-[var(--destructive)]">{error}</p> : null}
        <Link href="/editor" className="text-center text-xs text-muted-foreground hover:text-foreground">
          Cancel
        </Link>
      </form>
    </main>
  );
}
