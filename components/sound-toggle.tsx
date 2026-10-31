"use client";

import { VolumeHighIcon, VolumeOffIcon } from "@hugeicons/core-free-icons";
import { useSyncExternalStore } from "react";
import { HugeiconsIcon } from "./icons/icon";
import { useSound } from "./sound-provider";
import { Button } from "./ui/button";

const subscribe = () => () => {};

/**
 * Header control for interaction sounds. Silent itself: turning sound on
 * answers with the provider's own `success`, and turning it off should not
 * make a noise on the way out.
 */
export function SoundToggle({ className }: { readonly className?: string }) {
  const { enabled, setEnabled } = useSound();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  if (!mounted) return <span aria-hidden className="size-8 shrink-0" />;
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className={className}
      onClick={() => setEnabled(!enabled)}
      aria-label="Interface sounds"
      aria-pressed={enabled}
      data-cuelume-silent=""
    >
      <span key={enabled ? "on" : "off"} className="icon-swap">
        <HugeiconsIcon icon={enabled ? VolumeHighIcon : VolumeOffIcon} size={16} strokeWidth={1.75} />
      </span>
    </Button>
  );
}
