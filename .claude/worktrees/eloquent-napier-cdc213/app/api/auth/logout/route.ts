import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, destroySession } from "@/lib/auth/store";

export async function POST(request: NextRequest) {
  // Dropped server-side as well as in the browser, so a token already copied
  // off the machine stops working too.
  await destroySession(request.cookies.get(SESSION_COOKIE)?.value);
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
