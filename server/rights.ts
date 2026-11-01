import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { RIGHTS_COPY, RIGHTS_ERROR_CODE, RIGHTS_HEADER, RIGHTS_VERSION, RightsRecordSchema, type RightsRecord, type RightsSubjectKind } from "../shared/rights";
import { AppError } from "./errors";
import { dataRoot } from "./storage";

// Server side of the content rights acknowledgement. The browser box is a
// convenience; this is the check, so a direct API call cannot skip it. It
// records that a statement was made, never that it is true.

/**
 * Throws a structured 422 unless the request carries the current
 * acknowledgement. Call it before reading a body or spending anything.
 */
export function requireRights(request: Request): void {
  const sent = request.headers.get(RIGHTS_HEADER)?.trim();
  if (!sent) {
    throw new AppError(RIGHTS_ERROR_CODE, 422, RIGHTS_COPY.error, `Send the ${RIGHTS_HEADER} header with version ${RIGHTS_VERSION} once the person has confirmed.`);
  }
  if (sent !== RIGHTS_VERSION) {
    throw new AppError(RIGHTS_ERROR_CODE, 422, RIGHTS_COPY.error, `Acknowledgement version ${sent.slice(0, 40)} is not current (${RIGHTS_VERSION}).`);
  }
}

const SAFE_ID = /^[\w-]{1,120}$/;

function rightsDir(): string {
  return path.join(dataRoot(), "rights");
}

function recordPath(kind: RightsSubjectKind, subjectId: string): string {
  if (!SAFE_ID.test(subjectId)) throw new AppError("internal_error", 500, "Something went wrong on the server. Try again in a few seconds.");
  return path.join(rightsDir(), `${kind}-${subjectId}.json`);
}

/**
 * Stores the acknowledgement for one subject. The first record wins: a repeated
 * request for the same job or run (a deduplicated edit, an idempotent retry)
 * keeps the original timestamp instead of adding a second record.
 */
export async function recordRights(kind: RightsSubjectKind, subjectId: string, assetIds: readonly string[], now: Date = new Date()): Promise<RightsRecord> {
  const record: RightsRecord = {
    status: "confirmed",
    version: RIGHTS_VERSION,
    confirmedAt: now.toISOString(),
    subjectKind: kind,
    subjectId,
    assetIds: assetIds.slice(0, 32),
  };
  const file = recordPath(kind, subjectId);
  await mkdir(rightsDir(), { recursive: true });
  try {
    await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return (await readRights(kind, subjectId)) ?? record;
  }
}

export async function readRights(kind: RightsSubjectKind, subjectId: string): Promise<RightsRecord | null> {
  const text = await readFile(recordPath(kind, subjectId), "utf8").catch(() => null);
  if (text === null) return null;
  const parsed = RightsRecordSchema.safeParse(JSON.parse(text));
  return parsed.success ? parsed.data : null;
}
