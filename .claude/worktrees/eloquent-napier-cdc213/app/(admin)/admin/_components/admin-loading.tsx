"use client";

import { Card, CardDescription, CardHeader, CardSeparator, CardTitle } from "@/app/_components/dashboard-card";
import { SkeletonBar, SkeletonTabs } from "@/components/ai-elements/skeleton";
import { useAdminLocale } from "./admin-locale";
import { useAdminHref } from "./admin-shell";
import { LoadingChips, LoadingFacts, LoadingField, LoadingHistory, LoadingPage, LoadingSection, LoadingStat, LoadingText } from "./loading-primitives";

/** These layouts follow the admin screens, independently of the product dashboard. */
export function CustomersLoading() {
  const { tr } = useAdminLocale();
  return <LoadingPage title={tr("Clientes", "Customers")}
    description={tr("Cada instalación alojada, desde el registro del fleet", "Every hosted install, from the fleet registry")}
    status={tr("Cargando clientes, uso de IA y versiones…", "Loading customers, AI usage and releases…")} actions={["w-24"]}>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {[tr("Clientes activos", "Live customers"), tr("En beta", "In beta"), tr("Pagando", "Paying"), tr("IA · 30 días", "AI · 30 days"), tr("Atención", "Attention")]
        .map(label => <LoadingStat key={label} label={label} hint />)}
    </div>
    <Card>
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <LoadingChips labels={[tr("Todos", "All"), "Beta", tr("Pagando", "Paying"), tr("Atención", "Attention"), tr("Pruebas", "Test")]} />
        <SkeletonBar className="h-8 w-full rounded-lg sm:w-64" />
      </div>
      <CardSeparator />
      <div className="divide-y divide-border">
        {[0, 1, 2].map(index => <div key={index} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3.5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
          <LoadingText />
          <div className="space-y-2"><SkeletonBar className="h-3 w-20" /><SkeletonBar className="h-5 w-16 rounded-md" /></div>
          <div className="hidden gap-2 md:flex"><SkeletonBar className="h-3 w-7" /><SkeletonBar className="h-3 w-7" /></div>
          <div className="hidden md:block"><LoadingText /></div>
          <div className="hidden md:block"><LoadingText /></div>
        </div>)}
      </div>
    </Card>
    <LoadingHistory title="Releases" description={tr("Producción · los nuevos clientes se crean desde este commit", "Production · new customers are created from this commit")} />
  </LoadingPage>;
}

export function RequestsLoading() {
  const { tr } = useAdminLocale();
  return <LoadingPage title={tr("Solicitudes", "Requests")}
    description={tr("Acceso a la beta privada y consultas recibidas desde la web.", "Private beta access and inquiries sent from the website.")}
    status={tr("Cargando solicitudes y seguimiento…", "Loading requests and follow-up…")} actions={["w-24"]}>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[tr("Beta privada", "Private beta"), tr("Beta pendiente", "Beta pending"), tr("Solicitudes abiertas", "Open requests"), tr("Avisos por correo fallidos", "Failed email notices")]
        .map(label => <LoadingStat key={label} label={label} />)}
    </div>
    <Card>
      <div className="grid gap-3 p-4 sm:grid-cols-2 sm:items-end lg:grid-cols-[1fr_1fr_2fr_auto]">
        <LoadingField label={tr("Origen", "Source")} /><LoadingField label={tr("Estado", "Status")} />
        <LoadingField label={tr("Buscar", "Search")} /><SkeletonBar className="h-8 w-16 rounded-lg" />
      </div>
      <CardSeparator />
      <div className="divide-y divide-border">
        {[0, 1, 2].map(index => <div key={index} className="grid gap-2 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-3"><LoadingText wide /><SkeletonBar className="h-3 w-3/4" /></div>
          <div className="flex items-center gap-2 sm:flex-col sm:items-end"><SkeletonBar className="h-5 w-20 rounded-md" /><SkeletonBar className="h-3 w-28" /></div>
        </div>)}
      </div>
      <LoadingPager />
    </Card>
  </LoadingPage>;
}

