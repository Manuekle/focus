import "../product.css";
import { ProductPageLoading } from "@/components/product-loading";
import { AdsSkeleton } from "./page-skeleton";

export default function Loading() {
  return <ProductPageLoading maxWidth="max-w-6xl"><AdsSkeleton /></ProductPageLoading>;
}
