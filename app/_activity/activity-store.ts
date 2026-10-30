import { z } from "zod";

const ResourceSchema = z.object({ kind: z.enum(["edit", "flipbook", "character", "rotoscope"]), id: z.uuid() });
export type ActivityResource = z.infer<typeof ResourceSchema>;
const ActivitySchema = z.object({
  id: z.string().max(100),
  title: z.string().max(160),
  detail: z.string().max(1000),
  href: z.string().max(200).nullable(),
  state: z.enum(["running", "completed", "failed", "canceled", "waiting"]),
  progress: z.number().min(0).max(1).nullable(),
  resource: ResourceSchema.optional(),
  startedAt: z.number().finite(),
  updatedAt: z.number().finite(),
  observedAt: z.number().finite(),
  sourceUpdatedAt: z.number().finite().optional(),
});
export type Activity = z.infer<typeof ActivitySchema>;
export type ActivityInput = Omit<Activity, "startedAt" | "updatedAt" | "observedAt">;
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

const EMPTY: readonly Activity[] = [];
const RECENT_LIMIT = 5;
const MAX_AGE = 24 * 60 * 60 * 1000;
let entries: readonly Activity[] = EMPTY;
let scope: string | null = null;
let version = 0;
let storage: Storage | undefined;
const listeners = new Set<() => void>();
const pendingRequests = new Set<string>();

export const activityId = (resource: ActivityResource) => `${resource.kind}:${resource.id}`;
export const activityHref = (resource: ActivityResource) => resource.kind === "edit"
  ? null // Video jobs supply their video id, rather than their job id, in the URL.
  : resource.kind === "flipbook" ? `/flipbook?f=${resource.id}` : resource.kind === "rotoscope" ? `/rotoscope?run=${resource.id}` : `/characters?c=${resource.id}`;
export const getActivityVersion = () => version;
export const activityRequestPending = (id: string) => pendingRequests.has(id);
export const getActivities = () => entries;
export const getServerActivities = () => EMPTY;
export const subscribeActivities = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

function commit(next: readonly Activity[]) {
  const active = next.filter((entry) => entry.state === "running");
  const recent = next.filter((entry) => entry.state !== "running").sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT_LIMIT);
  entries = [...active.sort((a, b) => b.startedAt - a.startedAt), ...recent];
  if (scope && storage) {
    try { storage.setItem(`focus.activity.${scope}`, JSON.stringify(entries)); } catch { /* Storage is optional. */ }
  }
  for (const listener of listeners) listener();
}

/** Metadata is scoped to this browser session and account; requests are never replayed. */
export function setActivityScope(next: string, sessionStorage?: Storage) {
  if (scope === next) return;
  const initial = scope === null;
  scope = next;
  storage = sessionStorage;
  if (!initial) { version++; pendingRequests.clear(); }
  let restored: Activity[] = [];
  try {
    const parsed = z.array(ActivitySchema).max(100).safeParse(JSON.parse(storage?.getItem(`focus.activity.${scope}`) ?? "[]"));
    if (parsed.success) restored = parsed.data.filter((entry) => Date.now() - entry.updatedAt < MAX_AGE).map((entry) => ({
      ...entry,
      // Only server resources can be resumed after a document reload.
      state: entry.state === "running" && !entry.resource ? "canceled" : entry.state,
      detail: entry.state === "running" && !entry.resource ? "Interrupted by page reload" : entry.detail,
      href: entry.href && /^\/(?:editor\?v=|flipbook(?:\?|$)|characters(?:\?|$)|rotoscope(?:\?|$))/.test(entry.href) ? entry.href : null,
      observedAt: 0,
    }));
  } catch { /* Private browsing or invalid metadata: start with the current tasks. */ }
  const current = initial ? entries : [];
  commit([...current, ...restored.filter((entry) => !current.some((item) => item.id === entry.id))]);
}

/** A settled document is only activity if it was seen working, or explicitly requested. */
export function observeActivity(input: ActivityInput, force = false) {
  input = { ...input, title: input.title.slice(0, 160), detail: input.detail.slice(0, 1000) };
  const previous = entries.find((entry) => entry.id === input.id);
  if (!previous && input.state !== "running" && !force) return;
  if (previous?.sourceUpdatedAt && input.sourceUpdatedAt && input.sourceUpdatedAt < previous.sourceUpdatedAt) return;
  const now = Date.now();
  const changed = !previous || previous.state !== input.state || previous.detail !== input.detail || previous.progress !== input.progress || previous.title !== input.title;
  const restarted = previous && previous.state !== "running" && input.state === "running";
  const next: Activity = { ...input, sourceUpdatedAt: input.sourceUpdatedAt ?? previous?.sourceUpdatedAt, startedAt: previous && !restarted ? previous.startedAt : now, updatedAt: changed ? now : previous.updatedAt, observedAt: now };
  commit([...entries.filter((entry) => entry.id !== input.id), next]);
}

export function dismissActivity(id: string) {
  if (entries.find((entry) => entry.id === id)?.state === "running") return;
  commit(entries.filter((entry) => entry.id !== id));
}

export function activityConnectionError(id: string, missing = false) {
  const previous = entries.find((entry) => entry.id === id);
  if (!previous || previous.state !== "running") return;
  observeActivity({ ...previous, state: missing ? "failed" : "running", detail: missing ? "This task is no longer available." : "Reconnecting…", progress: null });
}

/** Wrap expensive requests, then hand background work to its existing server resource. */
export async function trackActivity<T>(
  input: { title: string; href?: string; resource?: ActivityResource },
  work: (update: (progress: number | null, detail?: string) => void) => Promise<T>,
  result?: (value: T) => ActivityInput,
): Promise<T> {
  const requestVersion = version;
  const id = input.resource ? activityId(input.resource) : `request:${crypto.randomUUID()}`;
  const running: ActivityInput = { id, title: input.title, href: input.href ?? entries.find((entry) => entry.id === id)?.href ?? null, resource: input.resource, state: "running", progress: null, detail: "Processing…" };
  pendingRequests.add(id);
  observeActivity(running);
  const update = (progress: number | null, detail = "Processing…") => {
    if (requestVersion === version) observeActivity({ ...running, progress: progress === null ? null : Math.max(0, Math.min(1, progress)), detail });
  };
  try {
    const value = await work(update);
    if (requestVersion === version) {
      const resolved = result?.(value) ?? { ...running, state: "completed" as const, detail: "Completed", progress: 1 };
      if (resolved.id !== id) commit(entries.filter((entry) => entry.id !== id));
      observeActivity(resolved, true);
    }
    return value;
  } catch (error) {
    if (requestVersion === version) {
      const canceled = error instanceof Error && (error.name === "AbortError" || ("code" in error && error.code === "aborted"));
      observeActivity({ ...running, state: canceled ? "canceled" : "failed", detail: canceled ? "Canceled" : error instanceof Error ? error.message.slice(0, 1000) : "This task couldn’t be completed. Try again.", progress: null }, true);
    }
    throw error;
  } finally {
    if (requestVersion === version) pendingRequests.delete(id);
  }
}
