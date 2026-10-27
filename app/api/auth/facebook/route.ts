import { safeNextPath } from "../../../../shared/account";
import { AppError, errorResponse } from "../../../../server/errors";
import { authorizeUrl, callbackUrl, readFacebookConfig, simulatedLoginAllowed } from "../../../../server/auth/facebook";
import { newOAuthState } from "../../../../server/auth/session";
import { redirectWithCookies, stateCookie } from "../../../../server/auth/routes";

/**
 * Starts "Continue with Facebook". With a Meta app configured this is the
 * real Facebook Login dialog; locally it opens the simulated sign-in page.
 */
export async function GET(request: Request) {
  try {
    const next = safeNextPath(new URL(request.url).searchParams.get("next"));
    const state = newOAuthState();
    const config = readFacebookConfig();
    if (config) return redirectWithCookies(authorizeUrl(config, callbackUrl(request), state), [stateCookie(state, next)]);
    if (!simulatedLoginAllowed()) throw new AppError("auth_not_configured", 503, "El inicio de sesión con Facebook no está configurado en esta instalación.");
    return redirectWithCookies(`/auth/simulated?state=${encodeURIComponent(state)}`, [stateCookie(state, next)]);
  } catch (error) {
    return errorResponse(error);
  }
}
