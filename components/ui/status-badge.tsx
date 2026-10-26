"use client";

// The app's status badge system: one soft, pastel pill per state, shared by
// every page that shows "is this thing on".
//
// It lives in components/ui rather than next to the channel badges because
// non-channel surfaces (the model/provider badge in the chat header, for one)
// need the exact same pill — a second hand-rolled version is how a design
// system drifts.

import { HugeiconsIcon, type IconSvgElement } from "../icons/icon";
import {
  TriangleAlertIcon,
  Loading03Icon,
  SendIcon,
  Search01Icon,
  CheckIcon,
  CancelCircleIcon,
  Clock01Icon,
} from "@hugeicons/core-free-icons";
import { ActionSwapIcon, ActionSwapText } from "../motion/action-swap";
import { useT } from "../../lib/i18n/provider";
import { cn } from "../../lib/utils";
// ── Status badge system ──────────────────────────────────────────────

/** All possible status variants for the badge component. */
export type StatusVariant =
  | "pending"
  | "in-progress"
  | "submitted"
  | "in-review"
  | "success"
  | "failed"
  | "expired"
  // App-specific mappings
  | "connected"
  | "disconnected"
  | "active"
  | "paused"
  | "draft"
  | "error"
  | "warning";

type StatusConfig = {
  readonly label: string;
  readonly icon: IconSvgElement;
  /** `.tone-*` class from globals.css: picks the --status-* fill and ink
      pair (light and dark) that `.tone-pill` paints. */
  readonly tone: string;
};

const STATUS_CONFIG: Record<StatusVariant, StatusConfig> = {
  // ── Spec variants ──
  pending: {
    label: "Pending",
    icon: TriangleAlertIcon,
    tone: "tone-pending",
  },
  "in-progress": {
    label: "In progress",
    icon: Loading03Icon,
    tone: "tone-progress",
  },
  submitted: {
    label: "Submitted",
    icon: SendIcon,
    tone: "tone-submitted",
  },
  "in-review": {
    label: "In review",
    icon: Search01Icon,
    tone: "tone-review",
  },
  success: {
    label: "Success",
    icon: CheckIcon,
    tone: "tone-success",
  },
  failed: {
    label: "Failed",
    icon: CancelCircleIcon,
    tone: "tone-failed",
  },
  expired: {
    label: "Expired",
    icon: Clock01Icon,
    tone: "tone-expired",
  },
  // ── App-specific mappings ──
  connected: {
    label: "Connected",
    icon: CheckIcon,
    tone: "tone-success",
  },
  disconnected: {
    label: "Disconnected",
    icon: CancelCircleIcon,
    tone: "tone-expired",
  },
  active: {
    label: "Active",
    icon: CheckIcon,
    tone: "tone-success",
  },
  paused: {
    label: "Paused",
    icon: Clock01Icon,
    tone: "tone-review",
  },
  draft: {
    label: "Draft",
    icon: TriangleAlertIcon,
    tone: "tone-expired",
  },
  error: {
    label: "Error",
    icon: CancelCircleIcon,
    tone: "tone-failed",
  },
  // Not broken, but not fully working either — a free plan with a partial
  // catalog, an account near zero balance, a temporary rate limit.
  warning: {
    label: "Warning",
    icon: TriangleAlertIcon,
    tone: "tone-pending",
  },
};

/**
 * The status pill: an outline icon and a label on a tinted fill with the
 * secondary Badge's inset edge. Geometry and colour are `.pill` and
 * `.tone-pill` in globals.css, shared with every other pill in the app.
 */
export function StatusBadge({
  status,
  label,
  title,
  size = "default",
  className,
}: {
  readonly status: StatusVariant;
  /** `sm` (20px) for dense rows; the default is 24px. */
  readonly size?: "default" | "sm";
  /** Overrides the dictionary label — pass one only when a page needs
   *  wording that differs from the shared `badge.*` entries. */
  readonly label?: string;
  /** Hover text for detail that would make the pill too long to read. */
  readonly title?: string;
  readonly className?: string;
}) {
  const t = useT();
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  // `badge.<variant>` mirrors the StatusVariant union, so a new variant only
  // needs its two dictionary entries. `t` echoes the key back when one is
  // missing, so fall back to the built-in English label in that case.
  const translated = t(`badge.${status}`);
  const resolved = translated === `badge.${status}` ? config.label : translated;

  return (
    <span
      title={title}
      className={cn("pill tone-pill", size === "sm" && "pill-sm", config.tone, className)}
    >
      <ActionSwapIcon value={status} className={size === "sm" ? "size-[11px]" : "size-3"}>
        <HugeiconsIcon icon={config.icon} size={size === "sm" ? 11 : 12} strokeWidth={1.75} className="shrink-0" />
      </ActionSwapIcon>
      {/* The swap key tracks the status (and an explicit label override), not
          the translated text: a locale switch re-renders the wording in place
          instead of replaying the enter/exit overlap, which read as both
          languages — and both icons — at once. */}
      <ActionSwapText value={label ? `${status}:${label}` : status}>{label ?? resolved}</ActionSwapText>
    </span>
  );
}
