import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import {
  ACTIVE_FLIPBOOK_STATUSES,
  FlipbookIdSchema,
  FlipbookImageIdSchema,
  FlipbookSchema,
  DrawingIdSchema,
  MAX_CAST,
  VersionIdSchema,
  type BackgroundMedia,
  type Flipbook,
} from "../../shared/flipbook";
import { flipbookEnabled } from "../../shared/features";
import { AppError } from "../errors";
import { dataRoot } from "../storage";

// Focus Flipbook storage. Same conventions as the video jobs: one JSON state
// file per flipbook written with write-then-rename, read-modify-write under a
// per-id lock, live workers tracked on globalThis (Next bundles each route
// separately), every id validated by pattern before it reaches a path.

const TTL_MS = 24 * 60 * 60 * 1000;

type Runtime = {
  readonly running: Map<string, AbortController>;
  readonly locks: Map<string, Promise<unknown>>;
};
const shared = ((globalThis as { __focusFlipbooks?: { -readonly [K in keyof Runtime]?: Runtime[K] } }).__focusFlipbooks ??= {});
const runtime: Runtime = {
  running: (shared.running ??= new Map()),
  locks: (shared.locks ??= new Map()),
};

export function assertFlipbookEnabled(): void {
  if (!flipbookEnabled()) throw new AppError("flipbook_disabled", 404, "Flipbook isn’t available in this version.");
}

// ── Paths ──────────────────────────────────────────────────────────────────

export function flipbooksRoot(): string {
  return path.join(dataRoot(), "flipbooks");
}

export function imagesRoot(): string {
  return path.join(dataRoot(), "flipbook-images");
}

export function parseFlipbookId(value: string): string {
  const parsed = FlipbookIdSchema.safeParse(value);
  if (!parsed.success) throw new AppError("flipbook_not_found", 404, "This animation no longer exists.");
  return parsed.data;
}

export function parseImageId(value: string): string {
  const parsed = FlipbookImageIdSchema.safeParse(value);
  if (!parsed.success) throw new AppError("image_not_found", 404, "This image no longer exists. Upload it again.");
  return parsed.data;
}

export function imageDir(id: string): string {
  return path.join(imagesRoot(), parseImageId(id));
}

export function flipbookDir(id: string): string {
  return path.join(flipbooksRoot(), parseFlipbookId(id));
}

function checkedFrame(frameId: string): string {
  // Key drawings and in-betweens keep their versions and sprites side by side.
  const parsed = DrawingIdSchema.safeParse(frameId);
  if (!parsed.success) throw new AppError("frame_not_found", 404, "That frame doesn’t exist.");
  return parsed.data;
}

function checkedVersion(version: string): string {
  const parsed = VersionIdSchema.safeParse(version);
  if (!parsed.success) throw new AppError("media_not_found", 404, "This file is no longer available.");
  return parsed.data;
}

export const flipbookFiles = {
  state: (id: string) => path.join(flipbookDir(id), "flipbook.json"),
  /** Working copy of the upload; keeps its alpha when it had one. */
  source: (id: string) => path.join(flipbookDir(id), "source.png"),
  /** The upload flattened on white: what the models receive. */
  sourceFlat: (id: string) => path.join(flipbookDir(id), "source-flat.png"),
  identity: (id: string) => path.join(flipbookDir(id), "character-identity.png"),
  /** One character of a scene, flattened on white, in the order they were picked. */
  cast: (id: string, index: number) => {
    if (!Number.isInteger(index) || index < 0 || index >= MAX_CAST) throw new AppError("media_not_found", 404, "This file is no longer available.");
    return path.join(flipbookDir(id), "cast", `${index}.png`);
  },
  reference: (id: string, version: string) => path.join(flipbookDir(id), "reference", `${checkedVersion(version)}.png`),
  extraReference: (id: string, version: string) => path.join(flipbookDir(id), "reference", `extra-${checkedVersion(version)}.png`),
  referenceMeasure: (id: string, version: string) => path.join(flipbookDir(id), "reference", `${checkedVersion(version)}.json`),
  versionDir: (id: string, frameId: string, version: string) => path.join(flipbookDir(id), "frames", checkedFrame(frameId), checkedVersion(version)),
  sprite: (id: string, frameId: string, key: string) => {
    if (!/^[0-9a-f]{16}$/.test(key)) throw new AppError("media_not_found", 404, "This file is no longer available.");
    return path.join(flipbookDir(id), "sprites", `${checkedFrame(frameId)}-${key}.png`);
  },
  background: (id: string, which: BackgroundFile) => path.join(flipbookDir(id), "backgrounds", `${which}.png`),
  exportDir: (id: string, key: string) => {
    if (!/^x-[0-9a-f]{16}$/.test(key)) throw new AppError("media_not_found", 404, "This file is no longer available.");
    return path.join(flipbookDir(id), "exports", key);
  },
};

