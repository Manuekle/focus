import "../product.css";
import { ProductPageLoading } from "@/components/product-loading";
import { CrmSkeleton } from "./page-skeleton";

export default function Loading() {
  return <ProductPageLoading maxWidth="max-w-[1400px]" actions={4}><CrmSkeleton /></ProductPageLoading>;
}
