"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { AdminAnnouncementAudience } from "@/lib/admin-types";
import { ADMIN_LOCALE_COOKIE, type AdminLocale } from "@/lib/admin-locale";
import type { Revenue } from "@/lib/admin-overview";
import { useOptionalAppLocale } from "@/lib/i18n/provider";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Globe02Icon } from "@hugeicons/core-free-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  adminLabels,
  audienceSummary,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  relativeTime,
  revenueHint,
  slugReasonLabel,
} from "./format";

// The panel's language on the client (lib/admin-locale.ts). The layout reads
// the cookie and hands the first value down, so both renders agree; the
// switch writes the cookie, flips the client at once and refreshes what the
// server rendered. Product components inside the panel (the 2FA card) follow
// through the product's own preference, kept in step here.

type Context = { readonly locale: AdminLocale; readonly setLocale: (next: AdminLocale) => void };

const AdminLocaleContext = createContext<Context>({ locale: "es", setLocale: () => undefined });

export function AdminLocaleProvider({ initial, children }: { readonly initial: AdminLocale; readonly children: ReactNode }) {
  const router = useRouter();
  const app = useOptionalAppLocale();
  const [locale, setState] = useState<AdminLocale>(initial);

  useEffect(() => {
    if (app && app.locale !== locale) app.setLocale(locale);
  }, [app, locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback(
    (next: AdminLocale) => {
      const secure = window.location.protocol === "https:" ? "; secure" : "";
      document.cookie = `${ADMIN_LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax${secure}`;
      setState(next);
      router.refresh();
    },
    [router],
  );

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <AdminLocaleContext.Provider value={value}>{children}</AdminLocaleContext.Provider>;
}

/** The panel's language, its labels and formats; `tr("Hola", "Hello")` picks one. */
export function useAdminLocale() {
  const { locale, setLocale } = useContext(AdminLocaleContext);
  return useMemo(() => {
    const tr = (es: string, en: string) => (locale === "en" ? en : es);
    return {
      locale,
      setLocale,
      tr,
      labels: adminLabels(locale),
      fmt: {
        dateTime: (iso: string | null | undefined) => formatDateTime(iso, locale),
        date: (iso: string | null | undefined) => formatDate(iso, locale),
        relative: (iso: string | null | undefined, now: number) => relativeTime(iso, now, locale),
        number: (value: number) => formatNumber(value, locale),
        money: (value: number, currency: string) => formatMoney(value, currency, locale),
        audience: (audience: AdminAnnouncementAudience) => audienceSummary(audience, locale),
        revenue: (revenue: Revenue) => revenueHint(revenue, locale),
        slugReason: (reason: string | null) => slugReasonLabel(reason, locale),
        /** "1 cliente" / "3 customers". */
        count: (value: number, es: [string, string], en: [string, string]) =>
          `${formatNumber(value, locale)} ${(locale === "en" ? en : es)[value === 1 ? 0 : 1]}`,
      },
    };
  }, [locale, setLocale]);
}

/** The same compact icon control as the theme switch beside it. */
export function LanguageSwitch({ className }: { readonly className?: string }) {
  const { locale, setLocale } = useAdminLocale();
  const nextLocale = locale === "es" ? "en" : "es";
  const label = locale === "es" ? "Switch to English" : "Cambiar a Español";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => setLocale(nextLocale)}
          aria-label={label}
          data-cuelume-toggle
          className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none", className)}
        >
          <HugeiconsIcon icon={Globe02Icon} size={14} strokeWidth={1.75} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
