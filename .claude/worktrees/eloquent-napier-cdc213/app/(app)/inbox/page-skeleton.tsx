"use client";

import { SkeletonBar } from "@/components/ai-elements/skeleton";

export function InboxSkeleton() {
  return (
    <div aria-hidden="true">
      <SkeletonBar className="mb-4 h-9 w-full rounded-lg" />
      <div className="mb-2 flex h-4 items-center gap-2 px-1">
        <SkeletonBar className="size-4 rounded" />
        <SkeletonBar className="h-3 w-24" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-[var(--shadow-soft)]"
          >
            <SkeletonBar className="size-4 shrink-0 rounded" />
            <SkeletonBar className="size-10 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <div className="flex h-5 items-center">
                <SkeletonBar className="h-4 w-36" />
              </div>
              <div className="flex h-4 items-center">
                <SkeletonBar className="h-3 w-72 max-w-full" />
              </div>
              <SkeletonBar className="mt-1 h-6 w-20 rounded-md" />
            </div>
            <SkeletonBar className="hidden h-6 w-28 rounded-md sm:block" />
            <SkeletonBar className="hidden h-3 w-8 sm:block" />
            <SkeletonBar className="size-8 shrink-0 rounded-lg" />
            <SkeletonBar className="size-8 shrink-0 rounded-lg sm:w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}
