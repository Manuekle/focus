import "../../product.css";
import { ProductPageLoading } from "@/components/product-loading";
import { SkeletonBar } from "@/components/ai-elements/skeleton";

export default function Loading() {
  return <ProductPageLoading maxWidth="max-w-3xl">
    <SkeletonBar className="mb-8 h-5 w-32" />
    <div className="flex min-h-60 flex-col items-center justify-center gap-5 rounded-2xl border border-dashed border-border bg-muted/25 px-6 py-10"><SkeletonBar className="size-12 rounded-2xl" /><SkeletonBar className="h-5 w-48" /><SkeletonBar className="h-4 w-64" /><SkeletonBar className="h-8 w-32 rounded-lg" /></div>
    <SkeletonBar className="mt-6 h-4 w-80" />
  </ProductPageLoading>;
}
