import "../product.css";
import { EditorShellSkeleton } from "@/components/product-loading";
import { LinkProfileSkeleton } from "./page-skeleton";

export default function Loading() {
  return <EditorShellSkeleton kind="links"><LinkProfileSkeleton /></EditorShellSkeleton>;
}
