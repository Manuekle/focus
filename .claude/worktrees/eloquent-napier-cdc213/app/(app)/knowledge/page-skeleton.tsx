"use client";

import { SkeletonBar, SkeletonTabs } from "@/components/ai-elements/skeleton";

/** The page as it opens: header, then the business card — identity row,
 *  section tabs, logo strip and the first fields — at the card's own
 *  spacing, so the form does not jump in under a different shape. */
export function KnowledgeSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="mb-6 rounded-[20px] border border-border/70 bg-muted/50 p-1.5">
        <div className="rounded-[14px] border border-border/50 bg-card p-5">
          <div className="flex items-start gap-3 border-b border-border/50 pb-4">
            <SkeletonBar className="size-12 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2 pt-0.5">
              <SkeletonBar className="h-4 w-32" />
              <SkeletonBar className="h-3 w-80 max-w-full" />
              <SkeletonBar className="h-3 w-36" />
            </div>
          </div>
          <SkeletonTabs count={4} width={288} className="mt-4" />
          <SkeletonBar className="mt-4 h-[84px] w-full rounded-2xl" />
          <SkeletonBar className="mt-5 h-4 w-24" />
          <SkeletonBar className="mt-2 h-[60px] w-full rounded-lg" />
          <div className="mt-5 grid gap-x-3 gap-y-5 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <SkeletonBar className="h-4 w-28" />
                <SkeletonBar className="h-9 w-full rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
