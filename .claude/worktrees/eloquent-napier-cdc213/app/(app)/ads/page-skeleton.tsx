"use client";

import { SkeletonBar } from "@/components/ai-elements/skeleton";
import { Card } from "@/app/_components/dashboard-card";

export function AdsSkeleton() {
  return (
    <div>
      <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <SkeletonBar className="h-7 w-24" />
          <SkeletonBar className="h-4 w-56" />
        </div>
        <SkeletonBar className="h-9 w-40 rounded-lg" />
      </header>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <SkeletonBar className="h-9 w-48 rounded-full" />
        <SkeletonBar className="h-9 w-full rounded-lg sm:w-64" />
      </div>
      <AdsPanelSkeleton tab="campaigns" />
    </div>
  );
}

export function AdsPanelSkeleton({ tab }: { readonly tab: "campaigns" | "leads" }) {
  return (
    <div className="t-skel-pulse-self space-y-3">
      {/* Only the campaigns tab carries the totals row, so only its
          placeholder does. */}
      {tab === "campaigns" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i}>
              {/* The tile's own shape: number, context line, picture, label. */}
              <div className="space-y-2 p-5">
                <SkeletonBar className="h-7" width="70%" />
                <SkeletonBar className="h-3" width="45%" />
                <SkeletonBar className="!mt-4 h-2 w-full rounded-full" />
                <SkeletonBar className="!mt-4 h-3" width="40%" />
              </div>
            </Card>
          ))}
        </div>
      ) : null}
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <div className="flex items-center gap-4 px-5 py-4">
            <SkeletonBar className="size-1.5 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonBar className="h-3.5" width="40%" />
              <SkeletonBar className="h-3" width="25%" />
            </div>
            {/* The metric columns, so the placeholder has the row's shape and
                the real rows do not jump sideways when they land. */}
            <div className="hidden items-center gap-6 xl:flex">
              <SkeletonBar className="h-3.5 w-[86px]" />
              <SkeletonBar className="h-3.5 w-[86px]" />
              <SkeletonBar className="h-3.5 w-[62px]" />
            </div>
            <SkeletonBar className="hidden h-3.5 w-[92px] sm:block" />
          </div>
        </Card>
      ))}
    </div>
  );
}
