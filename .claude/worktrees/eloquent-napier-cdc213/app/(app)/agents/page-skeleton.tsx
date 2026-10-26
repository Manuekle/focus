"use client";

import { SkeletonBar } from "@/components/ai-elements/skeleton";

/** Skeleton for the Agents page — header + search, routing bar, then rows. */
export function AgentsSkeleton() {
  return (
    <div aria-hidden="true" className="@container">
      <SkeletonBar className="mb-4 h-9 w-full rounded-lg" />
      {/* "Who answers each channel": title, one line, two pickers. */}
      <div className="mb-6 rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)]">
        <div className="space-y-2.5 px-5 pt-5 pb-4">
          <SkeletonBar className="h-4 w-44" />
          <SkeletonBar className="h-3 w-[36rem] max-w-full" />
        </div>
        <div className="grid gap-2 px-5 pb-5 sm:grid-cols-2">
          <SkeletonBar className="h-[38px] rounded-lg" />
          <SkeletonBar className="h-[38px] rounded-lg" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 @min-[560px]:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="min-w-0 rounded-[20px] border border-border/70 bg-muted/50 p-1.5">
            <div className="space-y-3 rounded-[14px] border border-border/50 bg-card p-5">
              <div className="flex items-start gap-3">
                <SkeletonBar className="size-10 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                  <SkeletonBar className="h-4 w-36" />
                  <SkeletonBar className="h-3 w-56 max-w-full" />
                </div>
              </div>
              <SkeletonBar className="h-5 w-24 rounded-full" />
            </div>
            <div className="flex h-[42px] items-center justify-between px-2.5">
              <SkeletonBar className="h-4 w-16" />
              <div className="flex items-center gap-2">
                {Array.from({ length: 4 }).map((__, icon) => (
                  <SkeletonBar key={icon} className="size-6 rounded-md" />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
