import "../../product.css";
import { EditorShellSkeleton } from "@/components/product-loading";
import { EditorSkeleton } from "./page-skeleton";

export default function Loading() {
  return <EditorShellSkeleton kind="form"><EditorSkeleton /></EditorShellSkeleton>;
}
