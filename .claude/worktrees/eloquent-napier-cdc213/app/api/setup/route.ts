import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { connect } from "node:net";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { Client } from "pg";
import { resolveEmbeddingModel } from "@/lib/ai-provider";
import { getStoredCredentials } from "@/lib/credentials";
import { applyDatabaseEnv } from "@/lib/runtime-env";
import { withApiErrors } from "@/lib/api-error";
import { isHosted } from "@/lib/hosted";
import { describePostgresTarget } from "@/lib/postgres-target";
import { modelSetupCheck } from "@/lib/setup-model-check";

// GET /api/setup — "does this machine have what the project needs?"
//
// Written for someone who has never opened a terminal: every check answers in
// plain language and, when it fails, names the one command that fixes it. The
// commands are executed with execFile (argument arrays, no shell), so nothing
// from the credential store is ever interpolated into a command line.

export const maxDuration = 60;

const run = promisify(execFile);

/** "skipped" is not a degraded state: it means the check does not apply to
 *  this install at all, the way Docker does not apply when the database is
 *  hosted. It must never count toward `failing` or block readiness. */
export type CheckStatus = "ok" | "warn" | "fail" | "unknown" | "skipped";

export type SetupCheck = {
  id: string;
  status: CheckStatus;
  detail: string;
  /** Shell command that resolves the failure, when there is one. */
  fix?: string;
  /** Where to read more, for the checks a command can't fix. */
  link?: string;
};

/** Container names pinned in docker-compose.yml, current and pre-rename.
 *  The install was renamed steve → senka → oruka (container steve-postgres →
 *  senka-postgres → oruka-postgres); a machine whose container predates a
 *  rename is still healthy, so every name counts as up. */
const POSTGRES_CONTAINERS = ["oruka-postgres", "senka-postgres", "steve-postgres"];

async function tryRun(file: string, args: string[], timeout = 8000) {
  try {
    const { stdout } = await run(file, args, { timeout, windowsHide: true });
    return { ok: true as const, out: stdout.trim() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false as const, out: message };
  }
}

