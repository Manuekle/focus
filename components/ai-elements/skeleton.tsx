"use client";

import type { ReactNode } from "react";
import { useLoadingHold } from "../../lib/hooks/use-loading-hold";
import { cn } from "../../lib/utils";

export interface SkeletonProps {
  /** When true, the skeleton is visible and pulsing. When false, the
   *  content is revealed with the dissolve transition. */
  isLoading: boolean;
  /** The real content — fades in when isLoading becomes false. */
  children: ReactNode;
  /** The skeleton placeholder — fades out when data arrives. */
  skeleton: ReactNode;
  className?: string;
}

/** Keep quick loads readable; slow requests reveal as soon as they finish. */
export function Skeleton({ isLoading, children, skeleton, className }: SkeletonProps) {
  const showLoading = useLoadingHold(isLoading);
  return (
    <div
      className={cn("t-skel", !showLoading && "is-revealed", showLoading && "is-resetting", className)}
      aria-busy={showLoading}
    >
      <div className={cn("t-skel-skeleton", showLoading && "is-pulsing")} aria-hidden="true">
        {showLoading ? skeleton : null}
      </div>
      <div className="t-skel-content" aria-hidden={showLoading} inert={showLoading}>{children}</div>
    </div>
  );
}

/* ── Skeleton building blocks ──────────────────────────────────────── */

/** A single pulsing bar. Combine multiple to build skeleton layouts. */
export function SkeletonBar({
  className = "h-3",
  width,
}: {
  readonly className?: string;
  readonly width?: string;
}) {
  return (
    <div
      className={cn("t-skel-pulse-self min-w-0 max-w-full rounded-md bg-muted", className)}
      style={width ? { width } : undefined}
    />
  );
}

/** A circular avatar placeholder. */
export function SkeletonAvatar({
  className,
  size = "size-9",
}: {
  readonly className?: string;
  readonly size?: string;
}) {
  return <div className={cn("t-skel-pulse-self rounded-full bg-muted", size, className)} />;
}

/* ── Page-level skeletons ──────────────────────────────────────────── */

/** The header every product page opens with: a `text-xl` title over a
 *  `text-sm` subtitle (52px together) and, on the right, one bar per action
 *  button in the live order, at the shared buttons' 32px height.
 *  `className` carries the page's bottom margin. */
export function PageHeaderSkeleton({
  title = "w-40",
  subtitle = "w-72",
  actions = [],
  className = "mb-8",
}: {
  readonly title?: string;
  readonly subtitle?: string;
  /** Width class per action button, e.g. `["w-24", "w-40"]`. */
  readonly actions?: readonly string[];
  readonly className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between", className)}>
      <div className="min-w-0 space-y-2">
        <SkeletonBar className={cn("h-7 max-w-full", title)} />
        <SkeletonBar className={cn("h-4 max-w-full", subtitle)} />
      </div>
      {actions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {actions.map((width, index) => (
            <SkeletonBar key={index} className={cn("h-8 rounded-lg", width)} />
          ))}
        </div>
      ) : null}
    </header>
  );
}

/** Matches the shared KPI header and inset plate while data is loading. */
/** Fixed copy the loaded page will print, drawn as a bar: the text is invisible
 *  on a muted ground, so it wraps exactly where the real line will. */
export function SkeletonText({ children }: { readonly children: string }) {
  return (
    <span className="t-skel-pulse-self select-none rounded-md bg-muted text-transparent [box-decoration-break:clone]">
      {children}
    </span>
  );
}

/** `deltaLabel` is the tile's fixed "vs. …" copy: given, the delta line wraps
 *  under the value at the same tile width the loaded one does. */
