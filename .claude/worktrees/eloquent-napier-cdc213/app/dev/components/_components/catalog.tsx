"use client";

// The catalog shell: a sticky index on the left, the entries on the right.
//
// It is a single client component on purpose. Everything it renders is a live
// example, so there is no server half worth splitting out, and the filter has
// to see every entry at once to be able to hide the sections that empty out.

import { useEffect, useMemo, useRef, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { ThemeToggle } from "@/components/motion/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import { CatalogI18nProvider, ct, useCatalogT } from "../_lib/catalog-i18n";
import { DemoBlock, ExportList, ImportLine, PropsTable } from "../_lib/kit";
import { getCatalog } from "../_registry";
import type { Entry, Section } from "../_lib/types";

/** Lowercased and stripped of accents, so "boton" finds "Botón". */
function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function matches(entry: Entry, query: string): boolean {
  if (!query) return true;
  const haystack = fold(
    [entry.name, entry.source, entry.desc, ...(entry.exports ?? [])].join(" "),
  );
  // Every word has to appear somewhere, in any order: "badge status" and
  // "status badge" find the same thing.
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

// ── Language toggle ─────────────────────────────────────────────────

function LanguageToggle() {
  const { locale, setLocale } = useCatalogT();
  return (
    <Button
      variant="outline"
      size="xs"
      onClick={() => setLocale(locale === "es" ? "en" : "es")}
      className="font-mono text-[11px]"
    >
      {locale === "es" ? "EN" : "ES"}
    </Button>
  );
}

// ── Entry ───────────────────────────────────────────────────────────

function EntryBlock({ entry }: { readonly entry: Entry }) {
  return (
    <article
      id={entry.id}
      // The sticky header would otherwise eat the heading of whatever an
      // anchor click lands on.
      className="scroll-mt-24 border-t border-border pt-10 first:border-t-0 first:pt-0"
    >
      <header className="mb-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="font-heading text-xl tracking-[-0.02em]">{entry.name}</h3>
          <code className="font-mono text-[11px] text-muted-foreground">{entry.source}</code>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {entry.desc}
        </p>
      </header>

      <div className="mb-5 max-w-2xl">
        <ImportLine line={entry.importLine} />
      </div>

      {entry.notes?.length ? (
        <ul className="mb-5 max-w-2xl space-y-1.5 rounded-xl border border-border bg-muted/40 p-3.5">
          {entry.notes.map((note) => (
            <li key={note} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
              <span aria-hidden="true" className="mt-1.5 size-1 shrink-0 rounded-full bg-foreground/40" />
              {note}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-4">
        {entry.demos.map((demo) => (
          <DemoBlock key={demo.id} demo={demo} />
        ))}
      </div>

      {entry.props?.length ? (
        <div className="mt-5">
          <h4 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {ct("shell.props")}
          </h4>
          <PropsTable props={entry.props} />
        </div>
      ) : null}

      {entry.exports?.length ? (
        <div className="mt-5">
          <h4 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {ct("shell.exports")}
          </h4>
          <ExportList names={entry.exports} />
        </div>
      ) : null}
    </article>
  );
}

// ── Shell ───────────────────────────────────────────────────────────

function CatalogInner() {
  const { ct: t, locale } = useCatalogT();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string>(() => getCatalog(locale)[0]?.entries[0]?.id ?? "");
  const searchRef = useRef<HTMLInputElement>(null);

  const sections: readonly Section[] = useMemo(() => {
    const catalog = getCatalog(locale);
    if (!query) return catalog;
    return catalog
      .map((section) => ({
        ...section,
        entries: section.entries.filter((entry) => matches(entry, query)),
      }))
      .filter((section) => section.entries.length > 0);
  }, [query, locale]);

  const total = useMemo(
    () => getCatalog(locale).reduce((sum, section) => sum + section.entries.length, 0),
    [locale],
  );
  const shown = sections.reduce((sum, section) => sum + section.entries.length, 0);

  // "/" focuses the filter, the way it does in every other index-shaped page.
  // Guarded so it does not steal the key from whatever the user is typing in.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Which entry the reader is on. `rootMargin` pins the trigger line just
  // under the sticky header rather than at the viewport edge, so the sidebar
  // highlights what is actually being read and not what is half off-screen.
  useEffect(() => {
    const headings = Array.from(document.querySelectorAll<HTMLElement>("article[id]"));
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-88px 0px -70% 0px", threshold: 0 },
    );

    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [sections]);

  return (
    <div className="min-h-dvh bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-5 py-3 sm:px-8">
          <div className="flex items-center gap-2.5">
            <h1 className="font-heading text-base tracking-[-0.02em]">{t("shell.title")}</h1>
            <Badge variant="outline" className="font-mono text-[10px]">
              {t("shell.badge")}
            </Badge>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <LanguageToggle />
            <InputGroup className="w-56">
              <InputGroupAddon>
                <HugeiconsIcon icon={Search01Icon} strokeWidth={1.75} />
              </InputGroupAddon>
              <InputGroupInput
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("shell.filterPlaceholder")}
                aria-label={t("shell.filterLabel")}
              />
              {query ? (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    aria-label={t("shell.clearFilterLabel")}
                    onClick={() => setQuery("")}
                  >
                    <HugeiconsIcon icon={Cancel01Icon} strokeWidth={1.75} />
                  </InputGroupButton>
                </InputGroupAddon>
              ) : null}
            </InputGroup>
            <ThemeToggle variant="circle-blur" start="top-right" />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-10 px-5 py-8 sm:px-8">
        {/* Index */}
        <nav
          aria-label={t("shell.indexLabel")}
          className="sticky top-[4.5rem] hidden h-[calc(100dvh-6rem)] w-56 shrink-0 overflow-y-auto pb-8 lg:block"
        >
          <p className="mb-3 font-mono text-[10.5px] text-muted-foreground">
            {shown === total
              ? t("shell.total", { total: String(total) })
              : t("shell.showing", { shown: String(shown), total: String(total) })}
          </p>
          {sections.map((section) => (
            <div key={section.id} className="mb-5">
              <p className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {section.title}
              </p>
              <ul className="space-y-px">
                {section.entries.map((entry) => (
                  <li key={entry.id}>
                    <a
                      href={`#${entry.id}`}
                      aria-current={active === entry.id ? "true" : undefined}
                      className={cn(
                        "block rounded-md px-2 py-1 text-[13px] transition-colors duration-150",
                        active === entry.id
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                      )}
                    >
                      {entry.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Entries */}
        <main className="min-w-0 flex-1">
          {sections.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <p className="text-sm text-muted-foreground">
                {t("shell.emptyMatch", { query })}
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setQuery("")}>
                {t("shell.clearFilter")}
              </Button>
            </div>
          ) : (
            sections.map((section) => (
              <section key={section.id} id={section.id} className="mb-14 scroll-mt-24">
                <div className="mb-8">
                  <h2 className="font-heading text-2xl tracking-[-0.02em]">{section.title}</h2>
                  <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                    {section.desc}
                  </p>
                </div>
                <div className="flex flex-col gap-10">
                  {section.entries.map((entry) => (
                    <EntryBlock key={entry.id} entry={entry} />
                  ))}
                </div>
              </section>
            ))
          )}
        </main>
      </div>
    </div>
  );
}

export function Catalog() {
  return (
    <CatalogI18nProvider>
      <CatalogInner />
    </CatalogI18nProvider>
  );
}