/** Host and port a Postgres URL points at, without pulling in a pg client. */
function tcpReachable(host: string, port: number, timeout = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

export const GET = withApiErrors(async function GET() {
  // A hosted tenant has no machine to set up: Oruka runs the server, the
  // database and the model. Every check below would describe Vercel's
  // runtime instead (no Docker, no .env, no gateway key because the project
  // routes through OIDC) and tell the customer to run commands they can't.
  if (isHosted()) {
    return NextResponse.json({
      hosted: true,
      checks: [],
      summary: { ready: true, failing: 0, warning: 0, total: 0 },
    });
  }

  // The page can be opened before anything is wired up, so the stored values
  // have to stand in for a .env that may not exist yet.
  applyDatabaseEnv();

  const stored = await getStoredCredentials();
  const checks: SetupCheck[] = [];

  // ── Node ──────────────────────────────────────────────────────────────────
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({
    id: "node",
    status: major >= 24 ? "ok" : "fail",
    detail: `Node.js ${process.version}`,
    fix: major >= 24 ? undefined : "nvm install 24 && nvm use 24",
    link: "https://nodejs.org/en/download",
  });

  // ── Docker ────────────────────────────────────────────────────────────────
  // Only when this install's database is the local container. Pointed at
  // Supabase or any other hosted Postgres, Docker has no part in running the
  // app, and two red rows about a daemon nobody needs is noise that hides the
  // one check that matters.
  const target = describePostgresTarget(process.env.WORKFLOW_POSTGRES_URL);
  const usesLocalDatabase = target === null || target.isLocal;

  const dockerVersion = usesLocalDatabase
    ? await tryRun("docker", ["--version"])
    : { ok: false, out: "" };
  let dockerRunning = false;
  if (!usesLocalDatabase) {
    checks.push({
      id: "docker",
      status: "skipped",
      detail: target?.kind === "supabase" ? "postgres.hostedSupabase" : "postgres.hosted",
    });
  } else if (!dockerVersion.ok) {
    checks.push({
      id: "docker",
      status: "fail",
      detail: "docker.notInstalled",
      link: "https://www.docker.com/products/docker-desktop/",
    });
  } else {
    const info = await tryRun("docker", ["info", "--format", "{{.ServerVersion}}"], 12000);
    dockerRunning = info.ok;
    checks.push({
      id: "docker",
      status: info.ok ? "ok" : "fail",
      detail: info.ok ? `${dockerVersion.out} · daemon ${info.out}` : dockerVersion.out,
      fix: info.ok ? undefined : "open -a Docker",
      link: "https://www.docker.com/products/docker-desktop/",
    });
  }

  // ── Postgres container ────────────────────────────────────────────────────
  let containerUp = false;
  if (!usesLocalDatabase) {
    checks.push({ id: "postgres-container", status: "skipped", detail: "postgres.hostedContainer" });
  } else if (!dockerRunning) {
    checks.push({ id: "postgres-container", status: "unknown", detail: "docker.required" });
  } else {
    let foundName = "";
    let foundState = "";
    let foundStatus = "";
    for (const name of POSTGRES_CONTAINERS) {
      const ps = await tryRun("docker", [
        "ps",
        "--all",
        "--filter",
        `name=${name}`,
        "--format",
        "{{.Names}}|{{.State}}|{{.Status}}",
      ]);
      const [containerName = "", state = "", status = ""] = (ps.out.split("\n")[0] ?? "").split("|");
      if (containerName !== "") {
        foundName = containerName;
        foundState = state;
        foundStatus = status;
        if (state === "running") break;
      }
    }
    containerUp = foundState === "running";
    checks.push({
      id: "postgres-container",
      status: containerUp ? "ok" : "fail",
      detail: foundName ? `${foundName}: ${foundStatus || foundState}` : "postgres.noContainer",
      fix: containerUp ? undefined : "pnpm db:up",
    });
  }

  // ── Postgres reachable ────────────────────────────────────────────────────
  if (!target) {
    checks.push({
      id: "postgres-url",
      status: "fail",
      detail: "postgres.noUrl",
    });
  } else {
    const reachable = await tcpReachable(target.host, target.port);
    checks.push({
      id: "postgres-url",
      status: reachable ? "ok" : "fail",
      detail: `${target.host}:${target.port}`,
      // "Start the container" is only a fix when a container is what serves
      // this. A hosted database that won't answer needs its own dashboard.
      fix: reachable || !target.isLocal ? undefined : "pnpm db:up",
    });
  }

  // ── Migrations ────────────────────────────────────────────────────────────
  // A real network connection through WORKFLOW_POSTGRES_URL — the same
  // connection string the runtime agent uses — not `docker exec` into the
  // container. `docker exec` authenticates as the container's own trusted
  // local user, so it stayed green even when the URL itself had the wrong
  // password, the wrong user, or pointed at the wrong database: exactly the
  // gap between "Docker's running" and "the app can actually reach its data"
  // that made this check worth little as a readiness signal.
  const postgresUrl = process.env.WORKFLOW_POSTGRES_URL;
  if (!postgresUrl) {
    checks.push({ id: "migrations", status: "unknown", detail: "postgres.required" });
  } else {
    const client = new Client({ connectionString: postgresUrl, connectionTimeoutMillis: 5000 });
    let migrated = false;
    let count = 0;
    let queryFailed = false;
    try {
      await client.connect();
      const result = await client.query(
        "select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema')",
      );
      count = Number(result.rows[0]?.count ?? 0);
      migrated = count > 0;
    } catch {
      queryFailed = true;
    } finally {
      await client.end().catch(() => {});
    }
    checks.push({
      id: "migrations",
      status: migrated ? "ok" : "fail",
      detail: migrated ? `${count}` : queryFailed ? "postgres.queryFailed" : "0",
      fix: migrated ? undefined : "pnpm db:migrate",
    });
  }

  // ── Model credentials ─────────────────────────────────────────────────────
  checks.push(await modelSetupCheck(stored));

  // ── Embeddings (knowledge base) ───────────────────────────────────────────
  const embedding = resolveEmbeddingModel();
  checks.push({
    id: "embeddings",
    status: embedding ? "ok" : "warn",
    detail: embedding ? `${embedding.modelId} · ${embedding.route}` : "embeddings.missing",
    link: "/settings",
  });

  // ── .env ──────────────────────────────────────────────────────────────────
  const envPath = join(process.cwd(), ".env");
  checks.push({
    id: "env-file",
    status: existsSync(envPath) ? "ok" : "warn",
    detail: existsSync(envPath) ? ".env" : "env.missing",
    fix: existsSync(envPath) ? undefined : "cp .env.example .env",
  });

  const failing = checks.filter((c) => c.status === "fail").length;
  const warning = checks.filter((c) => c.status === "warn").length;

  return NextResponse.json({
    checks,
    summary: {
      ready: failing === 0,
      failing,
      warning,
      total: checks.filter((c) => c.status !== "skipped").length,
    },
  });
});
