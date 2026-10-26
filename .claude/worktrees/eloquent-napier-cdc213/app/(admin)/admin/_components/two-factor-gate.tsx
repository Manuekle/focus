"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@/components/icons/icon";
import { ArrowDown01Icon, Copy01Icon, LockPasswordIcon, Logout01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Checkbox } from "@/components/motion/checkbox";
import { OrukaTile } from "@/components/icons/oruka-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { OtpInput } from "@/components/ui/otp-input";
import { LanguageSwitch, useAdminLocale } from "./admin-locale";

// The second factor before the operator panel opens (lib/auth/two-factor.ts):
// enrolment with a QR code the first time, a code from the app every new
// session after that. In the panel's language (admin-locale.tsx).

type Step =
  | { kind: "intro" }
  | { kind: "scan"; qr: string; secret: string }
  | { kind: "recovery"; codes: string[] }
  | { kind: "verify" };

const ERRORS: Record<number, readonly [string, string]> = {
  400: [
    "El código no es correcto o ya se usó. Revisa que la hora del teléfono esté bien y prueba con el siguiente.",
    "The code is wrong or already used. Check your phone's clock and try the next one.",
  ],
  409: ["No se puede verificar con la clave actual del servidor.", "It cannot be verified with the server's current key."],
  429: ["Demasiados intentos. Espera cinco minutos.", "Too many attempts. Wait five minutes."],
};

