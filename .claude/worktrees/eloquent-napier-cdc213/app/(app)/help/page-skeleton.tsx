"use client";

import { SkeletonBar, SkeletonTabs } from "@/components/ai-elements/skeleton";

export function HelpPanelSkeleton() {
  return <div aria-hidden="true">
    <SkeletonTabs count={4} className="mb-6" />
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4"><SkeletonBar className="h-6 w-40" /><SkeletonBar className="h-9 w-full rounded-lg" /><div className="flex flex-wrap gap-1.5">{[0, 1, 2, 3].map((i) => <SkeletonBar key={i} className="h-7 w-20 rounded-full" />)}</div><div className="divide-y divide-border rounded-2xl border border-border bg-card">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="flex items-center gap-3 px-5 py-4"><SkeletonBar className="h-5 flex-1" /><SkeletonBar className="size-4 shrink-0" /></div>)}</div></div>
      <div className="space-y-4"><div className="space-y-4 rounded-2xl border border-border bg-card p-5"><SkeletonBar className="size-9 rounded-xl" /><SkeletonBar className="h-5 w-32" /><SkeletonBar className="h-3 w-full" /><SkeletonBar className="h-24 w-full rounded-lg" /><SkeletonBar className="h-8 w-full rounded-lg" /></div><SkeletonBar className="h-4 w-48" /></div>
    </div>
  </div>;
}
