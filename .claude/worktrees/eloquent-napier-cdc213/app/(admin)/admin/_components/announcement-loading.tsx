"use client";

import { Card, CardSeparator } from "@/app/_components/dashboard-card";
import { SkeletonBar } from "@/components/ai-elements/skeleton";
import { useAdminLocale } from "./admin-locale";
import { useAdminHref } from "./admin-shell";
import { LoadingChips, LoadingField, LoadingPage, LoadingSection } from "./loading-primitives";

export function AnnouncementLoading() {
  return <EditorLoading />;
}

export function NewAnnouncementLoading() {
  return <EditorLoading creating />;
}

/** The editor keeps its content column, preview rail and save bar while data loads. */
function EditorLoading({ creating = false }: { readonly creating?: boolean }) {
  const { locale, tr } = useAdminLocale();
  const href = useAdminHref();
  return <LoadingPage title={creating ? tr("Nuevo anuncio", "New announcement") : tr("Anuncio", "Announcement")}
    description={creating
      ? tr("Una novedad, una promoción o un aviso para tus clientes, en español y en inglés.", "A new feature, an offer or a notice for your customers, in Spanish and English.")
      : <SkeletonBar className="h-4 w-80 max-w-full" />}
    back={{ href: href("/announcements"), label: tr("Anuncios", "Announcements") }} badges={["w-20"]}
    status={tr("Cargando el contenido y la audiencia del anuncio…", "Loading announcement content and audience…")} className="pb-4">
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
      <div className="space-y-4">
        <LoadingSection title={tr("Tipo", "Kind")} description={tr("Cambia la etiqueta, el color y la ilustración", "Sets the label, the colours and the artwork")}>
          <div className="grid gap-1 rounded-2xl bg-muted p-1 shadow-[var(--shadow-inset)] sm:grid-cols-3">
            {[0, 1, 2].map(index => <div key={index} className="flex items-center gap-3 rounded-xl bg-card/50 p-2"><SkeletonBar className="size-10 shrink-0 rounded-[10px]" /><div className="min-w-0 flex-1 space-y-2"><SkeletonBar className="h-3.5 w-16 max-w-full" /><SkeletonBar className="h-3 w-full" /></div></div>)}
          </div>
        </LoadingSection>
        <LoadingSection title={tr("Contenido", "Content")} description={tr("Cada cliente lo ve en el idioma en que usa la app. Ambos son obligatorios para publicar.", "Each customer sees it in the language they use the app in. Both are required to publish.")}>
          <SkeletonBar className="h-8 w-52 max-w-full rounded-lg" />
          <LoadingField label={`${tr("Título", "Title")} (${locale === "en" ? "English" : "Español"})`} />
          <div className="space-y-1.5"><p className="text-xs text-muted-foreground">{tr("Texto", "Text")} ({locale === "en" ? "English" : "Español"})</p><SkeletonBar className="h-32 w-full rounded-lg" /><SkeletonBar className="h-3 w-4/5" /></div>
          <LoadingField label={`${tr("Texto del botón", "Button label")} (${locale === "en" ? "English" : "Español"})`} />
          <SkeletonBar className="h-3 w-1/2" />
        </LoadingSection>
        <LoadingSection title={tr("Botón e imagen", "Button and image")} description={tr("Ambos opcionales", "Both optional")}>
          <LoadingField label={tr("Enlace del botón", "Button link")} />
          <div className="space-y-2"><SkeletonBar className="h-3 w-full" /><SkeletonBar className="h-3 w-3/4" /></div>
          <LoadingField label={tr("Imagen", "Image")} /><SkeletonBar className="h-3 w-4/5" />
        </LoadingSection>
        <LoadingSection title={tr("Quién lo ve", "Who sees it")}>
          <div className="space-y-1.5"><p className="text-sm">{tr("Acceso", "Access")}</p><LoadingChips labels={[tr("Todos", "Everyone"), "Beta", tr("Pagando", "Paying")]} /></div>
          <div className="space-y-1.5"><p className="text-sm">Plan</p><LoadingChips labels={["Pro", "Managed"]} /></div>
          <LoadingField label={tr("Clientes específicos", "Specific customers")} />
          <div className="flex items-center justify-between gap-4 border-t border-border pt-4"><p className="text-sm">{tr("Solo el dueño de cada instalación", "Only each install's owner")}</p><SkeletonBar className="h-5 w-9 shrink-0 rounded-full" /></div>
        </LoadingSection>
        <LoadingSection title={tr("Cuándo", "When")} description={tr("Vacío: desde que se publica y sin final. Hora de tu navegador.", "Empty: from publishing, with no end. Your browser's time.")}>
          <div className="grid gap-4 sm:grid-cols-2"><LoadingField label={tr("Desde", "From")} /><LoadingField label={tr("Hasta", "Until")} /></div>
        </LoadingSection>
      </div>
      <div className="space-y-4 lg:sticky lg:top-20">
        <Card>
          <div className="flex items-start gap-3 px-5 pb-4 pt-5"><div className="min-w-0 flex-1"><h2 className="text-sm font-medium">{tr("Vista previa", "Preview")}</h2><p className="mt-0.5 text-xs text-muted-foreground">{tr("El mismo diálogo que ve el cliente", "The same dialog the customer sees")}</p></div><SkeletonBar className="h-[38px] w-28 shrink-0 rounded-lg" /></div>
          <CardSeparator />
          <div className="bg-[radial-gradient(circle_at_1px_1px,var(--border)_1px,transparent_0)] bg-[length:14px_14px] p-4">
            <div className="mx-auto max-w-[380px] rounded-[20px] border border-border/70 bg-muted/60 p-1.5 shadow-[var(--shadow-float)]">
              <div className="overflow-hidden rounded-[14px] bg-card"><SkeletonBar className="aspect-[2/1] w-full rounded-none" /><div className="space-y-4 p-5"><SkeletonBar className="h-5 w-20 rounded-md" /><SkeletonBar className="h-5 w-4/5" /><SkeletonBar className="h-3.5 w-full" /></div></div>
              <div className="flex justify-end px-2 pb-1 pt-2.5"><SkeletonBar className="h-8 w-16 rounded-lg md:h-7" /></div>
            </div>
          </div>
        </Card>
        <LoadingSection title={tr("Para publicar", "To publish")}>
          <div className="space-y-3">{[0, 1, 2, 3].map(index => <div key={index} className="flex items-center gap-2.5"><SkeletonBar className="size-4 shrink-0 rounded-full" /><SkeletonBar className="h-3 w-4/5" /></div>)}</div>
        </LoadingSection>
        {!creating ? <LoadingSection title={tr("Resultados", "Results")}><div className="grid grid-cols-2 gap-3">{[0, 1, 2, 3].map(index => <div key={index} className="space-y-2 rounded-xl border border-border p-3"><SkeletonBar className="h-3 w-20 max-w-full" /><SkeletonBar className="h-4 w-12" /></div>)}</div></LoadingSection> : null}
      </div>
    </div>
    <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-border/80 bg-card/90 p-2.5 pl-4 shadow-[var(--shadow-float)] backdrop-blur-md">
      <div className="flex min-w-0 basis-full items-center gap-2 sm:basis-0 sm:flex-1"><SkeletonBar className="size-2 shrink-0 rounded-full" /><SkeletonBar className="h-3 w-52 max-w-full" /></div>
      <div className="ml-auto flex flex-wrap gap-2"><SkeletonBar className="h-8 w-32 rounded-lg" /><SkeletonBar className="h-8 w-24 rounded-lg" /></div>
    </div>
  </LoadingPage>;
}
