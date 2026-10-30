// Runs once when a Next.js server starts, before it handles requests: the
// values saved on the settings page join the environment first.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadStoredSettings } = await import("./server/settings");
  loadStoredSettings();
}
