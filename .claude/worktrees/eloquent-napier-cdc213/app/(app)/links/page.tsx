"use client";

import "../product.css";
import { EditorSkeleton } from "./page-skeleton";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Add01Icon,
  Copy01Icon,
  Download04Icon,
  LinkSquare02Icon,
  PaintBoardIcon,
  PanelLeftIcon,
  QrCodeIcon,
  Loading03Icon,
  StarIcon,
  UserCircleIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/icon";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Spinner } from "@/components/ui/spinner";
import { PhoneFrame, PhoneStatusBar } from "@/components/phone-frame";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/components/toast-provider";
import { DockReopenButton } from "@/app/_components/dock-reopen-button";
import { LinkPageView } from "@/app/l/[slug]/link-page-view";
import { AnimatedQR } from "@/components/motion/animated-qr";
import { DownloadAnimation } from "@/components/motion/download-animation";
import { KIND_ICONS } from "./_components/kinds";
import { LinkPanel } from "./_components/link-panel";
import { MicroLabel } from "./_components/panel";
import { ProfilePanel, type Defaults } from "./_components/profile-panel";
import { StylePanel } from "./_components/style-panel";
import { fetchJson, type UiError } from "@/lib/api-error-message";
import { useModKey } from "@/lib/hooks/use-mod-key";
import { useT } from "@/lib/i18n/provider";
import type { LinkKind, LinkPage, LinkPageItem, PublicLinkPage } from "@/lib/types";
import { cn } from "@/lib/utils";

const DOCK_MIN = 320;
const DOCK_MAX = 520;
const DOCK_WIDTH_KEY = "oruka:links-dock-width";
const DOCK_OPEN_KEY = "oruka:links-dock-open";

type EditorState = {
  readonly defaults: Defaults;
  readonly hasLogo: boolean;
  readonly page: LinkPage | null;
};

/** The rail's selection: one of the two settings panels, or a link's id. */
type Selection = "profile" | "style" | string;

type SaveStatus = "idle" | "saving" | "saved";

const EMPTY_DEFAULTS: Defaults = {
  address: "",
  description: "",
  email: "",
  phone: "",
  title: "Mi negocio",
  websiteUrl: "",
};

function newItem(kind: LinkKind, title: string): LinkPageItem {
  return {
    id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    title,
    destination: "",
    enabled: true,
    featured: false,
  };
}

/** Mirrors the server's public projection, including the blank-means-inherit
 *  rule, so the preview shows what publishing would actually put on the web. */
function publicPreview(page: LinkPage, defaults: Defaults): PublicLinkPage {
  const enabled = page.links.filter((item) => item.enabled && item.destination.trim());
  const featured = enabled.find((item) => item.featured) ?? null;
  return {
    slug: page.slug,
    profile: {
      title: page.profile.title.trim() || defaults.title,
      description: page.profile.description.trim() || defaults.description,
    },
    theme: page.theme,
    style: page.style,
    featured,
    links: enabled.filter((item) => !item.featured),
  };
}

