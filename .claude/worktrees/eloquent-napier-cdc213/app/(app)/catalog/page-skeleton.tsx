"use client";

import { KpiCardSkeleton, SkeletonBar } from "@/components/ai-elements/skeleton";

export function CatalogSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="mb-6 flex items-stretch gap-4 overflow-hidden" style={{ paddingInline: "2px" }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="min-w-[220px] flex-1">
            <KpiCardSkeleton />
          </div>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SkeletonBar className="h-9 min-w-[200px] flex-1 rounded-lg" />
        <SkeletonBar className="h-8 w-[300px] max-w-full rounded-lg" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-[20px] border border-border/70 bg-muted/50 p-1.5">
            <div className="rounded-[14px] border border-border/50 bg-card p-3">
              <SkeletonBar className="aspect-[4/3] w-full rounded-xl" />
              <SkeletonBar className="mt-3 h-4 w-3/4" />
              <SkeletonBar className="mt-2 h-4 w-20" />
            </div>
            <div className="flex h-9 items-center justify-between px-2.5">
              <SkeletonBar className="h-5 w-20 rounded-md" />
              <SkeletonBar className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
