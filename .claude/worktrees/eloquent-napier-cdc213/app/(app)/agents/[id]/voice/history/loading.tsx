import "../../../../product.css";
import { AgentSessionSkeleton } from "@/components/product-loading";

export default function Loading() {
  return <AgentSessionSkeleton kind="history" />;
}
