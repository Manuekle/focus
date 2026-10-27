"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import {
  AnimatedToastStack,
  useAnimatedToastStack,
  type ToastInput,
  type ToastStatus,
} from "./motion/animated-toast-stack";
import { useSound, type CueName, type CueOptions } from "./sound-provider";
import { useT } from "../lib/i18n/provider";

type ToastContextValue = {
  /** Queue a toast. Returns its id, usable with `dismiss`/`update`. */
  readonly toast: (input: ToastInput & { readonly sound?: boolean }) => string;
  readonly dismiss: (id: string) => void;
  readonly update: (id: string, patch: Partial<ToastInput>) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * The toast is the app's notification surface, so this is where sound belongs
 * — one mapping here covers every page instead of each caller remembering to
 * cue next to its own `toast()`.
 *
 * Each toast plays the cue for what it reports, at `subtle`: the toast is the
 * echo of an event, not the event. `ready` for the two quiet statuses on
 * purpose: an informational toast is a result that is there, not an outcome,
 * and giving it the same warm confirmation as a save makes every save sound
 * like nothing in particular. Warnings and errors keep their full weight —
 * those are the toasts someone has to act on.
 */
const STATUS_CUE: Record<ToastStatus, readonly [CueName, CueOptions?]> = {
  neutral: ["ready", { emphasis: "subtle" }],
  info: ["ready", { emphasis: "subtle" }],
  loading: ["loading", { emphasis: "subtle" }],
  success: ["success", { emphasis: "subtle" }],
  warning: ["warning"],
  error: ["error"],
};

/**
 * Real toasts for real changes — mounted once at the root, above the
 * `TooltipProvider`. Every page calls `useToast()` instead of rolling its
 * own inline "Saved" banner.
 */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const { toasts, showToast, dismissToast, updateToast } = useAnimatedToastStack({
    defaultDuration: 4200,
    limit: 4,
  });
  const { cue } = useSound();
  const t = useT();

  const toast = useCallback(
    ({ sound = true, ...input }: ToastInput & { readonly sound?: boolean }) => {
      if (sound) cue(...STATUS_CUE[input.status ?? "neutral"]);
      // An error stays until it is dismissed. 4.2s is enough for "Saved"
      // and nowhere near enough to read what failed and decide what to do
      // about it — WCAG 2.2.1, and the reason the timing is adjustable at all.
      // Spread after the default so a caller that wants its own duration
      // still wins. A warning is usually a sentence with a consequence in it,
      // so it gets twice the read time without becoming sticky.
      if (input.status === "error") return showToast({ duration: 0, ...input });
      if (input.status === "warning") return showToast({ duration: 8400, ...input });
      return showToast(input);
    },
    [cue, showToast],
  );

  // A `loading` toast that later resolves is the same event to the listener as
  // a toast that arrived already finished, so the status patch cues too.
  const update = useCallback(
    (id: string, patch: Partial<ToastInput>) => {
      if (patch.status) cue(...STATUS_CUE[patch.status]);
      updateToast(id, patch);
    },
    [cue, updateToast],
  );

  const value = useMemo<ToastContextValue>(
    () => ({ toast, dismiss: dismissToast, update }),
    [toast, dismissToast, update],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <AnimatedToastStack
        toasts={toasts}
        onDismiss={dismissToast}
        position="bottom-center"
        placement="fixed"
        portal
        classNames={{
          root: "bottom-[max(24px,env(safe-area-inset-bottom))]",
          title: "line-clamp-none",
          description: "line-clamp-none",
        }}
        dismissLabel={t("apiError.dismiss")}
      />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
}
