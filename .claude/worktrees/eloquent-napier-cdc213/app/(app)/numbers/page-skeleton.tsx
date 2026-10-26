"use client";

import { Card } from "@/app/_components/dashboard-card";
import { SkeletonBar } from "@/components/ai-elements/skeleton";

/** Mirrors the populated page below its header — directory rows with their
 *  number, capability chips, agent picker and two icon actions — at the same
 *  heights, so the reveal does not move anything. */
export function NumbersSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} className="p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1.5">
              <div className="flex h-5 items-center gap-2">
                <SkeletonBar className="h-4 w-28" />
                <SkeletonBar className="h-4 w-20" />
              </div>
              <div className="flex gap-1.5">
                <SkeletonBar className="h-[22px] w-16" />
                <SkeletonBar className="h-[22px] w-14" />
              </div>
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <SkeletonBar className="h-8 min-w-0 flex-1 rounded-lg sm:w-44 sm:flex-none" />
              <SkeletonBar className="size-8 shrink-0 rounded-lg" />
              <SkeletonBar className="size-8 shrink-0 rounded-lg" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
