import path from "node:path";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dataRoot } from "../storage";

// Basic, local usage diagnostics: one JSON line per API call or cache hit.

export type UsageEntry = {
  readonly at: string;
  readonly model: string;
  readonly kind: "plan" | "segment" | "file_upload";
  readonly cached: boolean;
  readonly ok: boolean;
  readonly videoId?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly videoFramesProcessed?: number;
  readonly durationMs?: number;
  readonly error?: string;
};

function usageFile(): string {
  return path.join(dataRoot(), "usage.jsonl");
}

export async function recordUsage(entry: Omit<UsageEntry, "at">): Promise<void> {
  try {
    await mkdir(dataRoot(), { recursive: true });
    await appendFile(usageFile(), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  } catch (error) {
    console.warn("[focus] could not record usage", error);
  }
}

export async function usageSummary() {
  const raw = await readFile(usageFile(), "utf8").catch(() => "");
  const entries = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as UsageEntry);
  const sum = (pick: (entry: UsageEntry) => number | undefined) =>
    entries.reduce((total, entry) => total + (pick(entry) ?? 0), 0);
  const calls = entries.filter((entry) => !entry.cached);
  return {
    apiCalls: calls.length,
    failedCalls: calls.filter((entry) => !entry.ok).length,
    cacheHits: entries.filter((entry) => entry.cached).length,
    planCalls: calls.filter((entry) => entry.kind === "plan").length,
    segmentCalls: calls.filter((entry) => entry.kind === "segment").length,
    inputTokens: sum((entry) => entry.inputTokens),
    outputTokens: sum((entry) => entry.outputTokens),
    videoFramesProcessed: sum((entry) => entry.videoFramesProcessed),
    recent: entries.slice(-20).reverse(),
  };
}

/** SAM frames billed since a moment (cache hits excluded): the processing budget. */
export async function samFramesSince(since: Date): Promise<number> {
  const raw = await readFile(usageFile(), "utf8").catch(() => "");
  let total = 0;
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const entry = JSON.parse(line) as UsageEntry;
    if (entry.kind === "segment" && !entry.cached && new Date(entry.at) >= since) total += entry.videoFramesProcessed ?? 0;
  }
  return total;
}
