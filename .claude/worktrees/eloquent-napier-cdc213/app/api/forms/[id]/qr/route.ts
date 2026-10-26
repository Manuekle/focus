import QRCode from "qrcode";
import { type NextRequest, NextResponse } from "next/server";
import { getForm } from "@/lib/business-store";
import { apiError, withApiErrors } from "@/lib/api-error";
import { SITE_URL, SITE_URL_IS_CONFIGURED } from "@/lib/site";

/**
 * The printable version of a form's public link.
 *
 * SVG rather than PNG on purpose: this code ends up on a table tent, a
 * counter sign or a flyer, and a raster QR blown up to poster size is the one
 * way to make a scan fail. Vector prints at any size from the same file.
 *
 * Error correction is "M" — the level that survives a coffee ring or a thumb
 * over a corner without inflating the module count so much that the code stops
 * scanning from across a room.
 */
const QR_OPTIONS = {
  errorCorrectionLevel: "M",
  margin: 2,
  type: "svg",
  color: { dark: "#000000", light: "#ffffff" },
} as const;

/** A filename someone can find again in their Downloads folder. */
function fileName(slug: string): string {
  return `${slug.replace(/[^a-z0-9-]/gi, "-")}-qr.svg`;
}

export const GET = withApiErrors(async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const form = await getForm(id);
  if (!form) return apiError("not_found");

  // Same fallback order as the rest of the app: the configured origin wins,
  // and the request's own origin covers localhost and preview URLs, where
  // nothing is configured but the link still has to work.
  const origin = SITE_URL_IS_CONFIGURED ? SITE_URL : request.nextUrl.origin;

  // JSON mode: return the raw module grid for canvas animation.
  if (request.nextUrl.searchParams.has("json")) {
    const qr = QRCode.create(`${origin}/f/${form.slug}`, {
      errorCorrectionLevel: "M",
    });
    // BitMatrix is a class with a flat Uint8Array, not a JSON row array.
    const modules = Array.from({ length: qr.modules.size }, (_, row) =>
      Array.from({ length: qr.modules.size }, (_, column) =>
        Boolean(qr.modules.get(row, column)),
      ),
    );
    return NextResponse.json({ modules }, { headers: { "cache-control": "no-cache" } });
  }

  const svg = await QRCode.toString(`${origin}/f/${form.slug}`, QR_OPTIONS);

  // `download` is what the button sends; without it the same URL previews
  // inline, which is what the card's <img> wants.
  const disposition = request.nextUrl.searchParams.has("download")
    ? `attachment; filename="${fileName(form.slug)}"`
    : "inline";

  return new NextResponse(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "content-disposition": disposition,
      // The code only changes when the slug does, and the slug is editable —
      // so revalidate rather than cache hard.
      "cache-control": "no-cache",
    },
  });
});
