import "../product.css";
import { LoadingRegion } from "@/components/product-loading";
import { TeamSkeleton } from "../runtime/_components/team-panel";

export default function Loading() {
  return <LoadingRegion className="flex h-full min-h-0 flex-col"><TeamSkeleton label="" feedOnly fill /></LoadingRegion>;
}
