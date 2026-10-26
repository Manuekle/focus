import { NextResponse } from "next/server";
import { readBusinessLogoById } from "@/lib/business-profile-store";
import { apiError, withApiErrors } from "@/lib/api-error";

// GET /api/businesses/[id]/logo — serve any business's logo by ID

export const GET = withApiErrors(async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const stored = await readBusinessLogoById(id);
  if (!stored) return apiError("not_found", { message: "No logo." });

  return new NextResponse(stored.bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": stored.logo.mime,
      "Content-Length": String(stored.bytes.byteLength),
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
