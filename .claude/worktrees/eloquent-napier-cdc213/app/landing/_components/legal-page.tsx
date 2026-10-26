"use client";

import type { ReactNode } from "react";
import entityData from "@/content/entity.json";
import { useT } from "@/lib/i18n/provider";
import { Reveal, Shell } from "./primitives";
import { MarketingShell, PageHeader } from "./marketing-shell";
import styles from "./editorial.module.css";
import { Grain } from "./grain";

export const ENTITY: {
  readonly address: string | null;
  readonly email: string | null;
  readonly jurisdiction: string | null;
  readonly name: string | null;
} = {
  address: entityData.address ?? null,
  email: entityData.email ?? null,
  jurisdiction: entityData.jurisdiction ?? null,
  name: entityData.name ?? null,
};

const ENTITY_LABEL_KEY = {
  address: "legal.entityAddress",
  email: "legal.entityEmail",
  jurisdiction: "legal.entityJurisdiction",
  name: "legal.entityName",
} as const;

/**
 * A field of `ENTITY` rendered inline. Unset fields print as a marked slot
 * rather than as blank space or a plausible invention, so an unfinished
 * clause is visible in the page itself and not only in a comment.
 */
export function Entity({ field }: { readonly field: keyof typeof ENTITY }) {
  const t = useT();
  const value = ENTITY[field];
  if (value) return <>{value}</>;
  return (
    <span className="rounded border border-dashed border-muted-foreground/50 px-1.5 py-0.5 font-mono text-[0.85em] text-muted-foreground">
      {t("legal.entityUndefined", { label: t(ENTITY_LABEL_KEY[field]) })}
    </span>
  );
}

/** True while any field is still unset. */
export const ENTITY_INCOMPLETE = Object.values(ENTITY).some((value) => value === null);

export function Clause({ children, title }: { readonly children: ReactNode; readonly title: string }) {
  return (
    <Reveal className="border-border border-t py-8 first:border-t-0 first:pt-0">
      <h2 className="text-lg font-medium tracking-[-0.02em]">{title}</h2>
      <div className="mt-3 flex max-w-[68ch] flex-col gap-3 text-[15px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </Reveal>
  );
}

/**
 * The shared frame for the two legal pages: the marketing chrome, the page
 * header, the draft notice while `ENTITY` is incomplete, and the clause rail.
 */
export function LegalPage({
  children,
  lede,
  title,
  updated,
}: {
  readonly children: ReactNode;
  readonly lede: string;
  readonly title: string;
  readonly updated: string;
}) {
  const t = useT();

  return (
    <MarketingShell>
      <PageHeader
        eyebrow={t("legal.updatedOn", { updated })}
        title={title}
        titleClassName="font-cooper"
        lede={lede}
      />

      <section className={`${styles.surface} ${styles.publicBody} py-16 sm:py-20`}>
        <Grain />
        <Shell className={styles.publicBodyContent}>
          <div className="max-w-[72ch]">{children}</div>
        </Shell>
      </section>
    </MarketingShell>
  );
}
