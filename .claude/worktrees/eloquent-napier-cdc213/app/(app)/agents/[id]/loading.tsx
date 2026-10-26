import "../../product.css";
import { LoadingRegion } from "@/components/product-loading";
import { WorkspaceSkeleton } from "@/components/ai-elements/skeleton";

export default function Loading() {
  return <LoadingRegion className="h-full min-h-0"><WorkspaceSkeleton kind="agent" /></LoadingRegion>;
}
