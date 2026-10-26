import "../product.css";
import { ProductPageLoading } from "@/components/product-loading";
import { HelpPanelSkeleton } from "./page-skeleton";

export default function Loading() {
  return <ProductPageLoading><HelpPanelSkeleton /></ProductPageLoading>;
}
