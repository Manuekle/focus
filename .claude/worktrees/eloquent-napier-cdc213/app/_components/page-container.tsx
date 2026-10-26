"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/icon";
import { NAV_ITEMS } from "@/lib/nav-items";
import { cn } from "@/lib/utils";

/**
 * The frame every product page sits in.
 *
 * With a `title` it draws the workspace layout /history, /links,
 * /email-templates and /calendar use: no floating card and no page padding
 * around the chrome — a header bar with the page's icon, title and actions,
 * divided from the content by a hairline and reaching every edge under the
 * shell. The content scrolls beneath it, so the actions stay in reach on a
 * long list. The icon defaults to the sidebar's own for this route, so the two
 * can never disagree.
 *
 * Without a `title` it is the older centred column, kept for the few screens
 * that draw their own chrome (onboarding, the agent workspaces).
 */
export function PageContainer({
  children,
  className,
  maxWidth = "max-w-5xl",
  pattern = "grid",
  title,
  description,
  icon,
  meta,
  actions,
  banner,
  toolbar,
  back,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly maxWidth?: string;
  readonly pattern?: "grid" | "crosses" | "diagonals" | "brackets" | "none";
  /** Turns on the workspace layout. */
  readonly title?: ReactNode;
  /** One line beside the title on wide screens; under it on narrow ones. */
  readonly description?: ReactNode;
  readonly icon?: IconSvgElement;
  /** A pill or count right after the title. */
  readonly meta?: ReactNode;
  readonly actions?: ReactNode;
  /** Full-width notice under the header row, e.g. an `ErrorBanner`. */
  readonly banner?: ReactNode;
  /** A second header row, for tabs or filters that belong to the page. */
  readonly toolbar?: ReactNode;
  /** The parent page, for a screen one level down (billing under account). */
  readonly back?: HeaderBack;
}) {
  if (title !== undefined) {
    return (
      <WorkspaceFrame
        title={title}
        description={description}
        icon={icon}
        meta={meta}
        actions={actions}
        banner={banner}
        toolbar={toolbar}
        back={back}
        maxWidth={maxWidth}
        className={className}
      >
        {children}
      </WorkspaceFrame>
    );
  }

  const patternClass =
    pattern === "none"
      ? ""
      : `bg-pattern bg-pattern-${pattern} bg-pattern-fade`;

  return (
    <div className="y-fade flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
      {pattern !== "none" ? (
        <div
          className={cn("pointer-events-none fixed inset-0 opacity-30", patternClass)}
        />
      ) : null}
      <div
        className={cn(
          "page-enter relative mx-auto w-full px-5 py-8 sm:px-6 sm:py-10",
          maxWidth,
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

type HeaderBack = { readonly href: string; readonly label: string };

/** The sidebar entry this path belongs to: the longest matching prefix. */
function navIconFor(pathname: string | null): IconSvgElement | undefined {
  if (!pathname) return undefined;
  let best: (typeof NAV_ITEMS)[number] | undefined;
  for (const item of NAV_ITEMS) {
    const hit = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (hit && (!best || item.href.length > best.href.length)) best = item;
  }
  return best?.icon;
}

function WorkspaceFrame({
  children,
  className,
  maxWidth,
  title,
  description,
  icon,
  meta,
  actions,
  banner,
  toolbar,
  back,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly maxWidth: string;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly icon?: IconSvgElement;
  readonly meta?: ReactNode;
  readonly actions?: ReactNode;
  readonly banner?: ReactNode;
  readonly toolbar?: ReactNode;
  readonly back?: HeaderBack;
}) {
  const pathname = usePathname();
  const glyph = icon ?? navIconFor(pathname);

  return (
    <div className="content-enter flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <WorkspaceHeader
        title={title}
        description={description}
        icon={glyph}
        meta={meta}
        actions={actions}
        banner={banner}
        toolbar={toolbar}
        back={back}
      />
      <div className="y-fade min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className={cn("page-enter relative mx-auto w-full px-4 py-5 sm:px-6 sm:py-6", maxWidth, className)}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** The header bar alone, for a page that lays out its own body. */
export function WorkspaceHeader({
  title,
  description,
  icon,
  meta,
  actions,
  banner,
  toolbar,
  back,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly icon?: IconSvgElement;
  readonly meta?: ReactNode;
  readonly actions?: ReactNode;
  readonly banner?: ReactNode;
  readonly toolbar?: ReactNode;
  readonly back?: HeaderBack;
}) {
  return (
    <header className="shrink-0 border-b border-border bg-card/40 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 flex-1 basis-56 items-center gap-2.5 sm:gap-3">
          {back ? (
            <Link
              href={back.href}
              aria-label={back.label}
              title={back.label}
              className="group flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
            >
              <HugeiconsIcon
                icon={ArrowLeft01Icon}
                size={16}
                strokeWidth={1.75}
                className="transition-transform duration-200 ease-expo-out group-hover:-translate-x-0.5"
              />
            </Link>
          ) : null}
          {icon ? (
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
              <HugeiconsIcon icon={icon} size={15} strokeWidth={1.75} />
            </div>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h1 className="truncate text-lg leading-8 font-medium tracking-[-0.02em]">{title}</h1>
            {meta}
            {description ? (
              <>
                <span aria-hidden="true" className="mx-0.5 hidden h-4 w-px shrink-0 bg-border lg:block" />
                <p className="hidden min-w-0 truncate text-[13px] text-muted-foreground lg:block">{description}</p>
              </>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">{actions}</div>
        ) : null}
      </div>
      {description ? (
        <p className="-mt-1 px-3 pb-2.5 text-[13px] leading-5 text-muted-foreground sm:px-4 lg:hidden">{description}</p>
      ) : null}
      {toolbar ? <div className="border-t border-border/70 px-3 py-2 sm:px-4">{toolbar}</div> : null}
      {banner}
    </header>
  );
}
