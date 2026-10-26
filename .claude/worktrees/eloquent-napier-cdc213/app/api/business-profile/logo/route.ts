import { NextResponse, type NextRequest } from "next/server";
import {
  deleteBusinessLogo,
  readBusinessLogo,
  saveBusinessLogo,
} from "@/lib/business-profile-store";
import { BusinessIdentityError, MAX_LOGO_BYTES, logoExtensionFor } from "@/lib/business-identity";
import { apiError, withApiErrors } from "@/lib/api-error";

// GET    /api/business-profile/logo — the bytes, for <img src>
// POST   /api/business-profile/logo — multipart upload, replaces the current one
// DELETE /api/business-profile/logo — remove it

export const GET = withApiErrors(async function GET() {
  const stored = await readBusinessLogo();
  if (!stored) return apiError("not_found", { message: "No logo has been uploaded." });

  return new NextResponse(stored.bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": stored.logo.mime,
      "Content-Length": String(stored.bytes.byteLength),
      // The URL carries the upload's id, so the bytes behind it never change.
      "Cache-Control": "private, max-age=31536000, immutable",
      // An SVG served from this origin is a script the owner uploaded to their
      // own app. Both headers together make it inert: nothing may load or run,
      // and the browser may not re-interpret the declared type.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

export const POST = withApiErrors(async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError("unsupported_format", { message: "A multipart form was expected." });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return apiError("no_file");
  if (file.size > MAX_LOGO_BYTES) {
    return apiError("too_large", { message: `The logo must be under ${MAX_LOGO_BYTES / (1024 * 1024)} MB.` });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let extension: string;
  try {
    extension = logoExtensionFor(file.type, bytes.byteLength);
  } catch (error) {
    if (error instanceof BusinessIdentityError) {
      return apiError(bytes.byteLength > MAX_LOGO_BYTES ? "too_large" : "unsupported_format", {
        message: error.message,
      });
    }
    throw error;
  }

  const logo = await saveBusinessLogo({ bytes, mime: file.type.toLowerCase(), extension });
  return NextResponse.json({ logo });
});

export const DELETE = withApiErrors(async function DELETE() {
  await deleteBusinessLogo();
  return NextResponse.json({ ok: true });
});
