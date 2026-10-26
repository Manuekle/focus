import "../product.css";
import { ProductPageLoading } from "@/components/product-loading";
import { KnowledgeSkeleton } from "./page-skeleton";

export default function Loading() {
  return <ProductPageLoading maxWidth="max-w-6xl"><KnowledgeSkeleton /></ProductPageLoading>;
}