export function KpiCardSkeleton({
  deltaLabel,
  visual = false,
}: {
  readonly deltaLabel?: string;
  readonly visual?: boolean;
}) {
  return (
    <div className="kpi-card border border-border bg-card shadow-[var(--shadow-soft)]" aria-hidden="true">
      <div className="kpi-header">
        <SkeletonBar className="size-4 shrink-0" />
        <SkeletonBar className="h-4 w-24 max-w-full" />
      </div>
      <div className="kpi-body">
        <div className="kpi-plate">
          <SkeletonBar className="h-8 w-16 max-w-full" />
          {deltaLabel ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
              <SkeletonBar className="size-[13px] shrink-0" />
              <div className="flex h-4 items-center"><SkeletonBar className="h-3 w-8" /></div>
              <span className="min-w-0 text-pretty [overflow-wrap:anywhere]"><SkeletonText>{deltaLabel}</SkeletonText></span>
            </div>
          ) : (
            <SkeletonBar className="mt-2 h-4 w-28 max-w-full" />
          )}
        </div>
        {visual ? <div className="kpi-plate mt-auto pt-4"><SkeletonBar className="h-6 w-full" /></div> : null}
      </div>
    </div>
  );
}

/** The shared `CardHeader` (app/_components/dashboard-card): an icon tile
 *  beside a title and a one-line description, 74px tall. */
function SkeletonCardHeader({ trailing = false }: { readonly trailing?: boolean }) {
  return (
    <div className="flex items-start gap-3 px-5 pt-5 pb-4">
      <SkeletonBar className="size-9 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        <SkeletonBar className="h-4 w-32 max-w-full" />
        <SkeletonBar className="h-3 w-40 max-w-full" />
      </div>
      {trailing ? <SkeletonBar className="h-5 w-8 shrink-0" /> : null}
    </div>
  );
}

/** A section label and its "view all" link, at the 20px text-sm line. */
function SkeletonSectionTitle({ link = false, width = "w-32" }: { readonly link?: boolean; readonly width?: string }) {
  return (
    <div className="mb-4 flex h-5 items-center justify-between">
      <SkeletonBar className={cn("h-3.5", width)} />
      {link ? <SkeletonBar className="h-3 w-12" /> : null}
    </div>
  );
}

/** Skeleton for the Dashboard page — stats grid, chart, cards. Each block
 *  repeats the populated page's spacing and heights (KPI carousel, the
 *  194px activity plot beside the 200px donut, five recent chats) so the
 *  reveal does not move anything. */
export function DashboardSkeleton() {
  return (
    <div aria-hidden="true">

      {/* The live page is a horizontally scrolling carousel, not a responsive
         grid. Keep its fixed card width so the reveal does not reflow. */}
      <div className="mb-8 overflow-hidden">
        <div className="flex items-stretch gap-4" style={{ paddingInline: "2px" }}>
        {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="min-w-[200px] flex-1">
              <KpiCardSkeleton visual />
            </div>
        ))}
        </div>
      </div>

      <div className="mb-8 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)] lg:col-span-2">
          <SkeletonCardHeader trailing />
          <div className="mx-5 h-px bg-border" />
          <div className="px-4 py-6">
            <div className="grid grid-cols-[30px_minmax(0,1fr)] gap-[9px]">
              <div className="flex flex-col items-end justify-between py-1">
                {Array.from({ length: 4 }).map((_, i) => <SkeletonBar key={i} className="h-2.5 w-4" />)}
              </div>
              <SkeletonBar className="h-[194px] w-full" />
            </div>
            <div className="mt-2 ml-[39px] flex h-4 items-center justify-between">
              {Array.from({ length: 5 }).map((_, i) => <SkeletonBar key={i} className="h-2.5 w-7" />)}
            </div>
          </div>
        </div>

        {/* Channel breakdown: the donut ring wraps above its legend at this
           card width, exactly as the live chart's flex rules do. */}
        <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)]">
          <SkeletonCardHeader trailing />
          <div className="mx-5 h-px bg-border" />
          <div className="px-5 py-4">
            <div className="flex flex-wrap items-center justify-center gap-3">
              <div className="t-skel-pulse-self aspect-square w-[200px] max-w-full flex-[0_1_200px] rounded-full border-[28px] border-muted" />
              <div className="grid min-w-0 flex-[1_1_170px] gap-[3px]">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex h-[33px] items-center gap-[9px] px-2">
                    <SkeletonBar className="size-[9px] shrink-0 rounded-[3px]" />
                    <SkeletonBar className="h-3 w-20" />
                    <SkeletonBar className="ml-auto h-3 w-12" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <section className="mb-8">
        <SkeletonSectionTitle />
        <div className="overflow-hidden">
          <div className="flex items-stretch gap-4" style={{ paddingInline: "2px" }}>
        {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="min-w-[240px] flex-1 rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)]">
            <SkeletonCardHeader />
            <div className="mx-5 h-px bg-border" />
            <div className="px-5 py-3">
              <SkeletonBar className="h-6 w-24 rounded-full" />
            </div>
          </div>
        ))}
          </div>
        </div>
      </section>

      <section className="mb-8">
        <SkeletonSectionTitle link width="w-28" />
        <div className="divide-y divide-border rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)]">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3.5">
              <SkeletonBar className="size-9 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <SkeletonBar className="h-4 w-40" />
                <SkeletonBar className="h-3 w-3/4" />
              </div>
              <div className="hidden space-y-2 text-right sm:block">
                <SkeletonBar className="ml-auto h-3 w-12" />
                <SkeletonBar className="ml-auto h-3 w-16" />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SkeletonSectionTitle link width="w-40" />
        <div className="overflow-hidden">
          <div className="flex items-stretch gap-4" style={{ paddingInline: "2px" }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="min-w-[260px] flex-1 rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)]">
                <SkeletonCardHeader />
              </div>
            ))}
          </div>
        </div>
      </section>
      </div>
  );
}

