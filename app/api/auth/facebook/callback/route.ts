import { z } from "zod";
import { AppError, errorResponse } from "../../../../../server/errors";
import { callbackUrl, exchangeCode, readFacebookConfig, simulatedLoginAllowed, simulatedProfile } from "../../../../../server/auth/facebook";
import { checkState, jsonWithCookies, redirectWithCookies, signIn } from "../../../../../server/auth/routes";
import { readJsonBody } from "../../../../../server/guard";

/** Facebook sends the person back here with a one-time code. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const config = readFacebookConfig();
  const next = checkState(request, url.searchParams.get("state"));
  // Declined or failed: back to the app with a reason the editor can show.
  if (!config || !next) return Response.redirect(new URL("/editor?auth=failed", url), 303);
  const code = url.searchParams.get("code");
  if (!code) return Response.redirect(new URL(`${next}${next.includes("?") ? "&" : "?"}auth=canceled`, url), 303);
  try {
    const profile = await exchangeCode(config, code, callbackUrl(request));
    return redirectWithCookies(next, await signIn(profile));
  } catch (error) {
    if (error instanceof AppError && error.detail) console.warn(`[focus] facebook login failed: ${error.code} — ${error.detail}`);
    return Response.redirect(new URL("/editor?auth=failed", url), 303);
  }
}

const SimulatedSchema = z.object({ state: z.string().min(1).max(100), name: z.string().max(80) });

/** The local stand-in for Facebook: the simulated sign-in page posts here. */
export async function POST(request: Request) {
  try {
    if (!simulatedLoginAllowed()) throw new AppError("auth_not_configured", 503, "El inicio de sesión simulado no está disponible aquí.");
    const parsed = SimulatedSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_name", 400, "Escribe tu nombre para continuar.");
    const next = checkState(request, parsed.data.state);
    if (!next) throw new AppError("auth_expired", 400, "El inicio de sesión expiró. Vuelve a intentarlo.");
    return jsonWithCookies({ next }, await signIn(simulatedProfile(parsed.data.name)));
  } catch (error) {
    return errorResponse(error);
  }
}
