import { parseArgs } from "node:util";
import { VARIANTS, type Variant } from "./prompt";
import { singleFrameDebug } from "./run";
import { pipelineFrameDebug, type PromptStrategy } from "./pipeline-frame";

// single_frame_debug from the console: one drawing, every artifact, one report.
//
//   pnpm single-frame-debug --pose pose.png --character hero.png
//   pnpm single-frame-debug --pose pose.png --character hero.png --dry               inputs, overlays, masks and the request; no Muse call
//   pnpm single-frame-debug --pose pose.png --character hero.png --generated out.png evaluates an existing image instead (e.g. frame 7 of a run)
//   pnpm single-frame-debug --pose pose.png --character hero.png --variant edit      one change against the base prompt: edit | mannequin | describe | stance
//   options: --out debug_runs  --size 1024x1536  --reasoning high|low  --no-sam
//
// On a rotoscope run, with the pipeline's own references and prompt (or a short structured prompt over the same references):
//   pnpm single-frame-debug --run .focus-data/rotoscope/<id> --frame 1 --strategy existing|structured [--dry] [--generated out.png] [--no-review] [--out debug_runs]

const { values } = parseArgs({
  options: {
    pose: { type: "string" },
    character: { type: "string" },
    out: { type: "string" },
    size: { type: "string" },
    reasoning: { type: "string" },
    generated: { type: "string" },
    variant: { type: "string" },
    dry: { type: "boolean" },
    "no-sam": { type: "boolean" },
    run: { type: "string" },
    frame: { type: "string" },
    strategy: { type: "string" },
    "no-review": { type: "boolean" },
  },
});

if (values.run) {
  const strategy = (values.strategy ?? "existing") as PromptStrategy;
  if (!["existing", "structured"].includes(strategy) || !/^\d+$/.test(values.frame ?? "")) {
    console.error("usage: pnpm single-frame-debug --run <run dir> --frame <n> [--strategy existing|structured] [--dry] [--out dir]");
    process.exitCode = 1;
  } else {
    try {
      const { dir, record } = await pipelineFrameDebug({ run: values.run, frame: Number(values.frame), strategy, out: values.out, dry: values.dry, generated: values.generated, review: !values["no-review"], log: (line) => console.log(line) });
      for (const check of record.checks) console.log(`${(check.status ?? (check.passed ? "pass" : "fail")).toUpperCase().padEnd(13)} ${check.name}: ${check.detail}`);
      if (record.verdict) console.log(`\n${record.verdict.decision}${record.verdict.reasons.length ? `\n  ${record.verdict.reasons.join("\n  ")}` : ""}`);
      if (record.generation.source === "failed") process.exitCode = 1;
      console.log(`\nrecord: ${dir}/evaluation.json`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
} else if (!values.pose || !values.character) {
  console.error("usage: pnpm single-frame-debug --pose <image> --character <image> [--dry] [--generated <image>] [--out dir] [--size WxH] [--reasoning high|low] [--variant base|edit|mannequin|describe|stance] [--no-sam]");
  process.exitCode = 1;
} else if (values.variant && !VARIANTS.includes(values.variant as Variant)) {
  console.error(`--variant must be one of ${VARIANTS.join(", ")}`);
  process.exitCode = 1;
} else if (values.size && !/^\d+x\d+$/.test(values.size)) {
  console.error("--size must look like 1024x1536");
  process.exitCode = 1;
} else {
  try {
    const { dir, record } = await singleFrameDebug({
      pose: values.pose,
      character: values.character,
      out: values.out,
      size: values.size,
      reasoning: values.reasoning === "low" ? "low" : "high",
      generated: values.generated,
      variant: values.variant as Variant | undefined,
      dry: values.dry,
      sam: values["no-sam"] ? false : undefined,
      log: (line) => console.log(line),
    });
    if (record.checks.length) {
      console.log("");
      for (const check of record.checks) console.log(`${check.status.toUpperCase().padEnd(10)} ${check.label}: ${check.summary}`);
    }
    console.log(`\nreport: ${dir}/comparison_report.md`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
