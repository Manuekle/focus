// Optional deployment diagnostic for Railway Limited Trial. These unauthenticated
// GETs check outbound HTTPS only: no prompts, API keys or paid model requests.
for (const [provider, url] of [
  ["meta-model-api", "https://api.meta.ai/v1/models"],
  ["facebook-graph", "https://graph.facebook.com/v26.0/me"],
]) {
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(8000) });
    console.info(JSON.stringify({ event: "provider_connectivity", provider, httpStatus: response.status }));
    await response.body?.cancel();
  } catch (error) {
    console.warn(JSON.stringify({ event: "provider_connectivity", provider, error: error?.cause?.code ?? error?.name ?? "connection_failed" }));
  }
}
