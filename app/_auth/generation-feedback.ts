"use client";

import { refreshSession } from "./session-client";

export const GENERATION_LIMIT_EVENT = "focus:generation-limit";

/** All AI clients use the same exhaustion notice, including stale open tabs. */
export function generationFeedback(response: Response, body: unknown, method?: string): void {
  const code = (body as { error?: { code?: string } } | null)?.error?.code;
  if (code === "generation_limit_reached") window.dispatchEvent(new Event(GENERATION_LIMIT_EVENT));
  if (code === "generation_limit_reached" || (response.ok && method === "POST")) void refreshSession();
}
