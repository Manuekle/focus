import type { Check, Severity } from "./run-state";

// The frame's verdict from its checks. Pass/fail alone made every failed check a reason to draw
// again, and every unmeasurable one a pass: a slightly low colour score cost an attempt exactly
// like a mirrored pose, and a pose nobody could measure counted as matched.
//
//   REJECTED      a critical or major finding that was measured: the next attempt fixes it.
//   INCONCLUSIVE  nothing rejects it, but something that matters couldn't be measured: a person decides.
//   REVIEW_NEEDED nothing rejects it, but a minor finding stands: a person decides, no attempt spent.
//   ACCEPTED      every check passed (informational warnings allowed).
//
// Only REJECTED draws again; INCONCLUSIVE and REVIEW_NEEDED stop for a person (run-state.ts).

export type Decision = "ACCEPTED" | "REVIEW_NEEDED" | "REJECTED" | "INCONCLUSIVE";

export type Verdict = {
  readonly decision: Decision;
  /** The findings behind it, most severe first: "pose (critical): …". */
  readonly reasons: readonly string[];
};

/**
 * Each check's usual severity when it fails. Pose, framing and the reviewer's limbs, identity and
 * anatomy are what make a frame wrong; scale, proportions, cut-outs and the animation policies are
 * measurable defects worth one more attempt; line density is a style drift a person may accept.
 */
const SEVERITY: Readonly<Record<string, Severity>> = {
  pose: "critical",
  review: "critical",
  alpha: "major",
  scale: "major",
  proportions: "major",
  colour: "major",
  policies: "major",
  style: "minor",
  mapping: "info",
  rig: "info",
};

export const severityOf = (check: Check): Severity => check.severity ?? SEVERITY[check.name] ?? "major";

const RANK: Readonly<Record<Severity, number>> = { critical: 0, major: 1, minor: 2, info: 3 };

export function decide(checks: readonly Check[]): Verdict {
  const status = (check: Check) => check.status ?? (check.passed ? "pass" : "fail");
  const describe = (check: Check) => `${check.name} (${status(check) === "inconclusive" ? "not measurable" : severityOf(check)}): ${check.detail}`;
  const byRank = (a: Check, b: Check) => RANK[severityOf(a)] - RANK[severityOf(b)];
  const failed = checks.filter((check) => status(check) === "fail").sort(byRank);
  const rejecting = failed.filter((check) => RANK[severityOf(check)] <= RANK.major);
  if (rejecting.length) return { decision: "REJECTED", reasons: rejecting.map(describe) };
  // An unmeasurable check only matters if it could have rejected the frame.
  const unmeasured = checks.filter((check) => status(check) === "inconclusive" && RANK[severityOf(check)] <= RANK.major);
  if (unmeasured.length) return { decision: "INCONCLUSIVE", reasons: [...unmeasured, ...failed].map(describe) };
  const minor = [...failed, ...checks.filter((check) => status(check) === "warn" && severityOf(check) === "minor")].sort(byRank);
  if (minor.length) return { decision: "REVIEW_NEEDED", reasons: minor.map(describe) };
  return { decision: "ACCEPTED", reasons: [] };
}
