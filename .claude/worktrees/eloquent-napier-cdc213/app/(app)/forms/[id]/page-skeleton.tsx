"use client";

import { SkeletonBar } from "@/components/ai-elements/skeleton";

export function RailSkeleton() {
  return (
    <div className="space-y-1.5 p-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="space-y-1.5 rounded-lg px-2.5 py-2">
          <SkeletonBar className="h-3.5" width={`${80 - (i % 3) * 15}%`} />
          <SkeletonBar className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

export function EditorSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-3 px-5 py-6 sm:px-8">
      <SkeletonBar className="h-3 w-16" />
      <SkeletonBar className="h-7 w-64" />
      <SkeletonBar className="h-4 w-80" />
      <div className="space-y-3 pt-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-border/60 p-3">
            <SkeletonBar className="h-8 w-full rounded-lg" />
            <SkeletonBar className="h-8 w-2/3 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
