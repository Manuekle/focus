"use client";

import { SkeletonBar } from "@/components/ai-elements/skeleton";

/** Skeleton for the Forms list — header + button, then a table of rows. */
/** Header, then the forms table inside its shell card — header row and
 *  form rows at the table's own padding — so the reveal does not move. */
export function FormsSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="rounded-[20px] border border-border/70 bg-muted/50 p-1.5">
        <div className="x-fade overflow-x-auto rounded-[14px] border border-border/50 bg-card px-5 py-4">
          <div className="min-w-[660px]">
          <div className="flex items-center gap-4 border-b border-border/60 py-2.5">
            <SkeletonBar className="h-3 w-20 flex-[2]" />
            <SkeletonBar className="h-3 w-14 flex-1" />
            <SkeletonBar className="h-3 w-20 flex-1" />
            <SkeletonBar className="h-3 w-20 flex-1" />
            <SkeletonBar className="ml-auto h-3 w-14" />
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-border/50 py-3 last:border-0">
              <div className="flex-[2] space-y-1.5">
                <SkeletonBar className="h-4 w-32" />
                <SkeletonBar className="h-3 w-24" />
              </div>
              <div className="flex-1">
                <SkeletonBar className="h-6 w-20 rounded-full" />
              </div>
              <div className="flex-1 space-y-1.5">
                <SkeletonBar className="h-4 w-24" />
                <SkeletonBar className="h-3 w-20" />
              </div>
              <div className="flex-1">
                <SkeletonBar className="h-3 w-8" />
              </div>
              <div className="ml-auto flex gap-1">
                <SkeletonBar className="size-7 rounded-md" />
                <SkeletonBar className="size-7 rounded-md" />
                <SkeletonBar className="size-7 rounded-md" />
              </div>
            </div>
          ))}
          </div>
        </div>
      </div>
    </div>
  );
}
