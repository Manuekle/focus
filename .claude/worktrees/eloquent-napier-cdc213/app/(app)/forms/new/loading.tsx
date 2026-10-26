import "../../product.css";
import { ProductPageLoading } from "@/components/product-loading";
import { SkeletonBar } from "@/components/ai-elements/skeleton";

export default function Loading() {
  return <ProductPageLoading maxWidth="max-w-2xl">
    <SkeletonBar className="mb-8 h-4 w-40" />
    <SkeletonBar className="mb-8 h-4 w-24" />
    <div className="mb-6 space-y-3"><SkeletonBar className="h-7 w-64" /><SkeletonBar className="h-4 w-80" /></div>
    <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"><SkeletonBar className="size-8 shrink-0 rounded-lg" /><SkeletonBar className="h-4 w-32" /></div>)}</div>
    <div className="mt-8 flex justify-between gap-3"><SkeletonBar className="h-8 w-24 rounded-lg" /><SkeletonBar className="h-8 w-28 rounded-lg" /></div>
  </ProductPageLoading>;
}
