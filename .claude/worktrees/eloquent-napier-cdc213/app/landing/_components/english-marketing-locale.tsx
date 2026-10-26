"use client";

import type { ReactNode } from "react";
import { en } from "@/lib/i18n/dictionary-public-en";
import { registerDictionary } from "@/lib/i18n/dictionaries";
import { I18nLocale } from "@/lib/i18n/provider";

// This module is imported only by the /en route tree. Registering the already
// loaded English dictionary keeps the server HTML English instead of briefly
// falling back to Spanish while a client-side chunk downloads.
registerDictionary("en", en);

export function EnglishMarketingLocale({ children }: { readonly children: ReactNode }) {
  return <div lang="en"><I18nLocale locale="en">{children}</I18nLocale></div>;
}
