import { type AdminDeployments, type AdminRelease, type AdminTenant, lastDeployFailed } from "@/lib/admin-types";

// What the Despliegues page and a customer's page say about releases,
// decided apart from how they look: the one state that matters now, what a
// GitHub run was, what a commit changes, and where each install stands.

export type DeployStage = "checking" | "testing" | "rolling_out";

/** The first thing the operator should read, in priority order. */
export type DeployState =
  | { readonly kind: "running"; readonly stage: DeployStage; readonly sha: string | null; readonly runUrl: string | null; readonly rollback: boolean }
  | { readonly kind: "no_test" }
  | { readonly kind: "up_to_date" }
  /** Main is the production commit, but some installs never landed it: a release of it again builds only those. */
  | { readonly kind: "partial"; readonly behind: number }
  | { readonly kind: "ci_failed" }
  | { readonly kind: "ci_running" }
  | { readonly kind: "ready" };

export function deployState(deployment: AdminDeployments, releases: readonly AdminRelease[], behind = 0): DeployState {
  if (deployment.busy) {
    const active = releases.find(release => release.status === "testing" || release.status === "rolling_out");
    const run = deployment.runs.find(item => item.status !== "completed");
    const requested = run ? parseRunTitle(run.title) : null;
    return {
      kind: "running",
      // Before the fleet opens a release row, the workflow is still checking
      // the commit and testing its own engine.
      stage: active ? (active.status === "testing" ? "testing" : "rolling_out") : "checking",
      sha: active?.sha ?? requested?.sha ?? null,
      runUrl: run?.url ?? null,
      rollback: Boolean(active?.rollbackOf) || requested?.operation === "rollback",
    };
  }
  if (!deployment.test) return { kind: "no_test" };
  if (deployment.productionCommit === deployment.main.sha) return behind ? { kind: "partial", behind } : { kind: "up_to_date" };
  if (deployment.ci.status === "completed" && deployment.ci.conclusion !== "success") return { kind: "ci_failed" };
  if (deployment.ci.status !== "completed") return { kind: "ci_running" };
  return { kind: "ready" };
}

export type RunRequest = { readonly operation: "deploy" | "rollback" | "plan"; readonly sha: string; readonly actor: string | null };

/** The release workflow's run name (oruka-fleet release.yml `run-name`): "deploy <sha> · <actor>", "Plan …", "rollback …". */
export function parseRunTitle(title: string): RunRequest | null {
  const match = /^(deploy|rollback|plan)\s+([0-9a-f]{7,40})(?:\s+·\s+(.+))?$/i.exec(title.trim());
  if (!match) return null;
  return { operation: match[1]!.toLowerCase() as RunRequest["operation"], sha: match[2]!, actor: match[3]?.trim() || null };
}

export type CommitKind = "feature" | "fix" | "improvement" | "maintenance" | "docs" | "merge" | "other";

const TYPE_KIND: Record<string, CommitKind> = {
  feat: "feature", fix: "fix", perf: "improvement", docs: "docs",
  refactor: "maintenance", chore: "maintenance", build: "maintenance", ci: "maintenance",
  style: "maintenance", test: "maintenance", revert: "maintenance",
};

/** A commit subject as a reader wants it: what kind of change, and the sentence without the "feat(x):" prefix. */
export function commitSummary(message: string): { readonly kind: CommitKind; readonly text: string } {
  const merge = /^Merge pull request #(\d+) from \S+/.exec(message);
  if (merge) return { kind: "merge", text: `PR #${merge[1]}` };
  const conventional = /^([a-z]+)(?:\([^)]*\))?!?:\s*(.+)$/i.exec(message);
  if (conventional) return { kind: TYPE_KIND[conventional[1]!.toLowerCase()] ?? "other", text: conventional[2]! };
  return { kind: "other", text: message };
}

export type InstallState = "updating" | "failed" | "not_deployed" | "current" | "behind";

/** Where one install stands against the production commit. */
export function installState(
  tenant: Pick<AdminTenant, "deployingCommit" | "deployedCommit" | "deployFailedAt" | "deployedAt">,
  production: string | null,
): InstallState {
  if (tenant.deployingCommit) return "updating";
  if (lastDeployFailed(tenant)) return "failed";
  if (!tenant.deployedCommit) return "not_deployed";
  return production && tenant.deployedCommit !== production ? "behind" : "current";
}

/** Installs a release reaches (oruka-fleet adminDeployments `customers`) that are not on `production`. */
export function installsBehind(
  tenants: readonly Pick<AdminTenant, "vercelProjectId" | "status" | "deployingCommit" | "deployedCommit" | "deployFailedAt" | "deployedAt">[],
  production: string | null,
): number {
  return tenants.filter(tenant =>
    tenant.vercelProjectId && ["awaiting_owner", "active", "suspended"].includes(tenant.status)
    && ["behind", "failed"].includes(installState(tenant, production)),
  ).length;
}

/** Installs a release reaches: built at least once and not deleted; the test install first. */
export function releaseInstalls<T extends Pick<AdminTenant, "vercelProjectId" | "status" | "isTest" | "slug">>(tenants: readonly T[]): T[] {
  return tenants
    .filter(tenant => tenant.vercelProjectId && tenant.status !== "deleted")
    .sort((a, b) => Number(b.isTest) - Number(a.isTest) || a.slug.localeCompare(b.slug));
}
