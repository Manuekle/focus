import "../product.css";
import { ProductPageLoading } from "@/components/product-loading";
import { CatalogSkeleton } from "./page-skeleton";

export default function Loading() {
  return <ProductPageLoading><CatalogSkeleton /></ProductPageLoading>;
}
