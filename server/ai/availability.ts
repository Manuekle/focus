import { createHash } from "node:crypto";
import { AppError } from "../errors";
import { requireMetaConfig } from "./meta";

export type ModelCapability = "planner" | "image" | "segmentation";
const catalogs = ((globalThis as { __focusModelCatalogs?: Map<string, { at: number; models: Set<string> }> }).__focusModelCatalogs ??= new Map());

/** Catalog lookup only: refuse unavailable models before charging a generation. */
export async function assertModelsAvailable(capabilities: readonly ModelCapability[]): Promise<void> {
  const config = requireMetaConfig();
  const key = createHash("sha256").update(`${config.baseUrl}\0${config.apiKey}`).digest("hex");
  let catalog = catalogs.get(key);
  if (!catalog || Date.now() - catalog.at > 60_000) {
    let response: Response;
    try {
      response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/models`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
        redirect: "error", signal: AbortSignal.timeout(8000), cache: "no-store",
      });
    } catch {
      throw new AppError("meta_unreachable", 503, "AI availability couldn’t be checked. Your generation hasn’t been used. Try again shortly.");
    }
    if (!response.ok) {
      const code = response.status === 401 ? "meta_unauthorized" : [402, 403].includes(response.status) ? "meta_forbidden" : "meta_unavailable";
      throw new AppError(code, 503, "The AI service is unavailable. Your generation hasn’t been used. Try again shortly.");
    }
    const body = await response.json().catch(() => null);
    if (!Array.isArray(body?.data) || body.data.some((model: { id?: unknown } | null) => !model || typeof model.id !== "string")) {
      throw new AppError("meta_unavailable", 503, "AI availability couldn’t be checked. Your generation hasn’t been used.");
    }
    catalog = { at: Date.now(), models: new Set(body.data.map((model: { id: string }) => model.id)) };
    // Empty catalogs must be rechecked on retry, rather than caching an outage.
    if (catalog.models.size) catalogs.set(key, catalog);
  }
  const missing = capabilities.map((capability) => config[`${capability}Model`]).filter((model) => !catalog.models.has(model));
  if (missing.length) {
    console.error(JSON.stringify({ event: "provider_models_unavailable", models: missing }));
    throw new AppError("meta_model_not_found", 503, "Animation generation is temporarily unavailable. Your generation hasn’t been used. Please try again later.");
  }
}
