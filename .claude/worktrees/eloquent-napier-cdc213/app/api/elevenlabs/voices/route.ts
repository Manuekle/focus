import { ELEVENLABS_SCOPES, hasVoicePlatform, listVoices } from "@/lib/elevenlabs-agents";
import { NextResponse } from "next/server";
import { apiError, apiFailure, withApiErrors } from "@/lib/api-error";

/**
 * The account's voices, for the picker in the voice playground.
 *
 * A missing key is not an error here: the page renders the whole panel with an
 * empty picker and a line pointing at Settings, which reads better than an
 * error banner over a screen the person has not configured yet.
 */
export const GET = withApiErrors(async function GET() {
  if (!(await hasVoicePlatform())) {
    return NextResponse.json({ configured: false, voices: [] });
  }
  try {
    const voices = await listVoices();
    return NextResponse.json({ configured: true, voices });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const perm = msg.match(/permission (\w+)/)?.[1] ?? (msg.includes("missing_permissions") ? ELEVENLABS_SCOPES : null);
    if (perm || msg.includes("unauthorized")) {
      // The permission name goes in `field`, not into a sentence built here:
      // `apiError.elevenlabs_permission` is the sentence, and it exists in
      // both languages. A message written in this file would arrive in
      // whichever one the author happened to speak.
      return apiError("elevenlabs_permission", { detail: msg, field: perm ?? ELEVENLABS_SCOPES });
    }
    return apiFailure(error, "upstream_failed");
  }
});