/** The app's `SlidingTabs` bar: 32px tall like a button, roughly 76px per tab. */
export function SkeletonTabs({ count, width, className }: { readonly count: number; readonly width?: number; readonly className?: string }) {
  return <SkeletonBar className={cn("h-8 max-w-full rounded-lg", className)} width={`${width ?? count * 76}px`} />;
}

/** History's full-bleed frame — header bar, conversation rail, reader —
 *  while its summaries load. */
export function ChatsSkeleton() {
  return (
    <div aria-hidden="true" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card/40 px-3 py-2.5 sm:px-4">
        <SkeletonBar className="size-8 shrink-0 rounded-lg" />
        <SkeletonBar className="h-5 w-32" />
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-full shrink-0 flex-col border-r border-border bg-card/30 md:w-80 lg:w-96">
          <div className="space-y-2 px-3 pt-3 pb-2">
            <SkeletonBar className="h-3 w-24" />
            <SkeletonBar className="h-8 w-full rounded-lg" />
            <SkeletonTabs count={5} className="w-full" />
          </div>
          <div className="space-y-1 px-2 pt-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="flex gap-2.5 px-2 py-2">
                <SkeletonBar className="size-8 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <SkeletonBar className="h-3.5 w-32 max-w-full" />
                  <SkeletonBar className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        </aside>
        <div className="hidden min-w-0 flex-1 flex-col items-center justify-center gap-3 md:flex">
          <SkeletonBar className="h-32 w-40 rounded-2xl" />
          <SkeletonBar className="h-4 w-44" />
          <SkeletonBar className="h-3 w-60" />
        </div>
      </div>
    </div>
  );
}

/** Skeleton for the Automations page — header, flow/Instagram tabs, then
 *  the open tab: the stats bar and a stacked list of flow cards (the real
 *  list is single-column, not a grid), or the Instagram comments view. */
