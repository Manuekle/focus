import { createHash } from "node:crypto";

// Optional runtime diagnostic: catalog access only, no paid model requests.
// The key stays in the Authorization header; logs contain its fingerprint.
const apiKey = process.env.MODEL_API_KEY?.trim() || process.env.META_API_KEY?.trim();
for (const [provider, url] of [
  ["meta-model-api", `${(process.env.META_BASE_URL?.trim() || "https://api.meta.ai/v1").replace(/\/$/, "")}/models`],
  ["facebook-graph", "https://graph.facebook.com/v26.0/me"],
]) {
  try {
    const meta = provider === "meta-model-api";
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: meta && apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    const result = { event: "provider_connectivity", provider, httpStatus: response.status };
    if (meta) {
      result.ready = false;
      result.keyConfigured = Boolean(apiKey);
      if (apiKey) result.keyFingerprint = createHash("sha256").update(apiKey).digest("hex").slice(0, 12);
      result.contentType = response.headers.get("content-type");
      result.requestId = response.headers.get("x-request-id");
      const body = await response.json().catch(() => null);
      if (Array.isArray(body?.data)) {
        result.models = body.data.map((model) => model.id);
        const required = [
          process.env.META_PLANNER_MODEL?.trim() || "muse-spark-1.3",
          process.env.META_SEGMENTATION_MODEL?.trim() || "sam-3.1",
          ...(process.env.NEXT_PUBLIC_ENABLE_FLIPBOOK === "true" ? [process.env.META_IMAGE_MODEL?.trim() || "muse-image-1.0"] : []),
        ];
        result.missingModels = required.filter((model) => !result.models.includes(model));
        result.ready = response.ok && result.missingModels.length === 0;
      }
      if (body?.error) {
        result.errorCode = body.error.code;
        result.errorMessage = String(body.error.message || "").split(apiKey || "NEVERMATCH").join("[REDACTED]").slice(0, 400);
      }
    } else await response.body?.cancel();
    console.info(JSON.stringify(result));
  } catch (error) {
    console.warn(JSON.stringify({ event: "provider_connectivity", provider, error: error?.cause?.code ?? error?.name ?? "connection_failed" }));
  }
}
