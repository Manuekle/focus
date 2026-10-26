"use client";

import { ArrowLeft01Icon, Calendar03Icon, CloudUploadIcon, LockPasswordIcon, Logout01Icon, Mail01Icon, Megaphone01Icon, UserMultiple02Icon } from "@hugeicons/core-free-icons";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { HugeiconsIcon } from "@/components/icons/icon";

import { OrukaTile } from "@/components/icons/oruka-mark";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { LanguageSwitch, useAdminLocale } from "./admin-locale";

// The panel's frame: brand, sections, language, theme, who is signed in.
// Its copy is the panel's own (admin-locale.tsx), kept out of the product
// dictionaries the customers' installs download.

const BaseContext = createContext("/admin");
const TimeContext = createContext(0);

/** One server timestamp for the first client render, including relative dates. */
export function useAdminNow(): number {
  return useContext(TimeContext);
}

/** `/admin` on www, `` on admin.oruka.si (lib/admin.ts adminBasePath). */
export function useAdminHref(): (path?: string) => string {
  const base = useContext(BaseContext);
  return (path = "") => `${base}${path}` || "/";
}

const NAV = [
  { href: "", es: "Clientes", en: "Customers", icon: UserMultiple02Icon },
  { href: "/requests", es: "Solicitudes", en: "Requests", icon: Mail01Icon },
  { href: "/calls", es: "Llamadas", en: "Calls", icon: Calendar03Icon },
  { href: "/deployments", es: "Despliegues", en: "Deployments", icon: CloudUploadIcon },
  { href: "/announcements", es: "Anuncios", en: "Announcements", icon: Megaphone01Icon },
  { href: "/security", es: "Seguridad", en: "Security", icon: LockPasswordIcon },
] as const;

/** The section row scrolls sideways on a phone; its clipped side fades instead of being cut. */
function useEdgeFade<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    el.style.setProperty("--x-fade-start", max > 0 && el.scrollLeft > 4 ? "24px" : "0px");
    el.style.setProperty("--x-fade-end", max > 0 && el.scrollLeft < max - 4 ? "24px" : "0px");
  }, []);
  useEffect(() => {
    const el = ref.current;
    update();
    el?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [update]);
  return ref;
}

/**
 * The section row's highlight: one pill that slides to the active section
 * instead of each link switching its own background. It snaps on first paint
 * and on resize, and glides when the route changes.
 */
function useNavPill(active: string) {
  const pill = useRef<HTMLSpanElement>(null);
  const links = useRef(new Map<string, HTMLAnchorElement>());
  const placed = useRef(false);
  const place = useCallback(
    (animate: boolean) => {
      const node = pill.current;
      const link = links.current.get(active);
      if (!node) return;
      if (!link) {
        node.style.opacity = "0";
        return;
      }
      if (!animate) node.style.transition = "none";
      node.style.opacity = "1";
      node.style.width = `${link.offsetWidth}px`;
      node.style.transform = `translateX(${link.offsetLeft}px)`;
      if (!animate) {
        void node.offsetWidth;
        node.style.transition = "";
      }
    },
    [active],
  );
  useLayoutEffect(() => {
    place(placed.current);
    placed.current = true;
  }, [place]);
  useEffect(() => {
    const onResize = () => place(false);
    window.addEventListener("resize", onResize);
    document.fonts?.ready.then(() => place(false)).catch(() => undefined);
    return () => window.removeEventListener("resize", onResize);
  }, [place]);
  const register = (href: string) => (node: HTMLAnchorElement | null) => {
    if (node) links.current.set(href, node);
    else links.current.delete(href);
  };
  return { pill, register };
}

