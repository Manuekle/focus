/** Empty values prevent Next's dotenv loader from restoring real accounts. */
export function isolateMockEnvironment(env: Record<string, string | undefined>, credentialKeys: readonly string[]): void {
  const runtimeKeys = [
    "WORKFLOW_POSTGRES_URL", "VERCEL_OIDC_TOKEN", "VERCEL_TOKEN", "VERCEL", "VERCEL_ENV",
    "ORUKA_FLEET_URL", "ORUKA_TENANT_ID",
  ];
  for (const key of [...credentialKeys, ...runtimeKeys]) {
    // A local model needs no account and is safe to use for rehearsals.
    if (key !== "OLLAMA_BASE_URL") env[key] = "";
  }
}
