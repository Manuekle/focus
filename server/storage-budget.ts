import path from "node:path";
import { copyFile, mkdir, readdir, stat, statfs, writeFile } from "node:fs/promises";
import { AppError } from "./errors";
import { dataRoot } from "./storage";

const MB = 1024 * 1024;
function positive(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

export function storageBudgetEnabled(): boolean {
  return positive("FOCUS_MAX_DATA_MB", 0) > 0;
}

async function directoryBytes(dir: string, volumeRoot = false): Promise<number> {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries) {
    // ext4 recovery metadata belongs to the filesystem, not Focus. Railway
    // keeps this directory root-only; statfs still includes its disk usage.
    if (volumeRoot && entry.isDirectory() && entry.name === "lost+found") continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(file);
    else if (entry.isFile()) total += await stat(file).then((info) => info.size).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return 0;
      throw error;
    });
    // Runtime media never needs links; don't traverse outside the data root.
  }
  return total;
}

export async function storageBudgetStatus() {
  if (!storageBudgetEnabled()) return null;
  const root = dataRoot();
  await mkdir(root, { recursive: true });
  const [usedBytes, disk] = await Promise.all([directoryBytes(root, true), statfs(root)]);
  const limitBytes = positive("FOCUS_MAX_DATA_MB", 0) * MB;
  const reserveBytes = positive("FOCUS_MIN_FREE_MB", 100) * MB;
  const freeBytes = disk.bavail * disk.bsize;
  return { usedBytes, limitBytes, reserveBytes, freeBytes, availableBytes: Math.max(0, Math.min(limitBytes - usedBytes, freeBytes - reserveBytes)) };
}

export async function assertStorageAvailable(expectedBytes = 0): Promise<void> {
  const status = await storageBudgetStatus().catch(() => {
    throw new AppError("storage_unavailable", 503, "Available storage couldn’t be checked. Try again shortly.");
  });
  if (status && (status.usedBytes + expectedBytes >= status.limitBytes || status.freeBytes - expectedBytes <= status.reserveBytes)) {
    throw new AppError("storage_full", 507, "The demo’s storage limit has been reached. Remove unused media, then try again.");
  }
}

// Serialize binary writes across Next route bundles. A check followed by a
// write must not race another buffer that passed the same remaining budget.
const shared = ((globalThis as { __focusStorageWrites?: { tail: Promise<void> } }).__focusStorageWrites ??= { tail: Promise.resolve() });
export async function withStorageWrite<T>(bytes: number, write: () => Promise<T>): Promise<T> {
  if (!storageBudgetEnabled()) return write();
  const previous = shared.tail;
  let release!: () => void;
  shared.tail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    await assertStorageAvailable(bytes);
    return await write();
  } finally { release(); }
}

/** For generated frames, sheets and archives written outside the atomic store. */
export async function writeMediaFile(file: string, data: Buffer | string): Promise<void> {
  if (typeof data === "string") return writeFile(file, data);
  await withStorageWrite(data.byteLength, () => writeFile(file, data));
}

export async function copyMediaFile(source: string, destination: string): Promise<void> {
  const { size } = await stat(source);
  await withStorageWrite(size, () => copyFile(source, destination));
}

/** Encoders write without a Buffer. Stop them before they consume the reserve. */
export function watchStorageBudget(onFull: (error: Error) => void): () => void {
  if (!storageBudgetEnabled()) return () => undefined;
  let checking = false, stopped = false;
  const stop = () => { stopped = true; clearInterval(timer); };
  const timer = setInterval(() => {
    if (checking || stopped) return;
    checking = true;
    void assertStorageAvailable().catch((error: Error) => {
      if (!stopped) { stop(); onFull(error); }
    }).finally(() => { checking = false; });
  }, 250);
  timer.unref();
  return stop;
}
