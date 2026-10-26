import type { ReactNode } from "react";
import { EnglishMarketingLocale } from "@/app/landing/_components/english-marketing-locale";

export default function EnglishMarketingLayout({ children }: { readonly children: ReactNode }) {
  return <EnglishMarketingLocale>{children}</EnglishMarketingLocale>;
}
