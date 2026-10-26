import "../product.css";
import { ProductPageLoading } from "@/components/product-loading";
import { NumbersSkeleton } from "./page-skeleton";

export default function Loading() {
  return <ProductPageLoading actions={2}><NumbersSkeleton /></ProductPageLoading>;
}
