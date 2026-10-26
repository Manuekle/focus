"use client";

import { SkeletonBar } from "@/components/ai-elements/skeleton";

export function EditorSkeleton() {
  return (
    <div className="h-full space-y-2.5 bg-muted/10 p-6">
      {Array.from({ length: 12 }).map((_, i) => (
        <SkeletonBar key={i} className="h-3" width={`${72 - (i % 5) * 11}%`} />
      ))}
    </div>
  );
}
