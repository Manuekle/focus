import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { readMetaConfig } from "./ai/meta";
import { guardConfig } from "./guard";
import { dataRoot } from "./storage";
import { storageBudgetStatus } from "./storage-budget";

function toolVersion(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(bin, ["-version"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? (out.split("\n")[0]?.split(" ")[2] ?? "unknown") : null);
    });
  });
}

const CACHE_MS = 10_000;
let cached: { at: number; report: ReturnType<typeof buildReport> } | null = null;

/** Liveness and readiness facts. Never includes secrets or paths. Cached briefly: the endpoint is public and spawns two processes. */
export function healthReport() {
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    const report = buildReport();
    cached = { at: Date.now(), report };
    // A failed probe must not be served for the whole window.
    report.catch(() => { if (cached?.report === report) cached = null; });
  }
  return cached.report;
}

async function buildReport() {
  const [ffmpeg, ffprobe] = await Promise.all([
    toolVersion(process.env.FFMPEG_PATH ?? "ffmpeg"),
    toolVersion(process.env.FFPROBE_PATH ?? "ffprobe"),
  ]);
  const storage = await mkdir(dataRoot(), { recursive: true })
    .then(() => access(dataRoot(), constants.W_OK))
    .then(() => true, () => false);
  const config = guardConfig();
  const budget = await storageBudgetStatus().catch(() => null);
  const ok = Boolean(ffmpeg && ffprobe && storage);
  return {
    ok,
    checks: {
      ffmpeg,
      ffprobe,
      storageWritable: storage,
      metaConfigured: readMetaConfig() !== null,
      aiEnabled: !config.aiDisabled,
      ...(budget ? { storage: { usedMb: Math.ceil(budget.usedBytes / 1024 / 1024), limitMb: budget.limitBytes / 1024 / 1024, reserveMb: budget.reserveBytes / 1024 / 1024, availableMb: Math.floor(budget.availableBytes / 1024 / 1024) } } : {}),
    },
  };
}
