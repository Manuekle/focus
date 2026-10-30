import { createHash, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors";
import { clientKey, takeSlot } from "./guard";

/** Settings requests per client per hour on a public server, counted before the token check. */
const SETTINGS_PER_HOUR = 120;

function same(a: string, b: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * Local installs (`pnpm dev`, bound to 127.0.0.1) are open to their owner. A
 * production server needs FOCUS_ADMIN_TOKEN, sent as the X-Focus-Admin header;
 * without a configured token the settings page stays off.
 */
export function assertSettingsAccess(request: Request): void {
  if (process.env.NODE_ENV !== "production") return;
  const token = process.env.FOCUS_ADMIN_TOKEN;
  if (!token) {
    throw new AppError("settings_disabled", 403, "Settings are off on this server. Set FOCUS_ADMIN_TOKEN in your hosting platform to turn them on.");
  }
  const wait = takeSlot("settings", clientKey(request), SETTINGS_PER_HOUR);
  if (wait !== null) throw new AppError("rate_limited", 429, `Too many settings requests. Try again in ${Math.max(1, Math.ceil(wait / 60))} min.`);
  if (!same(request.headers.get("x-focus-admin") ?? "", token)) {
    throw new AppError("admin_token_required", 401, "Enter the admin token (FOCUS_ADMIN_TOKEN) to manage settings.");
  }
}
