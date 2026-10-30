"use client";

import { Alert02Icon, AlertCircleIcon, Cancel01Icon, CheckIcon, InformationCircleIcon } from "@hugeicons/core-free-icons";

// The one inline "this happened" box: a warning above a form, a connected
// account confirmed, a payment that failed.
//
// Pages had grown their own — an emerald box here, an amber one there, a red
// one with a different radius — each picking its own icon and tint. Same look
// as the toasts (`.alert-surface` in globals.css): a tone-coloured
// glyph on a white chip, a wash fading from the top edge, and the words left
// in foreground/muted so their contrast never rides on the tint.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { HugeiconsIcon } from "../icons/icon";

import { useT } from "../../lib/i18n/provider";
import { cn } from "../../lib/utils";

export type AlertTone = "error" | "warning" | "success" | "info";

const TONE_COLOR: Record<AlertTone, string> = {
  error: "text-[var(--alert-error)]",
  warning: "text-[var(--alert-warning)]",
  success: "text-[var(--alert-success)]",
  info: "text-[var(--alert-info)]",
};

/** The tone glyph uses the app's shared Hugeicons family. */
export function AlertGlyph({ tone, size = 16 }: { readonly tone: AlertTone; readonly size?: number }) {
  const icon = {
    error: Alert02Icon,
    warning: AlertCircleIcon,
    success: CheckIcon,
    info: InformationCircleIcon,
  }[tone];
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={1.75}
      className={cn("shrink-0", TONE_COLOR[tone])}
    />
  );
}

/** The round white chip the glyph sits on. `children` replaces the glyph —
 *  the toast puts its spinner and bell here for the untoned statuses.
 *  Negative block margins fold it into one 20px text line: it centres on the
 *  first line and the card's padding stays even, instead of the chip pushing
 *  the text down and leaving the top looking wider than the bottom. */
export function AlertIconChip({
  tone,
  size = "md",
  children,
  className,
}: {
  readonly tone?: AlertTone;
  readonly size?: "sm" | "md";
  readonly children?: ReactNode;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-card text-muted-foreground",
        "shadow-[0_2px_6px_oklch(0_0_0/0.09),0_0_0_1px_oklch(0_0_0/0.05),var(--shadow-inset)]",
        "dark:bg-[oklch(1_0_0/0.06)] dark:shadow-[0_0_0_1px_oklch(1_0_0/0.08)]",
        size === "sm" ? "-my-0.5 size-6" : "-my-1 size-7",
        className,
      )}
    >
      {children ?? (tone ? <AlertGlyph tone={tone} size={size === "sm" ? 14 : 16} /> : null)}
    </span>
  );
}

export function Alert({
  tone,
  title,
  children,
  action,
  onDismiss,
  size = "md",
  role = "status",
  className,
}: {
  readonly tone: AlertTone;
  /** Bold first line. Leave it out when the body is one short sentence. */
  readonly title?: ReactNode;
  /** The explanation, in muted text under the title (or alone). */
  readonly children?: ReactNode;
  /** A control under the text — "Retry", "Keep plan". */
  readonly action?: ReactNode;
  readonly onDismiss?: () => void;
  /** `sm` for notices inside a dialog, a list, or a narrow panel. */
  readonly size?: "sm" | "md";
  /** `status` announces politely when the alert appears; pass `alert` for a
   *  failure the user must hear now, or `null` for a notice that is just
   *  part of the page. */
  readonly role?: "status" | "alert" | null;
  readonly className?: string;
}) {
  const t = useT();
  const small = size === "sm";
  const [leaving, setLeaving] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  // Let the fold-away play, then tell the parent. The timer outlasts the 280ms transition,
  // and a parent re-render in the meantime does not restart it.
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => dismissRef.current?.(), 300);
    return () => clearTimeout(timer);
  }, [leaving]);

  return (
    <div className="alert-shell" data-leaving={leaving ? "" : undefined}>
      <div className="alert-shell-clip">
      <div
        role={role ?? undefined}
        data-tone={tone}
        className={cn(
          "alert-surface flex items-start rounded-2xl border shadow-[var(--shadow-elevated),var(--shadow-inset)]",
          small ? "gap-2.5 rounded-xl px-3 py-2.5" : "gap-3 p-4",
          className,
        )}
      >
        <AlertIconChip tone={tone} size={size} />
        <div className="min-w-0 flex-1">
          {title ? (
            <p className={cn("font-medium text-foreground", small ? "text-xs leading-5" : "text-sm leading-5")}>
              {title}
            </p>
          ) : null}
          {children ? (
            <div
              className={cn(
                small ? "text-xs leading-5" : "text-sm leading-5",
                title ? "mt-0.5 text-muted-foreground" : "text-foreground",
              )}
            >
              {children}
            </div>
          ) : null}
          {action ? <div className="mt-3 flex flex-wrap items-center gap-2">{action}</div> : null}
        </div>
        {onDismiss ? (
          <button
            type="button"
            onClick={() => setLeaving(true)}
            aria-label={t("apiError.dismiss")}
            className="-my-1 -mr-1 grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-foreground/5 hover:text-foreground"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
      </div>
    </div>
  );
}

const NOTICE_STORAGE = "focus:closed-notices:";
const noticeListeners = new Set<() => void>();
/** Kept in memory too, so closing still works where storage is blocked (private windows). */
const noticeMemory = new Map<string, string>();

const readNotices = (scope: string): string => {
  const kept = noticeMemory.get(scope);
  if (kept !== undefined) return kept;
  try {
    return window.localStorage.getItem(NOTICE_STORAGE + scope) ?? "[]";
  } catch {
    return "[]";
  }
};
const subscribeNotices = (listener: () => void) => {
  noticeListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    noticeListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
};

/** Which informational notices the user has closed, by key, remembered per `scope` (a run, a flipbook)
 *  so a closed notice stays closed after a reload. A page shows one notice at a time, so closing one
 *  lets the next in line take its place. */
export function useDismissedNotices(scope: string) {
  // The server renders with nothing closed; the browser's own list takes over once hydrated.
  const raw = useSyncExternalStore(subscribeNotices, () => readNotices(scope), () => "[]");
  const closed = useMemo<ReadonlySet<string>>(() => {
    try {
      const keys: unknown = JSON.parse(raw);
      return new Set(Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string") : []);
    } catch {
      return new Set();
    }
  }, [raw]);
  const dismiss = useCallback((key: string) => {
    const next = JSON.stringify([...new Set([...JSON.parse(readNotices(scope)) as string[], key])]);
    noticeMemory.set(scope, next);
    try {
      window.localStorage.setItem(NOTICE_STORAGE + scope, next);
    } catch {
      // Blocked storage: the memory copy still closes it for this visit.
    }
    noticeListeners.forEach((listener) => listener());
  }, [scope]);
  return { isDismissed: (key: string) => closed.has(key), dismiss };
}
