"use client";

import { SkeletonBar } from "@/components/ai-elements/skeleton";
import { EditorShellSkeleton } from "@/components/product-loading";

export function LinkProfileSkeleton() {
  return <div className="mx-auto w-full max-w-3xl space-y-5 px-5 py-6 sm:px-8">
    <div className="flex items-center gap-3"><SkeletonBar className="size-14 shrink-0 rounded-2xl" /><div className="min-w-0 flex-1 space-y-2"><SkeletonBar className="h-5 w-32" /><SkeletonBar className="h-3 w-56" /></div></div>
    <SkeletonBar className="h-4 w-28" />
    <SkeletonBar className="h-9 w-full rounded-lg" />
    <SkeletonBar className="h-4 w-32" />
    <SkeletonBar className="h-24 w-full rounded-lg" />
    <div className="grid gap-4 sm:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="space-y-2"><SkeletonBar className="h-4 w-24" /><SkeletonBar className="h-9 w-full rounded-lg" /></div>)}</div>
  </div>;
}

export function EditorSkeleton() {
  return <EditorShellSkeleton kind="links"><LinkProfileSkeleton /></EditorShellSkeleton>;
}
