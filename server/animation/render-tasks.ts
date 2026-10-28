import { AppError } from "../errors";

type Task = {
  controller: AbortController;
  promise: Promise<unknown>;
  subscribers: number;
  finished: boolean;
};
const tasks = ((
  globalThis as { __focusExportTasks?: Map<string, Task> }
).__focusExportTasks ??= new Map());
const MAX_QUEUED = 8;
const TIMEOUT_MS = 180_000;

/** One bounded local render per cache key, shared by preview and download.
 * A disconnected subscriber cannot cancel work another subscriber still needs. */
export async function shareRender<T>(
  key: string,
  run: (signal: AbortSignal) => Promise<T>,
  options: { signal?: AbortSignal; beforeStart?: () => void } = {},
): Promise<T> {
  if (options.signal?.aborted)
    throw new AppError("canceled", 499, "Render canceled.");
  let task = tasks.get(key);
  if (!task) {
    if (tasks.size >= MAX_QUEUED)
      throw new AppError(
        "busy",
        503,
        "Too many exports are processing. Try again in a minute.",
      );
    options.beforeStart?.();
    const controller = new AbortController();
    const created: Task = {
      controller,
      promise: Promise.resolve(),
      subscribers: 0,
      finished: false,
    };
    const timeout = setTimeout(
      () =>
        controller.abort(
          new AppError(
            "render_timeout",
            504,
            "The smooth render took too long. Try a shorter clip or Drawn playback.",
          ),
        ),
      TIMEOUT_MS,
    );
    created.promise = Promise.resolve()
      .then(() => run(controller.signal))
      .catch((error) => {
        if (controller.signal.aborted) throw controller.signal.reason;
        throw error;
      })
      .finally(() => {
        created.finished = true;
        clearTimeout(timeout);
        if (tasks.get(key) === created) tasks.delete(key);
      });
    void created.promise.catch(() => undefined);
    tasks.set(key, created);
    task = created;
  }
  task.subscribers++;
  const current = task;
  const signal = options.signal;
  let onAbort: (() => void) | undefined;
  try {
    const canceled = new Promise<never>((_, reject) => {
      onAbort = () => reject(new AppError("canceled", 499, "Render canceled."));
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
    return (await (signal
      ? Promise.race([current.promise, canceled])
      : current.promise)) as T;
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    current.subscribers--;
    if (!current.subscribers && !current.finished) {
      if (tasks.get(key) === current) tasks.delete(key);
      current.controller.abort(
        new AppError("canceled", 499, "Render canceled."),
      );
    }
  }
}
