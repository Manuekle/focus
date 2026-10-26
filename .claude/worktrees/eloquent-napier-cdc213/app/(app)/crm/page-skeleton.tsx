"use client";

import { SkeletonBar, SkeletonTabs } from "@/components/ai-elements/skeleton";

/** Skeleton for the CRM page at the populated page's geometry: header and
 *  its four actions, pipeline bar, toolbar (view tabs, search, two filters,
 *  the drag hint on its own line) and the list view it opens on — one card
 *  per stage, its 44px header over 58px contact rows. */
export function CrmSkeleton() {
  return (
    <div aria-hidden="true">
      <SkeletonBar className="mb-5 h-1.5 w-full rounded-full" />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SkeletonTabs count={3} width={236} />
        <SkeletonBar className="h-9 min-w-[200px] flex-1 rounded-lg" />
        <SkeletonBar className="h-9 w-full rounded-lg sm:w-[184px]" />
        <SkeletonBar className="h-9 w-full rounded-lg sm:w-[184px]" />
        <SkeletonBar className="h-4 w-52" />
      </div>
      <div className="space-y-2.5 p-2">
        {[5, 2, 2].map((rows, section) => (
          <div key={section} className="kpi-card h-auto border border-border bg-card">
            <div className="flex h-11 items-center gap-2 px-2">
              <SkeletonBar className="size-4 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <SkeletonBar className="h-3.5 w-20" />
                <SkeletonBar className="h-[3px] w-full" />
              </div>
              <SkeletonBar className="h-4 w-5 shrink-0" />
            </div>
            <div className="space-y-2 p-2">
              {Array.from({ length: rows }).map((_, row) => (
                <div key={row} className="@container flex h-[58px] items-center gap-4 rounded-[20px] border border-border/70 bg-muted/40 p-1.5">
                  <div className="flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-[14px] border border-border/50 bg-card px-3.5">
                    <SkeletonBar className="h-3.5 min-w-0 flex-1" />
                    <SkeletonBar className="hidden h-3 w-28 @md:block" />
                    <SkeletonBar className="hidden h-3 w-56 @2xl:block" />
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                      <SkeletonBar className="h-3 w-6" />
                      <SkeletonBar className="h-7 w-7 rounded-lg" />
                      <SkeletonBar className="size-7 rounded-lg" />
                      <SkeletonBar className="size-7 rounded-lg" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
