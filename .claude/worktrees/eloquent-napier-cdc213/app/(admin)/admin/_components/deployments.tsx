"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  ArrowTurnBackwardIcon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  LinkSquare02Icon,
  Loading03Icon,
  Rocket01Icon,
  SecurityCheckIcon,
  TestTube01Icon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, CardSeparator, CardTitle, CardDescription } from "@/app/_components/dashboard-card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { StatusBadge, type StatusVariant } from "@/components/ui/status-badge";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import { type AdminDeployments, type AdminOverview, type AdminTenant, lastDeployFailed } from "@/lib/admin-types";
import { cn } from "@/lib/utils";
import { ProductFigure } from "@/components/hairline/product-figure";
import { useAdminLocale } from "./admin-locale";
import { PageHeader, useAdminHref, useAdminNow } from "./admin-shell";
import { releaseVariant, shortSha } from "./format";
import { type CommitKind, type InstallState, commitSummary, deployState, installState, installsBehind, parseRunTitle, releaseInstalls } from "./deploy-view";

// The operator's release desk. It answers, top to bottom: what is going on
// and what to press (one sentence, one button); the path every release takes
// (main's checks → the test install → customers); what the new version
// brings; where each install stands; and what happened before.

type Action = "deploy" | "rollback";
type Tone = "good" | "bad" | "busy" | "wait" | "idle";

const TONE_TEXT: Record<Tone, string> = {
  good: "text-[var(--status-success-fg)]",
  bad: "text-[var(--status-failed-fg)]",
  busy: "text-[var(--status-progress-fg)]",
  wait: "text-[var(--status-pending-fg)]",
  idle: "text-muted-foreground",
};
const TONE_SURFACE: Record<Tone, string> = {
  good: "tone-pill tone-success",
  bad: "tone-pill tone-failed",
  busy: "tone-pill tone-progress",
  wait: "tone-pill tone-pending",
  idle: "tone-pill tone-expired",
};
const TONE_ICON: Record<Tone, IconSvgElement> = {
  good: CheckmarkCircle02Icon, bad: CancelCircleIcon, busy: Loading03Icon, wait: Clock01Icon, idle: Clock01Icon,
};
const INSTALL_VARIANT: Record<InstallState, StatusVariant> = {
  current: "success", behind: "pending", updating: "in-progress", failed: "failed", not_deployed: "draft",
};

