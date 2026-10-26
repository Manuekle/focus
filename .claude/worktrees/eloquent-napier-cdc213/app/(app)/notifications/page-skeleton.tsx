"use client";

import { KpiCardSkeleton, SkeletonBar, SkeletonTabs } from "@/components/ai-elements/skeleton";
import { Card } from "@/app/_components/dashboard-card";

/** The populated page at its own geometry: header with its two actions, three
 *  KPI cards, the tabs, then a titled group of notification cards (inner card
 *  over a metadata line), so the reveal does not move anything. */
export function NotificationsSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="mb-6 flex items-stretch gap-4 overflow-hidden" style={{ paddingInline: "2px" }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="min-w-[220px] flex-1">
            <KpiCardSkeleton visual />
          </div>
        ))}
      </div>
      <SkeletonTabs count={3} width={260} className="mb-6" />
      <SkeletonBar className="mb-3 h-5 w-28" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="rounded-[20px] border-border/70 bg-muted/50 p-1.5">
            <div className="rounded-[14px] border border-border/50 bg-card">
              <div className="flex items-start gap-3 px-5 pt-5 pb-4">
                <SkeletonBar className="size-10 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2 pt-1">
                  <SkeletonBar className="h-4 w-80 max-w-full" />
                  <SkeletonBar className="h-3 w-48 max-w-full" />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 px-2.5 pt-2 pb-0.5">
              <SkeletonBar className="h-3 w-40" />
              <div className="flex gap-1">
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
