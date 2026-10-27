import { errorResponse } from "../../../../server/errors";
import { jsonWithCookies, sessionInfo } from "../../../../server/auth/routes";

/** Who is signed in, or how many free edits an anonymous visitor has left. */
export async function GET(request: Request) {
  try {
    const { info, setCookie } = await sessionInfo(request);
    return jsonWithCookies(info, [setCookie]);
  } catch (error) {
    return errorResponse(error);
  }
}
