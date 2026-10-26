import type { ReactNode } from "react";
import { LinkPageFonts } from "@/components/link-page-fonts";

export default function Layout({ children }: { readonly children: ReactNode }) {
  return <LinkPageFonts>{children}</LinkPageFonts>;
}
