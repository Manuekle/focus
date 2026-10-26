"use client";

import { SkeletonBar } from "@/components/ai-elements/skeleton";

export function ConnectionsSkeleton() {
  return (
    <div>
      <div className="mb-8 space-y-2">
        <SkeletonBar className="h-7 w-40" />
        <SkeletonBar className="h-4 w-96 max-w-full" />
      </div>

      {/* OAuth cards */}
      <div className="mb-4 flex items-start gap-3">
        <SkeletonBar className="size-8 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <SkeletonBar className="h-3.5 w-32" />
          <SkeletonBar className="h-3 w-56" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
            <div className="flex min-w-0 items-center gap-3">
              <SkeletonBar className="size-9 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <SkeletonBar className="h-4 w-24" />
                <SkeletonBar className="h-3 w-32" />
              </div>
            </div>
            <div className="mt-4 flex justify-between">
              <SkeletonBar className="h-3 w-20" />
              <SkeletonBar className="h-8 w-20 rounded-lg" />
            </div>
          </div>
        ))}
      </div>

      {/* Manual keys */}
      <div className="mt-10 mb-4 flex items-start gap-3">
        <SkeletonBar className="size-8 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <SkeletonBar className="h-3.5 w-28" />
          <SkeletonBar className="h-3 w-64" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
            <div className="flex min-w-0 items-center gap-3">
              <SkeletonBar className="size-9 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <SkeletonBar className="h-3.5 w-24" />
                <SkeletonBar className="h-3 w-40" />
              </div>
            </div>
            <div className="mt-4 flex justify-between">
              <SkeletonBar className="h-3 w-20" />
              <SkeletonBar className="h-8 w-20 rounded-lg" />
            </div>
          </div>
        ))}
      </div>

      {/* Webhooks */}
      <div className="mt-10 mb-4 flex items-start gap-3">
        <SkeletonBar className="size-8 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <SkeletonBar className="h-3.5 w-24" />
          <SkeletonBar className="h-3 w-56" />
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
        <SkeletonBar className="mx-auto h-3 w-48" />
      </div>
    </div>
  );
}
