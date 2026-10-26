"use client";

import { SkeletonBar } from "@/components/ai-elements/skeleton";

export function BillingSkeleton() {
  return (
    <div className="space-y-4">
      <SkeletonBar className="h-3 w-16" />
      <div className="mb-4 space-y-2">
        <SkeletonBar className="h-7 w-32" />
        <SkeletonBar className="h-4 w-64" />
      </div>

      {/* Plan card */}
      <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)]">
        <div className="flex min-w-0 items-center gap-3 p-5">
          <SkeletonBar className="size-9 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonBar className="h-4 w-28" />
            <SkeletonBar className="h-3 w-40" />
          </div>
          <SkeletonBar className="h-5 w-16 rounded-full" />
        </div>
        <div className="h-px bg-border" />
        <div className="space-y-4 p-5">
          <div className="flex items-baseline justify-between">
            <SkeletonBar className="h-7 w-24" />
            <SkeletonBar className="h-4 w-28" />
          </div>
          <SkeletonBar className="h-4 w-64" />
          <div className="grid gap-2 sm:grid-cols-3">
            <SkeletonBar className="h-12 rounded-xl" />
            <SkeletonBar className="h-12 rounded-xl" />
            <SkeletonBar className="h-12 rounded-xl" />
          </div>
          <div className="flex gap-2">
            <SkeletonBar className="h-9 w-28 rounded-lg" />
            <SkeletonBar className="h-9 w-32 rounded-lg" />
          </div>
        </div>
      </div>

      {/* Payments card */}
      <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)]">
        <div className="flex min-w-0 items-center gap-3 p-5">
          <SkeletonBar className="size-9 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonBar className="h-4 w-32" />
            <SkeletonBar className="h-3 w-48" />
          </div>
        </div>
      </div>
    </div>
  );
}
