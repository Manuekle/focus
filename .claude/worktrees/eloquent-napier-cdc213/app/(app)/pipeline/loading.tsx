import "../product.css";
import { ProductPageLoading } from "@/components/product-loading";
import { PipelineSkeleton } from "./page-skeleton";

export default function Loading() {
  return <ProductPageLoading maxWidth="max-w-[1400px]" actions={3}><PipelineSkeleton /></ProductPageLoading>;
}