export function Deployments({ deployment, overview }: { readonly deployment: AdminDeployments; readonly overview: AdminOverview }) {
  const router = useRouter();
  const href = useAdminHref();
  const now = useAdminNow();
  const { tr, fmt, labels } = useAdminLocale();
  const [refreshing, refresh] = useTransition();
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [sending, setSending] = useState(false);
  const [requested, setRequested] = useState<{ url: string; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<"releases" | "runs">("releases");

  const requestUnseen = requested && !deployment.runs.some(run => run.url === requested.url);
  const requestPending = Boolean(requestUnseen && Date.parse(overview.generatedAt) - requested.at < 60_000);
  const state = requestPending
    ? { kind: "running" as const, stage: "checking" as const, sha: deployment.main.sha, runUrl: requested?.url ?? null, rollback: false }
    : deployState(deployment, overview.releases, installsBehind(overview.tenants, deployment.productionCommit));
  const busy = state.kind === "running" || sending;
  const passed = deployment.ci.status === "completed" && deployment.ci.conclusion === "success";
  const production = deployment.productionCommit;
  const sha = confirm === "rollback" ? deployment.rollbackCommit : deployment.main.sha;

  const installs = releaseInstalls(overview.tenants);
  const test = installs.find(tenant => tenant.slug === deployment.test) ?? null;
  const customers = installs.filter(tenant => !tenant.isTest);
  const customersCount = fmt.count(deployment.customers, ["cliente", "clientes"], ["customer", "customers"]);
  const pending = deployment.pending ?? null;
  const productionRelease = overview.releases.find(release => release.sha === production && release.promotedAt);
  const compareUrl = production ? `https://github.com/${deployment.appRepo}/compare/${production}...${deployment.main.sha}` : deployment.main.url;
  const ciUrl = deployment.ci.url ?? undefined;

  // The newest request failed and nothing reached the fleet after it.
  const lastRun = deployment.runs[0];
  const lastRelease = overview.releases[0];
  const lastRunFailed = state.kind !== "running" && state.kind !== "up_to_date" && lastRun?.status === "completed" && lastRun.conclusion === "failure"
    && (!lastRelease || Date.parse(lastRun.createdAt) > Date.parse(lastRelease.createdAt));

  // A running deployment is independent of the tab; refresh only its view.
  useEffect(() => {
    if (!deployment.busy && !requestPending) return;
    const timer = setInterval(() => refresh(() => router.refresh()), 15_000);
    return () => clearInterval(timer);
  }, [deployment.busy, requestPending, router]);

  async function publish() {
    if (!confirm || !sha) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/deployments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: confirm, sha }) });
      const body = await response.json().catch(() => null) as { url?: string; message?: string } | null;
      if (!response.ok || !body?.url) {
        throw new Error(body?.message ?? tr(
          "No se pudo solicitar el despliegue. Actualiza el estado antes de reintentar.",
          "The deploy could not be requested. Refresh the status before trying again.",
        ));
      }
      setRequested({ url: body.url, at: Date.now() });
      setConfirm(null);
      refresh(() => router.refresh());
    } catch (failure) {
      setError((failure as Error).message);
      setConfirm(null);
      refresh(() => router.refresh());
    } finally { setSending(false); }
  }

  // ── 1. What is going on, and the one thing to press ─────────────────
  const newCount = pending ? fmt.count(pending.aheadBy, ["cambio", "cambios"], ["change", "changes"]) : null;
  const hero: { tone: Tone; title: string; body: ReactNode; action: ReactNode } = (() => {
    switch (state.kind) {
      case "running": {
        const what = shortSha(state.sha);
        const title = state.rollback
          ? tr(`Volviendo a ${what}`, `Rolling back to ${what}`)
          : state.stage === "checking" ? tr(`Preparando la publicación de ${what}`, `Preparing to ship ${what}`)
          : state.stage === "testing" ? tr(`Verificando ${what} en ${deployment.test}`, `Checking ${what} on ${deployment.test}`)
          : tr(`Actualizando clientes a ${what}`, `Updating customers to ${what}`);
        return {
          tone: "busy", title,
          body: tr(
            "Puedes cerrar esta página: la publicación sigue en GitHub. El estado se actualiza solo cada 15 segundos.",
            "You can close this page: the rollout keeps going on GitHub. The status refreshes itself every 15 seconds.",
          ),
          action: state.runUrl ? <ExternalButton href={state.runUrl}>{tr("Ver en GitHub", "View on GitHub")}</ExternalButton> : null,
        };
      }
      case "no_test":
        return {
          tone: "bad", title: tr("Falta la instalación de prueba", "The test install is missing"),
          body: tr(
            "Sin una instalación de prueba lista no hay dónde verificar una versión antes de tus clientes. Crea o reactiva una marcada como prueba.",
            "Without a ready test install there is nowhere to check a version before your customers. Create or reactivate one marked as test.",
          ),
          action: null,
        };
      case "up_to_date":
        return {
          tone: "good", title: tr("Todo al día", "Everything is up to date"),
          body: deployment.customers
            ? tr(`${deployment.test} y tus ${customersCount} tienen la última versión de main (${shortSha(production)}).`, `${deployment.test} and your ${customersCount} run main's latest version (${shortSha(production)}).`)
            : tr(`${deployment.test} tiene la última versión de main (${shortSha(production)}). Todavía no hay clientes.`, `${deployment.test} runs main's latest version (${shortSha(production)}). No customers yet.`),
          action: null,
        };
      case "partial":
        return {
          tone: "wait",
          title: state.behind === 1
            ? tr("Falta una instalación por actualizar", "One install is still behind")
            : tr(`Faltan ${state.behind} instalaciones por actualizar`, `${state.behind} installs are still behind`),
          body: tr(
            `Main ya está en producción (${shortSha(production)}), pero no llegó a todas. Volver a publicarla actualiza solo las que faltan; revisa abajo cuáles son.`,
            `Main is already in production (${shortSha(production)}), but it did not reach every install. Shipping it again updates only the ones missing; see which below.`,
          ),
          action: (
            <Button disabled={busy || !passed} onClick={() => { setError(null); setConfirm("deploy"); }}>
              <HugeiconsIcon icon={Rocket01Icon} size={16} strokeWidth={1.75} />
              {tr("Actualizar las que faltan", "Update the missing ones")}
            </Button>
          ),
        };
      case "ci_failed":
        return {
          tone: "bad", title: tr("Main no pasó las comprobaciones", "Main failed its checks"),
          body: tr(
            `Arregla el error en main antes de publicar. Tus clientes siguen en ${shortSha(production)}, sin cambios.`,
            `Fix the error on main before shipping. Your customers stay on ${shortSha(production)}, unchanged.`,
          ),
          action: ciUrl ? <ExternalButton href={ciUrl}>{tr("Ver el error", "See the error")}</ExternalButton> : null,
        };
      case "ci_running":
        return {
          tone: "wait", title: tr("Esperando las comprobaciones de main", "Waiting for main's checks"),
          body: tr(
            `GitHub está revisando ${shortSha(deployment.main.sha)} (tests, lint y build). Cuando terminen bien podrás publicarla; tarda unos 5 minutos.`,
            `GitHub is checking ${shortSha(deployment.main.sha)} (tests, lint and build). Once they pass you can ship it; it takes about 5 minutes.`,
          ),
          action: <Button disabled>{tr("Publicar versión nueva", "Ship new version")}</Button>,
        };
      case "ready":
        return {
          tone: "good", title: tr("Hay una versión nueva lista para publicar", "A new version is ready to ship"),
          body: tr(
            `${!pending ? "Main pasó las comprobaciones" : pending.aheadBy === 1 ? "El cambio nuevo de main pasó las comprobaciones" : `Los ${fmt.number(pending.aheadBy)} cambios nuevos de main pasaron las comprobaciones`}. Tus clientes siguen en ${shortSha(production)} hasta que la publiques.`,
            `${!pending ? "Main passed its checks" : pending.aheadBy === 1 ? "Main's new change passed its checks" : `Main's ${fmt.number(pending.aheadBy)} new changes passed their checks`}. Your customers stay on ${shortSha(production)} until you ship it.`,
          ),
          action: (
            <Button disabled={busy} onClick={() => { setError(null); setConfirm("deploy"); }}>
              <HugeiconsIcon icon={Rocket01Icon} size={16} strokeWidth={1.75} />
              {tr("Publicar versión nueva", "Ship new version")}
            </Button>
          ),
        };
    }
  })();

  // ── 2. The path every release takes ─────────────────────────────────
  const testState = test ? installState(test, production) : null;
  const ciStep: Step = {
    icon: SecurityCheckIcon,
    title: tr("Comprobaciones de main", "Main's checks"),
    body: tr("GitHub corre tests, lint y build sobre el último commit de main.", "GitHub runs tests, lint and build on main's latest commit."),
    tone: passed ? "good" : deployment.ci.status === "completed" ? "bad" : "wait",
    status: passed ? tr("Aprobadas", "Passed") : deployment.ci.status === "completed" ? tr("Fallaron", "Failed") : tr("En curso", "Running"),
    link: ciUrl ? { href: ciUrl, label: tr("Ver comprobaciones", "View checks") } : null,
  };
  const testStep: Step = {
    icon: TestTube01Icon,
    title: tr("Instalación de prueba", "Test install"),
    body: tr(
      `${test?.domain ?? "La instalación de prueba"} se actualiza primero y se verifica: salud, inicio de sesión, configuración y canales.`,
      `${test?.domain ?? "The test install"} updates first and gets checked: health, sign-in, configuration and channels.`,
    ),
    ...(state.kind === "running" && state.stage === "testing" || testState === "updating"
      ? { tone: "busy" as const, status: tr("Verificando ahora", "Checking now") }
      : testState === "failed" ? { tone: "bad" as const, status: tr("La última verificación falló", "The last check failed") }
      : test && test.deployedCommit === deployment.main.sha ? { tone: "good" as const, status: tr("Tiene la última versión", "Runs the latest version") }
      : test ? { tone: "idle" as const, status: tr(`Hoy en ${shortSha(test.deployedCommit)}; recibe la nueva primero`, `On ${shortSha(test.deployedCommit)} today; gets the new one first`) }
      : { tone: "bad" as const, status: tr("No hay", "Missing") }),
    link: test ? { href: href(`/tenants/${test.id}`), label: tr("Abrir", "Open"), internal: true } : null,
  };
  const current = customers.filter(tenant => installState(tenant, production) === "current").length;
  const customersStep: Step = {
    icon: UserMultipleIcon,
    title: tr("Clientes", "Customers"),
    body: tr(
      "Solo si prueba pasa. Se actualizan de a 3; si uno falla, los siguientes no empiezan.",
      "Only if the test passes. They update 3 at a time; if one fails, the next ones don't start.",
    ),
    ...(!customers.length ? { tone: "idle" as const, status: tr("Todavía no hay clientes", "No customers yet") }
      : state.kind === "running" && state.stage === "rolling_out" ? { tone: "busy" as const, status: tr(`${current} de ${customers.length} actualizados`, `${current} of ${customers.length} updated`) }
      : customers.some(tenant => lastDeployFailed(tenant)) ? { tone: "bad" as const, status: tr("Alguno falló: revisa Instalaciones", "One failed: see Installs") }
      : { tone: current === customers.length ? "good" as const : "idle" as const, status: tr(`${current} de ${customers.length} con la versión de producción`, `${current} of ${customers.length} on the production version`) }),
    link: null,
  };

  const runLabel = (operation: string) =>
    operation === "rollback" ? tr("Volver atrás", "Roll back") : operation === "plan" ? tr("Simulación", "Dry run") : tr("Publicar", "Ship");

  return (
    <div className="content-enter space-y-6">
      <PageHeader
        title={tr("Despliegues", "Deployments")}
        description={tr(
          "Lleva la última versión de main a tu instalación de prueba y, si pasa la verificación, a tus clientes.",
          "Take main's latest version to your test install and, if it passes the check, to your customers.",
        )}
        actions={
          <Button variant="secondary" size="sm" disabled={refreshing} onClick={() => refresh(() => router.refresh())}>
            <HugeiconsIcon icon={Loading03Icon} size={14} strokeWidth={1.75} className={cn(refreshing && "animate-spin")} />
            {tr("Actualizar estado", "Refresh status")}
          </Button>
        }
      />

      {error ? <div role="alert"><Alert tone="error" title={tr("No se pudo desplegar", "Deploy failed")}>{error}</Alert></div> : null}
      {requestUnseen && !requestPending && requested ? (
        <Alert tone="warning" title={tr("Revisa la ejecución en GitHub", "Check the run on GitHub")}>
          {tr("No pudimos confirmar su estado.", "We could not confirm its status.")}{" "}
          <a className="underline underline-offset-4" href={requested.url} target="_blank" rel="noopener noreferrer">{tr("Verifica la solicitud", "Check the request")}</a>{" "}
          {tr("antes de volver a desplegar.", "before deploying again.")}
        </Alert>
      ) : null}

      <Card>
        <div role="status" className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <span className={cn("grid size-10 shrink-0 place-items-center rounded-full", TONE_SURFACE[hero.tone])}>
            <HugeiconsIcon icon={TONE_ICON[hero.tone]} size={20} strokeWidth={1.75} className={cn(hero.tone === "busy" && "animate-spin motion-reduce:animate-none")} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-medium tracking-[-0.01em] text-balance">{hero.title}</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground text-pretty">{hero.body}</p>
            {lastRunFailed && lastRun ? (
              <p className="mt-2 text-xs text-[var(--status-failed-fg)]">
                {tr("El último intento falló", "The last attempt failed")} {fmt.relative(lastRun.createdAt, now)}.{" "}
                <a className="underline underline-offset-4" href={lastRun.url} target="_blank" rel="noopener noreferrer">{tr("Ver el registro", "See the log")}</a>
              </p>
            ) : null}
          </div>
          {hero.action ? <div className="flex shrink-0 flex-wrap gap-2">{hero.action}</div> : null}
        </div>
        <CardSeparator />
        <ol className="grid gap-px bg-border sm:grid-cols-3" aria-label={tr("Cómo se publica una versión", "How a version ships")}>
          {[ciStep, testStep, customersStep].map((step, index) => (
            <PipelineStep key={step.title} step={step} index={index + 1} />
          ))}
        </ol>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <div className="min-w-0 flex-1">
              <CardTitle as="h2">{tr("Qué trae la versión nueva", "What the new version brings")}</CardTitle>
              <CardDescription>
                {state.kind === "up_to_date" || state.kind === "partial"
                  ? tr("Main y producción son la misma versión.", "Main and production are the same version.")
                  : pending
                    ? tr(`${newCount} en main desde ${shortSha(production)}, lo más nuevo primero`, `${newCount} on main since ${shortSha(production)}, newest first`)
                    : tr("El último commit de main", "Main's latest commit")}
              </CardDescription>
            </div>
            <a className="inline-flex shrink-0 items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground" href={deployment.main.url} target="_blank" rel="noopener noreferrer">
              main · {shortSha(deployment.main.sha)}
              <HugeiconsIcon icon={LinkSquare02Icon} size={12} strokeWidth={1.75} />
            </a>
          </CardHeader>
          <CardSeparator />
          {state.kind === "up_to_date" || state.kind === "partial" ? (
            <div className="flex flex-col items-center gap-3 px-5 py-6 text-center">
              <ProductFigure kind="empty-archive" className="w-36" />
              <p className="text-sm text-muted-foreground">{tr("No hay cambios nuevos para publicar.", "There are no new changes to ship.")}</p>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-border">
                {(pending?.commits.length ? pending.commits : [{ ...deployment.main }]).map(commit => (
                  <CommitRow key={commit.sha} commit={commit} relative={fmt.relative(commit.date, now)} />
                ))}
              </ul>
              {pending && pending.aheadBy > pending.commits.length ? (
                <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
                  {tr(`Y ${pending.aheadBy - pending.commits.length} más.`, `And ${pending.aheadBy - pending.commits.length} more.`)}{" "}
                  <a className="underline underline-offset-4 hover:text-foreground" href={compareUrl} target="_blank" rel="noopener noreferrer">{tr("Ver todo en GitHub", "See them all on GitHub")}</a>
                </p>
              ) : null}
            </>
          )}
        </Card>

        <Card>
          <CardHeader>
            <div className="min-w-0 flex-1">
              <CardTitle as="h2">{tr("En producción", "In production")}</CardTitle>
              <CardDescription>{tr("Lo que tienen tus clientes y desde donde arrancan las instalaciones nuevas", "What your customers run, and what new installs start from")}</CardDescription>
            </div>
          </CardHeader>
          <CardSeparator />
          <CardBody>
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-lg tracking-[-0.01em]">{shortSha(production)}</p>
                <p className="text-xs text-muted-foreground">
                  {productionRelease
                    ? tr(`Publicada ${fmt.relative(productionRelease.promotedAt, now)} · release #${productionRelease.id}`, `Shipped ${fmt.relative(productionRelease.promotedAt, now)} · release #${productionRelease.id}`)
                    : tr("Sin release registrado", "No release recorded")}
                </p>
              </div>
              <ProductFigure kind="rack" className="w-24 shrink-0" />
            </div>
            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-sm font-medium">{tr("¿La versión publicada da problemas?", "Is the shipped version misbehaving?")}</p>
              <p className="text-xs text-muted-foreground text-pretty">
                {deployment.rollbackCommit
                  ? tr(
                    `Vuelve a la anterior, ${shortSha(deployment.rollbackCommit)}. Pasa por prueba igual que una versión nueva y después llega a tus clientes.`,
                    `Go back to the previous one, ${shortSha(deployment.rollbackCommit)}. It goes through the test install like a new version, then reaches your customers.`,
                  )
                  : tr("Todavía no hay una versión anterior a la que volver.", "There is no previous version to go back to yet.")}
              </p>
              <Button variant="secondary" disabled={busy || !deployment.rollbackCommit || !deployment.test} onClick={() => { setError(null); setConfirm("rollback"); }}>
                <HugeiconsIcon icon={ArrowTurnBackwardIcon} size={16} strokeWidth={1.75} />
                {tr("Volver a la versión anterior", "Roll back to the previous version")}
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="min-w-0 flex-1">
            <CardTitle as="h2">{tr("Instalaciones", "Installs")}</CardTitle>
            <CardDescription>{tr("Qué versión tiene cada una ahora mismo", "Which version each one runs right now")}</CardDescription>
          </div>
        </CardHeader>
        <CardSeparator />
        {!installs.length ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">{tr("Todavía no hay instalaciones.", "No installs yet.")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {installs.map(tenant => <InstallRow key={tenant.id} tenant={tenant} production={production} href={href(`/tenants/${tenant.id}`)} />)}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader className="flex-wrap">
          <div className="min-w-56 flex-1">
            <CardTitle as="h2">{tr("Historial", "History")}</CardTitle>
            <CardDescription>
              {history === "releases"
                ? tr("Versiones que llegó a publicar el fleet, con su resultado", "Versions the fleet shipped, with their outcome")
                : tr("Cada pedido hecho desde este panel y su registro en GitHub", "Every request made from this panel and its GitHub log")}
            </CardDescription>
          </div>
          <SlidingTabs
            value={history}
            onValueChange={id => setHistory(id as "releases" | "runs")}
            tabs={[{ id: "releases", label: tr("Versiones", "Versions") }, { id: "runs", label: tr("Pedidos en GitHub", "GitHub requests") }]}
          />
        </CardHeader>
        <CardSeparator />
        {history === "releases" ? (
          !overview.releases.length ? (
            <div className="flex flex-col items-center gap-3 px-5 py-6">
              <ProductFigure kind="empty-archive" className="w-40" />
              <p className="text-center text-sm text-muted-foreground">{tr("Sin versiones registradas.", "No versions recorded.")}</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {overview.releases.map(release => (
                <li key={release.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                    <span className="w-9 shrink-0 tabular-nums text-muted-foreground">#{release.id}</span>
                    <span className="font-mono text-xs">{shortSha(release.sha)}</span>
                    {release.rollbackOf ? <span className="text-xs text-muted-foreground">{tr("vuelta atrás", "rollback")}</span> : null}
                    {release.sha === production ? <span className="text-xs text-muted-foreground">· {tr("en producción", "in production")}</span> : null}
                    <span className="ml-auto flex items-center gap-3">
                      <span className="text-xs text-muted-foreground" title={fmt.dateTime(release.createdAt)}>{fmt.relative(release.createdAt, now)}</span>
                      <StatusBadge status={releaseVariant(release.status)} label={labels.release[release.status]} />
                    </span>
                  </div>
                  {release.error ? <p className="mt-1.5 break-words pl-12 text-xs text-[var(--status-failed-fg)]">{release.error}</p> : null}
                </li>
              ))}
            </ul>
          )
        ) : !deployment.runs.length ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">{tr("Todavía no se pidió nada desde el panel.", "Nothing requested from the panel yet.")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {deployment.runs.map(run => {
              const parsed = parseRunTitle(run.title);
              return (
                <li key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3 text-sm">
                  <a className="inline-flex min-w-0 items-center gap-1.5 underline decoration-border underline-offset-4 hover:decoration-foreground" href={run.url} target="_blank" rel="noopener noreferrer">
                    {parsed ? <>{runLabel(parsed.operation)} <span className="font-mono text-xs">{shortSha(parsed.sha)}</span></> : run.title}
                    <HugeiconsIcon icon={LinkSquare02Icon} size={12} strokeWidth={1.75} className="text-muted-foreground" />
                  </a>
                  {parsed?.actor ? <span className="min-w-0 truncate text-xs text-muted-foreground">{parsed.actor}</span> : null}
                  <span className="ml-auto flex items-center gap-3">
                    <span className="text-xs text-muted-foreground" title={fmt.dateTime(run.createdAt)}>{fmt.relative(run.createdAt, now)}</span>
                    <StatusBadge
                      status={run.status !== "completed" ? "in-progress" : run.conclusion === "success" ? "success" : run.conclusion === "cancelled" ? "expired" : "failed"}
                      label={run.status !== "completed" ? tr("En curso", "Running") : run.conclusion === "success" ? tr("Completado", "Completed") : run.conclusion === "cancelled" ? tr("Cancelado", "Cancelled") : tr("Falló", "Failed")}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Dialog open={Boolean(confirm)} onOpenChange={open => { if (!open && !sending) setConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === "rollback" ? tr(`Volver a ${shortSha(sha)}`, `Roll back to ${shortSha(sha)}`) : tr(`Publicar ${shortSha(sha)}`, `Ship ${shortSha(sha)}`)}</DialogTitle>
            <DialogDescription>
              {confirm === "rollback"
                ? tr(`Reemplaza ${shortSha(production)} por la versión anterior.`, `Replaces ${shortSha(production)} with the previous version.`)
                : deployment.main.message}
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-2.5 text-sm">
            {[
              tr(`Se instala en ${deployment.test} y se verifica. Unos 5 a 10 minutos.`, `It installs on ${deployment.test} and gets checked. About 5 to 10 minutes.`),
              deployment.customers
                ? tr(`Si pasa, se actualizan tus ${customersCount}, de a 3.`, `If it passes, your ${customersCount} update, 3 at a time.`)
                : tr("Si pasa, queda como versión de producción. Todavía no hay clientes que actualizar.", "If it passes, it becomes the production version. There are no customers to update yet."),
              tr(`Si algo falla se detiene, y tus clientes siguen en ${shortSha(production)}.`, `If anything fails it stops, and your customers stay on ${shortSha(production)}.`),
            ].map((line, index) => (
              <li key={index} className="flex gap-3">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-medium tabular-nums text-muted-foreground">{index + 1}</span>
                <span className="text-pretty">{line}</span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">{tr("Puedes cerrar el panel mientras tanto: sigue en GitHub.", "You can close the panel meanwhile: it keeps going on GitHub.")}</p>
          <DialogFooter>
            <Button variant="secondary" disabled={sending} onClick={() => setConfirm(null)}>{tr("Cancelar", "Cancel")}</Button>
            <Button disabled={sending} onClick={() => void publish()}>
              {sending ? tr("Solicitando…", "Requesting…") : confirm === "rollback" ? tr("Volver atrás", "Roll back") : tr("Publicar", "Ship")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type Step = {
  readonly icon: IconSvgElement;
  readonly title: string;
  readonly body: string;
  readonly tone: Tone;
  readonly status: string;
  readonly link: { readonly href: string; readonly label: string; readonly internal?: boolean } | null;
};

function PipelineStep({ step, index }: { readonly step: Step; readonly index: number }) {
  return (
    <li className="flex flex-col gap-2 bg-card px-5 py-4">
      <div className="flex items-center gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <HugeiconsIcon icon={step.icon} size={14} strokeWidth={1.75} />
        </span>
        <p className="text-sm font-medium">
          <span className="tabular-nums text-muted-foreground">{index}.</span> {step.title}
        </p>
      </div>
      <p className="text-xs text-muted-foreground text-pretty">{step.body}</p>
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
        <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", TONE_TEXT[step.tone])}>
          <HugeiconsIcon icon={TONE_ICON[step.tone]} size={14} strokeWidth={1.75} className={cn(step.tone === "busy" && "animate-spin motion-reduce:animate-none")} />
          {step.status}
        </span>
        {step.link ? (
          step.link.internal
            ? <Link className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" href={step.link.href}>{step.link.label}</Link>
            : <a className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" href={step.link.href} target="_blank" rel="noopener noreferrer">{step.link.label}</a>
        ) : null}
      </div>
    </li>
  );
}

function CommitRow({ commit, relative }: { readonly commit: { readonly sha: string; readonly message: string; readonly url: string; readonly date: string }; readonly relative: string }) {
  const { tr } = useAdminLocale();
  const { kind, text } = commitSummary(commit.message);
  const KIND: Record<CommitKind, string> = {
    feature: tr("Nuevo", "New"), fix: tr("Arreglo", "Fix"), improvement: tr("Mejora", "Improvement"),
    maintenance: tr("Interno", "Internal"), docs: tr("Docs", "Docs"), merge: "PR", other: tr("Cambio", "Change"),
  };
  return (
    <li className="flex items-start gap-3 px-5 py-2.5">
      {/* A fixed column keeps the messages aligned; the pill inside it hugs
          its word, so "PR" is not a lone pair of letters in a wide box. */}
      <span className="flex w-[5.25rem] shrink-0">
        <span
          className={cn(
            "pill pill-sm",
            kind === "feature" ? TONE_SURFACE.good : kind === "fix" ? TONE_SURFACE.wait : kind === "improvement" ? TONE_SURFACE.busy : TONE_SURFACE.idle,
          )}
        >
          {KIND[kind]}
        </span>
      </span>
      <p className="min-w-0 flex-1 text-sm text-pretty">{kind === "merge" ? <span className="text-muted-foreground">{tr(`Se integró el ${text}`, `Merged ${text}`)}</span> : text}</p>
      <a className="hidden shrink-0 font-mono text-xs text-muted-foreground hover:text-foreground min-[480px]:block" href={commit.url} target="_blank" rel="noopener noreferrer" title={relative}>
        {shortSha(commit.sha)}
      </a>
    </li>
  );
}

function InstallRow({ tenant, production, href }: { readonly tenant: AdminTenant; readonly production: string | null; readonly href: string }) {
  const { tr, fmt } = useAdminLocale();
  const now = useAdminNow();
  const state = installState(tenant, production);
  const LABEL: Record<InstallState, string> = {
    current: tr("Al día", "Up to date"), behind: tr("Versión anterior", "Older version"), updating: tr("Actualizando", "Updating"),
    failed: tr("Falló la última", "Last one failed"), not_deployed: tr("Sin desplegar", "Not deployed"),
  };
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <Link className="font-medium underline decoration-border underline-offset-4 hover:decoration-foreground" href={href}>{tenant.slug}</Link>
        {tenant.isTest ? <span className="pill pill-sm tone-pill tone-expired ml-2">{tr("prueba", "test")}</span> : null}
        <p className="truncate text-xs text-muted-foreground">{tenant.domain}</p>
      </div>
      <div className="text-right">
        <p className="font-mono text-xs">{state === "updating" ? `${shortSha(tenant.deployedCommit)} → ${shortSha(tenant.deployingCommit)}` : shortSha(tenant.deployedCommit)}</p>
        <p className="text-xs text-muted-foreground" title={fmt.dateTime(tenant.deployedAt)}>{fmt.relative(tenant.deployedAt, now)}</p>
      </div>
      <StatusBadge status={INSTALL_VARIANT[state]} label={LABEL[state]} />
    </li>
  );
}

/** A secondary button that opens GitHub in a new tab. */
function ExternalButton({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <Button variant="secondary" asChild>
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
        <HugeiconsIcon icon={LinkSquare02Icon} size={14} strokeWidth={1.75} />
      </a>
    </Button>
  );
}
