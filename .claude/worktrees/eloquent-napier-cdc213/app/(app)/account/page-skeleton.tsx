"use client";

import { SkeletonBar } from "@/components/ai-elements/skeleton";

export function AccountSkeleton() {
  return (
    <div className="space-y-4">
      {/* Identity + plan */}
      <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)]">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <SkeletonBar className="size-14 shrink-0 rounded-2xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonBar className="h-3 w-24" />
            <SkeletonBar className="h-5 w-56" />
            <SkeletonBar className="h-3 w-40" />
          </div>
          <SkeletonBar className="hidden h-8 w-36 rounded-[11px] sm:block" />
        </div>
      </div>

      {/* AI credits */}
      <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)]">
        <div className="space-y-3 p-5">
          <div className="flex min-w-0 items-center gap-3">
            <SkeletonBar className="size-9 shrink-0 rounded-xl" />
            <SkeletonBar className="h-4 w-28" />
          </div>
          <div className="flex items-end justify-between">
            <SkeletonBar className="h-7 w-32" />
            <SkeletonBar className="h-4 w-10" />
          </div>
          <SkeletonBar className="h-9 w-full rounded-full" />
        </div>
      </div>

      {/* Businesses */}
      <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)]">
        <div className="flex min-w-0 items-center gap-3 p-5">
          <SkeletonBar className="size-9 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonBar className="h-4 w-28" />
            <SkeletonBar className="h-3 w-48" />
          </div>
        </div>
        <div className="h-px bg-border" />
        <div className="p-5">
          <SkeletonBar className="h-5 w-40" />
        </div>
      </div>

      {/* Licence card — the credit card and its wallet */}
      <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)]">
        <div className="flex min-w-0 items-center gap-3 p-5">
          <SkeletonBar className="size-9 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonBar className="h-4 w-36" />
            <SkeletonBar className="h-3 w-56" />
          </div>
        </div>
        <div className="border-y border-border bg-muted/40 px-5 py-7">
          <SkeletonBar className="mx-auto aspect-[1.586] w-full max-w-[27rem] rounded-[18px]" />
        </div>
        <div className="p-5">
          <SkeletonBar className="h-4 w-52" />
        </div>
      </div>

      {/* Change password form */}
      <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)]">
        <div className="flex min-w-0 items-center gap-3 p-5">
          <SkeletonBar className="size-9 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonBar className="h-4 w-40" />
            <SkeletonBar className="h-3 w-56" />
          </div>
        </div>
        <div className="h-px bg-border" />
        <div className="space-y-3 p-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonBar key={i} className="h-9 w-full" />
          ))}
          <SkeletonBar className="h-9 w-28 rounded-lg" />
        </div>
      </div>

      {/* Sound + sign out */}
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)]">
            <div className="flex min-w-0 items-center gap-3 p-5">
              <SkeletonBar className="size-9 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <SkeletonBar className="h-4 w-28" />
                <SkeletonBar className="h-3 w-40" />
              </div>
            </div>
            <div className="h-px bg-border" />
            <div className="p-5">
              <SkeletonBar className="h-9 w-32 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
