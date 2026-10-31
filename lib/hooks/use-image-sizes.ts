"use client";

import { useEffect, useState } from "react";

export type ImageSize = { readonly width: number; readonly height: number };

const SQUARE: ImageSize = { width: 1, height: 1 };
const sizes = new Map<string, ImageSize>();

/**
 * Natural pixel sizes of pictures, for components that reserve a shape before
 * the picture is on screen (the image viewer's morph). A picture reads as a
 * square until it has loaded.
 */
export function useImageSizes(srcs: readonly string[]): (src: string) => ImageSize {
  const [, refresh] = useState(0);
  const key = srcs.join("\n");
  useEffect(() => {
    let live = true;
    for (const src of key.split("\n")) {
      if (!src || sizes.has(src)) continue;
      const image = new Image();
      image.onload = () => {
        if (!image.naturalWidth || !image.naturalHeight) return;
        sizes.set(src, { width: image.naturalWidth, height: image.naturalHeight });
        if (live) refresh((tick) => tick + 1);
      };
      image.src = src;
    }
    return () => { live = false; };
  }, [key]);
  return (src) => sizes.get(src) ?? SQUARE;
}
