import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { ProjectSchema, type Project, type ProjectSummary } from "../shared/account";
import { AppError } from "./errors";
import { dataRoot } from "./storage";

// Saved projects: one per clip per account, holding every edit made on it.
// A project keeps its clip, masks, jobs and renders out of the 24-hour
// cleanup until it is deleted.

function projectsDir(): string {
  return path.join(dataRoot(), "projects");
}

function projectFile(id: string): string {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new AppError("project_not_found", 404, "This project doesn’t exist.");
  return path.join(projectsDir(), `${id}.json`);
}

async function save(project: Project): Promise<Project> {
  const next = ProjectSchema.parse({ ...project, updatedAt: new Date().toISOString() });
  const file = projectFile(next.id);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(next));
  await rename(temp, file);
  return next;
}

async function readProject(id: string): Promise<Project | null> {
  const raw = await readFile(projectFile(id), "utf8").catch(() => null);
  if (!raw) return null;
  const parsed = ProjectSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

async function allProjects(): Promise<Project[]> {
  const names = await readdir(projectsDir()).catch(() => [] as string[]);
  const projects = await Promise.all(names.filter((name) => name.endsWith(".json")).map((name) => readProject(name.slice(0, -5)).catch(() => null)));
  return projects.filter((project): project is Project => project !== null);
}

// Per-project read-modify-write, like jobs.
const locks = ((globalThis as { __focusProjectLocks?: Map<string, Promise<unknown>> }).__focusProjectLocks ??= new Map());
function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.then(task, task);
  locks.set(key, next.catch(() => undefined));
  return next;
}

/** A project the user owns; anything else is "not found", never "forbidden". */
export async function getProject(id: string, ownerId: string): Promise<Project> {
  const project = await readProject(id);
  if (!project || project.ownerId !== ownerId) throw new AppError("project_not_found", 404, "This project doesn’t exist.");
  return project;
}

export async function listProjects(ownerId: string): Promise<Project[]> {
  return (await allProjects()).filter((project) => project.ownerId === ownerId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function summarize(project: Project): ProjectSummary {
  return {
    id: project.id,
    title: project.title,
    videoId: project.videoId,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    posterUrl: `/api/videos/${project.videoId}/media?variant=poster`,
    edits: project.jobIds.length,
  };
}

/** The user's project for a clip, created on first use. Known jobs are attached (oldest first). */
export function projectForVideo(ownerId: string, videoId: string, input: { title: string; jobIds?: readonly string[] }): Promise<Project> {
  return withLock(`video:${ownerId}:${videoId}`, async () => {
    const existing = (await listProjects(ownerId)).find((project) => project.videoId === videoId);
    const now = new Date().toISOString();
    const base: Project = existing ?? { id: randomUUID(), ownerId, title: input.title.slice(0, 80) || "Untitled clip", videoId, jobIds: [], activeJobId: null, createdAt: now, updatedAt: now };
    const jobIds = [...new Set([...base.jobIds, ...(input.jobIds ?? [])])].slice(-200);
    return withLock(base.id, () => save({ ...base, jobIds, activeJobId: base.activeJobId ?? jobIds.at(-1) ?? null }));
  });
}

/** Records an edit in the user's project for its clip and makes it the active one. */
export async function attachJob(ownerId: string, videoId: string, jobId: string, title: string): Promise<Project> {
  const project = await projectForVideo(ownerId, videoId, { title });
  return withLock(project.id, async () => {
    const current = await getProject(project.id, ownerId);
    return save({ ...current, jobIds: [...new Set([...current.jobIds, jobId])].slice(-200), activeJobId: jobId });
  });
}

export function updateProject(id: string, ownerId: string, patch: { title?: string; activeJobId?: string }): Promise<Project> {
  return withLock(id, async () => {
    const current = await getProject(id, ownerId);
    if (patch.activeJobId && !current.jobIds.includes(patch.activeJobId)) throw new AppError("job_not_found", 404, "That edit doesn’t belong to this project.");
    return save({ ...current, ...(patch.title ? { title: patch.title } : {}), ...(patch.activeJobId ? { activeJobId: patch.activeJobId } : {}) });
  });
}

export async function deleteProject(id: string, ownerId: string): Promise<void> {
  await getProject(id, ownerId);
  await rm(projectFile(id), { force: true });
}

/** Clips and jobs that belong to a saved project; the 24-hour cleanup leaves them alone. */
export async function retainedIds(): Promise<{ videos: Set<string>; jobs: Set<string> }> {
  const projects = await allProjects();
  return { videos: new Set(projects.map((project) => project.videoId)), jobs: new Set(projects.flatMap((project) => project.jobIds)) };
}
