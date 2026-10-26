"use client";

import type { EveDynamicToolPart } from "eve/react";
import type { ChartSpec, ReportSpec } from "@/lib/artifacts";
import type { ConnectTarget } from "@/lib/connect-targets";
import { ChartArtifact } from "./chart-artifact";
import { ConnectArtifact } from "./connect-artifact";
import { ReportArtifact } from "./report-artifact";

/**
 * The three tool calls the chat draws instead of printing.
 *
 * Every other tool renders as the collapsed terminal disclosure in
 * `agent-message.tsx`: a name, a status, and its JSON. That is the right shape
 * for `upsert_contact` — evidence that something happened, folded away once it
 * has. It is the wrong shape for a chart, where the payload *is* the answer,
 * and a chart shown as `{"series":[{"points":[{"label":"Ene"...` is a chart
 * nobody drew.
 *
 * ## Why the spec comes from `part.input`
 *
 * `chart` and `report` are renderers: the model passes the finished spec as
 * arguments and the tool returns one line of acknowledgement. Reading the spec
 * back out of the *input* rather than echoing it through the output halves what
 * a drawn chart costs in the model's context, which is the difference between
 * a conversation that can hold six charts and one that can hold three.
 *
 * The input is safe to read because Eve validates tool arguments against
 * `inputSchema` before `execute` runs, and this only renders once the call has
 * returned `ok: true` — so a spec that reached here has been through
 * `chartSpecSchema`. The guards below are shape checks against a malformed
 * *stream*, not a second validation pass; re-running Zod in the browser would
 * ship the whole validator to render a bar chart.
 *
 * ## `request_connection` is the exception: it reads the output
 *
 * The other two are renderers and the model owns what they draw. A connection
 * card is a claim about this installation — that Shopify is not configured,
 * that this route is where you fix it — and the model's picture of that came
 * from a brief assembled before the turn started. So the tool resolves it
 * server-side at call time and the card draws what came *back*. The model
 * chooses the subject; it does not get to author the status or the link.
 */

const ARTIFACT_TOOLS = new Set(["chart", "report", "request_connection"]);

/** Whether this part will render as an artifact, so the caller can skip its terminal block. */
export function isArtifactPart(part: EveDynamicToolPart): boolean {
  if (!ARTIFACT_TOOLS.has(part.toolName) || part.state !== "output-available") return false;
  if (!succeeded(part.output)) return false;
  if (part.toolName === "request_connection") return asConnectSpec(part.output) !== null;
  return (part.toolName === "chart" ? asChartSpec(part.input) : asReportSpec(part.input)) !== null;
}

export function ToolArtifact({ part }: { readonly part: EveDynamicToolPart }) {
  if (part.state !== "output-available" || !succeeded(part.output)) return null;

  if (part.toolName === "chart") {
    const spec = asChartSpec(part.input);
    return spec ? <ChartArtifact spec={spec} /> : null;
  }
  if (part.toolName === "report") {
    const spec = asReportSpec(part.input);
    return spec ? <ReportArtifact spec={spec} /> : null;
  }
  if (part.toolName === "request_connection") {
    const spec = asConnectSpec(part.output);
    return spec ? <ConnectArtifact reason={spec.reason} targets={spec.targets} /> : null;
  }
  return null;
}

/**
 * A tool that refuses off the console answers `{ ok: false, error }`, and that
 * refusal is a message for the model, not a document for the operator.
 */
function succeeded(output: unknown): boolean {
  return isRecord(output) && output.ok === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asChartSpec(input: unknown): ChartSpec | null {
  if (!isRecord(input)) return null;
  if (typeof input.kind !== "string" || typeof input.title !== "string") return null;
  if (!Array.isArray(input.series) || input.series.length === 0) return null;
  const seriesOk = input.series.every(
    (series) => isRecord(series) && typeof series.name === "string" && Array.isArray(series.points),
  );
  return seriesOk ? (input as unknown as ChartSpec) : null;
}

function asReportSpec(input: unknown): ReportSpec | null {
  if (!isRecord(input)) return null;
  if (typeof input.title !== "string" || typeof input.summary !== "string") return null;
  if (!Array.isArray(input.sections) || input.sections.length === 0) return null;
  const sectionsOk = input.sections.every(
    (section) => isRecord(section) && typeof section.heading === "string",
  );
  return sectionsOk ? (input as unknown as ReportSpec) : null;
}

/**
 * The card's rows, as the tool returned them.
 *
 * Shape-checked rather than re-validated: `outputSchema` already ran on the
 * server, and a row that survives here was built by `resolveConnectTarget`
 * from the catalog in lib/connect-targets.ts — the ids, statuses and routes
 * are a closed set that never passed through the model.
 */
function asConnectSpec(
  output: unknown,
): { readonly reason?: string; readonly targets: readonly ConnectTarget[] } | null {
  if (!isRecord(output) || !Array.isArray(output.targets) || output.targets.length === 0) return null;
  const ok = output.targets.every(
    (target) =>
      isRecord(target) &&
      typeof target.id === "string" &&
      typeof target.descriptionKey === "string" &&
      typeof target.status === "string" &&
      typeof target.action === "string" &&
      typeof target.href === "string" &&
      // Relative and app-local. A row is a link the reader clicks without
      // reading it, and the one thing this must never render is an absolute
      // URL somewhere else — `//host` counts as absolute.
      target.href.startsWith("/") &&
      !target.href.startsWith("//"),
  );
  if (!ok) return null;
  return {
    reason: typeof output.reason === "string" ? output.reason : undefined,
    targets: output.targets as unknown as readonly ConnectTarget[],
  };
}
