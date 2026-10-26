"use client";

import { lazy } from "react";
import { cn } from "@/lib/utils";
import type { GlobeClient } from "./client-globe";
import { DeferredDemo } from "./deferred-demo";

const Globe = lazy(() => import("./client-globe").then((module) => ({ default: module.ClientGlobe })));

export function ClientGlobe({ className, clients }: {
  readonly className?: string;
  readonly clients: readonly GlobeClient[];
}) {
  return (
    <DeferredDemo className={cn("relative aspect-square w-full", className)}>
      <Globe clients={clients} />
    </DeferredDemo>
  );
}
