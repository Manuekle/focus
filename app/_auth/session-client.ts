"use client";

import { useCallback, useEffect, useState } from "react";
import { SessionInfoSchema, type SessionInfo } from "../../shared/account";

// The browser side of accounts: who is signed in (or how many free generations are
// left), and the two navigations that sign in and out.

// One request per page load, shared by every component that asks.
let pending: Promise<SessionInfo | null> | null = null;
const listeners = new Set<(info: SessionInfo | null) => void>();

function load(): Promise<SessionInfo | null> {
  pending ??= fetch("/api/auth/session", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((body) => {
      const parsed = SessionInfoSchema.safeParse(body);
      return parsed.success ? parsed.data : null;
    })
    .catch(() => null);
  return pending;
}

/** Re-reads the session (after an edit spent a free use, or after signing out). */
export async function refreshSession(): Promise<SessionInfo | null> {
  pending = null;
  const info = await load();
  for (const listener of listeners) listener(info);
  return info;
}

export function useSession() {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const listener = (next: SessionInfo | null) => active && setInfo(next);
    listeners.add(listener);
    void load().then((next) => {
      if (!active) return;
      setInfo(next);
      setLoading(false);
    });
    return () => {
      active = false;
      listeners.delete(listener);
    };
  }, []);
  const refresh = useCallback(() => refreshSession(), []);
  return { session: info, loading, refresh };
}

/** Starts "Continue with Facebook"; the person comes back to `next`. */
export function signInWithFacebook(next: string): void {
  // A full navigation: the route answers with a redirect to Facebook (or the simulated page).
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/api/auth/facebook?next=${encodeURIComponent(next)}`);
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  await refreshSession();
}
