import "../product.css";
import { ProductPageLoading } from "@/components/product-loading";
import { InboxSkeleton } from "./page-skeleton";

export default function Loading() {
  return <ProductPageLoading><InboxSkeleton /></ProductPageLoading>;
}
