"use client";

import { useEffect, useRef } from "react";
import { useToast } from "../../components/toast-provider";
import type { AnimatedToastAction, ToastStatus } from "../../components/motion/animated-toast-stack";

/** Keeps a state-driven notice in the app's toast stack until that state clears. */
export function EditorNotice({
  title,
  description,
  status = "error",
  action,
  duration = 0,
}: {
  readonly title: string;
  readonly description?: string;
  readonly status?: ToastStatus;
  readonly action?: AnimatedToastAction;
  readonly duration?: number;
}) {
  const { toast, dismiss } = useToast();
  const onAction = useRef(action?.onClick);
  const actionLabel = action?.label;

  // Refresh the action without showing the same notice again on every render.
  useEffect(() => {
    onAction.current = action?.onClick;
  }, [action?.onClick]);

  useEffect(() => {
    const id = toast({
      title,
      description,
      status,
      duration,
      action: actionLabel ? {
        label: actionLabel,
        onClick: (notice) => {
          onAction.current?.(notice);
        },
      } : undefined,
    });
    return () => dismiss(id);
  }, [title, description, status, duration, actionLabel, toast, dismiss]);

  return null;
}
