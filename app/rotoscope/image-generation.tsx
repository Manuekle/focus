"use client";

import dynamic from "next/dynamic";

// WebGL loader for a drawing in progress; client-only so three stays out of the server render and the first bundle.
export const ImageGeneration = dynamic(() => import("img-fx").then((mod) => mod.ImageGeneration), { ssr: false });