export function CallsLoading() {
  const { tr } = useAdminLocale();
  return <LoadingPage title={tr("Llamadas", "Calls")}
    description={tr("Reservas de Cal.com · Horarios de Bogotá.", "Cal.com bookings · Bogotá times.")}
    status={tr("Consultando las reservas de Cal.com…", "Reading Cal.com bookings…")} actions={["w-24", "w-40"]}>
    <Card className="grid gap-3 p-4 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-4 sm:p-5">
      <div className="min-w-0 flex-1"><h2 className="text-sm font-medium">{tr("Tu enlace para agendar", "Your booking link")}</h2><SkeletonBar className="mt-2 h-3 w-72 max-w-full" /></div>
      <SkeletonBar className="h-8 w-28 rounded-lg md:h-7" />
    </Card>
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3"><span className="text-xs text-muted-foreground">{tr("Mostrar", "Show")}</span><SkeletonBar className="h-8 w-36 rounded-lg" /></div>
        <p className="text-xs text-muted-foreground">{tr("Actualización automática cada minuto", "Refreshes every minute")}</p>
      </div>
      <div className="flex flex-wrap items-end gap-2 px-4 pb-4">
        <div className="min-w-0 flex-1 sm:max-w-xs"><LoadingField label={tr("Email del contacto", "Contact email")} /></div>
        <SkeletonBar className="h-8 w-32 rounded-lg md:h-7" />
      </div>
      <CardSeparator />
      <div className="divide-y divide-border">
        {[0, 1, 2].map(index => <div key={index} className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-2">
            <SkeletonBar className="h-3.5 w-72 max-w-full" /><SkeletonBar className="h-3 w-52 max-w-full" />
            <div className="flex flex-wrap gap-2 pt-1"><SkeletonBar className="h-3.5 w-28" /><SkeletonBar className="h-3 w-44" /></div>
          </div>
          <div className="flex flex-wrap items-center gap-3 lg:flex-col lg:items-end"><SkeletonBar className="h-5 w-24 rounded-md" /><SkeletonBar className="h-8 w-32 rounded-lg md:h-7" /></div>
        </div>)}
      </div>
      <LoadingPager />
    </Card>
  </LoadingPage>;
}

