import { NextResponse, type NextRequest } from "next/server";
import { resetPassword } from "@/lib/auth/store";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    token?: string;
    password?: string;
  } | null;

  if (!body?.token || !body?.password) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const result = await resetPassword(body.token, body.password);
  if (!result.ok) {
    return NextResponse.json({ error: "invalid_or_expired_token" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
