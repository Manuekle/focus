import "../product.css";
import { ProductPageLoading } from "@/components/product-loading";
import { NotificationsSkeleton } from "./page-skeleton";

export default function Loading() {
  return <ProductPageLoading maxWidth="max-w-6xl"><NotificationsSkeleton /></ProductPageLoading>;
}
