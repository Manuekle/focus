import "../product.css";
import { ProductPageLoading } from "@/components/product-loading";
import { AutomationsSkeleton } from "@/components/ai-elements/skeleton";

export default function Loading() {
  return <ProductPageLoading maxWidth="max-w-6xl"><AutomationsSkeleton /></ProductPageLoading>;
}