export type BackgroundFile = BackgroundMedia;

export function newVersionId(): string {
  return `v-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

// ── Atomic writes ──────────────────────────────────────────────────────────

export async function writeAtomic(file: string, data: string | Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(temp, data);
  await rename(temp, file);
}

export async function readJsonFile<T>(file: string, parse: (value: unknown) => T): Promise<T | null> {
  const raw = await readFile(file, "utf8").catch(() => null);
  if (!raw) return null;
  try {
    return parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

// ── State ──────────────────────────────────────────────────────────────────

async function readState(id: string): Promise<Flipbook> {
  const raw = await readFile(flipbookFiles.state(id), "utf8").catch(() => null);
  if (!raw) throw new AppError("flipbook_not_found", 404, "This animation no longer exists or has expired.");
  return FlipbookSchema.parse(JSON.parse(raw));
}

async function writeState(flipbook: Flipbook): Promise<Flipbook> {
  const active = ACTIVE_FLIPBOOK_STATUSES.includes(flipbook.status);
  const next = FlipbookSchema.parse({
    ...flipbook,
    // Progress and step text only describe running work.
    detail: active || flipbook.status === "reference_ready" ? flipbook.detail : null,
    progress: active ? flipbook.progress : null,
    updatedAt: new Date().toISOString(),
  });
  await writeAtomic(flipbookFiles.state(next.id), JSON.stringify(next));
  return next;
}

function withLock<T>(id: string, task: () => Promise<T>): Promise<T> {
  const previous = runtime.locks.get(id) ?? Promise.resolve();
  const next = previous.then(task, task);
  runtime.locks.set(id, next.catch(() => undefined));
  return next;
}

export function createState(flipbook: Flipbook): Promise<Flipbook> {
  return withLock(flipbook.id, () => writeState(flipbook));
}

/**
 * Read-modify-write under the flipbook's lock. Frame workers run side by
 * side, so every change is a function of the latest state, never a stale copy.
 * A canceled flipbook only accepts changes that say so.
 */
export function updateFlipbook(id: string, change: (current: Flipbook) => Flipbook, options: { evenIfCanceled?: boolean } = {}): Promise<Flipbook> {
  return withLock(id, async () => {
    const current = await readState(id);
    if (current.status === "canceled" && !options.evenIfCanceled) return current;
    return writeState(change(current));
  });
}

export async function getFlipbook(id: string): Promise<Flipbook> {
  const flipbook = await readState(parseFlipbookId(id));
  const unfinished = (book: Flipbook) => ACTIVE_FLIPBOOK_STATUSES.includes(book.status) || book.queuedDrawings?.length || book.frames.some((frame) => frame.status === "generating");
  // Active with no live worker: the server restarted mid-run.
  if (unfinished(flipbook) && !runtime.running.has(flipbook.id)) {
    return withLock(flipbook.id, async () => {
      const current = await readState(flipbook.id);
      if (!unfinished(current) || runtime.running.has(current.id)) return current;
      const usable = Boolean(current.plan && current.reference);
      return writeState({
        ...current,
        budget: { ...current.budget, used: Math.max(0, current.budget.used - (current.queuedDrawings?.length ?? 0)) },
        queuedDrawings: [],
        status: usable ? (current.frames.some((frame) => frame.version && frame.status === "ready") ? "ready" : "reference_ready") : "failed",
        frames: current.frames.map((frame) =>
          frame.status === "generating" || frame.status === "processing"
            ? { ...frame, status: "failed", error: { code: "interrupted", message: "Interrupted by a server restart. Redraw this frame." } }
            : frame,
        ),
        error: usable ? null : { code: "interrupted", message: "Processing was interrupted by a server restart. Start again." },
      });
    });
  }
  return flipbook;
}

/** Every stored flipbook, as last written. No recovery: for listing only. */
export async function allFlipbooks(): Promise<Flipbook[]> {
  const names = (await readdir(flipbooksRoot()).catch(() => [] as string[])).filter((name) => FlipbookIdSchema.safeParse(name).success);
  const states = await Promise.all(names.map((name) => readJsonFile(flipbookFiles.state(name), (value) => FlipbookSchema.parse(value))));
  return states.filter((state): state is Flipbook => state !== null);
}

// ── Workers ────────────────────────────────────────────────────────────────

export function isRunning(id: string): boolean {
  return runtime.running.has(id);
}

export function activeFlipbookCount(): number {
  return runtime.running.size;
}

/**
 * Runs one background task for a flipbook. A failure lands in the state as a
 * user-facing error; a cancel stays a cancel.
 */
export function startWorker(id: string, work: (signal: AbortSignal) => Promise<void>, onFailure: (error: AppError) => (current: Flipbook) => Flipbook): void {
  if (runtime.running.has(id)) throw new AppError("flipbook_busy", 409, "This animation is still working. Wait for the current step to finish.");
  const controller = new AbortController();
  runtime.running.set(id, controller);
  void work(controller.signal)
    .catch(async (error) => {
      if (controller.signal.aborted) return;
      const failure = error instanceof AppError ? error : new AppError("internal_error", 500, "Something failed while animating.");
      if (!(error instanceof AppError)) console.error("[focus] flipbook failed", error);
      else if (failure.detail) console.warn(`[focus] flipbook ${id} failed: ${failure.code} — ${failure.detail}`);
      await updateFlipbook(id, onFailure(failure)).catch(() => undefined);
    })
    .finally(() => {
      if (runtime.running.get(id) === controller) runtime.running.delete(id);
    });
}

export function abortWorker(id: string): void {
  runtime.running.get(id)?.abort();
  // Its finally block releases the slot after reservations and in-flight work settle.
}

// ── Cleanup ────────────────────────────────────────────────────────────────

/** Removes flipbooks no account saved and uploaded images, once untouched for a day. */
export async function cleanupFlipbooks(): Promise<void> {
  const now = Date.now();
  for (const name of await readdir(flipbooksRoot()).catch(() => [] as string[])) {
    if (!FlipbookIdSchema.safeParse(name).success || runtime.running.has(name)) continue;
    const dir = path.join(flipbooksRoot(), name);
    const info = await stat(path.join(dir, "flipbook.json")).catch(() => null) ?? await stat(dir).catch(() => null);
    if (!info || now - info.mtimeMs <= TTL_MS) continue;
    const saved = await readJsonFile(path.join(dir, "flipbook.json"), (value) => FlipbookSchema.parse(value));
    if (!saved?.ownerId) await rm(dir, { recursive: true, force: true });
  }
  for (const name of await readdir(imagesRoot()).catch(() => [] as string[])) {
    if (!FlipbookImageIdSchema.safeParse(name).success) continue;
    const dir = path.join(imagesRoot(), name);
    const info = await stat(dir).catch(() => null);
    if (info && now - info.mtimeMs > TTL_MS) await rm(dir, { recursive: true, force: true });
  }
}
