import { NextResponse } from "next/server";
import { readBusinessLogoById } from "@/lib/business-profile-store";
import { getPublishedLinkPageBySlug } from "@/lib/link-pages";

export const dynamic = "force-dynamic";

/** Public only through a published page's opaque slug — no business id is
 * exposed in the path, and drafts cannot fetch a logo through this route. */
export const GET = async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const page = await getPublishedLinkPageBySlug(slug);
  if (!page) return new NextResponse(null, { status: 404 });
  const stored = await readBusinessLogoById(page.businessId);
  if (!stored) return new NextResponse(null, { status: 404 });
  return new NextResponse(stored.bytes as unknown as BodyInit, {
    headers: {
      "content-type": stored.logo.mime,
      "content-length": String(stored.bytes.byteLength),
      "cache-control": "public, max-age=300",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
};
