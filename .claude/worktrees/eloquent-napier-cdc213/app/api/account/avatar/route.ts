import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { getSessionAccountEmail, SESSION_COOKIE } from "@/lib/auth/store";
import {
  deleteAvatar,
  readAvatar,
  saveAvatar,
  ALLOWED_AVATAR_MIMES,
} from "@/lib/account-store";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// GET    /api/account/avatar — serve the uploaded avatar bytes
// POST   /api/account/avatar — multipart upload, replaces the current one
// DELETE /api/account/avatar — remove the current avatar

export const GET = withApiErrors(async function GET() {
  const stored = await readAvatar();
  if (!stored) return apiError("not_found", { message: "No avatar uploaded." });

  return new NextResponse(stored.bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": stored.mime,
      "Content-Length": String(stored.bytes.byteLength),
      "Cache-Control": "private, no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

export const POST = withApiErrors(async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const email = await getSessionAccountEmail(token);
  if (!email) return apiError("unauthorized");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError("unsupported_format", { message: "A multipart form was expected." });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return apiError("no_file");

  const mime = file.type.toLowerCase().split(";")[0].trim();
  if (!ALLOWED_AVATAR_MIMES.has(mime)) {
    return apiError("unsupported_format", {
      message: "Supported formats: JPEG, PNG, WebP, GIF.",
    });
  }
  if (file.size > MAX_BYTES) {
    return apiError("too_large", { message: "Avatar must be under 5 MB." });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const avatar = await saveAvatar(bytes, mime);
  return NextResponse.json({ avatar });
});

export const DELETE = withApiErrors(async function DELETE(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const email = await getSessionAccountEmail(token);
  if (!email) return apiError("unauthorized");

  await deleteAvatar();
  return NextResponse.json({ ok: true });
});
