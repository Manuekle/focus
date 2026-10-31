import path from "node:path";
import { parseArgs } from "node:util";
import { buildReport, diagnoseFrame, generateRun, initRun, mapPreview, previewRun, reguideRun, runsRoot, type Renderer } from "./pipeline";
import { approveManually, readManifest } from "./run-state";
import { CharacterMeasuresSchema } from "../../shared/rotoscope";

// Console rotoscope: video → frames at N fps → one validated drawing per frame.
//
//   pnpm rotoscope init --video clip.mov --character hero.png --fps 9 --seconds 1 --run test-1s [--height 160 --weight 54 --person-height 165] [--pose-sheet]
//                                                         --height/--weight: the character's cm and kg; --pose-sheet draws it in four other poses first
//                                                         --kit <dir>: a My characters kit of this very sheet (its character.png): its files are copied in
//   pnpm rotoscope preview --run test-1s                  gridded pose images, no model call
//   pnpm rotoscope reguide --run test-1s                  redraws the pose guides with the current code
//   pnpm rotoscope generate --run test-1s [--limit 3] [--attempts 1] [--dual] [--renderer auto|rig|muse] [--no-repair] [--review-always] [--writer template|spark]
//                                                         resumes where it stopped; --dual adds Higgsfield's drawing;
//                                                         --renderer picks the character rig and/or generators (default auto);
//                                                         --review-always has Muse Spark review every attempt (debug), not only those the measurements don't reject
//                                                         --writer template draws from the template prompt; by default Muse Spark writes each frame's prompt from it and the prompt memory
//   pnpm rotoscope map --run test-1s --frame 20           the character rig's drawing of one frame and its pose check, no model call
//   pnpm rotoscope diagnose --run test-1s --frame 20      mapping diagnostics for attempts drawn before the engine (local)
//   pnpm rotoscope lab --run test-1s --frames 1-9 [--settings pilot|name,name] [--repeats N]
//                                                         pose laboratory: Muse Image, one image per setting, measured like the firewall (paid calls)
//   pnpm rotoscope scan --run test-1s --frames 1-21 [--lab <stamp>]   overlay scan of saved drawings (approved, rejected, a lab's), no model call
//   pnpm rotoscope approve --run test-1s --frame 4 --attempt 2
//   pnpm rotoscope status --run test-1s
//   pnpm rotoscope report --run test-1s [--speed 0.5]
//   pnpm rotoscope import --run test-1s --owner <user id> [--batch <uuid> --frames 4] [--dual]
//                                                         opens it in the app (/rotoscope); with --batch, in that test batch (/rotoscope?batch=…), whose rounds draw --frames frames

const runDir = (name: string) => path.join(runsRoot(), name);
const log = (line: string) => console.log(line);
const need = (values: Record<string, string | undefined>, ...names: string[]) => {
  const missing = names.filter((name) => !values[name]);
  if (missing.length) throw new Error(`missing ${missing.map((name) => `--${name}`).join(", ")}`);
};