export function AutomationsSkeleton({ view = "flows" }: { readonly view?: "flows" | "instagram" }) {
  return (
    <div aria-hidden="true">
      <SkeletonTabs count={2} width={270} className="mb-6" />

      {view === "instagram" ? (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="w-full max-w-2xl space-y-[9px] pt-1 pb-[5px]">
              <SkeletonBar className="h-3.5 w-full" />
              <SkeletonBar className="h-3.5 w-3/4" />
            </div>
            <SkeletonBar className="h-8 w-44 shrink-0 rounded-[13px]" />
          </div>
          <CommentAutomationCardsSkeleton />
        </div>
      ) : (
        <>

        {/* The three KPIs live in the same horizontal carousel as their
           populated counterparts. */}
        <div className="mb-6 overflow-hidden">
          <div className="flex items-stretch gap-4" style={{ paddingInline: "2px" }}>
          {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="min-w-[220px] flex-1">
                <KpiCardSkeleton visual />
              </div>
          ))}
          </div>
        </div>

        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-[20px] border border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]">
              <div className="flex flex-col">
                <div className="overflow-hidden rounded-[14px] border border-border/50 bg-card shadow-xs">
                  <SkeletonCardHeader />
                  <div className="mx-5 h-px bg-border" />
                  <div className="flex flex-wrap items-center gap-4 px-5 py-3">
                    <SkeletonBar className="h-3 w-24" />
                    <SkeletonBar className="h-3 w-20" />
                    <SkeletonBar className="h-3 w-32" />
                    <SkeletonBar className="h-3 w-24" />
                  </div>
                  <div className="mx-5 h-px bg-border" />
                  <div className="flex items-center gap-1.5 px-5 py-3">
                    <SkeletonBar className="size-3.5 rounded" />
                    <SkeletonBar className="h-3 w-16" />
                    <SkeletonBar className="h-5 w-24 rounded-md" />
                    <SkeletonBar className="h-5 w-20 rounded-md" />
                  </div>
                </div>
                <div className="flex justify-end gap-1 px-2 pt-2 pb-0.5">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <SkeletonBar key={j} className="size-8 rounded-lg" />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
        </>
      )}
    </div>
  );
}

/** Instagram comment-automation cards, in the flow card's shape they share:
 *  header with the post and status, the trigger line, the three counts, and
 *  the three row actions under the panel. */
