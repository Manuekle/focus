import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Production image acceptance: emulate Railway's root-owned mount and dynamic
// port, exercise real FFmpeg/uploads, then restart and check persisted media.
// Every provider key is empty and AI is disabled: this test cannot spend credits.
const image = process.argv[2] ?? "focus:railway";
const name = `focus-deployment-${randomUUID().slice(0, 8)}`;
const volume = `${name}-data`;
const work = await mkdtemp(path.join(tmpdir(), "focus-deployment-"));
const reportFile = path.resolve(process.env.FOCUS_DEPLOYMENT_REPORT ?? ".focus-data/deployment/report.json");
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", maxBuffer: 1024 * 1024 }).trim();
const report = { status: "running", image, providerCalls: 0, resources: { cpus: 1, memoryBytes: 1073741824 }, checks: [] };
let ownsVolume = false;
let ownsContainer = false;

async function healthy(base) {
  for (let attempt = 0; attempt < 90; attempt++) {
    const response = await fetch(`${base}/api/health`).catch(() => null);
    if (response?.ok) return response.json();
    await delay(500);
  }
  throw new Error("Container did not become healthy within 45 seconds.");
}

function baseAddress() {
  const port = docker("port", name, "8080/tcp").match(/127\.0\.0\.1:(\d+)/)?.[1];
  assert(port, "Docker did not allocate a localhost port.");
  return `http://127.0.0.1:${port}`;
}

try {
  const envFile = path.join(work, "runtime.env");
  await writeFile(envFile, [
    "PORT=8080", "FOCUS_AI_DISABLED=1", "MODEL_API_KEY=", "META_API_KEY=",
    "FOCUS_AUTH_SIMULATED=0", "FOCUS_DATA_DIR=/data", "RAILWAY_VOLUME_MOUNT_PATH=/data",
    "FOCUS_MAX_VIDEO_DURATION_SECONDS=15", "FOCUS_MAX_UPLOAD_MB=25", "FOCUS_MAX_ACTIVE_JOBS=1",
    `FOCUS_SESSION_SECRET=${randomBytes(48).toString("base64url")}`, "",
  ].join("\n"), { mode: 0o600 });

  assert.equal(docker("image", "inspect", image, "--format", "{{.Config.User}}"), "node");
  assert.equal(docker("run", "--rm", "--env-file", envFile, image, "node", "-e", "console.log(process.getuid())"), "1000");
  report.checks.push("Ordinary Docker commands run as node (UID 1000).");

  docker("volume", "create", volume);
  ownsVolume = true;
  docker("run", "--rm", "--user", "0", "--volume", `${volume}:/data`, "--entrypoint", "sh", image, "-c", "chown 0:0 /data && chmod 755 /data");
  docker("run", "--detach", "--name", name, "--user", "0", "--cpus", "1", "--memory", "1g", "--publish", "127.0.0.1::8080", "--env-file", envFile, "--volume", `${volume}:/data`, image);
  ownsContainer = true;
  const base = baseAddress();
  const health = await healthy(base);
  assert.equal(health.checks.storageWritable, true);
  assert.equal(health.checks.metaConfigured, false);
  assert.equal(health.checks.aiEnabled, false);
  const processStatus = docker("exec", name, "cat", "/proc/1/status");
  assert.equal(processStatus.match(/^Uid:\s+(\d+)/m)?.[1], "1000");
  report.checks.push("Root-owned Railway volume becomes writable; server PID 1 drops to UID 1000.");

  const healthCommand = JSON.parse(docker("inspect", name, "--format", "{{json .Config.Healthcheck.Test}}"));
  assert.equal(healthCommand[0], "CMD-SHELL");
  docker("exec", "--user", "node", name, "sh", "-c", healthCommand[1]);
  report.checks.push("Docker healthcheck follows runtime PORT=8080.");
  assert.equal((await fetch(`${base}/flipbook`)).status, 200);
  assert.equal((await fetch(`${base}/api/auth/session`)).status, 200);
  const signIn = await fetch(`${base}/api/auth/facebook`, { redirect: "manual" });
  assert.equal(signIn.status, 503);
  assert.equal((await signIn.json()).error.code, "auth_not_configured");
  const simulated = await fetch(`${base}/api/auth/facebook/callback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: "probe", name: "Probe" }) });
  assert.equal(simulated.status, 503);
  report.checks.push("Flipbook and sessions load; simulated production sign-in is unavailable.");

  docker("exec", "--user", "node", name, "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=128x128", "-frames:v", "1", "/data/probe.png");
  docker("cp", `${name}:/data/probe.png`, path.join(work, "probe.png"));
  const uploaded = await fetch(`${base}/api/flipbooks/images`, { method: "POST", headers: { "Content-Type": "image/png", "X-Focus-Filename": "probe.png" }, body: await readFile(path.join(work, "probe.png")) });
  assert.equal(uploaded.status, 201);
  const character = await uploaded.json();
  const disabled = await fetch(`${base}/api/flipbooks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageId: character.id, prompt: "walk in place" }) });
  assert.equal(disabled.status, 503);
  assert.equal((await disabled.json()).error.code, "ai_disabled");
  report.checks.push("Character upload works and AI creation obeys the emergency switch.");

  docker("exec", "--user", "node", name, "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "/data/probe.mp4");
  docker("cp", `${name}:/data/probe.mp4`, path.join(work, "probe.mp4"));
  const videoResponse = await fetch(`${base}/api/videos`, { method: "POST", headers: { "Content-Type": "video/mp4", "X-Focus-Filename": "probe.mp4" }, body: await readFile(path.join(work, "probe.mp4")) });
  assert.equal(videoResponse.status, 201);
  const video = await videoResponse.json();
  assert.equal(video.normalized.frameCount, 24);
  assert.equal(video.normalized.fps, 24);
  report.checks.push("Container FFmpeg produces video; the upload API validates and normalizes all 24 frames.");

  report.peakMemoryBytes = Number(docker("exec", name, "node", "-e", "try { console.log(require('node:fs').readFileSync('/sys/fs/cgroup/memory.peak', 'utf8').trim()) } catch { console.log('0') }")) || null;

  docker("restart", name);
  // Docker can allocate a different host port after restart when published
  // with port 0. Resolve it again; the application's PORT remains 8080.
  const restartedBase = baseAddress();
  await healthy(restartedBase);
  assert.equal((await fetch(`${restartedBase}/api/flipbooks/images/${character.id}`)).status, 200);
  assert.equal((await fetch(`${restartedBase}/api/videos/${video.id}`)).status, 200);
  report.checks.push("Character and video remain available after a container restart.");
  docker("exec", "--user", "node", name, "sh", "-c", "test ! -f /app/.env && test ! -f /app/.env.local");
  report.checks.push("Local .env files are absent from the runtime image.");
  report.status = "passed";
  report.health = health;
  report.architecture = docker("image", "inspect", image, "--format", "{{.Architecture}}");
  console.info(`Deployment acceptance passed (${report.checks.length} checks).`);
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.message : String(error);
  if (ownsContainer) console.error(docker("logs", "--tail", "40", name));
  throw error;
} finally {
  try {
    if (ownsContainer) docker("rm", "--force", name);
    if (ownsVolume) docker("volume", "rm", volume);
  } finally {
    await rm(work, { recursive: true, force: true });
    await mkdir(path.dirname(reportFile), { recursive: true });
    await writeFile(reportFile, JSON.stringify(report, null, 2));
    console.info(`Report: ${reportFile}`);
  }
}
