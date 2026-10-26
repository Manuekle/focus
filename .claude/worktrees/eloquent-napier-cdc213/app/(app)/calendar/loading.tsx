import "../product.css";
import { LoadingRegion } from "@/components/product-loading";
import { SkeletonBar, SkeletonTabs } from "@/components/ai-elements/skeleton";
import { CalendarSidebarSkeleton, GridSkeleton } from "./page-skeleton";

export default function Loading() {
  return <LoadingRegion className="flex h-full min-h-0 flex-col overflow-hidden">
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-card/40 px-3 py-2.5 sm:px-4">
      <SkeletonBar className="h-8 min-w-0 flex-1 sm:w-48" />
      <div className="order-last w-full sm:order-none sm:w-auto"><SkeletonTabs count={3} /></div>
      <SkeletonBar className="h-8 w-28 rounded-lg" /><SkeletonBar className="size-8 shrink-0 rounded-lg sm:w-24" />
    </header>
    <div className="flex min-h-0 flex-1 overflow-hidden"><aside className="hidden w-64 shrink-0 border-r border-border bg-card/30 p-4 lg:flex xl:w-72"><CalendarSidebarSkeleton /></aside><div className="flex min-h-0 min-w-0 flex-1 flex-col"><GridSkeleton view="month" /></div></div>
  </LoadingRegion>;
}
