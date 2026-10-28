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
    // Next may use an internal localhost URL while the browser uses 127.0.0.1
    // or a reverse-proxied public host. Host is supplied by the HTTP request.
    const expected = new URL(request.url);
    expected.host = request.headers.get("host") ?? expected.host;
    if (
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
