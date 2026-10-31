"use client";

import { ImageNotFound01Icon } from "@hugeicons/core-free-icons";
import type { ComponentProps } from "react";
import { HugeiconsIcon } from "../icons/icon";
import { useImageStatus, type ImageStatus } from "../../lib/hooks/use-image-status";
import { cn } from "../../lib/utils";
import styles from "./media-image.module.css";
import { Skeleton } from "./skeleton";

/** The skeleton and the failure mark that sit over a picture's box. Render them beside the <img>, inside a positioned parent. */
export function MediaImageCover({ status, iconSize = 18 }: { readonly status: ImageStatus; readonly iconSize?: number }) {
  if (status === "loaded") return null;
  return status === "loading"
    ? <Skeleton className={styles.cover} />
    : <span className={styles.fallback} role="img" aria-label="This picture couldn’t be loaded"><HugeiconsIcon icon={ImageNotFound01Icon} size={iconSize} strokeWidth={1.5} /></span>;
}

/**
 * An <img> that fills a positioned box: a skeleton while it loads, a fade when
 * it lands, a quiet mark if it cannot load. The parent must be `position:
 * relative` (every picture box here already is) and size the image itself.
 */
export function MediaImage({ className, onLoad, onError, alt = "", ...props }: ComponentProps<"img"> & { readonly iconSize?: number }) {
  const { iconSize, ...img } = props;
  const loading = useImageStatus(typeof img.src === "string" ? img.src : undefined);
  return (
    <>
      <img
        {...img}
        ref={loading.props.ref}
        alt={alt}
        data-status={loading.status}
        className={cn(styles.image, className)}
        onLoad={(event) => { loading.props.onLoad(event); onLoad?.(event); }}
        onError={(event) => { loading.props.onError(event); onError?.(event); }}
      />
      <MediaImageCover status={loading.status} iconSize={iconSize} />
    </>
  );
}

/**
 * A small standalone picture (a poster, a cover) with the same arrival as
 * `MediaImage`. It owns the box, so give it the size, radius and background;
 * `fit` says how the picture sits in it.
 */
export function MediaThumb({ className, fit = "contain", ...props }: ComponentProps<"img"> & { readonly fit?: "contain" | "cover"; readonly iconSize?: number }) {
  return (
    <span className={cn("relative block shrink-0 overflow-hidden", className)}>
      <MediaImage {...props} className={cn("absolute inset-0 size-full", fit === "cover" ? "object-cover" : "object-contain")} iconSize={props.iconSize ?? 14} />
    </span>
  );
}
