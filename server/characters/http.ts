import { AppError } from "../errors";
import { requireUser } from "../auth/require";
import { assertFlipbookEnabled } from "../animation/store";

export const privateJson = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function characterUser(request: Request) {
  assertFlipbookEnabled();
  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    // The configured public origin is authoritative behind Railway's HTTPS
    // proxy. IP-header trust is a separate setting and must not control CSRF.
    const publicUrl = process.env.FOCUS_PUBLIC_URL?.trim();
    const expected = new URL(publicUrl || request.url);
    if (!publicUrl) expected.host = request.headers.get("host") ?? expected.host;
    if (!publicUrl &&
      process.env.FOCUS_TRUST_PROXY === "1" &&
      request.headers.get("x-forwarded-proto") === "https"
    )
      expected.protocol = "https:";
    if (origin && origin !== expected.origin)
      throw new AppError(
        "invalid_origin",
        403,
        "Open Focus to make this change.",
      );
  }
  return requireUser(request);
}
export function uploadName(request: Request) {
  try {
    return decodeURIComponent(
      request.headers.get("x-focus-filename") ?? "reference.png",
    )
      .replace(/[\u0000-\u001f]/g, "")
      .slice(0, 100);
  } catch {
    throw new AppError(
      "invalid_filename",
      400,
      "Choose an image with a valid file name.",
    );
  }
}
