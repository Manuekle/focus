import "../product.css";
import { ProductPageLoading } from "@/components/product-loading";
import { SkeletonTabs } from "@/components/ai-elements/skeleton";
import { PanelSkeleton } from "./page-skeleton";

export default function Loading() {
  return <ProductPageLoading><SkeletonTabs count={4} className="mb-6" /><PanelSkeleton /></ProductPageLoading>;
}
