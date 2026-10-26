import "../product.css";
import { ProductPageLoading } from "@/components/product-loading";
import { SkillsSkeleton } from "./page-skeleton";

export default function Loading() {
  return <ProductPageLoading maxWidth="max-w-6xl"><SkillsSkeleton /></ProductPageLoading>;
}
