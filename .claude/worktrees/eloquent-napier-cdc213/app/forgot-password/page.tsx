"use client";

import { AuthBackdrop } from "@/app/_components/auth-backdrop";
import { HugeiconsIcon } from "@/components/icons/icon";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n, useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * Asks for an email, always ends the same way from the visitor's side.
 *
 * The API answers `{ ok: true }` whether or not the address has an account —
 * this page has to match that, or the confirmation screen itself would leak
 * what the response already refuses to.
 */
export default function ForgotPasswordPage() {
  const t = useT();
  const { locale } = useI18n();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  // Without email: a code from the authenticator app plus a recovery code
  // (app/api/auth/forgot-password/two-factor), for accounts with 2FA on.
  const [withApp, setWithApp] = useState(false);
  const [appCode, setAppCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const router = useRouter();

  const onResetWithApp = async (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError(t("auth.errorEmailInvalid"));
      return;
    }
    if (newPassword.length < 10) {
      setError(t("auth.errorWeak"));
      return;
    }
    setBusy(true);
    setError(null);
    const response = await fetch("/api/auth/forgot-password/two-factor", {
      body: JSON.stringify({ email: address, code: appCode.trim(), recoveryCode: recoveryCode.trim(), password: newPassword }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }).catch(() => null);
    setBusy(false);
    if (response?.ok) {
      router.replace("/login?reset=1");
      return;
    }
    const code = ((await response?.json().catch(() => null)) as { error?: string } | null)?.error;
    setError(
      !response
        ? t("auth.errorNetwork")
        : code === "rate_limited"
          ? t("apiError.rate_limited")
          : code === "weak_password"
            ? t("auth.errorWeak")
            : t("auth.forgotAppInvalid"),
    );
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError(t("auth.errorEmailInvalid"));
      return;
    }

    setBusy(true);
    setError(null);
    const response = await fetch("/api/auth/forgot-password", {
      // The reset email is written on the server, so it needs to be told
      // which language to write it in — same as the other routes that word a
      // sentence themselves (see lib/i18n/server.ts).
      body: JSON.stringify({ email: address, locale }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }).catch(() => null);
    setBusy(false);

    if (!response) {
      setError(t("auth.errorNetwork"));
      return;
    }
    setSent(true);
  };

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-6 py-16">
      {/* Backdrop, under everything and inert. */}
      <AuthBackdrop />

      <div className="relative w-full max-w-[25rem]">
        <h1 className="text-balance text-center font-cooper text-[2rem] leading-[1.08] font-medium tracking-[-0.02em]">
          {t("auth.forgotTitle")}
        </h1>
        <p className="mx-auto mt-3 max-w-[34ch] text-balance text-center text-[15px] leading-relaxed text-muted-foreground">
          {t("auth.forgotSubtitle")}
        </p>

        <div className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-soft),var(--shadow-inset)]">
          {sent ? (
            <div className="space-y-3 text-center">
              <p className="text-[15px] leading-relaxed">{t("auth.forgotSent")}</p>
              <p className="text-[13px] text-muted-foreground">{t("auth.forgotSentHint")}</p>
            </div>
          ) : withApp ? (
            <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void onResetWithApp(event)}>
              <p className="text-[13px] text-muted-foreground">{t("auth.forgotAppIntro")}</p>
              <label className="flex flex-col gap-1.5">
                <span className="font-medium text-sm">{t("auth.email")}</span>
                <Input autoComplete="username" onChange={(e) => setEmail(e.target.value)} placeholder={t("auth.emailPlaceholder")} type="email" value={email} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="font-medium text-sm">{t("auth.twoFactorCode")}</span>
                <Input autoComplete="one-time-code" className="font-mono tracking-[0.2em]" inputMode="numeric" maxLength={6} onChange={(e) => setAppCode(e.target.value)} placeholder="123456" value={appCode} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="font-medium text-sm">{t("auth.twoFactorRecoveryLabel")}</span>
                <Input autoComplete="off" className="font-mono tracking-[0.1em]" maxLength={9} onChange={(e) => setRecoveryCode(e.target.value)} placeholder="abcd-efgh" value={recoveryCode} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="font-medium text-sm">{t("auth.newPassword")}</span>
                <Input autoComplete="new-password" onChange={(e) => setNewPassword(e.target.value)} placeholder={t("auth.passwordPlaceholder")} type="password" value={newPassword} />
                <span className="text-muted-foreground text-xs">{t("auth.passwordHint")}</span>
              </label>
              {error ? (
                <p className="text-destructive text-xs" role="alert">
                  {error}
                </p>
              ) : null}
              <Button className="mt-1 w-full" disabled={busy || !appCode || !recoveryCode || !newPassword} type="submit">
                {t("auth.forgotAppSubmit")}
              </Button>
            </form>
          ) : (
            <form className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
              <div className={cn("t-input-wrap flex flex-col gap-1.5", error && "is-error")}>
                <label className="font-medium text-sm" htmlFor="forgot-email">
                  {t("auth.email")}
                </label>
                <div className={cn("t-input rounded-xl", error && "is-error")}>
                  <Input
                    autoComplete="username"
                    autoFocus
                    id="forgot-email"
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder={t("auth.emailPlaceholder")}
                    required
                    type="email"
                    value={email}
                  />
                </div>
                {error ? (
                  <p className="t-error-msg text-destructive text-xs" role="alert">
                    {error}
                  </p>
                ) : null}
              </div>

              <Button className="mt-1 w-full" disabled={busy} type="submit">
                {t("auth.forgotSubmit")}
              </Button>
            </form>
          )}
        </div>

        <button
          className="mx-auto mt-4 block text-[13px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
          onClick={() => {
            setWithApp((value) => !value);
            setSent(false);
            setError(null);
          }}
          type="button"
        >
          {withApp ? t("auth.forgotUseEmail") : t("auth.forgotUseApp")}
        </button>

        <div className="mt-6 flex justify-center">
          <Link
            className="group inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
            href="/login"
          >
            <HugeiconsIcon
              className="transition-transform duration-200 ease-expo-out group-hover:-translate-x-0.5"
              icon={ArrowLeft01Icon}
              size={14}
              strokeWidth={2}
            />
            {t("auth.signIn")}
          </Link>
        </div>
      </div>
    </main>
  );
}
