"use client";

import { KpiCardSkeleton, SkeletonBar } from "@/components/ai-elements/skeleton";
import { Card } from "@/app/_components/dashboard-card";

/** The populated page at its own geometry: header and pending-count chip,
 *  three KPI cards, search, then a titled group of reminder rows (inner card
 *  over a metadata line), so the reveal does not move anything. */
export function RemindersSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="mb-6 flex items-stretch gap-4 overflow-hidden" style={{ paddingInline: "2px" }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="min-w-[220px] flex-1">
            <KpiCardSkeleton visual />
          </div>
        ))}
      </div>
      <SkeletonBar className="mb-4 h-9 w-full rounded-lg" />
      <SkeletonBar className="mb-3 h-5 w-28" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="rounded-[20px] border-border/70 bg-muted/50 p-1.5">
            <div className="rounded-[14px] border border-border/50 bg-card">
              <div className="flex items-start gap-3 px-5 pt-5 pb-4">
                <SkeletonBar className="size-9 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                  <SkeletonBar className="h-4 w-72 max-w-full" />
                  <SkeletonBar className="h-3 w-40 max-w-full" />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 px-2.5 pt-2 pb-0.5">
              <SkeletonBar className="h-3 w-32" />
              <SkeletonBar className="size-8 rounded-lg" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
