import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { z } from "zod";
import { FlipbookProposalSchema, type FlipbookProposal } from "../../shared/flipbook-chat";
import type { Flipbook } from "../../shared/flipbook";
import { AppError } from "../errors";
import { flipbookDir, writeAtomic } from "./store";

export function proposalFingerprint(book: Flipbook): string {
  return createHash("sha256").update(JSON.stringify([book.plan, book.order, book.frames.map((frame) => [frame.id, frame.version, frame.approved])])).digest("hex");
}
export async function storeProposal(book: Flipbook, proposal: FlipbookProposal): Promise<FlipbookProposal> {
  const proposalId = randomUUID();
  const dir = path.join(flipbookDir(book.id), "proposals");
  const result = { ...proposal, proposalId };
  await writeAtomic(path.join(dir, `${proposalId}.json`), JSON.stringify({ fingerprint: proposalFingerprint(book), expires: Date.now() + 86400_000, proposal: result }));
  const previous = await Promise.all((await readdir(dir)).filter((name) => name.endsWith(".json")).map(async (name) => ({ name, time: (await stat(path.join(dir, name))).mtimeMs })));
  for (const entry of previous.sort((a, b) => b.time - a.time).slice(24)) await rm(path.join(dir, entry.name), { force: true });
  return result;
}
export async function readProposal(book: Flipbook, id: string) {
  if (!z.uuid().safeParse(id).success) throw new AppError("proposal_not_found", 404, "This proposal is no longer available.");
  const raw = await readFile(path.join(flipbookDir(book.id), "proposals", `${id}.json`), "utf8").catch(() => "null");
  const stored = z.object({ fingerprint: z.string(), expires: z.number(), proposal: FlipbookProposalSchema }).safeParse(JSON.parse(raw));
  if (!stored.success || stored.data.expires < Date.now()) throw new AppError("proposal_not_found", 404, "This proposal has expired. Ask for the change again.");
  if (stored.data.fingerprint !== proposalFingerprint(book)) throw new AppError("proposal_stale", 409, "The animation changed since this proposal. Ask again to update its drawing count and instructions.");
  return stored.data.proposal.changes.map(({ frame, description }) => ({ frame, description }));
}
