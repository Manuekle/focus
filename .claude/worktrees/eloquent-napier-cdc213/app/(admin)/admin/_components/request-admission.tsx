"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardSeparator } from "@/app/_components/dashboard-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { AccessRequest } from "@/lib/access-request-types";
import type { AdminSlugCheck, AdminTenant, AdminTenantDetail } from "@/lib/admin-types";
import { useAdminLocale } from "./admin-locale";
import { useAdminHref, useAdminNow } from "./admin-shell";
import { STATUS_VARIANT, suggestSlug } from "./format";

// Admitting a beta request (POST /api/admin/requests/<id>/admit): the fleet
// creates the installation, its provisioning job builds it, and the owner
// gets the invite at the last step. Once admitted, the card follows that
// installation until its owner signs in.

export type Installation = {
  readonly configured: boolean;
  readonly detail: AdminTenantDetail | null;
  readonly error: string | null;
};

/** Statuses where the fleet is still working: the card refreshes itself. */
const IN_FLIGHT = new Set<AdminTenant["status"]>(["requested", "provisioning"]);

type Check = { state: "idle" | "checking" } | { state: "done"; result: AdminSlugCheck } | { state: "error"; message: string };
/** The fleet's last answer, for the slug it was asked about. */
type Answer = { slug: string } & ({ result: AdminSlugCheck } | { error: string });

export function RequestAdmission({ request, installation, onAdmitted }: {
  readonly request: AccessRequest;
  readonly installation: Installation;
  readonly onAdmitted: (request: AccessRequest) => void;
}) {
  return request.admission
    ? <Admitted request={request} installation={installation} />
    : <AdmitForm request={request} configured={installation.configured} onAdmitted={onAdmitted} />;
}

