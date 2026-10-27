import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import sharp, { type Metadata } from "sharp";
import {
  FlipbookImageSchema,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MIN_IMAGE_DIMENSION,
  WORKING_LONG_SIDE,
  hasAcceptedImageExtension,
  type FlipbookImage,
} from "../../shared/flipbook";
import { formatBytes } from "../../shared/media";
import { AppError } from "../errors";
import { imageDir, parseImageId, writeAtomic } from "./store";

// Image uploads for Flipbook: the character, a replacement drawing, a custom
// background. The bytes are decoded for real (Sharp), never trusted by name
// or MIME type; EXIF rotation is applied once; the working copy is a PNG.

export type DecodedImage = {
  /** Working PNG, rotation applied, long side ≤ WORKING_LONG_SIDE, alpha kept. */
  readonly png: Buffer;
  /** Same pixels flattened on white: what a model receives. */
  readonly flat: Buffer;
  readonly width: number;
  readonly height: number;
  /** True only when some pixel is actually transparent. */
  readonly hasAlpha: boolean;
};

const FORMATS = new Set(["png", "jpeg", "webp"]);

function tooLarge(): AppError {
  return new AppError("image_too_large", 413, `This image is larger than ${formatBytes(MAX_IMAGE_BYTES)}. Export a smaller PNG, JPEG or WebP.`);
}

/** Reads a raw upload body into memory, refusing it as soon as it passes the limit. */
export async function readUpload(body: ReadableStream<Uint8Array> | null, declaredBytes?: number): Promise<Buffer> {
  if (!body) throw new AppError("empty_file", 400, "We didn’t receive a file.");
  if (declaredBytes !== undefined && declaredBytes > MAX_IMAGE_BYTES) throw tooLarge();
  const chunks: Buffer[] = [];
  let bytes = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_IMAGE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(Buffer.from(value));
  }
  if (bytes === 0) throw new AppError("empty_file", 400, "This file is empty. Choose another image.");
  return Buffer.concat(chunks, bytes);
}

export async function decodeImage(input: Buffer, options: { readonly minDimension?: number } = {}): Promise<DecodedImage> {
  const minDimension = options.minDimension ?? MIN_IMAGE_DIMENSION;
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_IMAGE_DIMENSION * MAX_IMAGE_DIMENSION, failOn: "error" }).metadata();
  } catch {
    throw new AppError("unreadable_image", 422, "We couldn’t read this file as an image. It may be damaged or in an unsupported format.");
  }
  if (!meta.format || !FORMATS.has(meta.format)) throw new AppError("unsupported_image", 415, "Unsupported format. Upload a PNG, JPEG or WebP image.");
  if ((meta.pages ?? 1) > 1) throw new AppError("unsupported_image", 415, "Animated images aren’t supported. Upload a single still image.");
  const quarterTurn = (meta.orientation ?? 1) >= 5;
  const width = quarterTurn ? meta.height : meta.width;
  const height = quarterTurn ? meta.width : meta.height;
  if (!width || !height) throw new AppError("unreadable_image", 422, "We couldn’t read this image’s size.");
  if (Math.min(width, height) < minDimension) throw new AppError("image_too_small", 422, `This image is ${width}×${height}. Use at least ${minDimension} px per side.`);
  if (Math.max(width, height) > MAX_IMAGE_DIMENSION) throw new AppError("image_too_large", 422, `This image is ${width}×${height}. The maximum is ${MAX_IMAGE_DIMENSION} px per side.`);

  try {
    const scale = Math.min(1, WORKING_LONG_SIDE / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const png = await sharp(input, { limitInputPixels: MAX_IMAGE_DIMENSION * MAX_IMAGE_DIMENSION, failOn: "error" })
      .rotate()
      .resize(targetWidth, targetHeight, { kernel: "lanczos3" })
      .toColourspace("srgb")
      .ensureAlpha()
      .png()
      .toBuffer();
    const stats = await sharp(png).stats();
    const flat = await sharp(png).flatten({ background: "#ffffff" }).png().toBuffer();
    return { png, flat, width: targetWidth, height: targetHeight, hasAlpha: !stats.isOpaque };
  } catch {
    throw new AppError("unreadable_image", 422, "We couldn’t decode this image. Export it again as PNG or JPEG.");
  }
}

function cleanName(name: string): string {
  return path.basename(name).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 255) || "image";
}

/** Stores the character upload; a flipbook made from it copies what it needs. */
export async function ingestCharacterImage(input: { readonly body: ReadableStream<Uint8Array> | null; readonly fileName: string; readonly declaredBytes?: number }): Promise<FlipbookImage> {
  const originalName = cleanName(input.fileName);
  if (!hasAcceptedImageExtension(originalName)) throw new AppError("unsupported_image", 415, "Unsupported format. Upload a PNG, JPEG or WebP image.");
  const bytes = await readUpload(input.body, input.declaredBytes);
  const decoded = await decodeImage(bytes);
  const id = randomUUID();
  const dir = imageDir(id);
  await mkdir(dir, { recursive: true });
  try {
    await writeAtomic(path.join(dir, "image.png"), decoded.png);
    await writeAtomic(path.join(dir, "image-flat.png"), decoded.flat);
    const image: FlipbookImage = {
      id,
      originalName,
      width: decoded.width,
      height: decoded.height,
      hasAlpha: decoded.hasAlpha,
      createdAt: new Date().toISOString(),
      url: `/api/flipbooks/images/${id}`,
    };
    await writeAtomic(path.join(dir, "image.json"), JSON.stringify(image));
    return image;
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

export async function getCharacterImage(id: string): Promise<{ image: FlipbookImage; png: string; flat: string }> {
  const dir = imageDir(parseImageId(id));
  const raw = await readFile(path.join(dir, "image.json"), "utf8").catch(() => null);
  const parsed = raw ? FlipbookImageSchema.safeParse(JSON.parse(raw)) : null;
  if (!parsed?.success) throw new AppError("image_not_found", 404, "This image no longer exists. Upload it again.");
  return { image: parsed.data, png: path.join(dir, "image.png"), flat: path.join(dir, "image-flat.png") };
}