export function TwoFactorGate({
  operator,
  enrolled,
  locked,
}: {
  readonly operator: string;
  readonly enrolled: boolean;
  readonly locked: boolean;
}) {
  const router = useRouter();
  const { tr } = useAdminLocale();
  const [step, setStep] = useState<Step>(enrolled ? { kind: "verify" } : { kind: "intro" });
  const [code, setCode] = useState("");
  // An unreadable secret still opens with a recovery code (they are hashes).
  const [recoveryMode, setRecoveryMode] = useState(locked);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const [errorKey, setErrorKey] = useState(0);

  const call = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/admin/2fa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = (await response?.json().catch(() => null)) as Record<string, unknown> | null;
    setBusy(false);
    if (!response?.ok) {
      const known = ERRORS[response?.status ?? 0];
      setError(known ? tr(known[0], known[1]) : tr("No se pudo. Prueba de nuevo.", "It didn't work. Try again."));
      setErrorKey((key) => key + 1);
      return null;
    }
    return data ?? {};
  };

  const start = async () => {
    const data = await call({ action: "start" });
    if (data) setStep({ kind: "scan", qr: String(data.qr), secret: String(data.secret) });
  };

  const submit = async (event: FormEvent | null, value = code) => {
    event?.preventDefault();
    if (busy || !value.trim()) return;
    if (step.kind === "scan") {
      const data = await call({ action: "confirm", code: value.trim() });
      if (data) {
        setCode("");
        setStep({ kind: "recovery", codes: (data.recoveryCodes as string[]) ?? [] });
      } else setCode("");
      return;
    }
    const data = await call({ action: "verify", code: value.trim() });
    if (data) {
      // The session now carries the second factor: load the panel for real.
      setBusy(true);
      window.location.reload();
    } else setCode("");
  };

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    router.replace("/login");
    router.refresh();
  };

  const copyCodes = async () => {
    if (step.kind !== "recovery") return;
    try {
      await navigator.clipboard.writeText(step.codes.join("\n"));
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  };

  const heading =
    step.kind === "recovery" ? tr("Guarda tus códigos de recuperación", "Save your recovery codes") : tr("Verificación en dos pasos", "Two-step verification");
  const lead =
    step.kind === "intro"
      ? tr(
          "El panel pide, además de tu contraseña, un código de una app de autenticación (Google Authenticator, 1Password, Authy…).",
          "Besides your password, the panel asks for a code from an authenticator app (Google Authenticator, 1Password, Authy…).",
        )
      : step.kind === "scan"
        ? tr("Escanea el QR con tu app y escribe el código de 6 dígitos que muestra.", "Scan the QR with your app and type the 6-digit code it shows.")
        : step.kind === "recovery"
          ? tr("Cada uno sirve una sola vez si pierdes el teléfono. No se vuelven a mostrar.", "Each works once if you lose your phone. They are not shown again.")
          : recoveryMode
            ? tr("Escribe uno de tus códigos de recuperación.", "Type one of your recovery codes.")
            : tr("Escribe el código de 6 dígitos de tu app de autenticación.", "Type the 6-digit code from your authenticator app.");

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-3 py-10 text-foreground sm:px-4">
      {/* Wide enough for the six code boxes inside the card's padding, phone included. */}
      <div className="w-full max-w-[26rem] space-y-6">
        <div className="flex items-center gap-2">
          <OrukaTile className="size-7" />
          <span className="text-sm font-medium">Oruka</span>
          <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Admin</span>
          <span className="ml-auto flex items-center gap-1.5">
            <LanguageSwitch />
            <ThemeToggle showLabel={false} className="size-8 justify-center focus-visible:outline-2 focus-visible:outline-ring" />
          </span>
        </div>

        <div className="rounded-[20px] border border-border/70 bg-muted/50 p-1 shadow-[var(--shadow-float)] sm:p-1.5">
          <div className="space-y-5 rounded-[14px] border border-border/50 bg-card p-3.5 shadow-xs sm:p-5">
            <div key={`${step.kind}:${recoveryMode}`} className="t-reveal space-y-1.5">
              <h1 className="flex items-center gap-2 text-base font-medium tracking-[-0.01em]">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                  <HugeiconsIcon icon={LockPasswordIcon} size={16} strokeWidth={1.75} />
                </span>
                {heading}
              </h1>
              <p className="text-sm text-muted-foreground text-pretty">{lead}</p>
              <p className="truncate text-xs text-muted-foreground">{operator}</p>
            </div>

            {locked ? (
              <Alert tone="warning" size="sm">
                {tr(
                  "Cambió la clave con la que se guardó el secreto: entra con un código de recuperación y genera un QR nuevo desde Seguridad.",
                  "The key the secret was sealed with changed: sign in with a recovery code and make a new QR from Security.",
                )}
              </Alert>
            ) : null}

            <div key={step.kind} className="t-reveal">
              {step.kind === "intro" ? (
                <div className="space-y-4">
                  {error ? (
                    <Alert tone="error" size="sm">
                      {error}
                    </Alert>
                  ) : null}
                  <Button className="w-full" disabled={busy} onClick={() => void start()}>
                    {busy ? tr("Generando…", "Generating…") : tr("Configurar", "Set up")}
                  </Button>
                </div>
              ) : step.kind === "recovery" ? (
                <div className="space-y-4">
                  <ul className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted/30 p-3 font-mono text-sm">
                    {step.codes.map((value) => (
                      <li key={value} className="text-center tabular-nums">
                        {value}
                      </li>
                    ))}
                  </ul>
                  <Button variant="secondary" className="w-full" onClick={() => void copyCodes()}>
                    <HugeiconsIcon icon={copy === "copied" ? Tick02Icon : Copy01Icon} size={14} strokeWidth={1.75} />
                    {copy === "copied" ? tr("Copiados", "Copied") : tr("Copiar", "Copy")}
                  </Button>
                  <p role="status" className={copy !== "idle" ? "text-xs text-muted-foreground" : "sr-only"}>
                    {copy === "copied"
                      ? tr("Códigos copiados.", "Codes copied.")
                      : copy === "failed"
                        ? tr("No se pudieron copiar. Guarda los códigos manualmente antes de continuar.", "They could not be copied. Save the codes by hand before going on.")
                        : ""}
                  </p>
                  <Checkbox checked={saved} onCheckedChange={setSaved} label={tr("Los guardé en un lugar seguro", "I saved them somewhere safe")} />
                  <Button className="w-full" disabled={!saved} onClick={() => router.refresh()}>
                    {tr("Entrar al panel", "Open the panel")}
                  </Button>
                </div>
              ) : (
                <form onSubmit={(event) => void submit(event)} className="space-y-4">
                  {step.kind === "scan" ? (
                    <div className="space-y-3">
                      <div
                        className="mx-auto w-48 rounded-xl bg-white p-2 shadow-[var(--shadow-soft)] outline outline-1 -outline-offset-1 outline-black/5 [&_svg]:h-auto [&_svg]:w-full"
                        // An SVG this server rendered from the otpauth URI (qrcode), not user input.
                        dangerouslySetInnerHTML={{ __html: step.qr }}
                      />
                      <ManualKey secret={step.secret} />
                    </div>
                  ) : null}
                  {recoveryMode ? (
                    <Input
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="abcd-efgh"
                      autoComplete="one-time-code"
                      autoFocus
                      maxLength={9}
                      aria-label={tr("Código de recuperación", "Recovery code")}
                      className="text-center font-mono text-lg tracking-[0.3em]"
                    />
                  ) : (
                    <OtpInput
                      autoFocus
                      busy={busy}
                      errorKey={errorKey}
                      invalid={Boolean(error)}
                      label={tr("Código de 6 dígitos", "6-digit code")}
                      onChange={(next) => {
                        setCode(next);
                        if (error) setError(null);
                      }}
                      onComplete={(next) => void submit(null, next)}
                      value={code}
                    />
                  )}
                  {error ? (
                    <Alert tone="error" size="sm">
                      {error}
                    </Alert>
                  ) : null}
                  {recoveryMode ? (
                    <Button type="submit" className="w-full" disabled={busy || code.trim().length < 6}>
                      {busy ? tr("Verificando…", "Verifying…") : tr("Entrar", "Sign in")}
                    </Button>
                  ) : (
                    <p className="text-center text-xs text-muted-foreground" aria-live="polite">
                      {busy
                        ? tr("Verificando…", "Verifying…")
                        : step.kind === "scan"
                          ? tr("Se activa al completar los 6 dígitos.", "Turns on once all 6 digits are in.")
                          : tr("Entra solo al completar los 6 dígitos.", "Signs in once all 6 digits are in.")}
                    </p>
                  )}
                  {step.kind === "verify" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setRecoveryMode((value) => !value);
                        setCode("");
                        setError(null);
                      }}
                      className="h-auto min-h-8 w-full whitespace-normal text-center text-xs text-muted-foreground"
                    >
                      {recoveryMode
                        ? tr("Usar el código de la app", "Use the app's code")
                        : tr("Perdí el teléfono: usar un código de recuperación", "I lost my phone: use a recovery code")}
                    </Button>
                  ) : null}
                </form>
              )}
            </div>
          </div>
        </div>

        <Button type="button" variant="ghost" size="sm" onClick={() => void signOut()} className="text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive">
          <HugeiconsIcon icon={Logout01Icon} size={14} strokeWidth={1.75} />
          {tr("Cerrar sesión", "Sign out")}
        </Button>
      </div>
    </div>
  );
}

/** "Can't scan?": the secret to type by hand, behind the product's animated disclosure. */
function ManualKey({ secret }: { readonly secret: string }) {
  const { tr } = useAdminLocale();
  return (
    <Collapsible className="group/manual rounded-xl border border-border bg-muted/30">
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
        <span className="flex-1">{tr("¿No puedes escanear? Clave manual", "Can't scan? Manual key")}</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={14}
          strokeWidth={1.75}
          className="shrink-0 transition-transform duration-200 ease-expo-out group-data-[state=open]/manual:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="select-all break-all px-3 pb-3 font-mono text-xs text-foreground">{secret}</p>
      </CollapsibleContent>
    </Collapsible>
  );
}
