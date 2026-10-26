import "../product.css";
import { ProductPageLoading } from "@/components/product-loading";
import { SkeletonBar } from "@/components/ai-elements/skeleton";

export default function Loading() {
  return <ProductPageLoading maxWidth="max-w-4xl">
    <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="space-y-3 rounded-2xl border border-border bg-card p-5"><SkeletonBar className="h-4 w-48" /><SkeletonBar className="h-3 w-full max-w-md" /><SkeletonBar className="h-3 w-2/3 max-w-sm" /></div>)}</div>
    <div className="mt-10 flex items-center gap-2 border-t border-border pt-4"><SkeletonBar className="size-4" /><SkeletonBar className="h-4 w-40" /><SkeletonBar className="ml-auto size-4" /></div>
  </ProductPageLoading>;
}
