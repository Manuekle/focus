import { SESSION_COOKIE, clearCookie } from "../../../../server/auth/session";
import { jsonWithCookies } from "../../../../server/auth/routes";

export async function POST() {
  return jsonWithCookies({ ok: true }, [clearCookie(SESSION_COOKIE)]);
}
