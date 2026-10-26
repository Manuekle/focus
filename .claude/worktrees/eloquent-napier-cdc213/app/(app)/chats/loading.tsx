import "../product.css";
import { LoadingRegion } from "@/components/product-loading";
import { ChatsSkeleton } from "@/components/ai-elements/skeleton";

export default function Loading() {
  return <LoadingRegion className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"><ChatsSkeleton /></LoadingRegion>;
}