function AdmitForm({ request, configured, onAdmitted }: {
  readonly request: AccessRequest; readonly configured: boolean; readonly onAdmitted: (request: AccessRequest) => void;
}) {
  const router = useRouter();
  const { tr, fmt, labels } = useAdminLocale();
  const [slug, setSlug] = useState(() => suggestSlug(request.company));
  const [email, setEmail] = useState(request.email);
  const [plan, setPlan] = useState<"pro" | "managed">("pro");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalized = slug.trim().toLowerCase();
  const fleetSilent = tr("El fleet no respondió.", "The fleet did not answer.");

  useEffect(() => {
    if (!configured || !normalized) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/admin/slug?slug=${encodeURIComponent(normalized)}`, { signal: controller.signal })
        .then(async (response) => {
          const body = await response.json().catch(() => null) as (AdminSlugCheck & { message?: string }) | null;
          if (!response.ok || !body) throw new Error(body?.message ?? fleetSilent);
          setAnswer({ slug: normalized, result: body });
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) setAnswer({ slug: normalized, error: (reason as Error).message });
        });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [configured, normalized, fleetSilent]);

  const check: Check = !configured || !normalized ? { state: "idle" }
    : answer?.slug !== normalized ? { state: "checking" }
    : "result" in answer ? { state: "done", result: answer.result }
    : { state: "error", message: answer.error };

  const available = check.state === "done" && check.result.available;
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const domain = check.state === "done" ? check.result.domain : null;

  async function admit() {
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/requests/${request.id}/admit`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: normalized, email: email.trim(), plan, revision: request.revision }),
      });
      const body = await response.json().catch(() => null) as { request?: AccessRequest; message?: string } | null;
      if (!response.ok || !body?.request) {
        setError(body?.message ?? tr("No se pudo admitir. Vuelve a intentarlo: no se crea una segunda instalación.", "Could not admit it. Try again: a second install is never created."));
        setConfirming(false);
        return;
      }
      setConfirming(false);
      onAdmitted(body.request);
      router.refresh();
    } catch {
      setError(tr("No se pudo conectar. Vuelve a intentarlo: no se crea una segunda instalación.", "Could not connect. Try again: a second install is never created."));
      setConfirming(false);
    } finally { setSending(false); }
  }

  return <Card>
    <CardHeader>
      <div className="min-w-0 flex-1">
        <CardTitle as="h2">{tr("Acceso a la beta", "Beta access")}</CardTitle>
        <CardDescription>{tr("Crea su instalación con acceso beta, sin cobro. La invitación sale al terminar.", "Creates their install with beta access, free. The invitation goes out when it finishes.")}</CardDescription>
      </div>
    </CardHeader>
    <CardSeparator />
    {!configured ? <p className="p-5 text-sm text-muted-foreground">
      {tr("Falta conectar el fleet (ORUKA_FLEET_URL y ORUKA_FLEET_ADMIN_TOKEN) para crear instalaciones desde aquí.", "Connect the fleet (ORUKA_FLEET_URL and ORUKA_FLEET_ADMIN_TOKEN) to create installs from here.")}
    </p> : <form className="grid gap-4 p-5 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); if (available && emailValid) setConfirming(true); }}>
      <label className="grid gap-1.5 text-xs text-muted-foreground">{tr("Subdominio", "Subdomain")}
        <Input name="slug" value={slug} onChange={(event) => setSlug(event.target.value)} maxLength={32} autoComplete="off" spellCheck={false}
          aria-invalid={check.state === "done" && !check.result.available ? true : undefined} aria-describedby="admit-slug-status" />
        <span id="admit-slug-status" aria-live="polite" className={check.state === "done" && !check.result.available ? "text-destructive" : undefined}>
          {check.state === "checking" ? tr("Comprobando…", "Checking…")
            : check.state === "error" ? check.message
            : check.state === "done" ? (check.result.available ? `${tr("Disponible", "Available")}: ${check.result.domain}` : fmt.slugReason(check.result.reason))
            : tr("Letras minúsculas, números y guiones.", "Lowercase letters, numbers and hyphens.")}
        </span>
      </label>
      <label className="grid gap-1.5 text-xs text-muted-foreground">{tr("Email del dueño", "Owner email")}
        <Input name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={320} autoComplete="off"
          aria-invalid={!emailValid ? true : undefined} />
        <span>{tr("Recibe la invitación para elegir su contraseña.", "Gets the invitation to choose a password.")}</span>
      </label>
      <div className="grid gap-1.5 text-xs text-muted-foreground">
        <label htmlFor="admit-plan">Plan</label>
        <Select name="plan" value={plan} onValueChange={(value) => setPlan(value as "pro" | "managed")}>
          <SelectTrigger id="admit-plan" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent position="popper" align="start">
            <SelectItem value="pro">Pro</SelectItem>
            <SelectItem value="managed">Managed</SelectItem>
          </SelectContent>
        </Select>
        <span>{tr("Puedes cambiarlo después desde Clientes, sin deploy.", "You can change it later from Customers, no deploy.")}</span>
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={!available || !emailValid || sending}>{tr("Admitir y crear instalación", "Admit and create install")}</Button>
      </div>
      {error ? <div className="sm:col-span-2" aria-live="polite"><Alert tone="error">{error}</Alert></div> : null}
    </form>}
    <Dialog open={confirming} onOpenChange={(open) => { if (!open && !sending) setConfirming(false); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr(`Admitir a ${request.company}`, `Admit ${request.company}`)}</DialogTitle>
          <DialogDescription>
            {tr(
              `Se creará ${domain ?? normalized} con plan ${labels.plan[plan]} y acceso beta, sin cobro. Al terminar (unos minutos), ${email.trim().toLowerCase()} recibirá la invitación. Borrar la instalación después requiere la CLI del fleet.`,
              `This creates ${domain ?? normalized} on the ${labels.plan[plan]} plan with beta access, free. When it finishes (a few minutes), ${email.trim().toLowerCase()} gets the invitation. Deleting the install later takes the fleet CLI.`,
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" disabled={sending} onClick={() => setConfirming(false)}>{tr("Cancelar", "Cancel")}</Button>
          <Button disabled={sending} onClick={() => void admit()}>{sending ? tr("Admitiendo…", "Admitting…") : tr("Confirmar admisión", "Confirm admission")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Card>;
}

function Admitted({ request, installation }: { readonly request: AccessRequest; readonly installation: Installation }) {
  const admission = request.admission!;
  const href = useAdminHref();
  const now = useAdminNow();
  const router = useRouter();
  const { tr, fmt, labels } = useAdminLocale();
  const tenant = installation.detail?.tenant ?? null;
  const steps = installation.detail?.steps ?? [];
  const events = installation.detail?.events ?? [];
  const [inviting, setInviting] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  // While the fleet builds it, follow along without a manual refresh.
  const inFlight = tenant ? IN_FLIGHT.has(tenant.status) : false;
  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 20_000);
    return () => clearInterval(timer);
  }, [inFlight, router]);

  const owner = steps.find((step) => step.step === "owner");
  const failed = steps.find((step) => step.status === "failed");
  const reinvited = events.find((event) => event.kind === "owner.reinvited" || event.kind === "owner.reinvite_failed");
  const done = steps.filter((step) => step.status === "done").length;

  async function reinvite() {
    if (!tenant) return;
    setInviting(true);
    setFeedback(null);
    const response = await fetch(`/api/admin/tenants/${tenant.id}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reinvite" }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null) as { via?: string; message?: string } | null;
    setInviting(false);
    setFeedback(response?.ok
      ? { ok: true, message: tr(`Invitación reenviada a ${tenant.ownerEmail}${body?.via ? ` (vía ${body.via})` : ""}.`, `Invitation sent again to ${tenant.ownerEmail}${body?.via ? ` (via ${body.via})` : ""}.`) }
      : { ok: false, message: body?.message ?? tr("No se pudo reenviar la invitación.", "Could not send the invitation again.") });
    if (response?.ok) router.refresh();
  }

  const invite = !owner || owner.status === "started"
    ? tr("Se envía cuando la instalación termina.", "Sent when the install finishes.")
    : owner.status === "failed"
      ? `${tr("Falló", "Failed")}: ${owner.error ?? tr("sin detalle", "no detail")}`
      : `${tr("Enviada", "Sent")} ${fmt.dateTime(owner.updatedAt)}${typeof owner.output.via === "string" ? ` · ${tr("vía", "via")} ${owner.output.via}` : ""}`;

  return <Card>
    <CardHeader>
      <div className="min-w-0 flex-1">
        <CardTitle as="h2">{tr("Instalación", "Install")}</CardTitle>
        <CardDescription>{tr(`Admitida ${fmt.dateTime(admission.at)} por ${admission.actor}`, `Admitted ${fmt.dateTime(admission.at)} by ${admission.actor}`)}</CardDescription>
      </div>
      {tenant ? <StatusBadge status={STATUS_VARIANT[tenant.status]} label={labels.status[tenant.status]} /> : null}
    </CardHeader>
    <CardSeparator />
    <div className="space-y-4 p-5">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">{tr("Dirección", "Address")}</dt>
        <dd className="min-w-0 truncate text-right"><a href={`https://${admission.domain}`} target="_blank" rel="noreferrer" className="underline decoration-border underline-offset-4 hover:decoration-foreground">{admission.domain}</a></dd>
        <dt className="text-muted-foreground">Plan</dt>
        <dd className="text-right">{labels.plan[tenant?.effectivePlan ?? admission.plan]} · beta</dd>
        <dt className="text-muted-foreground">{tr("Dueño", "Owner")}</dt>
        <dd className="min-w-0 truncate text-right">{admission.email}</dd>
        <dt className="text-muted-foreground">{tr("Aprovisionamiento", "Provisioning")}</dt>
        <dd className="text-right">{tenant ? tr(`${done} de 8 pasos`, `${done} of 8 steps`) : "—"}</dd>
        <dt className="text-muted-foreground">{tr("Invitación", "Invitation")}</dt>
        <dd className="min-w-0 text-right">{tenant ? invite : "—"}</dd>
        {reinvited ? <>
          <dt className="text-muted-foreground">{tr("Reenvío", "Resend")}</dt>
          <dd className="text-right">{reinvited.kind === "owner.reinvited" ? tr("Reenviada", "Sent again") : tr("Falló", "Failed")} {fmt.relative(reinvited.at, now)}</dd>
        </> : null}
      </dl>
      {installation.error ? <Alert tone="warning">{tr("No se pudo leer el estado en el fleet", "Could not read the state from the fleet")}: {installation.error}</Alert> : null}
      {tenant?.status === "failed" && failed ? <Alert tone="error" title={tr(`Falló el paso ${failed.step}`, `Step ${failed.step} failed`)}>
        {failed.error ?? tr("Sin detalle.", "No detail.")} {tr("El fleet reintenta solo, con espera creciente, hasta 5 veces.", "The fleet retries on its own, backing off, up to 5 times.")}
      </Alert> : null}
      {tenant?.status === "awaiting_owner" ? <p className="text-xs text-muted-foreground">
        {tr("El enlace de la invitación vence en una hora. Si no entró a tiempo, reenvíala.", "The invitation link expires in an hour. If they missed it, send it again.")}
      </p> : null}
      {feedback ? <div aria-live="polite"><Alert tone={feedback.ok ? "success" : "error"}>{feedback.message}</Alert></div> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" asChild><Link href={href(`/tenants/${admission.tenantId}`)}>{tr("Ver cliente", "View customer")}</Link></Button>
        {tenant?.status === "awaiting_owner"
          ? <Button disabled={inviting} onClick={() => void reinvite()}>{inviting ? tr("Reenviando…", "Sending…") : tr("Reenviar invitación", "Send invitation again")}</Button>
          : null}
      </div>
    </div>
  </Card>;
}
