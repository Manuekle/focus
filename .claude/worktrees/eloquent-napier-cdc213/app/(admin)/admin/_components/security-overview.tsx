"use client";

import Link from "next/link";
import { HugeiconsIcon } from "@/components/icons/icon";
import { ArrowRight01Icon, Activity01Icon } from "@hugeicons/core-free-icons";
import { TwoFactorCard } from "@/components/account/two-factor-card";
import { ProductI18n } from "@/lib/i18n/product-provider";
import { useAdminLocale } from "./admin-locale";
import { PageHeader } from "./admin-shell";
import { SecurityCardLoading } from "./admin-loading";

// Seguridad: the operator's own second factor (the product's account card,
// in the product's copy, kept in the panel's language by admin-locale.tsx)
// and the way into the panel's activity log.

export function SecurityOverview({ operator, activityHref }: { readonly operator: string; readonly activityHref: string }) {
  const { tr } = useAdminLocale();
  return (
    <div className="content-enter mx-auto max-w-2xl space-y-6">
      <PageHeader
        title={tr("Seguridad", "Security")}
        description={tr(
          `Tu cuenta (${operator}). Si pierdes el teléfono, entra con un código de recuperación y genera un QR nuevo aquí. Si olvidas la contraseña, en el login usa «¿Olvidaste tu contraseña?» y restablécela con tu app.`,
          `Your account (${operator}). If you lose your phone, sign in with a recovery code and make a new QR here. If you forget your password, use "Forgot your password?" on the login and reset it with your app.`,
        )}
      />
      <ProductI18n>
        <TwoFactorCard loadingFallback={<SecurityCardLoading />} />
      </ProductI18n>
      <Link
        href={activityHref}
        className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-soft)] transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
          <HugeiconsIcon icon={Activity01Icon} size={16} strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{tr("Actividad del panel", "Panel activity")}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {tr("Quién cambió qué en clientes, solicitudes, anuncios y despliegues.", "Who changed what in customers, requests, announcements and deployments.")}
          </span>
        </span>
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={16}
          strokeWidth={1.75}
          className="shrink-0 text-muted-foreground transition-transform duration-200 ease-expo-out group-hover:translate-x-0.5"
        />
      </Link>
    </div>
  );
}