const commands: Record<string, (values: Record<string, string | undefined>) => Promise<void>> = {
  init: async (v) => {
    need(v, "video", "character", "run");
    const cm = (value: string | undefined) => (value ? Number(value) : null);
    await initRun(runDir(v.run!), {
      video: v.video!, character: v.character!, fps: Number(v.fps ?? 9), start: Number(v.start ?? 0),
      seconds: v.seconds ? Number(v.seconds) : null, maxAttempts: Number(v["max-attempts"] ?? 3),
      measures: v.height || v.weight || v["person-height"] ? CharacterMeasuresSchema.parse({ heightCm: cm(v.height), weightKg: cm(v.weight), personHeightCm: cm(v["person-height"]) }) : null,
      poseSheet: v["pose-sheet"] === "true",
      kit: v.kit ? { dir: v.kit, body: !v.height && !v.weight } : null,
    }, log);
    log(`Next: pnpm rotoscope generate --run ${v.run}`);
  },
  preview: async (v) => { need(v, "run"); await previewRun(runDir(v.run!), log); },
  reguide: async (v) => { need(v, "run"); log(`new pose guides; the old ones are in ${await reguideRun(runDir(v.run!))}`); },
  generate: async (v) => {
    need(v, "run");
    const dir = runDir(v.run!);
    const renderer = (["auto", "rig", "muse"].includes(v.renderer ?? "") ? v.renderer : "auto") as Renderer;
    const outcome = await generateRun(dir, { limit: v.limit ? Number(v.limit) : undefined, attempts: v.attempts ? Number(v.attempts) : undefined, dual: v.dual === "true", renderer, repair: v["no-repair"] !== "true", review: v["review-always"] === "true" ? "always" : "gated", writer: v.writer === "template" ? "template" : "spark", log });
    if (outcome.kind === "complete") log(`\nall ${outcome.approved} frames approved. Next: pnpm rotoscope report --run ${v.run}`);
    if (outcome.kind === "partial") {
      log(`\n${outcome.approved} frames approved; frame${outcome.failed.length === 1 ? "" : "s"} ${outcome.failed.join(", ")} didn't pass and stay open.`);
      log(`Look at ${path.join(dir, "attempts")}; run generate again to retry them, or approve an attempt by hand.`);
    }
    if (outcome.kind === "limit") log(`\nstopped at the --limit: ${outcome.approved} approved, next is frame ${outcome.next}`);
    if (outcome.kind === "halted") {
      console.error(`\nFIREWALL: stopped at frame ${outcome.frame}. ${outcome.reason}`);
      console.error(`Look at ${path.join(dir, "attempts")}; then run generate again to retry from frame ${outcome.frame}, or approve an attempt by hand.`);
      process.exitCode = 2;
    }
  },
  map: async (v) => {
    need(v, "run", "frame");
    const { file, pose } = await mapPreview(runDir(v.run!), Number(v.frame), log);
    log(`\n${file}`);
    if (!pose.passed) process.exitCode = 2;
  },
  diagnose: async (v) => {
    need(v, "run", "frame");
    log(`${await diagnoseFrame(runDir(v.run!), Number(v.frame), log)} attempts measured`);
  },
  lab: async (v) => {
    need(v, "run", "frames");
    const { PILOT, SWAP, runLab } = await import("./lab");
    const [from, to] = v.frames!.split("-").map(Number);
    const frames = Array.from({ length: (to ?? from) - from + 1 }, (_, i) => from + i);
    const all = [...PILOT, ...SWAP];
    const wanted = v.settings && v.settings !== "pilot" ? v.settings.split(",") : null;
    const settings = wanted ? all.filter((setting) => wanted.includes(setting.name)) : PILOT;
    if (!settings.length) throw new Error(`no such settings; known: ${all.map((setting) => setting.name).join(", ")}`);
    const out = await runLab(runDir(v.run!), { frames, settings, repeats: v.repeats ? Number(v.repeats) : 1, log });
    log(`\nlab: ${out}  (results.md, frame_NNNN/sheet.png)`);
  },
  scan: async (v) => {
    need(v, "run", "frames");
    const { scanSaved } = await import("./lab");
    const [from, to] = v.frames!.split("-").map(Number);
    const frames = Array.from({ length: (to ?? from) - from + 1 }, (_, i) => from + i);
    log(`\nscan: ${await scanSaved(runDir(v.run!), { lab: v.lab, frames, log })}`);
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
    const run = await importConsoleRun(runDir(v.run!), v.owner!, { batch: v.batch, batchFrames: v.frames ? Number(v.frames) : undefined, dual: v.dual === "true" });
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
    ...Object.fromEntries(["video", "character", "fps", "start", "seconds", "run", "max-attempts", "limit", "frame", "attempt", "speed", "owner", "renderer", "frames", "settings", "repeats", "lab", "attempts", "height", "weight", "person-height", "batch", "kit", "writer"].map((name) => [name, { type: "string" as const }])),
    dual: { type: "boolean" as const },
    "no-repair": { type: "boolean" as const },
    "review-always": { type: "boolean" as const },
    "pose-sheet": { type: "boolean" as const },
  },
});
const command = commands[positionals[0] ?? ""];
if (!command) {
  console.error("usage: pnpm rotoscope <init|preview|reguide|generate|map|diagnose|lab|scan|status|approve|report|import> [options]");
  process.exitCode = 1;
} else {
  await command({ ...values, dual: values.dual ? "true" : undefined, "no-repair": values["no-repair"] ? "true" : undefined, "review-always": values["review-always"] ? "true" : undefined, "pose-sheet": values["pose-sheet"] ? "true" : undefined } as Record<string, string | undefined>).catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
