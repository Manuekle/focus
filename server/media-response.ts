import { AppError } from "./errors";
import { serveFile } from "./serve-file";
import { parseVideoId } from "./storage";
import { mediaFile, type MediaVariant } from "./videos";

const VARIANTS: readonly MediaVariant[] = ["normalized", "poster", "source"];

/** Serves a stored video file with byte-range support — what lets Safari play and every browser seek. */
export async function mediaResponse(request: Request, id: string): Promise<Response> {
  const requested = new URL(request.url).searchParams.get("variant") ?? "normalized";
  const variant = VARIANTS.find((name) => name === requested);
  if (!variant) throw new AppError("invalid_variant", 400, "Variante de archivo desconocida.");
  const file = await mediaFile(parseVideoId(id), variant);
  return serveFile(request, file.path, file.type);
}
