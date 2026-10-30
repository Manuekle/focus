import path from "node:path";
import { parseArgs } from "node:util";
import { buildReport, generateRun, initRun, previewRun, reguideRun, runsRoot } from "./pipeline";
import { approveManually, readManifest } from "./run-state";

// Console rotoscope: video → frames at N fps → one validated drawing per frame.
//
//   pnpm rotoscope init --video clip.mov --character hero.png --fps 9 --seconds 1 --run test-1s
//   pnpm rotoscope preview --run test-1s                  gridded pose images, no model call
//   pnpm rotoscope reguide --run test-1s                  redraws the pose guides with the current code
//   pnpm rotoscope generate --run test-1s [--limit 3] [--dual]   resumes where it stopped; --dual adds Higgsfield's drawing
//   pnpm rotoscope approve --run test-1s --frame 4 --attempt 2
//   pnpm rotoscope status --run test-1s
//   pnpm rotoscope report --run test-1s [--speed 0.5]
//   pnpm rotoscope import --run test-1s --owner <user id>   opens it in the app (/rotoscope)

const runDir = (name: string) => path.join(runsRoot(), name);
const log = (line: string) => console.log(line);
const need = (values: Record<string, string | undefined>, ...names: string[]) => {
  const missing = names.filter((name) => !values[name]);
  if (missing.length) throw new Error(`missing ${missing.map((name) => `--${name}`).join(", ")}`);
};

const commands: Record<string, (values: Record<string, string | undefined>) => Promise<void>> = {
  init: async (v) => {
    need(v, "video", "character", "run");
    await initRun(runDir(v.run!), {
      video: v.video!, character: v.character!, fps: Number(v.fps ?? 9), start: Number(v.start ?? 0),
      seconds: v.seconds ? Number(v.seconds) : null, maxAttempts: Number(v["max-attempts"] ?? 3),
    }, log);
    log(`Next: pnpm rotoscope generate --run ${v.run}`);
  },
  preview: async (v) => { need(v, "run"); await previewRun(runDir(v.run!), log); },
  reguide: async (v) => { need(v, "run"); log(`new pose guides; the old ones are in ${await reguideRun(runDir(v.run!))}`); },
  generate: async (v) => {
    need(v, "run");
    const dir = runDir(v.run!);
    const outcome = await generateRun(dir, { limit: v.limit ? Number(v.limit) : undefined, dual: v.dual === "true", log });
    if (outcome.kind === "complete") log(`\nall ${outcome.approved} frames approved. Next: pnpm rotoscope report --run ${v.run}`);
    if (outcome.kind === "limit") log(`\nstopped at the --limit: ${outcome.approved} approved, next is frame ${outcome.next}`);
    if (outcome.kind === "halted") {
      console.error(`\nFIREWALL: stopped at frame ${outcome.frame}. ${outcome.reason}`);
      console.error(`Look at ${path.join(dir, "attempts")}; then run generate again to retry from frame ${outcome.frame}, or approve an attempt by hand.`);
      process.exitCode = 2;
    }
  },
  status: async (v) => {
    need(v, "run");
    const manifest = await readManifest(runDir(v.run!));
    for (const frame of manifest.frames) {
      const last = frame.attempts.at(-1);
      log(`${String(frame.index).padStart(4)}  ${frame.status.padEnd(8)}  attempts ${frame.attempts.length}${frame.approved ? `  approved a${frame.approved.attempt}${frame.approved.manual ? " (manual)" : ""}` : ""}${last && !last.passed ? `  last: ${last.checks.filter((c) => !c.passed).map((c) => c.name).join(", ")}` : ""}`);
    }
    if (manifest.halted) log(`\nhalted at frame ${manifest.halted.frame}: ${manifest.halted.reason}`);
  },
  report: async (v) => {
    need(v, "run");
    const speed = Number(v.speed ?? 1);
    const out = await buildReport(runDir(v.run!), speed);
    log(`report: ${out}\n  sheet.png  side-by-side_${speed}x.gif  transparent_${speed}x.mov  scores.md`);
  },
  import: async (v) => {
    need(v, "run", "owner");
    const { importConsoleRun } = await import("./service");
    const run = await importConsoleRun(runDir(v.run!), v.owner!);
    log(`imported as ${run.id}: /rotoscope?run=${run.id}`);
  },
  approve: async (v) => {
    need(v, "run", "frame", "attempt");
    await approveManually(runDir(v.run!), Number(v.frame), Number(v.attempt));
    log(`frame ${v.frame} approved by hand (attempt ${v.attempt})`);
  },
};

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    ...Object.fromEntries(["video", "character", "fps", "start", "seconds", "run", "max-attempts", "limit", "frame", "attempt", "speed", "owner"].map((name) => [name, { type: "string" as const }])),
    dual: { type: "boolean" as const },
  },
});
const command = commands[positionals[0] ?? ""];
if (!command) {
  console.error("usage: pnpm rotoscope <init|preview|reguide|generate|status|approve|report|import> [options]");
  process.exitCode = 1;
} else {
  await command({ ...values, dual: values.dual ? "true" : undefined } as Record<string, string | undefined>).catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
