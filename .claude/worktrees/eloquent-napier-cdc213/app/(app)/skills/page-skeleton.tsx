"use client";

import { KpiCardSkeleton, SkeletonBar } from "@/components/ai-elements/skeleton";
import { Card } from "@/app/_components/dashboard-card";

export function SkillsSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="mb-6 flex items-stretch gap-4 overflow-hidden" style={{ paddingInline: "2px" }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="min-w-[220px] flex-1">
            <KpiCardSkeleton />
          </div>
        ))}
      </div>
      <SkeletonBar className="mb-3 h-4 w-40" />
      <div className="grid gap-3 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="rounded-[20px] border-border/70 bg-muted/50 p-1.5">
            <div className="flex gap-3 rounded-[14px] border border-border/50 bg-card p-5">
              <SkeletonBar className="size-9 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                <SkeletonBar className="h-4 w-36" />
                <SkeletonBar className="h-3 w-full" />
                <SkeletonBar className="h-3 w-2/3" />
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 px-2.5 pt-2 pb-0.5">
              <SkeletonBar className="h-3 w-40" />
              <div className="flex items-center gap-1">
                <SkeletonBar className="h-5 w-9 rounded-full" />
                <SkeletonBar className="size-8 rounded-lg" />
                <SkeletonBar className="size-8 rounded-lg" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