export function DeploymentsLoading() {
  const { tr } = useAdminLocale();
  return <LoadingPage title={tr("Despliegues", "Deployments")}
    description={tr("Lleva la última versión de main a tu instalación de prueba y, si pasa la verificación, a tus clientes.", "Take main's latest version to your test install and, if it passes the check, to your customers.")}
    status={tr("Consultando versiones y ejecuciones de GitHub…", "Reading releases and GitHub runs…")} actions={["w-36"]}>
    <Card>
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <SkeletonBar className="size-10 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <SkeletonBar className="h-5 w-80 max-w-full" />
          <div className="max-w-2xl space-y-2"><SkeletonBar className="h-3.5 w-full" /><SkeletonBar className="h-3.5 w-3/4" /></div>
        </div>
        <SkeletonBar className="h-8 w-48 max-w-full shrink-0 rounded-lg" />
      </div>
      <CardSeparator />
      <div className="grid gap-px bg-border sm:grid-cols-3">
        {[
          { title: tr("Comprobaciones de main", "Main's checks"), body: tr("GitHub corre tests, lint y build sobre el último commit de main.", "GitHub runs tests, lint and build on main's latest commit.") },
          { title: tr("Instalación de prueba", "Test install"), body: null },
          { title: tr("Clientes", "Customers"), body: tr("Solo si prueba pasa. Se actualizan de a 3; si uno falla, los siguientes no empiezan.", "Only if test passes. They update 3 at a time; if one fails, the next ones do not start.") },
        ].map((step, index) => <div key={step.title} className="flex flex-col gap-2 bg-card px-5 py-4">
          <div className="flex items-center gap-2"><SkeletonBar className="size-6 shrink-0 rounded-full" /><p className="text-sm font-medium"><span className="tabular-nums text-muted-foreground">{index + 1}.</span> {step.title}</p></div>
          {step.body ? <p className="text-xs text-muted-foreground text-pretty">{step.body}</p> : <div className="space-y-1 py-0.5"><SkeletonBar className="h-3 w-full" /><SkeletonBar className="h-3 w-4/5" /></div>}
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1"><SkeletonBar className="h-3 w-28" /><SkeletonBar className="h-3 w-16" /></div>
        </div>)}
      </div>
    </Card>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card>
        <CardHeader>
          <div className="min-w-0 flex-1"><CardTitle as="h2">{tr("Qué trae la versión nueva", "What the new version brings")}</CardTitle><SkeletonBar className="mt-1.5 h-3 w-72 max-w-full" /></div>
          <SkeletonBar className="h-3 w-24 shrink-0" />
        </CardHeader>
        <CardSeparator />
        <div className="divide-y divide-border">
          {[0, 1, 2, 3, 4].map(index => <div key={index} className="flex items-start gap-3 px-5 py-2.5">
            <SkeletonBar className="mt-0.5 h-5 w-16 shrink-0 min-[480px]:w-[4.5rem]" />
            <div className="min-w-0 flex-1 py-1"><SkeletonBar className={index % 2 ? "h-3.5 w-4/5" : "h-3.5 w-full"} /></div>
            <SkeletonBar className="mt-1 hidden h-3 w-14 shrink-0 min-[480px]:block" />
          </div>)}
        </div>
      </Card>
      <LoadingSection title={tr("En producción", "In production")} description={tr("Lo que tienen tus clientes y desde donde arrancan las instalaciones nuevas", "What your customers run, and what new installs start from")}>
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1 space-y-2"><SkeletonBar className="h-6 w-20" /><SkeletonBar className="h-3 w-52 max-w-full" /></div>
          <SkeletonBar className="aspect-[5/4] w-24 shrink-0 rounded-xl" />
        </div>
        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-sm font-medium">{tr("¿La versión publicada da problemas?", "Is the shipped version misbehaving?")}</p>
          <div className="space-y-1"><SkeletonBar className="h-3 w-full" /><SkeletonBar className="h-3 w-4/5" /></div>
          <SkeletonBar className="h-8 w-72 max-w-full rounded-lg" />
        </div>
      </LoadingSection>
    </div>
    <Card>
      <CardHeader><div className="min-w-0 flex-1"><CardTitle as="h2">{tr("Instalaciones", "Installs")}</CardTitle><CardDescription>{tr("Qué versión tiene cada una ahora mismo", "Which version each one runs right now")}</CardDescription></div></CardHeader>
      <CardSeparator />
      <div className="divide-y divide-border">{[0, 1, 2].map(index => <div key={index} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3">
        <div className="min-w-0 flex-1"><LoadingText /></div>
        <div className="space-y-2"><SkeletonBar className="ml-auto h-3 w-16" /><SkeletonBar className="h-3 w-20" /></div>
        <SkeletonBar className="h-5 w-24 rounded-md" />
      </div>)}</div>
    </Card>
    <Card>
      <CardHeader className="flex-wrap">
        <div className="min-w-56 flex-1"><CardTitle as="h2">{tr("Historial", "History")}</CardTitle><CardDescription>{tr("Versiones que llegó a publicar el fleet, con su resultado", "Versions the fleet shipped, with their outcome")}</CardDescription></div>
        <SkeletonTabs count={2} width={280} />
      </CardHeader>
      <CardSeparator />
      <div className="divide-y divide-border">{[0, 1, 2].map(index => <div key={index} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3">
        <SkeletonBar className="h-3 w-9" /><SkeletonBar className="h-3 w-16" />
        <div className="ml-auto flex items-center gap-3"><SkeletonBar className="h-3 w-20" /><SkeletonBar className="h-5 w-20 rounded-md" /></div>
      </div>)}</div>
    </Card>
  </LoadingPage>;
}

export function AnnouncementsLoading() {
  const { tr } = useAdminLocale();
  return <LoadingPage title={tr("Anuncios", "Announcements")}
    description={tr("Novedades, promociones y avisos que tus clientes ven al abrir la app, en español y en inglés. Se entregan con la configuración de cada cliente: sin deploy, en segundos.", "New features, offers and notices your customers see when they open the app, in Spanish and English. They ride each customer's configuration: no deploy, in seconds.")}
    status={tr("Cargando anuncios y resultados…", "Loading announcements and results…")} actions={["w-36"]}>
    <Card>
      <div className="p-4"><LoadingChips labels={[tr("Todos", "All"), tr("Publicados", "Published"), tr("Borradores", "Drafts"), tr("Archivados", "Archived")]} /></div>
      <CardSeparator />
      <div className="divide-y divide-border">
        {[0, 1, 2].map(index => <div key={index} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3.5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-2"><div className="flex gap-2"><SkeletonBar className="size-5 shrink-0 rounded-md" /><SkeletonBar className="h-3.5 w-52 max-w-full" /></div><div className="flex gap-2"><SkeletonBar className="h-4 w-12" /><SkeletonBar className="h-3 w-36 max-w-full" /></div></div>
          <div className="space-y-2"><SkeletonBar className="h-5 w-20 rounded-md" /><SkeletonBar className="h-3 w-16" /></div>
          <div className="col-span-2 md:col-span-1"><LoadingText /></div>
        </div>)}
      </div>
    </Card>
  </LoadingPage>;
}

