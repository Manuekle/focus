"use client";

import "../../product.css";
import { BillingSkeleton } from "./page-skeleton";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BillingPortalButton } from "@/components/billing-portal-button";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Alert } from "@/components/ui/alert";
import {
  CrownIcon,
  Invoice04Icon,
  StripeIcon,
  Calendar01Icon,
  CheckIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { PageContainer } from "../../../_components/page-container";
import { Card, CardHeader, CardTitle, CardDescription, CardSeparator, CardBody } from "../../../_components/dashboard-card";
import { Button } from "@/components/ui/button";
import { StripeMark } from "@/app/landing/_components/brand-marks";
import { StatusBadge, type StatusVariant } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ai-elements/skeleton";
import { useI18n } from "@/lib/i18n/provider";
import { fetchJson } from "@/lib/api-error-message";
import type { BillingOverview, PlanAccess } from "@/lib/billing-summary";
import type { BillingState } from "@/lib/billing-store";
import { formatUSD, getPlan } from "@/lib/plans";
import type { LicenseInfo } from "@/lib/license/types";
import { ChangePlanDialog } from "./_components/change-plan-dialog";
import { PaymentMethodDialog } from "./_components/payment-method-dialog";
import { ConnectButton } from "@/components/connections/connect-button";
import { ProductFigure, type ProductFigureKind } from "@/components/hairline/product-figure";

// One page, five installs' worth of answers. What applies depends on how the
// plan is held (lib/billing-summary.ts), decided on the server: a beta tenant
// sees its plan and that nothing is billed, a paying tenant sees the plan the
// fleet manages, a self-hosted install keeps its own checkout and licence, and
// www.oruka.si is told it is the install that sells plans.

const BADGE: Record<PlanAccess, StatusVariant> = {
  beta: "in-progress",
  subscription: "active",
  license: "active",
  operator: "draft",
  none: "expired",
};

const FEATURE_FIGURES: Record<string, ProductFigureKind> = {
  "plan.pro.feature1": "credits",
  "plan.pro.feature2": "channels",
  "plan.pro.feature3": "archive",
};

export default function BillingPage() {
  const { locale, t } = useI18n();
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [billing, setBilling] = useState<BillingOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const loadBilling = useCallback(async () => {
    const result = await fetchJson<BillingOverview>("/api/billing/plan", t);
    if (result.ok) setBilling(result.data);
    setLoading(false);
  }, [t]);

  useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  // The licence only means something on a self-hosted install.
  const selfHosted = billing?.mode === "self-hosted";
  useEffect(() => {
    if (!selfHosted) return;
    void fetch("/api/license")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: LicenseInfo | null) => {
        if (data) setLicense(data);
      })
      .catch(() => null);
  }, [selfHosted]);

  /** A plan change answers with the bare state; keep what the server decided. */
  const applyState = useCallback((state: BillingState) => {
    setBilling((current) => (current ? { ...current, ...state } : current));
  }, []);

  const cancelPending = useCallback(async () => {
    const result = await fetchJson<{ state: BillingState }>("/api/billing/plan", t, {
      method: "DELETE",
    });
    if (result.ok) applyState(result.data.state);
  }, [applyState, t]);

  const formatDate = useCallback(
    (iso: string | null | undefined) =>
      iso
        ? new Date(iso).toLocaleDateString(locale === "es" ? "es-AR" : "en-US", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })
        : "",
    [locale],
  );
  const pendingDate = useMemo(
    () => formatDate(billing?.pendingChange?.effectiveAt),
    [billing?.pendingChange?.effectiveAt, formatDate],
  );

  const access = billing?.access ?? "none";
  const plan = billing && billing.plan !== "none" ? getPlan(billing.plan) : null;
  const pastDue = billing?.paymentPastDue === true && access === "subscription";

  const planName =
    access === "operator"
      ? t("billing.operatorName")
      : access === "license"
        ? (license?.payload?.edition ?? "enterprise").replace(/^./, (c) => c.toUpperCase())
        : plan
          ? t(plan.nameKey)
          : t("billing.noPlan");
  const planSummary =
    access === "operator"
      ? t("billing.operatorSummary")
      : access === "license"
        ? (license?.payload?.company ?? t("plan.enterprise.summary"))
        : plan
          ? t(plan.summaryKey)
          : billing?.mode === "tenant"
            ? t("billing.noneHosted")
            : t("billing.noneSelfHosted");
  const price =
    plan && (access === "beta" || access === "subscription")
      ? plan.interval === "month"
        ? `${formatUSD(plan.amount)}${t("billing.perMonth")}`
        : `${formatUSD(plan.amount)} ${t("billing.oneTime")}`
      : null;

  return (
    <PageContainer
      maxWidth="max-w-4xl"
      title={t("billing.title")}
      description={t("billing.subtitle")}
      back={{ href: "/account", label: t("billing.back") }}
    >
      <Skeleton className="min-h-[500px]" isLoading={loading} skeleton={<BillingSkeleton />}>
      <div className="content-enter">
        {pastDue ? (
          <Alert tone="error" title={t("billing.pastDueTitle")} className="mb-4">
            {t("billing.pastDueBody")}
          </Alert>
        ) : null}

        <Card className="mb-4">
          <CardHeader>
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
              <HugeiconsIcon icon={CrownIcon} size={16} strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle>{t("billing.planTitle")}</CardTitle>
              <CardDescription>{t(`billing.accessHint.${access}`)}</CardDescription>
            </div>
            <StatusBadge
              className="shrink-0"
              status={pastDue ? "warning" : BADGE[access]}
              label={pastDue ? t("billing.access.pastDue") : t(`billing.access.${access}`)}
            />
          </CardHeader>
          <CardSeparator />
          <CardBody>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="font-heading text-2xl font-medium tracking-[-0.02em]">{planName}</p>
              {price ? (
                <p className="text-sm text-muted-foreground tabular-nums">
                  {access === "beta" ? (
                    <>
                      <span className="line-through decoration-muted-foreground/60">{price}</span>{" "}
                      <span className="font-medium text-foreground">{t("billing.betaPrice")}</span>
                    </>
                  ) : (
                    price
                  )}
                </p>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{planSummary}</p>

            {plan && (access === "beta" || access === "subscription") ? (
              <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {plan.featureKeys.map((key) => (
                  <li
                    key={key}
                    className={FEATURE_FIGURES[key]
                      ? "flex min-w-0 flex-col items-stretch gap-2 rounded-xl border border-border bg-muted/20 p-3 text-sm min-[360px]:flex-row min-[360px]:items-center min-[360px]:gap-3 sm:flex-col sm:items-stretch sm:gap-2"
                      : "flex items-start gap-2 rounded-xl border border-border bg-muted/20 p-3 text-sm"}
                  >
                    {FEATURE_FIGURES[key] ? (
                      <ProductFigure kind={FEATURE_FIGURES[key]} surface="feature" className="mx-auto w-32 min-[360px]:mx-0 min-[360px]:w-24 sm:mx-auto sm:w-full sm:max-w-40" />
                    ) : null}
                    <div className="flex min-w-0 items-start gap-2">
                      <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <span className="min-w-0">{t(key)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {access === "beta" ? (
              <Alert tone="info" role={null} title={t("billing.betaTitle")} className="mt-4">
                {t("billing.betaBody")}
              </Alert>
            ) : null}

            {access === "operator" ? (
              <p className="mt-4 text-sm text-muted-foreground">{t("billing.operatorBody")}</p>
            ) : null}

            {access === "license" ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-border bg-muted/20 p-3">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <HugeiconsIcon icon={Calendar01Icon} size={12} strokeWidth={1.75} />
                    {t("billing.maintenanceUntil")}
                  </p>
                  <p className="mt-1 text-sm font-medium">
                    {license?.payload?.maintenanceUntil ? formatDate(license.payload.maintenanceUntil) : "—"}
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-muted/20 p-3">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <HugeiconsIcon icon={CheckIcon} size={12} strokeWidth={1.75} />
                    {t("billing.statusLabel")}
                  </p>
                  <p className="mt-1 text-sm font-medium">
                    {license?.maintenanceActive ? t("billing.licenseValid") : t("account.planMaintenanceExpired")}
                  </p>
                </div>
              </div>
            ) : null}

            {access === "subscription" && billing?.periodEnd && !billing.pendingChange ? (
              <p className="mt-4 text-sm text-muted-foreground">
                {t("billing.renewsOn", { date: formatDate(billing.periodEnd) })}
              </p>
            ) : null}

            {billing?.pendingChange ? (
              <Alert
                tone="warning"
                role={null}
                title={t("billing.pendingTitle")}
                className="mt-4"
                action={
                  <Button size="sm" variant="secondary" onClick={() => void cancelPending()}>
                    {t("billing.pendingKeep", {
                      plan: billing.plan === "none" ? "—" : t(getPlan(billing.plan).nameKey),
                    })}
                  </Button>
                }
              >
                {t("billing.pendingBody", {
                  plan: t(getPlan(billing.pendingChange.to).nameKey),
                  date: pendingDate,
                })}
              </Alert>
            ) : null}

            {billing?.managedByFleet && access !== "beta" ? (
              <p className="mt-4 text-sm text-muted-foreground">{t("billing.managedByFleet")}</p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              {billing?.managedByFleet ? (
                <>
                  {access !== "beta" ? (
                    <BillingPortalButton size="sm">{access === "none" ? t("billing.portalPay") : t("billing.portalOpen")}</BillingPortalButton>
                  ) : null}
                  <Button asChild size="sm" variant={access === "beta" ? "default" : "secondary"}>
                    <Link href="/help">{t("billing.contactOruka")}</Link>
                  </Button>
                </>
              ) : billing?.canChangePlan ? (
                <ChangePlanDialog state={billing} onChanged={applyState}>
                  <Button size="sm">{t("billing.changePlan")}</Button>
                </ChangePlanDialog>
              ) : null}
              {access === "operator" ? null : (
                <Button asChild variant="secondary" size="sm">
                  <Link href="/pricing">{t("billing.viewPricing")}</Link>
                </Button>
              )}
            </div>
          </CardBody>
        </Card>

        {access === "beta" || access === "operator" ? (
          // Nothing is billed here: one line says so instead of an empty
          // payment form and an empty invoice list.
          <Card>
            <CardHeader>
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                <HugeiconsIcon icon={Invoice04Icon} size={16} strokeWidth={1.75} />
              </div>
              <div className="min-w-0 flex-1">
                <CardTitle>{t("billing.paymentsTitle")}</CardTitle>
                <CardDescription>
                  {access === "beta" ? t("billing.paymentsBeta") : t("billing.paymentsOperator")}
                </CardDescription>
              </div>
            </CardHeader>
          </Card>
        ) : (
          <>
            <Card className="mb-4">
              <CardHeader>
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground shadow-[var(--shadow-inset)]">
                  <HugeiconsIcon icon={StripeIcon} size={16} strokeWidth={1.75} className="text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle>{t("billing.paymentTitle")}</CardTitle>
                  <CardDescription>{t("billing.paymentDescription")}</CardDescription>
                </div>
              </CardHeader>
              <CardSeparator />
              <CardBody>
                <p className="text-sm text-muted-foreground">
                  {billing?.managedByFleet
                    ? t("billing.paymentManaged")
                    : billing?.hasPaymentMethod
                      ? t("billing.paymentOnFile")
                      : t("billing.paymentEmpty")}
                </p>
                {billing?.managedByFleet ? (
                  <BillingPortalButton variant="outline" className="mt-3">
                    <StripeMark size={16} />
                    {t("billing.portalOpen")}
                  </BillingPortalButton>
                ) : (
                  <PaymentMethodDialog>
                    {/* The Connect buttons' brand surface (fill, ink, hairline
                        and ring in Stripe violet), with the Stripe mark. */}
                    <ConnectButton tone="stripe" className="mt-3">
                      {t("billing.paymentAdd")}
                    </ConnectButton>
                  </PaymentMethodDialog>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                  <HugeiconsIcon icon={Invoice04Icon} size={16} strokeWidth={1.75} />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle>{t("billing.invoicesTitle")}</CardTitle>
                  <CardDescription>{t("billing.invoicesDescription")}</CardDescription>
                </div>
              </CardHeader>
              <CardSeparator />
              <CardBody>
                <p className="py-6 text-center text-sm text-muted-foreground">{t("billing.invoicesEmpty")}</p>
              </CardBody>
            </Card>
          </>
        )}
      </div>
      </Skeleton>
    </PageContainer>
  );
}
