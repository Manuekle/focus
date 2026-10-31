import path from "node:path";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

// Loads the animation-principles skills that Focus runs as policies. The
// SKILL.md files are kept byte for byte as published (MIT, Dylan Tarre) and
// checked against skills.lock.json on every load: a changed file is refused,
// so a policy never cites guidance that isn't there. Only their structure is
// read here (name, description, section headings); the executable rules live
// in rules.ts and each names the section it implements.

// Runtime files, not source: keep them out of Turbopack's file tracing (next.config.ts includes them in the build).
export const SKILLS_ROOT = path.join(/*turbopackIgnore: true*/ process.cwd(), "server/policies/skills/animation-principles");

export type SkillLock = {
  readonly source: string;
  readonly commit: string;
  readonly license: { readonly file: string; readonly spdx: string; readonly sha256: string };
  readonly skills: readonly { readonly name: string; readonly upstream: string; readonly file: string; readonly sha256: string }[];
};

export type Skill = {
  readonly name: string;
  readonly description: string;
  /** "## " and "### " headings, in order. */
  readonly sections: readonly string[];
  readonly sha256: string;
  readonly upstream: string;
  /** The SKILL.md exactly as published. */
  readonly content: string;
};

export type SkillSet = { readonly lock: SkillLock; readonly license: string; readonly skills: ReadonlyMap<string, Skill> };

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** YAML front matter of a SKILL.md: only the flat `key: value` lines the skills use. */
export function frontMatter(content: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content);
  if (!match) return {};
  return Object.fromEntries(match[1].split("\n").flatMap((line) => {
    const at = line.indexOf(":");
    return at > 0 ? [[line.slice(0, at).trim(), line.slice(at + 1).trim()]] : [];
  }));
}

export function sections(content: string): string[] {
  return content.split("\n").flatMap((line) => (/^#{2,3} /.test(line) ? [line.replace(/^#{2,3} /, "").trim()] : []));
}

let cached: { root: string; set: SkillSet } | null = null;

export function loadSkills(root = SKILLS_ROOT): SkillSet {
  if (cached?.root === root) return cached.set;
  const lockFile = path.join(root, "skills.lock.json");
  if (!existsSync(lockFile)) throw new Error(`animation policies: ${lockFile} is missing`);
  const lock = JSON.parse(readFileSync(lockFile, "utf8")) as SkillLock;
  const licenseData = readFileSync(path.join(root, lock.license.file));
  if (sha256(licenseData) !== lock.license.sha256) throw new Error("animation policies: the skills' LICENSE differs from the published one");
  const skills = new Map<string, Skill>();
  for (const entry of lock.skills) {
    const data = readFileSync(path.join(root, entry.file));
    if (sha256(data) !== entry.sha256) throw new Error(`animation policies: ${entry.file} differs from the published SKILL.md (${lock.commit.slice(0, 7)})`);
    const content = data.toString("utf8");
    const meta = frontMatter(content);
    if (meta.name !== entry.name) throw new Error(`animation policies: ${entry.file} is named ${meta.name ?? "nothing"}, expected ${entry.name}`);
    skills.set(entry.name, { name: entry.name, description: meta.description ?? "", sections: sections(content), sha256: entry.sha256, upstream: entry.upstream, content });
  }
  const set = { lock, license: licenseData.toString("utf8"), skills };
  cached = { root, set };
  return set;
}