export function CustomerLoading() {
  const { tr } = useAdminLocale();
  const href = useAdminHref();
  return <LoadingPage title={tr("Cliente", "Customer")} badges={["w-16", "w-20"]}
    description={<div className="flex flex-wrap gap-x-3 gap-y-1"><SkeletonBar className="h-4 w-36" /><SkeletonBar className="h-4 w-44" /><SkeletonBar className="h-4 w-44" /></div>}
    back={{ href: href(""), label: tr("Clientes", "Customers") }} status={tr("Cargando la instalación del cliente…", "Loading the customer's install…")}>
    <Card>
      <div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
        {[tr("Versión instalada", "Installed version"), tr("Tareas programadas", "Scheduled work"), tr("Configuración en vivo", "Live configuration"), tr("Canales", "Channels")].map(label => <div key={label} className="min-w-0 bg-card px-5 py-4">
          <p className="text-xs text-muted-foreground">{label}</p>
          <div className="mt-1.5 space-y-0.5"><div className="flex h-5 items-center gap-1.5"><SkeletonBar className="size-3.5 shrink-0 rounded-full" /><SkeletonBar className="h-3.5 w-28 max-w-full" /></div><div className="flex h-4 items-center"><SkeletonBar className="h-3 w-36 max-w-full" /></div></div>
        </div>)}
      </div>
    </Card>
    <div className="grid gap-4 md:grid-cols-2">
      <LoadingSection title="Plan" description={<SkeletonBar className="my-0.5 h-3 w-64 max-w-full" />}>
        <SkeletonBar className="h-7 w-28" />
        <LoadingFacts detail labels={[tr("Plan vendido", "Plan sold"), tr("Estado en Stripe", "Stripe status"), tr("Cliente Stripe", "Stripe customer"), tr("Suscripción", "Subscription")]} />
        <div className="space-y-2 border-t border-border pt-4"><SkeletonBar className="h-3 w-full" /><SkeletonBar className="h-3 w-3/4" /></div>
      </LoadingSection>
      <LoadingSection title={tr("Configuración en vivo", "Live configuration")} description={tr("El plan, los anuncios y los ajustes que el fleet le envía a la instalación sin volver a desplegarla", "The plan, announcements and settings the fleet sends to the install without redeploying it")}>
        <div className="flex items-center gap-1.5"><SkeletonBar className="size-4 shrink-0 rounded-full" /><SkeletonBar className="h-3.5 w-32" /></div>
        <LoadingFacts detail labels={[tr("Última versión enviada", "Latest version sent"), tr("Confirmada por la instalación", "Confirmed by the install")]} />
        <div className="space-y-2 border-t border-border pt-4"><SkeletonBar className="h-8 w-52 max-w-full rounded-lg" /><SkeletonBar className="h-3 w-full" /><SkeletonBar className="h-3 w-4/5" /></div>
      </LoadingSection>
      <LoadingSection title={tr("Versión instalada", "Installed version")} description={tr("El código que corre en esta instalación", "The code this install runs")}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2"><SkeletonBar className="h-6 w-20" /><SkeletonBar className="h-5 w-24 rounded-md" /></div>
        <LoadingFacts detail labels={[tr("Desde", "Since"), tr("Producción", "Production"), tr("Anterior", "Previous")]} />
        <p className="border-t border-border pt-4 text-xs text-muted-foreground">{tr("Las versiones nuevas se publican desde Despliegues, para todas las instalaciones a la vez.", "New versions ship from Deployments, for every install at once.")}</p>
      </LoadingSection>
      <LoadingSection title={tr("Tareas programadas", "Scheduled work")} description={tr("Cada 15 minutos el fleet llama a la instalación para correr recordatorios, seguimientos y automatizaciones", "Every 15 minutes the fleet calls the install to run reminders, follow-ups and automations")}>
        <LoadingFacts detail labels={[tr("Última vez que corrió bien", "Last good run"), tr("Último intento", "Last attempt"), tr("Fallos seguidos", "Failures in a row"), tr("Último error", "Last error")]} />
      </LoadingSection>
      <LoadingSection title={tr("Canales", "Channels")} description={<SkeletonBar className="my-0.5 h-3 w-36" />}>
        <div className="space-y-2">{["WhatsApp", "Instagram"].map(label => <div key={label} className="flex flex-wrap items-center gap-2.5 text-sm"><SkeletonBar className="size-2 shrink-0 rounded-full" /><span>{label}</span><SkeletonBar className="h-3 w-24" /></div>)}</div>
        <p className="border-t border-border pt-4 text-xs text-muted-foreground">{tr("El dueño los conecta desde su instalación, en Configuración → Canales.", "The owner connects them from their install, in Settings → Channels.")}</p>
      </LoadingSection>
      <LoadingSection title={tr("Uso de IA · 30 días", "AI usage · 30 days")} description={<SkeletonBar className="my-0.5 h-3 w-44 max-w-full" />}>
        <div className="grid grid-cols-2 gap-3">{[tr("Créditos", "Credits"), tr("Llamadas", "Calls"), tr("Costo de proveedores", "Provider cost"), tr("Pagado por Oruka", "Paid by Oruka")].map(label => <div key={label} className="rounded-xl border border-border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">{label}</p><SkeletonBar className="mt-1 h-5 w-16 max-w-full" /></div>)}</div>
      </LoadingSection>
      <LoadingSection title={tr("Aprovisionamiento", "Provisioning")} description={<SkeletonBar className="my-0.5 h-3 w-72 max-w-full" />}>
        <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">{[0, 1, 2, 3, 4, 5].map(index => <div key={index} className="flex min-w-0 items-center gap-2 py-0.5"><SkeletonBar className="size-3.5 shrink-0 rounded-full" /><SkeletonBar className="h-3.5 w-32 max-w-full" /></div>)}</div>
      </LoadingSection>
      <LoadingSection title={tr("Infraestructura", "Infrastructure")} description={tr("Ids para buscar en Vercel y Neon", "Ids to look up in Vercel and Neon")}>
        <LoadingFacts detail labels={["Tenant", tr("Proyecto Vercel", "Vercel project"), "Deployment", tr("Proyecto Neon", "Neon project"), tr("Origen", "Origin"), tr("Actualizado", "Updated")]} />
      </LoadingSection>
    </div>
    <Card>
      <CardHeader><div className="min-w-0 flex-1"><CardTitle>{tr("Historial", "History")}</CardTitle><CardDescription>{tr("Lo que le pasó a esta instalación, lo más nuevo primero", "What happened to this install, newest first")}</CardDescription></div></CardHeader>
      <CardSeparator />
      <div className="divide-y divide-border">{[0, 1, 2].map(index => <div key={index} className="flex items-start gap-3 px-5 py-2.5">
        <SkeletonBar className="mt-[7px] size-1.5 shrink-0 rounded-full" /><div className="min-w-0 flex-1"><LoadingText wide /></div><SkeletonBar className="mt-1 h-3 w-16 shrink-0" />
      </div>)}</div>
    </Card>
  </LoadingPage>;
}

