import path from "node:path";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { POSE_GALLERY_URL, PoseIdSchema, type PoseId } from "../../shared/pose-library";
import { AppError } from "../errors";
import { dataRoot } from "../storage";
import { writeAtomic } from "./store";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;

async function validatedPng(bytes: Buffer): Promise<Buffer> {
  const image = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error" });
  const metadata = await image.metadata();
  if (metadata.format !== "png" || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) throw new Error("invalid pose image");
  return image.resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).toColourspace("srgb").png().toBuffer();
}

/** Private reference use only: there is deliberately no route serving this cache. */
export async function loadPoseReference(id: PoseId, signal?: AbortSignal): Promise<Buffer> {
  const parsed = PoseIdSchema.safeParse(id);
  if (!parsed.success) throw new AppError("invalid_pose", 400, "The animation’s pose reference isn’t valid. Try creating the animation again.");
  if (signal?.aborted) throw new AppError("canceled", 499, "Canceled.");
  const file = path.join(dataRoot(), "pose-references", `${parsed.data}.png`);
  const cached = await readFile(file).catch(() => null);
  if (cached && cached.length <= MAX_BYTES) {
    try { return await validatedPng(cached); } catch { /* Refetch an invalid cache entry. */ }
  }

  try {
    const timeout = AbortSignal.timeout(15_000);
    const response = await fetch(new URL(`img/${parsed.data}.png`, POSE_GALLERY_URL), {
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok || !response.body || response.headers.get("content-type")?.split(";")[0].trim() !== "image/png" || Number(response.headers.get("content-length")) > MAX_BYTES) {
      await response.body?.cancel();
      throw new Error("pose download rejected");
    }
    const chunks: Uint8Array[] = [];
    const reader = response.body.getReader();
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) {
          await reader.cancel();
          throw new Error("pose download too large");
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const png = await validatedPng(Buffer.concat(chunks));
    if (signal?.aborted) throw new AppError("canceled", 499, "Canceled.");
    await writeAtomic(file, png);
    return png;
  } catch {
    if (signal?.aborted) throw new AppError("canceled", 499, "Canceled.");
    throw new AppError("pose_unavailable", 502, "The pose reference couldn’t be loaded. Try again.");
  }
}
