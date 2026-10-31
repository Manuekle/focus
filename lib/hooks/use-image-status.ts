"use client";

import { type SyntheticEvent, useCallback, useState } from "react";

export type ImageStatus = "loading" | "loaded" | "error";

/**
 * Where a picture is in its life: on its way, on screen, or gone. Spread
 * `props` on the <img>; the status follows `src`, and a picture the browser
 * already has (cached, or loaded before hydration) reads as loaded at once.
 */
export function useImageStatus(src: string | undefined) {
  const [settled, setSettled] = useState<{ src: string | undefined; status: ImageStatus }>({ src, status: "loading" });
  const status: ImageStatus = settled.src === src ? settled.status : "loading";
  const ref = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete) setSettled({ src, status: node.naturalWidth ? "loaded" : "error" });
  }, [src]);
  return {
    status,
    props: {
      ref,
      onLoad: (_event: SyntheticEvent<HTMLImageElement>) => setSettled({ src, status: "loaded" }),
      onError: (_event: SyntheticEvent<HTMLImageElement>) => setSettled({ src, status: "error" }),
    },
  };
}
