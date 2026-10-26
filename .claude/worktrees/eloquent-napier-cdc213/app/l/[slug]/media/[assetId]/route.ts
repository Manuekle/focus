import { NextResponse } from "next/server";
import { getPublishedLinkPageBySlug } from "@/lib/link-pages";
import { styleAssetIds } from "@/lib/link-page-style";
import { getAsset, readAssetBytes } from "@/lib/media-store";

export const dynamic = "force-dynamic";

/**
 * The background and avatar pictures a published page points at.
 *
 * The media library itself is the business's own material and stays behind
 * the session. This route serves exactly the assets a published page already
 * shows a stranger, resolved through the page's own slug: an id the page does
 * not reference answers 404, so the route cannot be used to walk the library.
 */
export const GET = async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string; slug: string }> },
) {
  const { assetId, slug } = await params;
  const published = await getPublishedLinkPageBySlug(slug);
  if (!published) return new NextResponse(null, { status: 404 });
  if (!styleAssetIds(published.page.style).includes(assetId)) return new NextResponse(null, { status: 404 });

  const asset = await getAsset(assetId);
  if (!asset || asset.kind !== "image") return new NextResponse(null, { status: 404 });

  let bytes: Uint8Array;
  try {
    bytes = await readAssetBytes(asset);
  } catch {
    // Metadata without bytes: the store and the blob directory drifted apart.
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "content-type": asset.mime || "application/octet-stream",
      "content-length": String(bytes.byteLength),
      "cache-control": "public, max-age=300",
      // Same two headers the business logo carries: nothing this document
      // references may load or run, and the declared type is final.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
};
