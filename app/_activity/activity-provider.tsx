"use client";

import { useEffect, type ReactNode } from "react";
import { useSession } from "../_auth/session-client";
import { jobApi } from "../_editor/job-client";
import { characterApi } from "../characters/character-client";
import { flipbookApi } from "../flipbook/flipbook-client";
import { rotoscopeApi } from "../rotoscope/rotoscope-client";
import { rotoscopeEnabled } from "../../shared/features";
import { activityConnectionError, activityRequestPending, getActivities, getActivityVersion, setActivityScope } from "./activity-store";

/** Lives above route changes; follows only known resources through their existing read APIs. */
export function ActivityProvider({ children }: { readonly children: ReactNode }) {
  const { session, loading } = useSession();
  const userId = session?.user?.id;
  const scope = userId ? `user.${userId}` : "guest";

  useEffect(() => {
    if (loading) return;
    let storage: Storage | undefined;
    try { storage = window.sessionStorage; } catch { /* Optional in private browsing. */ }
    setActivityScope(scope, storage);
    if (userId) void Promise.allSettled([flipbookApi.list(), characterApi.list(), ...(rotoscopeEnabled() ? [rotoscopeApi.list()] : [])]);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const version = getActivityVersion();
      // Foreground editors already poll. Only follow tasks whose snapshots went quiet.
      const pending = getActivities().filter((entry) => entry.state === "running" && entry.resource && !activityRequestPending(entry.id) && Date.now() - entry.observedAt > 2500);
      await Promise.allSettled(pending.map(async (entry) => {
        const resource = entry.resource!;
        try {
          if (resource.kind === "edit") await jobApi.get(resource.id);
          else if (resource.kind === "flipbook") await flipbookApi.get(resource.id);
          else if (resource.kind === "rotoscope") await rotoscopeApi.get(resource.id);
          else await characterApi.get(resource.id);
        } catch (error) {
          if (stopped || version !== getActivityVersion()) return;
          const code = error instanceof Error && "code" in error ? error.code : null;
          activityConnectionError(entry.id, typeof code === "string" && (code === "not_found" || code.endsWith("_not_found") || code === "http_404" || code === "expired"));
        }
      }));
      if (!stopped) timer = setTimeout(() => void tick(), 1800);
    };
    timer = setTimeout(() => void tick(), 500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [loading, scope, userId]);

  return children;
}