export function RequestLoading() {
  const { tr } = useAdminLocale();
  const href = useAdminHref();
  return <LoadingPage title={tr("Solicitud", "Request")} description={<SkeletonBar className="h-4 w-72 max-w-full" />}
    back={{ href: href("/requests"), label: tr("Solicitudes", "Requests") }} actions={["w-56"]}
    status={tr("Cargando la solicitud y su seguimiento…", "Loading the request and its follow-up…")}>
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <LoadingSection title={tr("Solicitud recibida", "Request received")} bodyClassName="space-y-5 p-5">
        <div className="space-y-4">{[tr("Nombre", "Name"), "Email", tr("Empresa", "Company")].map(label => <div key={label} className="space-y-2"><p className="text-xs text-muted-foreground">{label}</p><SkeletonBar className="h-3.5 w-52 max-w-full" /></div>)}</div>
        <div className="space-y-2"><p className="text-xs text-muted-foreground">{tr("Mensaje", "Message")}</p><SkeletonBar className="h-3 w-full" /><SkeletonBar className="h-3 w-4/5" /><SkeletonBar className="h-3 w-2/3" /></div>
      </LoadingSection>
      <LoadingSection title={tr("Seguimiento interno", "Internal follow-up")} bodyClassName="p-5">
        <LoadingField label={tr("Estado", "Status")} /><LoadingField label={tr("Notas internas", "Internal notes")} multiline />
        <SkeletonBar className="h-3 w-4/5" /><SkeletonBar className="h-8 w-40 rounded-lg" />
      </LoadingSection>
    </div>
    <LoadingSection title={tr("Acceso a la beta", "Beta access")}><LoadingFacts labels={[tr("Instalación", "Install"), "Plan"]} /></LoadingSection>
    <LoadingSection title={tr("Historial de seguimiento", "Follow-up history")}>
      {[0, 1].map(index => <div key={index} className="space-y-2 py-1"><div className="flex flex-wrap gap-2"><SkeletonBar className="h-3.5 w-20" /><SkeletonBar className="h-3 w-36" /></div><SkeletonBar className="h-3 w-44 max-w-full" /><SkeletonBar className="h-3.5 w-4/5" /></div>)}
    </LoadingSection>
  </LoadingPage>;
}

