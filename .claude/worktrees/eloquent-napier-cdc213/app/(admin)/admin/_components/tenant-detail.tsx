"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@/components/icons/icon";
import { CancelCircleIcon, CheckmarkCircle02Icon, Clock01Icon, LinkSquare02Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import Link from "next/link";
import { Card, CardBody, CardDescription, CardHeader, CardSeparator, CardTitle } from "@/app/_components/dashboard-card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, type StatusVariant } from "@/components/ui/status-badge";
import { useToast } from "@/components/toast-provider";
import { type AdminBillingSnapshot, type AdminEvent, type AdminTenantDetail, lastDeployFailed, tickStale } from "@/lib/admin-types";
import { cn } from "@/lib/utils";
import { useAdminLocale } from "./admin-locale";
import { PageHeader, useAdminHref, useAdminNow } from "./admin-shell";
import { type InstallState, installState } from "./deploy-view";
import { CHANNEL_LABEL, STATUS_VARIANT, channelTone, formatUsd, shortSha, tickTone } from "./format";
import { type EventTone, PUSH_LABEL, describeEvent, stepLabel } from "./tenant-events";
import { TenantFeatures } from "./tenant-features";

type Tr = (es: string, en: string) => string;
type Tone = "good" | "bad" | "busy" | "wait" | "idle";

const TONE_TEXT: Record<Tone, string> = {
  good: "text-[var(--status-success-fg)]",
  bad: "text-[var(--status-failed-fg)]",
  busy: "text-[var(--status-progress-fg)]",
  wait: "text-[var(--status-pending-fg)]",
  idle: "text-muted-foreground",
};
const TONE_ICON: Record<Tone, IconSvgElement> = {
  good: CheckmarkCircle02Icon, bad: CancelCircleIcon, busy: Loading03Icon, wait: Clock01Icon, idle: Clock01Icon,
};
const INSTALL_TONE: Record<InstallState, Tone> = { current: "good", behind: "wait", updating: "busy", failed: "bad", not_deployed: "idle" };
const INSTALL_VARIANT: Record<InstallState, StatusVariant> = {
  current: "success", behind: "pending", updating: "in-progress", failed: "failed", not_deployed: "draft",
};
const EVENT_DOT: Record<EventTone, string> = { neutral: "bg-muted-foreground/40", good: "bg-[var(--status-success-fg)]", bad: "bg-[var(--status-failed-fg)]" };

export function TenantDetail({ detail, salesEnabled, productionCommit }: {
  readonly detail: AdminTenantDetail;
  readonly salesEnabled: boolean;
  /** The fleet's production commit, to say whether this install is up to date; null when unknown. */
  readonly productionCommit: string | null;
}) {
  const { tenant, steps, events } = detail;
  const beta = tenant.access === "beta" || !salesEnabled;
  const router = useRouter();
  const href = useAdminHref();
  const now = useAdminNow();
  const { tr, fmt, labels, locale } = useAdminLocale();
  const { toast } = useToast();
  const [plan, setPlan] = useState<string>(tenant.plan);
  const [busy, setBusy] = useState<"plan" | "push-config" | "reinvite" | null>(null);

  const act = async (action: "plan" | "push-config" | "reinvite") => {
    setBusy(action);
    const response = await fetch(`/api/admin/tenants/${tenant.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...(action === "plan" ? { plan } : {}) }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { push?: string; via?: string; message?: string; error?: string } | null;
    setBusy(null);
    if (!response?.ok) {
      toast({
        title: tr("No se pudo", "It didn't work"),
        description: body?.message ?? body?.error ?? tr("El fleet no respondió.", "The fleet did not answer."),
        status: "error",
      });
      return;
    }
    if (action === "reinvite") {
      toast({
        title: tr("Invitación reenviada", "Invitation sent again"),
        description: `${tenant.ownerEmail}${body?.via ? ` · ${tr("vía", "via")} ${body.via}` : ""}`,
        status: "success",
      });
      router.refresh();
      return;
    }
    const push = PUSH_LABEL[body?.push ?? "none"];
    toast({
      title: action === "plan" ? tr(`Plan cambiado a ${labels.plan[plan]}`, `Plan changed to ${labels.plan[plan]}`) : tr("Configuración reenviada", "Configuration sent again"),
      description: push ? tr(`Resultado: ${push[0]}.`, `Result: ${push[1]}.`) : body?.push,
      status: body?.push === "applied" ? "success" : "warning",
    });
    router.refresh();
  };

  const origin = `https://${tenant.domain}`;
  const completedSteps = steps.filter((step) => step.status === "done").length;
  const access = tenant.isTest ? "test" : beta ? "beta" : "subscription";

  // ── What each area says in one line, for the summary and the cards ──
  const install = installState(tenant, productionCommit);
  const installLabel: Record<InstallState, string> = {
    current: productionCommit ? tr("Al día con producción", "Up to date with production") : tr("Desplegada", "Deployed"),
    behind: tr("Versión anterior a producción", "Older than production"),
    updating: tr("Actualizando ahora", "Updating now"),
    failed: tr("Falló la última actualización", "The last update failed"),
    not_deployed: tr("Todavía sin desplegar", "Not deployed yet"),
  };
  const stale = tickStale(tenant, now);
  const tick: { tone: Tone; label: string } =
    tenant.status !== "active" && !tenant.tickSucceededAt ? { tone: "idle", label: tr("Empieza al activarse", "Starts once active") }
      : tenant.tickFailures > 0 ? { tone: "bad", label: tr(`${tenant.tickFailures} fallos seguidos`, `${tenant.tickFailures} failures in a row`) }
      : stale ? { tone: "wait", label: tr(`Sin correr ${fmt.relative(tenant.tickSucceededAt, now)}`, `Not run ${fmt.relative(tenant.tickSucceededAt, now)}`) }
      : { tone: "good", label: tr(`Corrió ${fmt.relative(tenant.tickSucceededAt, now)}`, `Ran ${fmt.relative(tenant.tickSucceededAt, now)}`) };
  const config: { tone: Tone; label: string; detail: string } = tenant.configError
    ? { tone: "bad", label: tr("Con error", "Failing"), detail: tr("El último envío falló. Revisa el error y reenvíala.", "The last push failed. Check the error and send it again.") }
    : tenant.configBehind || tenant.configAppliedVersion !== tenant.configVersion
      ? { tone: "wait", label: tr(`Pendiente: v${tenant.configVersion}`, `Pending: v${tenant.configVersion}`), detail: tr("La instalación todavía no confirmó la última versión. El fleet la reintenta cada 15 minutos; puedes reenviarla ya.", "The install has not confirmed the latest version. The fleet retries every 15 minutes; you can send it now.") }
      : { tone: "good", label: tr(`Sincronizada: v${tenant.configVersion}`, `In sync: v${tenant.configVersion}`), detail: tr("La instalación tiene la última versión. No hace falta reenviarla.", "The install has the latest version. No need to send it again.") };
  const connected = (["whatsapp", "instagram"] as const).filter((id) => tenant.channelStates?.[id]?.state === "connected").length;
  const failedChannel = (["whatsapp", "instagram"] as const).some((id) => tenant.channelStates?.[id]?.state === "failed");

  return (
    <div className="content-enter space-y-6">
      <PageHeader
        back={{ href: href(""), label: tr("Clientes", "Customers") }}
        title={tenant.slug}
        badges={
          <>
            <StatusBadge status={STATUS_VARIANT[tenant.status]} label={labels.status[tenant.status]} />
            <StatusBadge status={tenant.isTest ? "draft" : beta ? "in-progress" : "active"} label={labels.access[access]} />
          </>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <a href={origin} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
              {tenant.domain}
              <HugeiconsIcon icon={LinkSquare02Icon} size={12} strokeWidth={1.75} />
            </a>
            <a href={`mailto:${tenant.ownerEmail}`} className="hover:text-foreground">
              {tenant.ownerEmail}
            </a>
            <span>
              {tr("Alta", "Created")} {fmt.dateTime(tenant.createdAt)}
            </span>
          </span>
        }
      />

      <Card>
        <dl className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4" aria-label={tr("Resumen", "Summary")}>
          <Summary label={tr("Versión instalada", "Installed version")} value={shortSha(tenant.deployingCommit ?? tenant.deployedCommit)} mono tone={INSTALL_TONE[install]} status={installLabel[install]} />
          <Summary label={tr("Tareas programadas", "Scheduled work")} value={tick.label} tone={tick.tone} status={tr("Cada 15 minutos", "Every 15 minutes")} />
          <Summary label={tr("Configuración en vivo", "Live configuration")} value={config.label} tone={config.tone} status={tenant.configAppliedAt ? tr(`Confirmada ${fmt.relative(tenant.configAppliedAt, now)}`, `Confirmed ${fmt.relative(tenant.configAppliedAt, now)}`) : tr("Nunca confirmada", "Never confirmed")} />
          <Summary label={tr("Canales", "Channels")} value={tr(`${connected} de 2 conectados`, `${connected} of 2 connected`)} tone={failedChannel ? "bad" : connected ? "good" : "idle"} status={`${tr("Reportado", "Reported")} ${fmt.relative(tenant.channelStatesAt, now)}`} />
        </dl>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Section
          title="Plan"
          description={
            tenant.isTest
              ? tr("Instalación de prueba: no cuenta como ingresos", "Test install: not counted as revenue")
              : beta
                ? tr("Beta privada: el plan no se cobra", "Private beta: the plan is not billed")
                : tr("Suscripción registrada en Stripe", "Subscription recorded in Stripe")
          }
        >
          <p className="font-heading text-2xl font-medium tracking-[-0.02em]">{labels.plan[tenant.effectivePlan]}</p>
          <Facts
            rows={[
              [tr("Plan vendido", "Plan sold"), labels.plan[tenant.plan]],
              [tr("Estado en Stripe", "Stripe status"), tenant.billingStatus ?? "—"],
              ...billingRows(tenant.billingSnapshot ?? null, tr, fmt),
              [tr("Cliente Stripe", "Stripe customer"), tenant.stripeCustomerId, true],
              [tr("Suscripción", "Subscription"), tenant.stripeSubscriptionId, true],
            ]}
          />
          {tenant.access === "beta" ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <Select value={plan} onValueChange={setPlan}>
                <SelectTrigger aria-label="Plan" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="managed">Managed</SelectItem>
                </SelectContent>
              </Select>
              <Button disabled={busy !== null || plan === tenant.effectivePlan} onClick={() => void act("plan")}>
                {busy === "plan" ? tr("Aplicando…", "Applying…") : tr("Cambiar plan", "Change plan")}
              </Button>
              <p className="w-full text-xs text-muted-foreground">
                {tr(
                  "Elige otro plan y aplícalo: llega a la instalación en segundos, sin desplegar.",
                  "Pick another plan and apply it: it reaches the install in seconds, without a deploy.",
                )}
              </p>
            </div>
          ) : (
            <p className="border-t border-border pt-4 text-xs text-muted-foreground">
              {tr(
                "El plan de un cliente que paga lo decide su suscripción: cámbialo desde Stripe.",
                "A paying customer's plan follows their subscription: change it in Stripe.",
              )}
            </p>
          )}
        </Section>

        <Section
          title={tr("Configuración en vivo", "Live configuration")}
          description={tr(
            "El plan, los anuncios y los ajustes que el fleet le envía a la instalación sin volver a desplegarla",
            "The plan, announcements and settings the fleet sends to the install without redeploying it",
          )}
        >
          <p className={cn("inline-flex items-center gap-1.5 text-sm font-medium", TONE_TEXT[config.tone])}>
            <HugeiconsIcon icon={TONE_ICON[config.tone]} size={16} strokeWidth={1.75} />
            {config.label}
          </p>
          <Facts
            rows={[
              [tr("Última versión enviada", "Latest version sent"), `v${tenant.configVersion}`],
              [
                tr("Confirmada por la instalación", "Confirmed by the install"),
                tenant.configAppliedVersion === null
                  ? tr("nunca", "never")
                  : `v${tenant.configAppliedVersion} · ${fmt.relative(tenant.configAppliedAt, now)}`,
              ],
              ...(tenant.configError ? ([[tr("Error", "Error"), <span key="error" className="text-[var(--status-failed-fg)]">{tenant.configError}</span>]] as const) : []),
            ]}
          />
          <div className="space-y-2 border-t border-border pt-4">
            <Button variant={config.tone === "good" ? "secondary" : "default"} disabled={busy !== null} onClick={() => void act("push-config")}>
              {busy === "push-config" ? tr("Enviando…", "Sending…") : tr("Reenviar configuración", "Send configuration again")}
            </Button>
            <p className="text-xs text-muted-foreground text-pretty">
              {config.detail}{" "}
              {tr("Reenviar no despliega ni reinicia nada.", "Sending it again neither deploys nor restarts anything.")}
            </p>
          </div>
        </Section>

        <TenantFeatures tenant={tenant} />

        <Section title={tr("Versión instalada", "Installed version")} description={tr("El código que corre en esta instalación", "The code this install runs")}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="font-mono text-lg tracking-[-0.01em]">{shortSha(tenant.deployedCommit)}</p>
            <StatusBadge status={INSTALL_VARIANT[install]} label={installLabel[install]} />
          </div>
          <Facts
            rows={[
              [tr("Desde", "Since"), fmt.relative(tenant.deployedAt, now)],
              [tr("Producción", "Production"), productionCommit ? shortSha(productionCommit) : null, true],
              [tr("Anterior", "Previous"), tenant.previousCommit ? shortSha(tenant.previousCommit) : null, true],
              ...(tenant.deployingCommit
                ? ([[tr("Instalando", "Installing"), `${shortSha(tenant.deployingCommit)} · ${tr("desde", "since")} ${fmt.relative(tenant.deployingSince, now)}`, true]] as const)
                : []),
            ]}
          />
          {lastDeployFailed(tenant) ? (
            <p className="text-xs text-[var(--status-failed-fg)]">
              {tr(
                `La instalación de ${shortSha(tenant.deployFailedCommit)} falló ${fmt.relative(tenant.deployFailedAt, now)}${tenant.deployFailedLive ? " y quedó en vivo" : ""}: ${tenant.deployError ?? "sin detalle"}`,
                `Installing ${shortSha(tenant.deployFailedCommit)} failed ${fmt.relative(tenant.deployFailedAt, now)}${tenant.deployFailedLive ? " and was left live" : ""}: ${tenant.deployError ?? "no detail"}`,
              )}
            </p>
          ) : null}
          <p className="border-t border-border pt-4 text-xs text-muted-foreground">
            {tr("Las versiones nuevas se publican desde", "New versions ship from")}{" "}
            <Link className="underline underline-offset-4 hover:text-foreground" href={href("/deployments")}>{tr("Despliegues", "Deployments")}</Link>
            {tr(", para todas las instalaciones a la vez.", ", for every install at once.")}
          </p>
        </Section>

        <Section
          title={tr("Tareas programadas", "Scheduled work")}
          description={tr(
            "Cada 15 minutos el fleet llama a la instalación para correr recordatorios, seguimientos y automatizaciones",
            "Every 15 minutes the fleet calls the install to run reminders, follow-ups and automations",
          )}
        >
          <Facts
            rows={[
              [
                tr("Última vez que corrió bien", "Last good run"),
                <span key="tick" className={tickTone(tenant, now)} title={fmt.dateTime(tenant.tickSucceededAt)}>
                  {fmt.relative(tenant.tickSucceededAt, now)}
                </span>,
              ],
              [tr("Último intento", "Last attempt"), fmt.relative(tenant.tickAttemptedAt, now)],
              [tr("Fallos seguidos", "Failures in a row"), fmt.number(tenant.tickFailures)],
              [tr("Último error", "Last error"), tenant.tickError ?? "—"],
            ]}
          />
          {tenant.tickFailures > 0 || stale ? (
            <p className="text-xs text-[var(--status-failed-fg)]">
              {tr(
                "Mientras no corra, los recordatorios y las automatizaciones de este cliente llegan tarde.",
                "Until it runs, this customer's reminders and automations are late.",
              )}
            </p>
          ) : null}
        </Section>

        <Section title={tr("Canales", "Channels")} description={`${tr("Reportado", "Reported")} ${fmt.relative(tenant.channelStatesAt, now)}`}>
          <ul className="space-y-2">
            {(["whatsapp", "instagram"] as const).map((id) => {
              const state = tenant.channelStates?.[id];
              return (
                <li key={id} className="flex items-start gap-2.5 text-sm">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", channelTone(state?.state))} />
                  <div className="min-w-0">
                    <p>
                      {CHANNEL_LABEL[id]}{" "}
                      <span className="text-muted-foreground">· {labels.channelState[state?.state ?? "disconnected"] ?? state?.state}</span>
                    </p>
                    {state?.message ? <p className="text-xs text-muted-foreground">{state.message}</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-border pt-4 text-xs text-muted-foreground">
            {tr("El dueño los conecta desde su instalación, en Configuración → Canales.", "The owner connects them from their install, in Settings → Channels.")}
          </p>
        </Section>

        <Section
          title={tr("Uso de IA · 30 días", "AI usage · 30 days")}
          description={
            tenant.usage
              ? `${tr("Reportado", "Reported")} ${fmt.relative(tenant.usageAt, now)}`
              : tr("La instalación todavía no reportó uso", "The install has not reported usage yet")
          }
        >
          {tenant.usage ? (
            <div className="grid grid-cols-2 gap-3">
              <Metric label={tr("Créditos", "Credits")} value={fmt.number(tenant.usage.credits)} />
              <Metric label={tr("Llamadas", "Calls")} value={fmt.number(tenant.usage.calls)} />
              <Metric label={tr("Costo de proveedores", "Provider cost")} value={formatUsd(tenant.usage.providerCost)} />
              <Metric label={tr("Pagado por Oruka", "Paid by Oruka")} value={formatUsd(tenant.usage.includedCost)} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {tr("Aparece con la próxima tarea programada que lo reporte.", "Shows up with the next scheduled run that reports it.")}
            </p>
          )}
        </Section>

        <Section
          title={tr("Aprovisionamiento", "Provisioning")}
          description={tr(`${completedSteps} de ${steps.length} pasos completos al crear la instalación`, `${completedSteps} of ${steps.length} steps done when the install was created`)}
        >
          {steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tr("Sin pasos registrados.", "No steps recorded.")}</p>
          ) : (
            <ul className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
              {steps.map((step) => {
                const tone: Tone = step.status === "done" ? "good" : step.status === "failed" ? "bad" : "wait";
                return (
                  <li key={step.step} className="flex min-w-0 items-center gap-2" title={step.error ?? `${step.step} · ${fmt.dateTime(step.updatedAt)}`}>
                    <HugeiconsIcon icon={TONE_ICON[tone]} size={14} strokeWidth={1.75} className={cn("shrink-0", TONE_TEXT[tone])} />
                    <span className="truncate">{stepLabel(step.step, locale)}</span>
                    {step.attempts > 1 ? <span className="shrink-0 text-xs text-muted-foreground">{tr(`${step.attempts} intentos`, `${step.attempts} attempts`)}</span> : null}
                  </li>
                );
              })}
            </ul>
          )}
          {tenant.status === "awaiting_owner" ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-4">
              <Button variant="secondary" disabled={busy !== null} onClick={() => void act("reinvite")}>
                {busy === "reinvite" ? tr("Reenviando…", "Sending…") : tr("Reenviar invitación", "Send invitation again")}
              </Button>
              <p className="text-xs text-muted-foreground">
                {tr("El dueño todavía no entró. El enlace vence en una hora.", "The owner has not signed in yet. The link expires in an hour.")}
              </p>
            </div>
          ) : null}
        </Section>

        <Section title={tr("Infraestructura", "Infrastructure")} description={tr("Ids para buscar en Vercel y Neon", "Ids to look up in Vercel and Neon")}>
          <Facts
            rows={[
              ["Tenant", tenant.id, true],
              [tr("Proyecto Vercel", "Vercel project"), tenant.vercelProjectId, true],
              ["Deployment", tenant.deploymentId, true],
              [tr("Proyecto Neon", "Neon project"), tenant.neonProjectId, true],
              tenant.requestId
                ? [
                    tr("Origen", "Origin"),
                    <Link
                      key="request"
                      href={href(`/requests/${tenant.requestId}`)}
                      className="underline decoration-border underline-offset-4 hover:decoration-foreground"
                    >
                      {tr("solicitud admitida", "admitted request")}
                    </Link>,
                  ]
                : ["Checkout", tenant.checkoutSessionId ?? tr("creado por el operador", "created by the operator"), Boolean(tenant.checkoutSessionId)],
              [tr("Actualizado", "Updated"), fmt.dateTime(tenant.updatedAt)],
            ]}
          />
        </Section>
      </div>

      <Card>
        <CardHeader>
          <div className="min-w-0 flex-1">
            <CardTitle>{tr("Historial", "History")}</CardTitle>
            <CardDescription>{tr("Lo que le pasó a esta instalación, lo más nuevo primero", "What happened to this install, newest first")}</CardDescription>
          </div>
        </CardHeader>
        <CardSeparator />
        {events.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{tr("Sin eventos.", "No events.")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** What Stripe bills, from the fleet's snapshot: only shown once a subscription synced. */
function billingRows(
  snapshot: AdminBillingSnapshot | null,
  tr: Tr,
  fmt: { money: (value: number, currency: string) => string; date: (iso: string | null) => string },
): Fact[] {
  if (!snapshot) return [];
  const currency = snapshot.currency ?? "usd";
  const amount = `${fmt.money(snapshot.monthlyAmount / 100, currency)}${tr("/mes", "/mo")}`;
  const list =
    snapshot.monthlyListAmount !== snapshot.monthlyAmount
      ? ` (${tr("lista", "list")} ${fmt.money(snapshot.monthlyListAmount / 100, currency)})`
      : "";
  const end = snapshot.currentPeriodEnd ? fmt.date(new Date(snapshot.currentPeriodEnd * 1000).toISOString()) : "—";
  return [
    [tr("Importe recurrente", "Recurring amount"), `${amount}${list}`],
    [tr("Modo", "Mode"), snapshot.livemode ? tr("real", "live") : tr("prueba (sandbox): no es ingreso", "test (sandbox): not revenue")],
    [snapshot.cancelAtPeriodEnd ? tr("Cancela el", "Cancels on") : tr("Renueva el", "Renews on"), end],
  ];
}

function Summary({ label, value, status, tone, mono = false }: {
  readonly label: string;
  readonly value: string;
  readonly status: string;
  readonly tone: Tone;
  readonly mono?: boolean;
}) {
  return (
    <div className="min-w-0 bg-card px-5 py-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 space-y-0.5">
        <p className={cn("flex min-w-0 items-start gap-1.5 text-sm font-medium", mono && "font-mono")}>
          <HugeiconsIcon icon={TONE_ICON[tone]} size={14} strokeWidth={1.75} className={cn("mt-[3px] shrink-0", TONE_TEXT[tone], tone === "busy" && "animate-spin motion-reduce:animate-none")} />
          <span className="min-w-0 break-words">{value}</span>
        </p>
        <p className="text-xs text-muted-foreground">{status}</p>
      </dd>
    </div>
  );
}

function Section({ title, description, children }: { readonly title: string; readonly description: string; readonly children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0 flex-1">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardSeparator />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

/** Label, value, and whether the value is an id (monospace); a missing value is a plain dash. */
type Fact = readonly [label: string, value: ReactNode, mono?: boolean];

function Facts({ rows }: { readonly rows: readonly Fact[] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([label, value, mono]) => {
        const empty = value === null || value === undefined || value === "" || value === "—";
        return (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd
              className={cn("min-w-0 truncate text-right", mono && !empty && "font-mono text-xs leading-5", empty && "text-muted-foreground")}
              title={typeof value === "string" ? value : undefined}
            >
              {empty ? "—" : value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}

function EventRow({ event }: { readonly event: AdminEvent }) {
  const now = useAdminNow();
  const { fmt, locale } = useAdminLocale();
  const line = describeEvent(event, locale);
  return (
    <li className="flex items-start gap-3 px-5 py-2.5" title={event.kind}>
      <span className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", EVENT_DOT[line.tone])} />
      <div className="min-w-0 flex-1">
        <p className="text-sm">{line.title}</p>
        {line.detail ? <p className="truncate text-xs text-muted-foreground" title={line.detail}>{line.detail}</p> : null}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground" title={fmt.dateTime(event.at)}>
        {fmt.relative(event.at, now)}
      </span>
    </li>
  );
}
