"use client";

import { SkeletonBar } from "@/components/ai-elements/skeleton";

function UsageCardHeader() {
  return <div className="flex items-start gap-3 px-5 pt-5 pb-4"><SkeletonBar className="size-9 shrink-0 rounded-xl" /><div className="min-w-0 flex-1 space-y-2"><SkeletonBar className="h-4 w-32" /><SkeletonBar className="h-3 w-56" /></div></div>;
}

export function AiUsageSkeleton() {
  return <div aria-hidden="true">
    <SkeletonBar className="mb-3 h-4 w-20" />
    <div className="mb-4 rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)]"><UsageCardHeader /><div className="mx-5 h-px bg-border" /><div className="space-y-2 px-5 py-4"><div className="flex justify-between gap-3"><SkeletonBar className="h-8 w-32" /><SkeletonBar className="h-4 w-28" /></div><SkeletonBar className="h-2 w-full rounded-full" /><SkeletonBar className="h-3 w-48" /></div></div>
    <div className="mb-4 rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)]"><UsageCardHeader /><div className="mx-5 h-px bg-border" /><div className="px-5 py-4"><div className="grid gap-3 sm:grid-cols-2">{[0, 1].map((i) => <div key={i} className="space-y-2 rounded-xl border border-border bg-muted/20 p-3"><SkeletonBar className="h-3 w-24" /><SkeletonBar className="h-7 w-20" /></div>)}</div><SkeletonBar className="mt-3 h-3 w-full" /></div></div>
    <div className="mb-4 rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)]"><UsageCardHeader /><div className="mx-5 h-px bg-border" /><div className="space-y-2 px-5 py-4"><SkeletonBar className="h-[194px] w-full" /><div className="flex justify-between">{[0, 1, 2, 3].map((i) => <SkeletonBar key={i} className="h-3 w-8" />)}</div></div></div>
    <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="min-w-0 rounded-2xl border border-border bg-card"><UsageCardHeader /><div className="space-y-3 px-5 pb-5">{[0, 1, 2].map((row) => <div key={row} className="flex justify-between gap-2"><SkeletonBar className="h-3 w-24" /><SkeletonBar className="h-3 w-10" /></div>)}</div></div>)}</div>
    <div className="min-w-0 rounded-2xl border border-border bg-card"><UsageCardHeader /><div className="space-y-4 px-5 pb-5"><SkeletonBar className="h-9 w-48 rounded-full" />{[0, 1, 2, 3].map((i) => <div key={i} className="flex justify-between gap-3 border-t border-border pt-3"><SkeletonBar className="h-3 w-48" /><SkeletonBar className="h-3 w-20" /></div>)}</div></div>
  </div>;
}