export function AdminShell({
  operator,
  base,
  renderedAt,
  children,
}: {
  readonly operator: string;
  readonly base: string;
  readonly renderedAt: number;
  readonly children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { locale, tr } = useAdminLocale();
  const [leaving, setLeaving] = useState(false);
  const [clock, setClock] = useState(renderedAt);
  const navRef = useEdgeFade<HTMLElement>();
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const href = (path: string) => `${base}${path}` || "/";
  // `/tenants/x` on the admin host, `/admin/tenants/x` on www, and the
  // rewritten form wherever Next reports that one instead.
  const section = pathname.replace(/^\/admin(?=\/|$)/, "") || "/";
  const routeHref =
    NAV.find((item) => (item.href === "" ? section === "/" || section.startsWith("/tenants") : section.startsWith(item.href)))?.href ?? null;
  // The pill leaves on the click, not when the next page has rendered: it
  // follows the section asked for until the route actually changes.
  const [pending, setPending] = useState<{ readonly href: string; readonly from: string } | null>(null);
  const activeHref = pending && pending.from === pathname ? pending.href : routeHref;
  const { pill, register } = useNavPill(activeHref ?? "__none");

  const signOut = async () => {
    setLeaving(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    router.replace("/login");
    router.refresh();
  };

  return (
    <BaseContext.Provider value={base}>
      <TimeContext.Provider value={Math.max(clock, renderedAt)}>
        <div
          data-app-shell
          className="min-h-dvh bg-background text-foreground"
          style={{
            paddingLeft: "env(safe-area-inset-left, 0px)",
            paddingRight: "env(safe-area-inset-right, 0px)",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          <a
            href="#admin-content"
            className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-card focus:p-3 focus:text-sm"
          >
            {tr("Saltar al contenido", "Skip to content")}
          </a>
          <header
            className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md"
            style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
          >
            <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 sm:px-6 xl:flex xl:gap-4">
              <Link
                href={href("")}
                className="flex min-h-14 w-fit shrink-0 items-center gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
              >
                <OrukaTile className="size-7" />
                <span className="hidden font-cooper text-lg font-medium sm:inline">Oruka</span>
                <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Admin
                </span>
              </Link>
              <nav
                ref={navRef}
                className="x-fade scrollbar-hide relative order-3 col-span-2 -mx-4 flex min-w-0 items-center gap-1 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 xl:order-none xl:mx-0 xl:px-0 xl:pb-0"
                aria-label={tr("Secciones", "Sections")}
              >
                <span
                  ref={pill}
                  aria-hidden
                  className="pointer-events-none absolute left-0 top-0 h-9 rounded-lg bg-muted opacity-0 shadow-[var(--shadow-inset)] transition-[transform,width,opacity] duration-300 ease-expo-out motion-reduce:transition-none"
                />
                {NAV.map((item) => {
                  const active = item.href === activeHref;
                  const label = locale === "en" ? item.en : item.es;
                  return (
                    <Link
                      key={item.href}
                      ref={register(item.href)}
                      href={href(item.href)}
                      onClick={(event) => {
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                        setPending({ href: item.href, from: pathname });
                      }}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative z-10 flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <HugeiconsIcon icon={item.icon} size={15} strokeWidth={1.75} />
                      <span>{label}</span>
                    </Link>
                  );
                })}
              </nav>
              <div className="ml-auto flex min-h-14 min-w-0 items-center gap-2 xl:order-3">
                <span className="hidden max-w-40 truncate text-xs text-muted-foreground 2xl:inline" title={operator}>
                  {operator}
                </span>
                <LanguageSwitch />
                <ThemeToggle showLabel={false} className="size-8 justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-ring" />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void signOut()}
                  disabled={leaving}
                  aria-label={tr("Cerrar sesión", "Sign out")}
                  className="text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive"
                >
                  <HugeiconsIcon icon={Logout01Icon} size={15} strokeWidth={1.75} />
                  <span className="hidden sm:inline">{tr("Salir", "Sign out")}</span>
                </Button>
              </div>
            </div>
          </header>
          <main id="admin-content" tabIndex={-1} className="mx-auto w-full max-w-6xl scroll-mt-28 px-4 py-8 sm:px-6 xl:scroll-mt-20">
            {children}
          </main>
        </div>
      </TimeContext.Provider>
    </BaseContext.Provider>
  );
}

/** A page's title row: heading, one line of context, actions on the right. */
export function PageHeader({
  title,
  description,
  back,
  badges,
  actions,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly back?: { readonly href: string; readonly label: string };
  readonly badges?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="space-y-3">
      {back ? <BackLink href={back.href} label={back.label} /> : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 break-words text-lg font-medium tracking-[-0.02em]">{title}</h1>
            {badges}
          </div>
          {description ? <div className="mt-1 max-w-2xl text-sm text-muted-foreground text-pretty">{description}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** "← Section", the same everywhere: the arrow eases left on hover. */
export function BackLink({ href, label }: { readonly href: string; readonly label: string }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1.5 rounded text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      <HugeiconsIcon icon={ArrowLeft01Icon} size={14} strokeWidth={1.75} className="size-3.5 shrink-0 transition-transform duration-200 ease-expo-out group-hover:-translate-x-0.5" />
      {label}
    </Link>
  );
}

/** A headline number with its label and one line of context. */
export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly tone?: "ok" | "warning";
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 font-heading text-2xl font-medium tabular-nums tracking-[-0.02em]",
          tone === "warning" && "text-amber-600 dark:text-amber-400",
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" title={hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
