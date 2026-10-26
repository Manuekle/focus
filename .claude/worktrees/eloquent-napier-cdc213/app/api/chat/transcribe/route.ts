import { NextResponse, type NextRequest } from "next/server";
import { transcribeAudio } from "@/lib/elevenlabs";
import { apiError, apiFailure, withApiErrors } from "@/lib/api-error";

// POST /api/chat/transcribe — one dictation clip from the web composer.
//
// The mic button records while it is open and posts the clip here when it
// stops; the text comes back into the textarea for the person to read and
// edit before sending. Nothing is stored — the bytes live for the length of
// the request and are never written anywhere.
//
// Voice notes arriving over WhatsApp and Instagram take a different road
// (lib/chat-media.ts): those are transcribed straight into the agent's
// context, because there is nobody at a keyboard to correct them.
//
// Auth is the middleware's: everything under /api is signed-in-only unless it
// is on the public list in middleware.ts, and this is not.

/** Scribe's own ceiling is far higher; this is a composer clip, not a
 *  recording session, and the cap keeps a stuck recorder from posting a
 *  hundred megabytes. About twenty minutes of opus. */
const MAX_BYTES = 10 * 1024 * 1024;

// Transcription is one upstream round trip on an audio file — past the static
// route budget on a long clip.
export const maxDuration = 120;

export const POST = withApiErrors(async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError("unsupported_format", { message: "A multipart form was expected." });
  }

  const file = form.get("audio");
  if (!(file instanceof File) || file.size === 0) return apiError("no_file");
  if (file.size > MAX_BYTES) return apiError("too_large");

  const data = Buffer.from(await file.arrayBuffer());

  let text: string;
  try {
    text = await transcribeAudio({
      data,
      mimeType: file.type || "audio/webm",
      filename: file.name || "dictation.webm",
      abortSignal: request.signal,
    });
  } catch (error) {
    // `transcribeAudio` throws the same way for a missing key as for a refused
    // request, and the two are different problems for whoever reads the toast:
    // one is a setup step in Settings, the other is ElevenLabs saying no.
    // `apiFailure` is what keeps the SDK's own message out of the response in
    // production, where it can name the request it built.
    const message = error instanceof Error ? error.message : String(error);
    // No key at all, and a key ElevenLabs rejects, are the same job for the
    // operator: go set it. "An external service didn't answer correctly"
    // would send them looking for an outage instead.
    const badKey =
      message.includes("API key is not configured") ||
      message.includes("Invalid API key") ||
      /Status code: 401/.test(message);
    // `not_configured` defaults to 200 — it is normally a "this feature is off"
    // answer to a GET, which the UI reads as a flag. Here it is a failed
    // dictation, so it has to arrive as one or `response.ok` swallows it.
    if (badKey) return apiError("not_configured", { status: 503 });
    return apiFailure(error, "upstream_failed");
  }

  return NextResponse.json({ text });
});
