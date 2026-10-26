"use client";

import "../product.css";
import { CatalogSkeleton } from "./page-skeleton";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  AiImagineIcon,
  AlertCircleIcon,
  ArrowUpRight01Icon,
  CheckmarkCircle02Icon,
  Loading03Icon,
  PackageIcon,
  SearchIcon,
  ShoppingBag01Icon,
  ZapIcon,
} from "@hugeicons/core-free-icons";
import { PageContainer } from "../../_components/page-container";
import { Card } from "../../_components/dashboard-card";
import { KpiCard } from "../../_components/kpi-card";
import { CardCarousel } from "../../_components/card-carousel";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/error-banner";
import { fetchJson, type UiError } from "@/lib/api-error-message";
import { useI18n } from "@/lib/i18n/provider";
import type { ShopifyProduct } from "@/lib/shopify";
import { cn } from "@/lib/utils";

// The Shopify catalog, as the agent sees it.
//
// Products are managed in Shopify; this page is where the owner checks what
// the agent can offer — what is active, what ran out — and turns that into
// something automatic: the agent answering price, stock and "pasame el link"
// with the `shopify_products` tool.

type CatalogResponse = {
  readonly connected: boolean;
  readonly shop?: string;
  readonly currency?: string;
  readonly products: readonly ShopifyProduct[];
};

type Filter = "all" | "active" | "out" | "draft";

