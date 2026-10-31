import type { ImageResponse } from "../animation/muse-image";
import type { DebugCheck, Status } from "./measure";

// evaluation.json's shape and comparison_report.md written from it: the report
// says only what the record holds, so the two never disagree.

export type ImageInfo = { readonly source: string; readonly file: string; readonly width: number; readonly height: number; readonly sha256: string };

export type ToolInfo = {
  readonly pose: Readonly<Record<string, { readonly estimator: string; readonly fallback: boolean; readonly bodyConfidence: number | null } | { readonly error: string }>>;
  readonly segmentation: Readonly<Record<string, { readonly method: string; readonly confidence: number | null } | { readonly error: string }>>;
};

export type DebugRecord = {
  readonly mode: "single_frame_debug";
  readonly createdAt: string;
  readonly dir: string;
  readonly inputs: { readonly pose: ImageInfo; readonly character: ImageInfo };
  readonly request: { readonly variant: string; readonly model: string; readonly size: string; readonly reasoning: "high" | "low" };
  readonly generation:
    | { readonly source: "muse"; readonly durationMs: number; readonly width: number; readonly height: number; readonly requests?: number; readonly usage?: ImageResponse["usage"]; readonly responseId?: string | null }
    | { readonly source: "file"; readonly file: string; readonly width: number; readonly height: number }
    | { readonly source: "skipped"; readonly reason: string }
    /** An API failure (no drawing to judge), never a quality verdict: `code` is the AppError code when there is one. */
    | { readonly source: "failed"; readonly kind: "api"; readonly code: string | null; readonly error: string };
  readonly tools: ToolInfo;
  readonly checks: readonly DebugCheck[];
  readonly summary: Readonly<Record<Status, readonly string[]>>;
  /** Artifact → what it shows; only files that were written. */
  readonly files: Readonly<Record<string, string>>;
};

export function summarize(checks: readonly DebugCheck[]): Record<Status, string[]> {
  const out: Record<Status, string[]> = { fail: [], warn: [], ok: [], unmeasured: [], manual: [] };
  for (const check of checks) out[check.status].push(check.id);
  return out;
}

const MARK: Record<Status, string> = { ok: "OK", warn: "WARN", fail: "FAIL", unmeasured: "not measured", manual: "check by eye" };
const cellText = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function reportMarkdown(record: DebugRecord, prompt: string): string {
  const { inputs, generation, tools, checks, summary, files } = record;
  const lines: string[] = [
    "# Single-frame debug report",
    "",
    `Run \`${record.dir}\` · ${record.createdAt} · variant **${record.request.variant}** · ${record.request.model}, size ${record.request.size}, reasoning ${record.request.reasoning}`,
    "",
    "One drawing from the images and the prompt below — no previous frame, no grid, no frame specification, no lessons. Whatever is wrong here is wrong before any multi-frame chaining.",
    "",
  ];
  if (generation.source === "skipped" || generation.source === "failed") {
    lines.push(`**No output to evaluate:** ${generation.source === "skipped" ? generation.reason : `Muse Image failed (API, ${generation.code ?? "no code"}; not a quality verdict): ${generation.error}`}`, "");
  } else {
    lines.push(
      `**Verdict:** ${summary.fail.length} fail, ${summary.warn.length} warn, ${summary.ok.length} ok, ${summary.unmeasured.length} not measured, ${summary.manual.length} by eye.`,
      ...(summary.fail.length ? [`Failing: ${summary.fail.join(", ")}.`] : []),
      "",
      "![comparison](comparison.png)",
      "",
      "| Part | Result | Finding |",
      "|---|---|---|",
      ...checks.map((check) => `| ${check.label} | ${MARK[check.status]} | ${cellText(check.summary)} |`),
      "",
    );
  }
  lines.push(
    "## Inputs",
    "",
    "| Image | Source | Size | SHA-256 |",
    "|---|---|---|---|",
    `| A · pose reference | \`${inputs.pose.source}\` | ${inputs.pose.width}×${inputs.pose.height} | \`${inputs.pose.sha256.slice(0, 16)}…\` |`,
    `| B · character reference | \`${inputs.character.source}\` | ${inputs.character.width}×${inputs.character.height} | \`${inputs.character.sha256.slice(0, 16)}…\` |`,
    ...(generation.source === "muse" ? [`| Output | Muse Image, ${(generation.durationMs / 1000).toFixed(1)} s, ${generation.requests ?? 1} request${generation.usage ? `, ${generation.usage.inputTokens ?? "?"} in / ${generation.usage.outputTokens ?? "?"} out tokens` : ""} | ${generation.width}×${generation.height} | |`] : []),
    ...(generation.source === "file" ? [`| Output | \`${generation.file}\` (given, not generated) | ${generation.width}×${generation.height} | |`] : []),
    "",
    "## Measuring tools",
    "",
    "Every pose number below is only as good as the pose estimator on that image. Body confidence is the mean RTMW score of the 17 body keypoints (SimCC scale, not 0–1: the pipeline counts a point under 0.3 as not found); a low or uneven value on an anime drawing means: read the pose checks with suspicion and look at the overlays.",
    "",
    "| Image | Pose estimator | Body confidence | Figure mask |",
    "|---|---|---|---|",
    ...Object.keys(tools.pose).map((name) => {
      const pose = tools.pose[name];
      const mask = tools.segmentation[name];
      const poseText = "error" in pose ? `failed: ${cellText(pose.error)}` : `${pose.estimator}${pose.fallback ? " (fallback)" : ""}`;
      const confidence = "error" in pose ? "—" : String(pose.bodyConfidence ?? "—");
      const maskText = !mask ? "—" : "error" in mask ? `failed: ${cellText(mask.error)}` : `${mask.method}${mask.confidence !== null ? ` (${mask.confidence})` : ""}`;
      return `| ${name} | ${poseText} | ${confidence} | ${maskText} |`;
    }),
    "",
  );
  if (checks.length) {
    lines.push("## Checks", "");
    for (const check of checks) {
      lines.push(`### ${check.label} — ${MARK[check.status]}`, "", check.summary, "", `*Method:* ${check.method}`, "");
      if (Object.keys(check.values).length) lines.push("```json", JSON.stringify(check.values, null, 2), "```", "");
    }
    lines.push(
      "## What this cannot tell",
      "",
      "- Face identity, hair shape and garment shapes have no automatic score here: judge them in `crops.png` and `comparison.png`.",
      "- Extra or missing fingers, a third arm, and limbs that overlap in Image A are not detected by these heuristics.",
      "- The pose estimator (RTMW, trained on photos plus HumanArt) can mislabel anime drawings, especially hands; a check is only as reliable as the overlays show.",
      "",
    );
  }
  lines.push("## Prompt sent to Muse Image", "", "Each image is preceded by its label and role (see `muse_request.json`); then:", "", "```text", prompt, "```", "", "Full request: `muse_request.json`; the exact image bytes sent: `sent_image_*.png`.", "", "## Files", "");
  for (const [file, what] of Object.entries(files)) lines.push(`- \`${file}\` — ${what}`);
  lines.push("");
  return lines.join("\n");
}
