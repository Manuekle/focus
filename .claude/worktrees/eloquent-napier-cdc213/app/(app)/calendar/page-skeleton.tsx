"use client";

import { SkeletonBar } from "@/components/ai-elements/skeleton";

export function GridSkeleton({ view }: { readonly view: "month" | "week" | "day" }) {
  if (view !== "month") {
    const columns = view === "day" ? 1 : 7;
    return (
      <div className="flex h-full min-h-0 flex-col" aria-busy="true">
        <div className="flex shrink-0 overflow-hidden border-b border-border/60">
          <div className="w-14 shrink-0" />
          <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {Array.from({ length: columns }).map((_, i) => (
              <div key={i} className="flex items-center justify-center gap-1.5 border-l border-border/60 py-2">
                <SkeletonBar className="h-3 w-10" />
                <SkeletonBar className="size-7 rounded-full" />
              </div>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 overflow-hidden border-b border-border/60">
          <SkeletonBar className="m-2 h-3 w-8 shrink-0" />
          <div className="grid min-h-10 flex-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {Array.from({ length: columns }).map((_, i) => (
              <div key={i} className="flex flex-col gap-1 border-l border-border/60 p-1">
                {i % 2 === 0 ? <SkeletonBar className="h-5 w-4/5 rounded-[5px]" /> : null}
              </div>
            ))}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex w-14 shrink-0 flex-col justify-between py-3 pr-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonBar key={i} className="ml-auto h-3 w-7" />
            ))}
          </div>
          <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {Array.from({ length: columns }).map((_, i) => (
              <div key={i} className="relative border-l border-border/60 [background-image:linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:100%_52px]">
                <SkeletonBar className="absolute top-[22%] left-1 right-1 h-12 rounded-md" />
                {i % 2 === 0 ? <SkeletonBar className="absolute top-[48%] left-1 right-1 h-16 rounded-md" /> : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy="true">
      <div className="grid shrink-0 grid-cols-7 border-b border-border/60">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="px-2 py-1.5 text-right">
            <SkeletonBar className="ml-auto h-3 w-6" />
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-[repeat(6,minmax(6.5rem,1fr))] overflow-y-auto">
        {Array.from({ length: 42 }).map((_, i) => (
          <div key={i} className="flex min-h-0 flex-col gap-1 border-r border-b border-border/60 p-1">
            <SkeletonBar className="ml-auto size-6 rounded-full" />
            {i % 3 === 0 ? <SkeletonBar className="h-5 w-full rounded-[5px]" /> : null}
            {i % 5 === 0 ? <SkeletonBar className="h-5 w-3/4 rounded-[5px]" /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CalendarSidebarSkeleton() {
  return (
    <div className="flex h-full w-full flex-col gap-6" aria-hidden="true">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <SkeletonBar className="h-4 w-24" />
          <SkeletonBar className="size-7 rounded-lg" />
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }).map((_, i) => (
            <SkeletonBar key={i} className="mx-auto size-6 rounded-full" />
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <SkeletonBar className="h-4 w-36" />
          <SkeletonBar className="size-7 rounded-lg" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-2.5 rounded-lg px-2 py-1.5">
            <SkeletonBar className="w-1 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <SkeletonBar className="h-3 w-3/4" />
              <SkeletonBar className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
      <SkeletonBar className="mt-auto h-3 w-full" />
    </div>
  );
}