export function CommentAutomationCardsSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1].map((key) => (
        <div key={key} className="rounded-[20px] border border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]">
          <div className="overflow-hidden rounded-[14px] border border-border/50 bg-card shadow-xs">
            <div className="flex items-start gap-3 px-5 pt-5 pb-4">
              <SkeletonBar className="size-9 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                <div className="flex items-center gap-2">
                  <SkeletonBar className="h-4 w-40 max-w-full" />
                  <SkeletonBar className="h-5 w-14 rounded-full" />
                </div>
                <SkeletonBar className="h-3 w-56 max-w-full" />
              </div>
            </div>
            <div className="mx-5 h-px bg-border" />
            <div className="flex flex-wrap items-center gap-4 px-5 py-3">
              <SkeletonBar className="h-5 w-28 rounded-md" />
              <SkeletonBar className="h-3 w-28" />
              <SkeletonBar className="h-3 w-24" />
            </div>
            <div className="mx-5 h-px bg-border" />
            <div className="grid grid-cols-3 gap-4 px-5 py-3">
              {[0, 1, 2].map((stat) => (
                <div key={stat} className="space-y-2 py-0.5">
                  <SkeletonBar className="h-3 w-20" />
                  <SkeletonBar className="h-4 w-6" />
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-1 px-2 pt-2 pb-0.5">
            {[0, 1, 2].map((action) => (
              <SkeletonBar key={action} className="size-8 rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Skeleton for the Settings page — bento grid of credential cards. */
export function SettingsSkeleton() {
  return <div aria-hidden="true" className="pb-24">
    <div className="space-y-10">
      <section>
        <div className="mb-4 flex items-center gap-2.5"><SkeletonBar className="size-8 shrink-0 rounded-lg" /><SkeletonBar className="h-4 w-32" /></div>
        <div className="rounded-[20px] border border-border bg-card p-5 shadow-[var(--shadow-float)]">
          <div className="flex items-start gap-3"><SkeletonAvatar /><div className="min-w-0 flex-1 space-y-2"><SkeletonBar className="h-4 w-32" /><SkeletonBar className="h-4 w-full max-w-xl" /></div></div>
          <SkeletonBar className="mt-4 h-9 w-full rounded-full" />
          <SkeletonBar className="mt-3 h-3 w-56 max-w-full" />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {[0, 1].map((i) => <div key={i} className="h-[170px] rounded-[20px] border border-border/70 bg-muted/50 p-1.5">
            <div className="flex min-h-[114px] items-start gap-3 rounded-[14px] border border-border/50 bg-card p-5"><SkeletonAvatar /><div className="min-w-0 flex-1 space-y-2"><SkeletonBar className="h-4 w-32 max-w-full" /><SkeletonBar className="h-3 w-full" /></div></div>
            <SkeletonBar className="mt-3 ml-auto mr-2 h-3 w-20" />
          </div>)}
        </div>
      </section>
      <div className="flex items-center gap-2.5 border-t border-border pt-4"><SkeletonBar className="size-8 shrink-0 rounded-lg" /><SkeletonBar className="h-4 w-32" /><SkeletonBar className="ml-auto size-4" /></div>
    </div>
  </div>;
}

/** A full-height placeholder for the two application workspaces. The editor
 * shell is intentionally represented before data arrives: it keeps the canvas
 * and dock from jumping into place once the record has loaded. */
export function WorkspaceSkeleton({ kind, canvasOnly = false }: {
  readonly kind: "agent" | "automation";
  /** A route can retain its real, read-only identity above the loading canvas. */
  readonly canvasOnly?: boolean;
}) {
  if (kind === "agent") return <AgentEditorSkeleton canvasOnly={canvasOnly} />;

  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy="true">
      {!canvasOnly && <header className="shrink-0 border-b border-border bg-card/40">
        <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
          <SkeletonBar className="size-8 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <SkeletonBar className="h-4 w-36 max-w-full" />
          </div>
          <SkeletonBar className="hidden h-8 w-8 rounded-lg sm:block" />
          <SkeletonBar className="h-8 w-20 rounded-lg" />
          <SkeletonBar className="size-8 rounded-lg" />
        </div>
        <div className="flex items-center gap-2.5 border-t border-border bg-muted/30 px-4 py-1.5">
          <SkeletonBar className="h-3 w-16" />
          <SkeletonBar className="h-3 w-px" />
          <SkeletonBar className="h-3 w-44" />
        </div>
      </header>}

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-hidden bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] p-4 [background-size:20px_20px] sm:p-6">
          <div className="relative mx-auto h-full min-h-[28rem] max-w-4xl">
            <div className="absolute top-[15%] left-[9%] h-px w-[74%] bg-border" />
            <div className="absolute top-[15%] left-[46%] h-[38%] w-px bg-border" />
            {[
              "top-[8%] left-[2%]", "top-[8%] left-[40%]", "top-[46%] left-[40%]", "top-[46%] right-[2%]",
            ].map((position, i) => (
              <div key={i} className={`absolute w-48 max-w-[38%] rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-soft)] ${position}`}>
                <SkeletonBar className="h-4 w-24" />
                <SkeletonBar className="mt-3 h-3 w-full" />
                <SkeletonBar className="mt-1.5 h-3 w-2/3" />
              </div>
            ))}
          </div>
        </div>

        <aside className="hidden w-[420px] shrink-0 border-l border-border bg-card lg:flex lg:flex-col">
          <div className="flex gap-1 p-3 pb-2">
            <SkeletonBar className="h-8 flex-1 rounded-lg" />
            <SkeletonBar className="h-8 flex-1 rounded-lg" />
          </div>
          <div className="space-y-4 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={i % 2 ? "ml-auto w-4/5 space-y-2" : "w-4/5 space-y-2"}>
                <SkeletonBar className="h-3 w-20" />
                <SkeletonBar className="h-12 w-full rounded-xl" />
              </div>
            ))}
          </div>
          <div className="mt-auto border-t border-border p-3">
            <SkeletonBar className="h-10 w-full rounded-xl" />
          </div>
        </aside>
      </div>
    </div>
  );
}

/** The agent editor as it lands: toolbar, the section navigation, the first
 *  section's form and, on a wide editor, the assistant docked beside it. Breakpoints follow the
 *  editor's own container, like the page, so the skeleton swaps into the
 *  same layout at every width. */
export function AgentEditorSkeleton({ canvasOnly = false }: { readonly canvasOnly?: boolean }) {
  return (
    <div className="@container/agent-editor flex h-full min-h-0 flex-col overflow-hidden" aria-busy="true">
      {!canvasOnly && (
        <header className="shrink-0 border-b border-border bg-card/40">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 sm:px-4">
            <SkeletonBar className="size-8 shrink-0 rounded-lg" />
            {/* Avatar, name and status as one block, like the page's identity. */}
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <SkeletonBar className="size-8 shrink-0 rounded-full" />
              <SkeletonBar className="h-5 w-20 max-w-full @min-[480px]/agent-editor:w-36" />
              <span className="min-w-0 flex-1" />
              <SkeletonBar className="hidden h-6 w-16 shrink-0 rounded-md @min-[480px]/agent-editor:block" />
            </div>
            <AgentToolbarActionsSkeleton />
          </div>
        </header>
      )}

      <div className="flex min-h-0 flex-1 flex-col @min-[760px]/agent-editor:flex-row">
        <div className="shrink-0 border-b border-border bg-card px-4 py-3 @min-[760px]/agent-editor:hidden">
          <SkeletonBar className="mb-2 h-3 w-24" />
          <SkeletonBar className="h-8 w-full rounded-lg" />
        </div>
        <div className="hidden w-72 shrink-0 space-y-6 overflow-hidden border-r border-border bg-muted/20 p-3 @min-[760px]/agent-editor:block">
          {[4, 3, 2].map((count, group) => (
            <div key={group}>
              <SkeletonBar className="mx-3 mb-3 h-3 w-20" />
              <div className="space-y-1">
                {Array.from({ length: count }, (_, item) => (
                  <div key={item} className="flex items-start gap-2.5 px-3 py-2.5">
                    <SkeletonBar className="mt-0.5 size-4 shrink-0 rounded" />
                    <div className="min-w-0 flex-1 space-y-2 py-0.5">
                      <SkeletonBar className="h-3.5 w-24" />
                      <SkeletonBar className="h-3 w-40" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="min-h-0 min-w-0 flex-1 bg-card px-5 py-6 sm:px-10 sm:py-8">
          <div className="max-w-2xl">
            <div className="mb-6 flex items-start gap-3 border-b border-border/60 pb-5">
              <SkeletonBar className="size-8 shrink-0 rounded-[10px]" />
              <div className="min-w-0 flex-1 pt-0.5">
                <SkeletonBar className="h-[18px] w-28" />
                <SkeletonBar className="mt-[14px] h-3.5 w-72" />
              </div>
            </div>
            <div className="space-y-4">
              {[64, 96].map((width) => (
                <div key={width} className="flex flex-col">
                  <SkeletonBar className="mt-1 h-3.5" width={`${width}px`} />
                  <SkeletonBar className="mt-1.5 h-8 w-full rounded-lg" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="hidden w-[380px] shrink-0 flex-col border-l border-border bg-card @min-[1180px]/agent-editor:flex">
          <div className="flex items-center justify-between border-b border-border py-2 pr-2 pl-4">
            <SkeletonBar className="h-4 w-24" />
            <SkeletonBar className="size-8 rounded-lg md:size-7" />
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-6">
            <div className="flex w-full flex-col items-center gap-3">
              <SkeletonBar className="h-7 w-52" />
              <SkeletonBar className="h-3 w-48" />
              <SkeletonBar className="h-3 w-40" />
            </div>
            <SkeletonBar className="h-[104px] w-full rounded-[22px]" />
            <div className="flex flex-col items-center gap-2">
              <SkeletonBar className="h-8 w-40 rounded-full" />
              <SkeletonBar className="h-8 w-56 rounded-full" />
              <SkeletonBar className="h-8 w-48 rounded-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Readiness and the activate button, in the toolbar's wrapping row:
 *  readiness sits beside the button on a wide editor and drops to its own
 *  line under the name on a narrow one, as the real toolbar does. Shared with
 *  the page's own loading header, which keeps the real name. */
export function AgentToolbarActionsSkeleton() {
  return (
    <>
      <div className="order-last flex h-6 w-full items-center pl-11 @min-[720px]/agent-editor:order-none @min-[720px]/agent-editor:w-auto @min-[720px]/agent-editor:pl-0">
        <SkeletonBar className="h-3 w-48" />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <SkeletonBar className="h-8 w-8 rounded-lg md:h-7 @min-[960px]/agent-editor:w-[104px]" />
        <SkeletonBar className="h-8 w-8 rounded-lg md:h-7 @min-[960px]/agent-editor:w-[104px]" />
        <SkeletonBar className="ml-1 h-8 w-16 rounded-lg md:h-7" />
        <span className="mx-1 h-5 w-px bg-border" />
        <SkeletonBar className="size-8 rounded-lg md:size-7" />
      </div>
    </>
  );
}
