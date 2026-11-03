"use client";

import { useRef } from "react";
import { Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { Button } from "../../components/ui/button";
import { IMAGE_ACCEPT_ATTRIBUTE } from "../../shared/flipbook";

/**
 * Puts the person's own picture on a frame (one they drew or generated
 * elsewhere) in place of the run's drawing, as Flipbook's Replace does.
 */
export function OwnImageButton({ frame, replacing, disabled, onPick, size = "sm" }: {
  readonly frame: number;
  /** The frame already has a drawing: the label says it is replaced. */
  readonly replacing: boolean;
  readonly disabled: boolean;
  readonly onPick: (file: File) => void;
  readonly size?: "xs" | "sm";
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button type="button" size={size} variant="ghost" disabled={disabled} onClick={() => fileRef.current?.click()} title={`Use your own image for frame ${frame} (drawn or generated elsewhere). It is kept as a new attempt and approved; the run's drawings stay in the attempts.`}>
        <HugeiconsIcon icon={Upload01Icon} size={size === "xs" ? 13 : 14} strokeWidth={1.75} />{replacing ? "Replace" : "Upload"}
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_ACCEPT_ATTRIBUTE}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onPick(file);
        }}
      />
    </>
  );
}
