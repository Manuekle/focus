import { randomBytes } from "node:crypto";
import path from "node:path";
import { rm } from "node:fs/promises";
import { AudioSettingsSchema, FlipbookAudioSchema, type FlipbookAudio } from "../../shared/sequence";
import { MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS } from "../../shared/living";
import { AppError } from "../errors";
import { ffmpeg, probe } from "../ffmpeg";
import { flipbookDir, getFlipbook, updateFlipbook } from "./store";
import { mediaLimiter, receiveMedia } from "./media-input";

export function trackPath(id: string, version: string): string {
  if (!/^[0-9a-f]{12}$/.test(version)) throw new AppError("audio_not_found", 404, "This track is no longer available.");
  return path.join(flipbookDir(id), "audio", `${version}.m4a`);
}

export async function normalizeTrack(input: string, output: string): Promise<number> {
  const source = await probe(input, true).catch(() => null);
  if (!source?.streams.some((stream) => stream.codec_type === "audio")) throw new AppError("audio_invalid", 422, "This file has no readable audio. Choose MP3, M4A, AAC, WAV or OGG.");
  await mediaLimiter.run(() => ffmpeg(["-protocol_whitelist", "file,pipe", "-i", input, "-vn", "-map", "0:a:0", "-t", String(MAX_AUDIO_SECONDS), "-ac", "2", "-ar", "48000", "-c:a", "aac", "-b:a", "160k", output]));
  const duration = Number((await probe(output, true)).format.duration);
  if (!(duration > 0.2 && duration <= MAX_AUDIO_SECONDS + 1)) throw new AppError("audio_invalid", 422, "Choose a track with at least a moment of readable sound.");
  return duration;
}

export async function uploadFlipbookTrack(id: string, body: ReadableStream<Uint8Array> | null, bytes: number | undefined, name: string) {
  await getFlipbook(id);
  const version = randomBytes(6).toString("hex");
  const output = trackPath(id, version);
  const raw = `${output}.upload`;
  await receiveMedia(body, bytes, raw, MAX_AUDIO_BYTES);
  try {
    const durationSeconds = await normalizeTrack(raw, output);
    const track = FlipbookAudioSchema.parse({ version, name: path.basename(name).slice(0, 120) || "Audio track", durationSeconds });
    return await updateFlipbook(id, (current) => ({ ...current, audio: track }), { evenIfCanceled: true });
  } catch (error) { await rm(output, { force: true }); throw error; }
  finally { await rm(raw, { force: true }); }
}

export async function updateTrack(id: string, settings: unknown) {
  const result = AudioSettingsSchema.safeParse(settings);
  if (!result.success) throw new AppError("audio_invalid", 400, "Choose valid audio start times and a volume between 0 and 100%.");
  const parsed = result.data;
  return updateFlipbook(id, (current) => {
    if (!current.audio || parsed.offset >= current.audio.durationSeconds) throw new AppError("audio_invalid", 400, "Choose a starting point inside the track.");
    return { ...current, audio: { ...current.audio, ...parsed } };
  }, { evenIfCanceled: true });
}

export function audioGraph(audio: Pick<FlipbookAudio, "offset" | "startsAt" | "volume">, seconds: number): string {
  const parsed = AudioSettingsSchema.parse(audio);
  const delay = Math.round(parsed.startsAt * 1000);
  return `atrim=start=${parsed.offset.toFixed(6)},asetpts=PTS-STARTPTS,volume=${parsed.volume.toFixed(6)},adelay=${delay}|${delay},apad,atrim=duration=${seconds.toFixed(6)}`;
}

export async function prepareExportTrack(id: string, audio: FlipbookAudio, seconds: number, output: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw signal.reason;
  await ffmpeg(["-protocol_whitelist", "file,pipe", "-i", trackPath(id, audio.version), "-af", audioGraph(audio, seconds), "-c:a", "aac", "-ac", "2", "-ar", "48000", output]);
  if (signal?.aborted) throw signal.reason;
  return output;
}