export default function LinkPagesPage() {
  const t = useT();
  const { toast } = useToast();
  const mod = useModKey();

  const [page, setPage] = useState<LinkPage | null>(null);
  const [defaults, setDefaults] = useState<Defaults>(EMPTY_DEFAULTS);
  const [hasLogo, setHasLogo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<UiError | null>(null);
  const [selection, setSelection] = useState<Selection>("profile");
  const [railOpen, setRailOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(true);
  const [dockTab, setDockTab] = useState<"preview" | "share">("preview");
  const [dockWidth, setDockWidth] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    try {
      const storedWidth = Number(localStorage.getItem(DOCK_WIDTH_KEY));
      if (storedWidth >= DOCK_MIN && storedWidth <= DOCK_MAX) setDockWidth(storedWidth);
      const storedOpen = localStorage.getItem(DOCK_OPEN_KEY);
      setDockOpen(storedOpen === null ? window.matchMedia("(min-width: 1024px)").matches : storedOpen === "1");
    } catch {
      // Private windows and blocked site data: the defaults above still hold.
    }
  }, []);

  const setDockOpenPersisted = useCallback((next: boolean) => {
    setDockOpen(next);
    try {
      localStorage.setItem(DOCK_OPEN_KEY, next ? "1" : "0");
    } catch {
      // See the read above.
    }
  }, []);

  // Drag-to-resize the dock, and remember the width the operator settled on.
  useEffect(() => {
    if (!isResizing) return;
    const onMove = (event: PointerEvent) => {
      const start = resizeRef.current;
      if (!start) return;
      const next = start.startWidth + (start.startX - event.clientX);
      setDockWidth(Math.min(DOCK_MAX, Math.max(DOCK_MIN, next)));
    };
    const onUp = () => {
      setIsResizing(false);
      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(DOCK_WIDTH_KEY, String(dockWidth));
      } catch {
        // Best-effort.
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dockWidth, isResizing]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchJson<EditorState>("/api/link-page", t);
      if (cancelled) return;
      if (result.ok) {
        setPage(result.data.page);
        setDefaults(result.data.defaults);
        setHasLogo(result.data.hasLogo);
        setError(null);
      } else {
        setError(result.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const create = useCallback(async () => {
    setCreating(true);
    const result = await fetchJson<EditorState>("/api/link-page", t, { method: "POST" });
    setCreating(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPage(result.data.page);
    if (result.data.defaults) setDefaults(result.data.defaults);
    setHasLogo(Boolean(result.data.hasLogo));
    setDirty(false);
    setError(null);
  }, [t]);

  const save = useCallback(
    async (next: LinkPage | null, announce = true) => {
      if (!next) return false;
      setSaveStatus("saving");
      const result = await fetchJson<{ page: LinkPage }>("/api/link-page", t, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: next.slug,
          status: next.status,
          profile: next.profile,
          style: next.style,
          theme: next.theme,
          links: next.links,
        }),
      });
      if (!result.ok) {
        setSaveStatus("idle");
        setError(result.error);
        return false;
      }
      setPage(result.data.page);
      setDirty(false);
      setError(null);
      setSaveStatus("saved");
      if (announce) toast({ title: t("links.saved"), status: "success" });
      return true;
    },
    [t, toast],
  );

  /** Re-reads the business profile into the contact links. Labels and order
   *  stay as the operator left them; only destinations are refreshed and
   *  missing rows added. */
  const syncWithBusiness = useCallback(async () => {
    setSaveStatus("saving");
    const result = await fetchJson<{ page: LinkPage }>("/api/link-page", t, { method: "PUT" });
    if (!result.ok) {
      setSaveStatus("idle");
      setError(result.error);
      return;
    }
    setPage(result.data.page);
    setDirty(false);
    setSaveStatus("saved");
    toast({ title: t("links.syncDone"), status: "success" });
  }, [t, toast]);

  const updatePage = useCallback((updater: (current: LinkPage) => LinkPage) => {
    setPage((current) => (current ? updater(current) : current));
    setDirty(true);
    setSaveStatus("idle");
  }, []);

  const updateLink = useCallback(
    (id: string, patch: Partial<LinkPageItem>) => {
      updatePage((current) => ({
        ...current,
        links: current.links.map((item) => {
          if (item.id !== id) return patch.featured ? { ...item, featured: false } : item;
          return { ...item, ...patch };
        }),
      }));
    },
    [updatePage],
  );

  const move = useCallback(
    (id: string, direction: -1 | 1) => {
      updatePage((current) => {
        const from = current.links.findIndex((item) => item.id === id);
        const to = from + direction;
        if (from < 0 || to < 0 || to >= current.links.length) return current;
        const links = [...current.links];
        [links[from], links[to]] = [links[to], links[from]];
        return { ...current, links };
      });
    },
    [updatePage],
  );

  const addLink = useCallback(() => {
    const item = newItem("website", t("links.kind.website"));
    updatePage((current) => ({ ...current, links: [...current.links, item] }));
    setSelection(item.id);
    setRailOpen(false);
  }, [t, updatePage]);

  const removeLink = useCallback(
    (id: string) => {
      updatePage((current) => ({ ...current, links: current.links.filter((entry) => entry.id !== id) }));
      setSelection((current) => (current === id ? "profile" : current));
    },
    [updatePage],
  );

  // Cmd/Ctrl+S, the same shortcut the template editor answers to.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save(page);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [page, save]);

  const preview = useMemo(() => (page ? publicPreview(page, defaults) : null), [page, defaults]);
  const shareUrl = page
    ? typeof window === "undefined"
      ? `/l/${page.slug}`
      : `${window.location.origin}/l/${page.slug}`
    : "";
  const published = page?.status === "published";

  const copyUrl = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast({ title: t("links.copied"), status: "success" });
    } catch {
      setError({ messageKey: "apiError.network" });
    }
  }, [shareUrl, t, toast]);

  if (loading) return <EditorSkeleton />;

  if (!page) {
    return (
      <div className="y-fade content-enter flex h-full min-h-0 items-center justify-center overflow-y-auto p-6">
        <section className="relative w-full max-w-lg overflow-hidden rounded-[28px] border border-border bg-card p-7 shadow-[var(--shadow-float)] sm:p-9">
          <div aria-hidden="true" className="absolute -top-20 -right-16 size-52 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative">
            <span className="grid size-12 place-items-center rounded-2xl border border-border bg-muted shadow-[var(--shadow-inset)]">
              <HugeiconsIcon icon={LinkSquare02Icon} size={22} strokeWidth={1.7} />
            </span>
            <h1 className="mt-7 font-cooper text-lg font-medium tracking-[-0.02em]">{t("links.title")}</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("links.subtitle")}</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("links.createHint")}</p>
            <Button type="button" className="mt-7" disabled={creating} onClick={() => void create()}>
              {creating ? (
                <Spinner size={14} strokeWidth={2} />
              ) : (
                <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={1.8} />
              )}
              {t("links.create")}
            </Button>
            <ErrorBanner error={error} onDismiss={() => setError(null)} className="mt-6" />
          </div>
        </section>
      </div>
    );
  }

  const rail = (
    <LinkRail
      links={page.links}
      onAdd={addLink}
      onSelect={(next) => {
        setSelection(next);
        setRailOpen(false);
      }}
      selection={selection}
    />
  );

  return (
    <div className="content-enter flex h-full min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border bg-card/40 backdrop-blur-sm">
        <div className="flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
          <button
            type="button"
            onClick={() => setRailOpen(true)}
            aria-label={t("links.railTitle")}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground md:hidden"
          >
            <HugeiconsIcon icon={PanelLeftIcon} size={16} strokeWidth={1.75} />
          </button>
          <div className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground shadow-[var(--shadow-inset)] md:flex">
            <HugeiconsIcon icon={LinkSquare02Icon} size={15} strokeWidth={1.75} />
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h1 className="truncate text-lg font-medium tracking-[-0.02em]">{t("links.title")}</h1>
            <span
              className={cn(
                "pill pill-sm tone-pill font-mono tracking-[0.1em] uppercase",
                published ? "tone-success" : "tone-expired",
              )}
            >
              {t(`links.status.${page.status}`)}
            </span>
            <span className="hidden truncate font-mono text-[11px] text-muted-foreground lg:inline">
              /l/{page.slug}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <SaveIndicator status={saveStatus} dirty={dirty} />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void syncWithBusiness()}
                  aria-label={t("links.syncNow")}
                  className="hidden sm:inline-flex"
                >
                  <HugeiconsIcon icon={Loading03Icon} size={14} strokeWidth={1.75} />
                  <span className="hidden lg:inline">{t("links.syncNow")}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("links.syncNow")}</TooltipContent>
            </Tooltip>

            <Button
              type="button"
              size="sm"
              onClick={() => void save(page)}
              disabled={!dirty || saveStatus === "saving"}
              aria-keyshortcuts="Meta+S Control+S"
              aria-label={t("links.save")}
            >
              <span className="hidden sm:inline">{t("links.save")}</span>
              <kbd
                aria-hidden="true"
                className="rounded border border-current/30 bg-black/5 px-1 font-mono text-[10px] leading-4"
              >
                {mod}S
              </kbd>
            </Button>

            <Button
              size="sm"
              type="button"
              variant={published ? "outline" : "default"}
              disabled={saveStatus === "saving"}
              onClick={() => void save({ ...page, status: published ? "draft" : "published" })}
            >
              {published ? t("links.unpublish") : t("links.publish")}
            </Button>

            <span className="mx-0.5 hidden h-5 w-px bg-border sm:block" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setDockOpenPersisted(!dockOpen)}
                  aria-label={t("links.dockPreview")}
                  aria-pressed={dockOpen}
                  className={cn(
                    "hidden size-8 items-center justify-center rounded-lg transition-colors duration-150 sm:flex",
                    dockOpen
                      ? "bg-muted text-foreground shadow-[var(--shadow-inset)]"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <HugeiconsIcon icon={PanelLeftIcon} size={16} strokeWidth={1.75} className="rotate-180" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("links.dockPreview")}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {error ? (
          <ErrorBanner
            layout="strip"
            error={error}
            onDismiss={() => setError(null)}
          />
        ) : null}
      </header>

      <div className="@container relative flex min-h-0 flex-1" style={{ ["--dock-max" as string]: `${DOCK_MAX}px` }}>
        <aside className="hidden w-72 shrink-0 flex-col border-r border-border bg-card/30 md:flex xl:w-80">
          {rail}
        </aside>

        <div className="y-fade relative min-w-0 flex-1 overflow-y-auto scrollbar-hide">
          {selection === "profile" ? (
            <ProfilePanel defaults={defaults} hasLogo={hasLogo} page={page} onChange={updatePage} />
          ) : selection === "style" ? (
            <StylePanel page={page} onChange={updatePage} />
          ) : (
            <LinkPanel
              index={page.links.findIndex((entry) => entry.id === selection)}
              item={page.links.find((entry) => entry.id === selection) ?? null}
              onChange={updateLink}
              onMove={move}
              onRemove={removeLink}
              total={page.links.length}
            />
          )}

          {!dockOpen ? (
            <DockReopenButton
              icon={ViewIcon}
              label={t("links.dockPreview")}
              onClick={() => setDockOpenPersisted(true)}
            />
          ) : null}
        </div>

        <div
          onPointerDown={(event) => {
            resizeRef.current = { startX: event.clientX, startWidth: dockWidth };
            setIsResizing(true);
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
          className={cn(
            "group relative z-20 w-3 shrink-0 -translate-x-1.5 cursor-col-resize touch-none",
            dockOpen ? "hidden lg:block" : "hidden",
          )}
          role="separator"
          aria-orientation="vertical"
          aria-label={t("links.dockPreview")}
        >
          <span
            className={cn(
              "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-foreground/[0.08]",
              "transition-[background-color] duration-200 ease-out",
              isResizing ? "bg-foreground/50" : "group-hover:bg-foreground/30",
            )}
          />
        </div>

        <aside
          aria-hidden={!dockOpen}
          inert={!dockOpen}
          data-open={dockOpen}
          data-resizing={isResizing}
          style={{ width: dockOpen ? `min(100cqw, ${dockWidth}px)` : 0 }}
          className={cn(
            "t-dock hidden min-h-0 flex-col overflow-hidden bg-card sm:flex",
            "absolute inset-y-0 right-0 z-30 max-w-[min(100%,var(--dock-max))] shadow-[var(--shadow-float)]",
            "lg:static lg:z-auto lg:shrink-0 lg:shadow-none",
            dockOpen ? "border-l border-border lg:border-l-0" : "border-l-0 shadow-none",
          )}
        >
          <div
            className="t-panel-slide flex h-full min-h-0 flex-col"
            data-open={dockOpen}
            style={{ width: `min(100cqw, ${dockWidth}px)` }}
          >
            <div className="shrink-0 p-3 pb-2">
              <SlidingTabs
                value={dockTab}
                onValueChange={(next) => setDockTab(next as "preview" | "share")}
                tabs={[
                  { id: "preview", label: t("links.dockPreview") },
                  { id: "share", label: t("links.share") },
                ]}
              />
            </div>

            <div className="min-h-0 flex-1">
              <div className={cn("h-full", dockTab === "preview" ? "block" : "hidden")}>
                <PhonePreview hasLogo={hasLogo} page={preview} />
              </div>
              <div
                className={cn("y-fade h-full overflow-y-auto p-4 scrollbar-hide", dockTab === "share" ? "block" : "hidden")}
              >
                <SharePanel
                  active={dockTab === "share"}
                  onCopy={() => void copyUrl()}
                  published={published}
                  slug={page.slug}
                  url={shareUrl}
                />
              </div>
            </div>
          </div>
        </aside>
      </div>

      <Drawer open={railOpen} onOpenChange={setRailOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{t("links.railTitle")}</DrawerTitle>
          </DrawerHeader>
          <div className="y-fade min-h-0 flex-1 overflow-y-auto">{rail}</div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

// ── Rail ───────────────────────────────────────────────────────────

function LinkRail({
  links,
  onAdd,
  onSelect,
  selection,
}: {
  readonly links: readonly LinkPageItem[];
  readonly onAdd: () => void;
  readonly onSelect: (next: Selection) => void;
  readonly selection: Selection;
}) {
  const t = useT();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3 py-2.5">
        <MicroLabel>{t("links.railTitle")}</MicroLabel>
      </div>

      <div className="shrink-0 px-2">
        <div className="flex flex-col gap-0.5">
          <RailRow
            icon={UserCircleIcon}
            label={t("links.sectionProfile")}
            onSelect={() => onSelect("profile")}
            selected={selection === "profile"}
          />
          <RailRow
            icon={PaintBoardIcon}
            label={t("links.sectionStyle")}
            onSelect={() => onSelect("style")}
            selected={selection === "style"}
          />
        </div>
      </div>

      <div className="mt-3 flex shrink-0 items-center justify-between gap-2 px-3 pb-1">
        <MicroLabel>{t("links.sectionLinks")}</MicroLabel>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onAdd}
              aria-label={t("links.add")}
              className={cn(
                "flex size-7 items-center justify-center rounded-lg text-muted-foreground",
                "transition-colors duration-150 hover:bg-accent hover:text-foreground",
              )}
            >
              <HugeiconsIcon icon={Add01Icon} size={15} strokeWidth={1.75} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("links.add")}</TooltipContent>
        </Tooltip>
      </div>

      <div aria-label={t("links.railList")} className="y-fade min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-hide">
        {links.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs leading-relaxed text-muted-foreground">{t("links.empty")}</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {links.map((item) => (
              <RailRow
                badge={item.featured ? StarIcon : undefined}
                dimmed={!item.enabled}
                icon={KIND_ICONS[item.kind]}
                key={item.id}
                label={item.title || t(`links.kind.${item.kind}`)}
                onSelect={() => onSelect(item.id)}
                selected={selection === item.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RailRow({
  badge,
  dimmed = false,
  icon,
  label,
  onSelect,
  selected,
}: {
  readonly badge?: IconSvgElement;
  readonly dimmed?: boolean;
  readonly icon: IconSvgElement;
  readonly label: string;
  readonly onSelect: () => void;
  readonly selected: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors duration-150",
        selected ? "bg-muted text-foreground shadow-[var(--shadow-inset)]" : "hover:bg-accent",
        dimmed && !selected ? "opacity-55" : "",
      )}
    >
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-lg",
          selected ? "bg-card text-foreground" : "bg-muted/70 text-muted-foreground",
        )}
      >
        <HugeiconsIcon icon={icon} size={14} strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
      {badge ? (
        <HugeiconsIcon icon={badge} size={13} strokeWidth={1.9} className="shrink-0 text-muted-foreground" />
      ) : null}
    </button>
  );
}

// ── Panels ─────────────────────────────────────────────────────────

// ── Dock ───────────────────────────────────────────────────────────

/** The public page, inside the same phone the email preview uses. Scaling a
 *  real render rather than approximating it is the point: the preview and the
 *  page are the same component, and the device around it is the same device. */
function PhonePreview({
  hasLogo,
  page,
}: {
  readonly hasLogo: boolean;
  readonly page: PublicLinkPage | null;
}) {
  return (
    <PhoneFrame
      className="p-4"
      maxWidth={360}
      screenBackground={page?.style.canvas}
      scrollable
      surfaceStyle={{ background: page?.style.canvasEnd }}
      // The page paints under the status bar the way an app does, so the bar
      // is drawn over it in the page's own ink.
      overlay={page ? <PhoneStatusBar color={page.style.ink} /> : null}
    >
      {page ? (
        <LinkPageView
          compact
          hasLogo={hasLogo}
          logoSrc="/api/business-profile/logo"
          mediaSrc={(assetId) => `/api/media/${assetId}/file`}
          page={page}
        />
      ) : null}
    </PhoneFrame>
  );
}

function SharePanel({
  active,
  onCopy,
  published,
  slug,
  url,
}: {
  /** The QR only animates in when its tab is on screen; mounting it behind a
   *  hidden tab would play the whole reveal to nobody. */
  readonly active: boolean;
  readonly onCopy: () => void;
  readonly published: boolean;
  readonly slug: string;
  readonly url: string;
}) {
  const t = useT();

  const download = () => {
    const link = document.createElement("a");
    link.href = "/api/link-page/qr?download=1";
    link.download = "";
    link.click();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card p-3">
        <MicroLabel>{t("links.address")}</MicroLabel>
        <code className="mt-1.5 block truncate rounded-lg bg-muted px-2.5 py-1.5 text-[11px]">
          {url || `/l/${slug}`}
        </code>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button
            className="h-8 text-xs"
            disabled={!published}
            onClick={onCopy}
            size="sm"
            type="button"
            variant="outline"
          >
            <HugeiconsIcon icon={Copy01Icon} size={13} strokeWidth={1.75} />
            {t("links.copy")}
          </Button>
          {published ? (
            <Button asChild className="h-8 text-xs" size="sm" variant="outline">
              <a href={`/l/${slug}`} rel="noreferrer" target="_blank">
                <HugeiconsIcon icon={LinkSquare02Icon} size={13} strokeWidth={1.75} />
                {t("links.openPublic")}
              </a>
            </Button>
          ) : (
            <Button className="h-8 text-xs" disabled size="sm" type="button" variant="outline">
              <HugeiconsIcon icon={LinkSquare02Icon} size={13} strokeWidth={1.75} />
              {t("links.openPublic")}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        {/* The canvas and the printable SVG encode the same matrix; both stay
            on a light ground in either theme so a phone camera reads them. */}
        {active && published ? (
          <AnimatedQR
            className="shrink-0"
            downloadLabel={t("links.qr")}
            label={t("links.qrAlt", { name: slug })}
            onDownload={download}
            size={172}
            source="/api/link-page/qr"
          />
        ) : (
          <div className="grid size-[172px] shrink-0 place-items-center rounded-lg border border-dashed border-border text-muted-foreground">
            <HugeiconsIcon icon={QrCodeIcon} size={26} strokeWidth={1.5} />
          </div>
        )}
        <div className="flex min-w-32 flex-1 flex-col items-start gap-1.5">
          <DownloadAnimation disabled={!published} onDownload={download}>
            <Button className="h-8 text-xs" disabled={!published} size="sm" variant="outline">
              <HugeiconsIcon icon={Download04Icon} size={13} strokeWidth={1.75} />
              {t("links.qr")}
            </Button>
          </DownloadAnimation>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            {published ? t("links.qrHint") : t("links.shareHint")}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Bits ───────────────────────────────────────────────────────────

function SaveIndicator({ dirty, status }: { readonly dirty: boolean; readonly status: SaveStatus }) {
  const t = useT();
  if (status === "idle" && !dirty) return null;
  const saving = status === "saving";
  return (
    <span className="list-fade-in mr-1 hidden items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase sm:flex">
      {saving ? (
        <Spinner size={11} strokeWidth={2} />
      ) : (
        <span
          className={cn("size-1.5 rounded-full", status === "saved" ? "bg-foreground/60" : "animate-pulse bg-amber-500")}
        />
      )}
      {saving ? t("links.saving") : status === "saved" ? t("links.saved") : t("links.unsaved")}
    </span>
  );
}
