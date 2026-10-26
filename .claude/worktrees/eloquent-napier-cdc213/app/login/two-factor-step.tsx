"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OtpInput } from "@/components/ui/otp-input";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * The second step of signing in, for an account with two-step verification
 * (lib/auth/two-factor.ts). The first step left a one-time challenge in an
 * httpOnly cookie; this sends the code that turns it into a session.
 */
export function TwoFactorStep({
  onSignedIn,
  onRestart,
}: {
  readonly onSignedIn: () => void;
  /** The challenge expired or burned: back to the password. */
  readonly onRestart: (message: string) => void;
}) {
  const t = useT();
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState(0);

  const submit = async (event: FormEvent | null, value = code) => {
    event?.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(null);
    const response = await fetch("/api/auth/two-factor", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: value.trim() }),
    }).catch(() => null);
    if (response?.ok) {
      // Stay "busy" until the page changes: the next screen is already on its way.
      onSignedIn();
      return;
    }
    setBusy(false);
    setErrorKey((key) => key + 1);
    const reason = ((await response?.json().catch(() => null)) as { error?: string } | null)?.error;
    if (!response) setError(t("auth.errorNetwork"));
    else if (reason === "expired") onRestart(t("auth.twoFactorExpired"));
    else if (reason === "rate_limited") setError(t("apiError.rate_limited"));
    else if (reason === "locked") {
      setRecovery(true);
      setError(t("auth.twoFactorLocked"));
    } else setError(t("auth.twoFactorWrong"));
    setCode("");
  };

  return (
    <form
      className="mt-8 flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-soft),var(--shadow-inset)]"
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <div className={cn("t-input-wrap flex flex-col gap-1.5", error && "is-error")}>
        <label className="font-medium text-sm" htmlFor="auth-2fa-code">
          {recovery ? t("auth.twoFactorRecoveryLabel") : t("auth.twoFactorCode")}
        </label>
        <p className="text-muted-foreground text-xs">{recovery ? t("auth.twoFactorRecoveryHint") : t("auth.twoFactorHint")}</p>
        {recovery ? (
        <div className={cn("t-input rounded-xl", error && "is-error")}>
          <Input
            autoComplete="one-time-code"
            autoFocus
            className="text-center font-mono text-lg tracking-[0.3em]"
            id="auth-2fa-code"
            inputMode="text"
            maxLength={9}
            onChange={(event) => setCode(event.target.value)}
            placeholder="abcd-efgh"
            value={code}
          />
        </div>
        ) : (
          <OtpInput
            autoFocus
            busy={busy}
            className="mt-2"
            errorKey={errorKey}
            id="auth-2fa-code"
            invalid={Boolean(error)}
            label={t("auth.twoFactorCode")}
            onChange={(next) => {
              setCode(next);
              if (error) setError(null);
            }}
            onComplete={(next) => void submit(null, next)}
            value={code}
          />
        )}
        {error ? (
          <p className="t-error-msg text-destructive text-xs" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {recovery ? (
        <Button className="mt-1 w-full" disabled={busy || code.trim().length < 6} type="submit">
          {busy ? t("auth.stepChecking") : t("auth.twoFactorVerify")}
        </Button>
      ) : null}

      <button
        className="self-center text-[13px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
        onClick={() => {
          setRecovery((value) => !value);
          setCode("");
          setError(null);
        }}
        type="button"
      >
        {recovery ? t("auth.twoFactorUseApp") : t("auth.twoFactorUseRecovery")}
      </button>
    </form>
  );
}