export function ActivityLoading() {
  const { tr } = useAdminLocale();
  const href = useAdminHref();
  return <LoadingPage title={tr("Actividad", "Activity")}
    description={tr("Lo que hizo cada operador en clientes, solicitudes, anuncios y despliegues, lo más nuevo primero. Sin notas internas, textos de anuncios ni secretos.", "What each operator did in customers, requests, announcements and deployments, newest first. No internal notes, announcement copy or secrets.")}
    back={{ href: href("/security"), label: tr("Seguridad", "Security") }} status={tr("Cargando la actividad del panel…", "Loading panel activity…")}>
    <Card>
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1.4fr_1fr_1fr_auto] lg:items-end">
        {[tr("Área", "Area"), tr("Operador", "Operator"), tr("Desde", "From"), tr("Hasta", "To")].map(label => <LoadingField key={label} label={label} />)}
        <SkeletonBar className="h-8 w-16 rounded-lg" />
      </div>
      <CardSeparator />
      <div className="divide-y divide-border">{[0, 1, 2, 3].map(index => <div key={index} className="flex items-start justify-between gap-4 px-5 py-3.5">
        <div className="min-w-0 space-y-2"><LoadingText wide /><SkeletonBar className="h-3 w-44 max-w-full" /></div>
        <SkeletonBar className="mt-1 h-3 w-16 shrink-0" />
      </div>)}</div>
    </Card>
  </LoadingPage>;
}

export function SecurityCardLoading() {
  const { tr } = useAdminLocale();
  return <>
    <p role="status" className="sr-only">{tr("Consultando la verificación en dos pasos…", "Reading two-step verification…")}</p>
    <div aria-busy="true" className="mb-4 rounded-[20px] border border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]">
      <div aria-hidden="true" className="space-y-4 overflow-hidden rounded-[14px] border border-border/50 bg-card p-5 shadow-xs">
        <div className="flex items-start gap-3"><SkeletonBar className="size-9 shrink-0 rounded-xl" /><div className="min-w-0 flex-1 space-y-2"><p className="text-sm font-medium">{tr("Verificación en dos pasos", "Two-step verification")}</p><SkeletonBar className="h-3 w-full" /><SkeletonBar className="h-3 w-3/4" /></div></div>
        <div className="flex flex-wrap gap-2"><SkeletonBar className="h-8 w-28 rounded-lg md:h-7" /><SkeletonBar className="h-8 w-44 rounded-lg md:h-7" /><SkeletonBar className="h-8 w-32 rounded-lg md:h-7" /><SkeletonBar className="h-8 w-20 rounded-lg md:h-7" /></div>
      </div>
    </div>
  </>;
}

export function SecurityLoading() {
  const { tr } = useAdminLocale();
  return <LoadingPage title={tr("Seguridad", "Security")} description={<div className="space-y-2"><SkeletonBar className="h-3.5 w-full" /><SkeletonBar className="h-3.5 w-4/5" /><SkeletonBar className="h-3.5 w-3/5" /></div>}
    className="mx-auto max-w-2xl" status={tr("Cargando la seguridad de tu cuenta…", "Loading your account security…")}>
    <SecurityCardLoading />
    <Card className="flex items-center gap-3 p-4"><SkeletonBar className="size-9 shrink-0 rounded-xl" /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{tr("Actividad del panel", "Panel activity")}</p><SkeletonBar className="mt-2 h-3 w-full" /></div><SkeletonBar className="size-4 shrink-0" /></Card>
  </LoadingPage>;
}

function LoadingPager() {
  return <><CardSeparator /><div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"><SkeletonBar className="h-3 w-48 max-w-full" /><SkeletonBar className="h-3 w-16" /></div></>;
}