export default function CatalogPage() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    const result = await fetchJson<CatalogResponse>("/api/catalog", t);
    if (result.ok) {
      setData(result.data);
      setError(null);
    } else {
      setError(result.error);
      setData((current) => current ?? { connected: true, products: [] });
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const products = useMemo(() => data?.products ?? [], [data]);
  const active = products.filter((product) => product.status === "active");
  const outOfStock = active.filter((product) => product.inventory === 0);

  const price = useCallback(
    (product: ShopifyProduct) => {
      if (!product.minPrice) return null;
      const format = (value: string) => {
        const amount = Number.parseFloat(value);
        try {
          return data?.currency
            ? new Intl.NumberFormat(locale, { style: "currency", currency: data.currency }).format(amount)
            : new Intl.NumberFormat(locale, { minimumFractionDigits: 2 }).format(amount);
        } catch {
          return value;
        }
      };
      return product.minPrice === product.maxPrice || !product.maxPrice
        ? format(product.minPrice)
        : `${format(product.minPrice)} – ${format(product.maxPrice)}`;
    },
    [data?.currency, locale],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return products.filter((product) => {
      if (filter === "active" && product.status !== "active") return false;
      if (filter === "out" && !(product.status === "active" && product.inventory === 0)) return false;
      if (filter === "draft" && product.status === "active") return false;
      if (!needle) return true;
      return [product.title, product.productType ?? "", product.vendor ?? "", ...product.tags]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [products, search, filter]);

  return (
    <PageContainer
      banner={<ErrorBanner layout="strip" error={error} onRetry={() => void refresh()} />}
      maxWidth="max-w-6xl"
      title={t("catalog.title")}
      description={t("catalog.subtitle")}
      actions={data?.connected && data.shop ? (
        <>
          <Button variant="outline" size="sm" aria-label={t("common.refresh")} onClick={() => void refresh()} disabled={refreshing}>
            <HugeiconsIcon
              icon={Loading03Icon}
              size={16}
              strokeWidth={1.75}
              className={refreshing ? "animate-spin" : undefined}
            />
            <span className="hidden sm:inline">{refreshing ? t("crm.refreshing") : t("common.refresh")}</span>
          </Button>
          <Button asChild size="sm">
            <a href={`https://${data.shop}/admin/products`} target="_blank" rel="noreferrer">
              <HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={1.75} />
              {t("catalog.openShopify")}
            </a>
          </Button>
        </>
      ) : null}
    >
      {data === null ? (
        <CatalogSkeleton />
      ) : !data.connected ? (
        <Card className="content-enter">
          <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
              <HugeiconsIcon icon={ShoppingBag01Icon} size={20} strokeWidth={1.75} />
            </div>
            <p className="text-sm font-medium">{t("catalog.connectTitle")}</p>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">{t("catalog.connectBody")}</p>
            <Button asChild className="mt-2">
              <Link href="/connections">{t("calendar.goToConnections")}</Link>
            </Button>
          </div>
        </Card>
      ) : (
        <div className="content-enter">
          <CardCarousel stats label={t("carousel.stats")}>
            <div className="mb-6 flex items-stretch gap-4" style={{ paddingInline: "2px" }}>
              <div className="min-w-[220px] flex-1">
                <KpiCard icon={PackageIcon} label={t("catalog.kpiProducts")} value={products.length} sub={t("catalog.kpiProductsSub")} />
              </div>
              <div className="min-w-[220px] flex-1">
                <KpiCard
                  icon={CheckmarkCircle02Icon}
                  label={t("catalog.kpiActive")}
                  value={active.length}
                  sub={t("catalog.kpiActiveSub")}
                />
              </div>
              <div className="min-w-[220px] flex-1">
                <KpiCard
                  icon={AlertCircleIcon}
                  label={t("catalog.kpiOut")}
                  value={outOfStock.length}
                  sub={t(outOfStock.length > 0 ? "catalog.kpiOutSub" : "catalog.kpiOutSubNone")}
                />
              </div>
            </div>
          </CardCarousel>

          {/* What the catalog is for: the agent answering on its own. */}
          <div className="mb-6 grid gap-3 md:grid-cols-2">
            <AutomateCard
              icon={AiImagineIcon}
              title={t("catalog.agentTitle")}
              body={t("catalog.agentBody")}
              href="/agents"
              cta={t("catalog.agentCta")}
            />
            <AutomateCard
              icon={ZapIcon}
              title={t("catalog.automationTitle")}
              body={t("catalog.automationBody")}
              href="/automations"
              cta={t("catalog.automationCta")}
            />
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[200px] flex-1">
              <HugeiconsIcon
                icon={SearchIcon}
                size={16}
                strokeWidth={1.75}
                className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-label={t("catalog.search")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("catalog.search")}
                className="pl-9"
              />
            </div>
            <SlidingTabs
              tabs={[
                { id: "all", label: t("catalog.filterAll") },
                { id: "active", label: t("catalog.filterActive") },
                { id: "out", label: t("catalog.filterOut") },
                { id: "draft", label: t("catalog.filterDraft") },
              ]}
              value={filter}
              onValueChange={(next) => setFilter(next as Filter)}
            />
          </div>

          {visible.length === 0 ? (
            <Card>
              <p className="px-5 py-12 text-center text-sm text-muted-foreground">
                {products.length === 0 ? t("catalog.empty") : t("catalog.noResults")}
              </p>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((product) => (
                <ProductCard key={product.id} product={product} price={price(product)} />
              ))}
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}

function AutomateCard({
  icon,
  title,
  body,
  href,
  cta,
}: {
  readonly icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  readonly title: string;
  readonly body: string;
  readonly href: string;
  readonly cta: string;
}) {
  return (
    <Card className="flex items-start gap-3 p-5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
        <HugeiconsIcon icon={icon} size={16} strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{body}</p>
        <Link href={href} className="mt-2 inline-flex text-xs font-medium text-foreground underline underline-offset-2">
          {cta}
        </Link>
      </div>
    </Card>
  );
}

function ProductCard({ product, price }: { readonly product: ShopifyProduct; readonly price: string | null }) {
  const { t } = useI18n();
  const stock =
    product.status !== "active"
      ? { label: t(`catalog.status.${product.status}`), tone: "muted" }
      : product.inventory === null
        ? { label: t("catalog.stockUntracked"), tone: "muted" }
        : product.inventory === 0
          ? { label: t("catalog.stockOut"), tone: "out" }
          : { label: t("catalog.stockIn", { count: String(product.inventory) }), tone: "in" };

  return (
    <Card className="rounded-[20px] border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]">
      <div className="overflow-hidden rounded-[14px] border border-border/50 bg-card p-3 shadow-xs">
        <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl bg-muted">
          {product.image ? (
            // Shopify's CDN, outside next/image's configured hosts.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.image} alt="" loading="lazy" className="size-full object-cover" />
          ) : (
            <HugeiconsIcon icon={PackageIcon} size={24} strokeWidth={1.5} className="text-muted-foreground" />
          )}
        </div>
        <p className="mt-3 line-clamp-2 text-sm font-medium text-foreground">{product.title}</p>
        <p className="mt-1 text-sm tabular-nums text-muted-foreground">{price ?? "—"}</p>
      </div>
      <div className="flex items-center justify-between gap-2 px-2.5 pt-2 pb-0.5">
        <span
          className={cn(
            "pill pill-sm tone-pill",
            stock.tone === "in" && "tone-success",
            stock.tone === "out" && "tone-failed",
            stock.tone === "muted" && "tone-expired",
          )}
        >
          {stock.label}
        </span>
        <a
          href={product.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("catalog.viewInStore")}
          <HugeiconsIcon icon={ArrowUpRight01Icon} size={12} strokeWidth={1.75} />
        </a>
      </div>
    </Card>
  );
}
