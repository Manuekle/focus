"use client";

import { SkeletonBar, SkeletonTabs } from "@/components/ai-elements/skeleton";

/** Skeleton for the pipeline page at the populated page's geometry:
 *  header and its three actions, pipeline bar, toolbar (view tabs, search,
 *  two filters, the drag hint on its own line) and the board's 300px stage
 *  columns. */
export function PipelineSkeleton() {
  return (
    <div aria-hidden="true">
      <SkeletonBar className="mb-5 h-1.5 w-full rounded-full" />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SkeletonTabs count={3} width={236} />
        <SkeletonBar className="h-9 min-w-[200px] flex-1 rounded-lg" />
        <SkeletonBar className="h-9 w-full rounded-lg sm:w-[184px]" />
        <SkeletonBar className="h-9 w-full rounded-lg sm:w-[212px]" />
        <SkeletonBar className="h-4 w-52" />
      </div>
      <div className="flex gap-3 overflow-hidden p-2">
        {[0, 1, 2, 3, 4].map((stage) => (
          <div key={stage} className="kpi-card h-auto w-[300px] shrink-0 border border-border bg-card">
            <div className="flex h-[51px] items-start gap-2 px-2 pt-1">
              <SkeletonBar className="mt-1 size-4 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <SkeletonBar className="h-3.5 w-20" />
                <SkeletonBar className="h-[3px] w-full" />
                <SkeletonBar className="h-3 w-24" />
              </div>
              <SkeletonBar className="h-4 w-5 shrink-0" />
            </div>
            <div className="p-2">
              <div className="space-y-2 rounded-[20px] border border-border/70 bg-muted/40 p-1.5">
                <div className="space-y-2 rounded-[14px] border border-border/50 bg-card p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <SkeletonBar className="h-3.5 w-28" />
                    <SkeletonBar className="h-3.5 w-16" />
                  </div>
                  <SkeletonBar className="h-3 w-20" />
                </div>
                <SkeletonBar className="mx-2 mb-1 h-3 w-16" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
