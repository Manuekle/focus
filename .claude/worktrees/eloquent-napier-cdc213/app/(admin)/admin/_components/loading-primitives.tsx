"use client";

import type { ReactNode } from "react";
import { Card, CardBody, CardHeader, CardSeparator, CardTitle } from "@/app/_components/dashboard-card";
import { SkeletonBar } from "@/components/ai-elements/skeleton";
import { cn } from "@/lib/utils";
import { PageHeader } from "./admin-shell";

/** Keep the shell and real page identity available while only data is pending. */
export function LoadingPage({ title, description, status, back, badges = [], actions = [], className, children }: {
  readonly title: string;
  readonly description: ReactNode;
  readonly status: string;
  readonly back?: { readonly href: string; readonly label: string };
  readonly badges?: readonly string[];
  readonly actions?: readonly string[];
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return <>
    <p role="status" className="sr-only">{status}</p>
    <div aria-busy="true" data-admin-loading className={cn("space-y-6", className)}>
      <PageHeader title={title} description={description} back={back}
        badges={badges.length ? <div aria-hidden="true" className="flex flex-wrap gap-2">
          {badges.map((width, index) => <SkeletonBar key={index} className={cn("h-5 rounded-md", width)} />)}
        </div> : undefined}
        actions={actions.length ?
        <div aria-hidden="true" className="flex flex-wrap gap-2">
          {actions.map((width, index) => <SkeletonBar key={index} className={cn("h-8 rounded-lg md:h-7", width)} />)}
        </div> : undefined}
      />
      {/* Placeholders are decoration, never controls or fabricated values. */}
      <div aria-hidden="true" className="space-y-6">{children}</div>
    </div>
  </>;
}

export function LoadingStat({ label, hint = false }: { readonly label: string; readonly hint?: boolean }) {
  return <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
    <p className="text-xs text-muted-foreground">{label}</p>
    <div className="mt-1 flex h-8 items-center"><SkeletonBar className="h-6 w-16" /></div>
    {hint ? <div className="mt-1 flex h-8 items-start"><SkeletonBar className="mt-1 h-2.5 w-4/5" /></div> : null}
  </div>;
}

export function LoadingSection({ title, description, children, className, bodyClassName }: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly bodyClassName?: string;
}) {
  return <Card className={className}>
    <CardHeader>
      <div className="min-w-0 flex-1">
        <CardTitle>{title}</CardTitle>
        {description ? <div className="mt-0.5 text-xs text-muted-foreground">{description}</div> : null}
      </div>
    </CardHeader>
    <CardSeparator />
    <CardBody className={bodyClassName}>{children}</CardBody>
  </Card>;
}

export function LoadingField({ label, multiline = false }: { readonly label: string; readonly multiline?: boolean }) {
  return <div className="grid min-w-0 gap-1.5">
    <p className="text-xs text-muted-foreground">{label}</p>
    <SkeletonBar className={cn("w-full rounded-lg", multiline ? "h-36" : "h-8")} />
  </div>;
}

export function LoadingChips({ labels }: { readonly labels: readonly string[] }) {
  return <div className="flex flex-wrap gap-1.5">
    {labels.map(label => <div key={label} className="flex min-h-8 items-center gap-2 rounded-[13px] bg-muted/50 px-3 text-xs text-muted-foreground">
      {label}<SkeletonBar className="h-2.5 w-3" />
    </div>)}
  </div>;
}

export function LoadingFacts({ labels, detail = false }: { readonly labels: readonly string[]; readonly detail?: boolean }) {
  if (detail) return <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.65fr)] gap-x-4 gap-y-1.5 text-sm">
    {labels.map((label, index) => <div key={label} className="contents">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex min-w-0 justify-end pt-1"><SkeletonBar className={cn("h-3 max-w-full", index % 2 ? "w-20" : "w-28")} /></div>
    </div>)}
  </div>;
  return <div className="space-y-3">
    {labels.map((label, index) => <div key={label} className="flex items-start justify-between gap-4 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <SkeletonBar className={cn("mt-0.5 h-3 shrink-0", index % 2 ? "w-20" : "w-28")} />
    </div>)}
  </div>;
}

export function LoadingText({ wide = false }: { readonly wide?: boolean }) {
  return <div className="min-w-0 space-y-2">
    <SkeletonBar className={cn("h-3.5 max-w-full", wide ? "w-80" : "w-48")} />
    <SkeletonBar className={cn("h-3 max-w-full", wide ? "w-64" : "w-36")} />
  </div>;
}

export function LoadingHistory({ title, description }: { readonly title: string; readonly description?: string }) {
  return <Card>
    <CardHeader><div className="min-w-0 flex-1">
      <CardTitle>{title}</CardTitle>
      {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
    </div></CardHeader>
    <CardSeparator />
    <div className="divide-y divide-border">
      {[0, 1, 2].map(index => <div key={index} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
        <SkeletonBar className="h-3 w-10" />
        <SkeletonBar className="h-3 w-16" />
        <SkeletonBar className="h-3 w-12" />
        <SkeletonBar className="h-5 w-24 rounded-md" />
        <SkeletonBar className="ml-auto h-3 w-20" />
      </div>)}
    </div>
  </Card>;
}
