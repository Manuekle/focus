"use client";

import { SkeletonBar } from "@/components/ai-elements/skeleton";

export function SetupSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
            <SkeletonBar className="h-7 w-10" />
            <SkeletonBar className="mt-2 h-3 w-20" />
            <SkeletonBar className="mt-4 h-1.5 w-full rounded-full" />
          </div>
        ))}
      </div>

      {/* Status banner */}
      <div className="rounded-[20px] border border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]">
        <div className="overflow-hidden rounded-[14px] border border-border/50 bg-card shadow-xs">
          <div className="flex items-start gap-3 px-5 py-4">
            <SkeletonBar className="size-9 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonBar className="h-4 w-40" />
              <SkeletonBar className="h-3 w-64" />
            </div>
          </div>
        </div>
      </div>

      {/* Masonry: checks / import / export */}
      <div className="gap-4 lg:columns-2">
        <div className="mb-4 break-inside-avoid rounded-[20px] border border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]">
          <div className="overflow-hidden rounded-[14px] border border-border/50 bg-card shadow-xs">
          <div className="flex min-w-0 items-center gap-3 p-5">
            <SkeletonBar className="size-9 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonBar className="h-4 w-32" />
              <SkeletonBar className="h-3 w-48" />
            </div>
          </div>
          <div className="h-px bg-border" />
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2 px-5 py-4">
                <SkeletonBar className="h-4 w-40" />
                <SkeletonBar className="h-3 w-56" />
              </div>
            ))}
          </div>
          </div>
        </div>

        <div className="mb-4 break-inside-avoid rounded-[20px] border border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]">
          <div className="overflow-hidden rounded-[14px] border border-border/50 bg-card shadow-xs">
          <div className="flex min-w-0 items-center gap-3 p-5">
            <SkeletonBar className="size-9 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonBar className="h-4 w-28" />
              <SkeletonBar className="h-3 w-44" />
            </div>
          </div>
          <div className="h-px bg-border" />
          <div className="space-y-4 p-5">
            <SkeletonBar className="h-24 w-full rounded-xl" />
            <SkeletonBar className="h-20 w-full rounded-xl" />
            <SkeletonBar className="h-9 w-28 rounded-lg" />
          </div>
          </div>
        </div>

        <div className="mb-4 break-inside-avoid rounded-[20px] border border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]">
          <div className="overflow-hidden rounded-[14px] border border-border/50 bg-card shadow-xs">
          <div className="flex min-w-0 items-center gap-3 p-5">
            <SkeletonBar className="size-9 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonBar className="h-4 w-28" />
              <SkeletonBar className="h-3 w-44" />
            </div>
          </div>
          <div className="h-px bg-border" />
          <div className="space-y-3 p-5">
            <SkeletonBar className="h-3 w-48" />
            <div className="flex gap-2">
              <SkeletonBar className="h-9 w-24 rounded-lg" />
              <SkeletonBar className="h-9 w-24 rounded-lg" />
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
