"use client";
import type { ReactNode } from "react";
import { FontPlatform } from "./font-platform";
import { ThemeProvider } from "./theme-provider";
import { SoundProvider } from "./sound-provider";
import { ToastProvider } from "./toast-provider";
import { MotionProvider } from "./motion/provider";
import { TooltipProvider } from "./ui/tooltip";
import { I18nProvider, type Locale } from "../lib/i18n/provider";

/** Mount once above your app. Every optional feedback channel is user-controllable. */
export function FocusProvider({ children, locale = "es", messages, forcedTheme }: {
  readonly children: ReactNode;
  readonly locale?: Locale;
  readonly messages?: Partial<Record<Locale, Record<string,string>>>;
  readonly forcedTheme?: "light" | "dark";
}) {
  return <ThemeProvider forcedTheme={forcedTheme}><MotionProvider><I18nProvider initialLocale={locale} messages={messages}>
    <SoundProvider><TooltipProvider><ToastProvider><FontPlatform />{children}</ToastProvider></TooltipProvider></SoundProvider>
  </I18nProvider></MotionProvider></ThemeProvider>;
}
export { useTheme } from "./theme-provider";
export { useToast } from "./toast-provider";
export { useSound } from "./sound-provider";
export { useI18n, useT } from "../lib/i18n/provider";
