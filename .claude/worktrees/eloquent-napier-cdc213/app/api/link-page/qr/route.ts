import QRCode from "qrcode";
import { NextResponse, type NextRequest } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { getLinkPageForCurrentBusiness } from "@/lib/link-pages";
import { SITE_URL, SITE_URL_IS_CONFIGURED } from "@/lib/site";

const QR_OPTIONS = {
  errorCorrectionLevel: "M",
  margin: 2,
  type: "svg",
  color: { dark: "#09090b", light: "#ffffff" },
} as const;

function fileName(slug: string): string {
  return `${slug.replace(/[^a-z0-9-]/gi, "-")}-enlaces-qr.svg`;
}

/** A printable vector code for the active business's shareable page. */
export const GET = withApiErrors(async function GET(request: NextRequest) {
  const page = await getLinkPageForCurrentBusiness();
  if (!page) return apiError("not_found", { message: "Create a link page first." });
  if (page.status !== "published") {
    return apiError("unprocessable", { message: "Publish the link page before downloading its QR code." });
  }
  const origin = SITE_URL_IS_CONFIGURED ? SITE_URL : request.nextUrl.origin;
  const target = `${origin}/l/${page.slug}`;

  // JSON mode: the raw module grid, for the canvas that animates the code in.
  if (request.nextUrl.searchParams.has("json")) {
    const qr = QRCode.create(target, { errorCorrectionLevel: "M" });
    // BitMatrix is a class over a flat Uint8Array, not a JSON row array.
    const modules = Array.from({ length: qr.modules.size }, (_, row) =>
      Array.from({ length: qr.modules.size }, (_, column) => Boolean(qr.modules.get(row, column))),
    );
    return NextResponse.json({ modules }, { headers: { "cache-control": "no-cache" } });
  }

  const svg = await QRCode.toString(target, QR_OPTIONS);
  const download = request.nextUrl.searchParams.has("download");
  return new NextResponse(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "content-disposition": download ? `attachment; filename="${fileName(page.slug)}"` : "inline",
      "cache-control": "no-cache",
    },
  });
});
