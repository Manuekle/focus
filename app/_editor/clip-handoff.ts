// A clip handed from the editor to Rotoscope or Flipbook. The file stays in
// memory for the client-side navigation that follows; a reload drops it and
// the destination simply opens empty.

let pending: File | null = null;

export function stashClip(file: File): void {
  pending = file;
}

/** The handed clip, once: taking it clears it. */
export function takeClip(): File | null {
  const file = pending;
  pending = null;
  return file;
}

/** Downloads a clip the app serves into a File the destination can upload like a picked one. */
export async function fetchClip(url: string, name: string): Promise<File> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("The video couldn’t be loaded.");
  const blob = await response.blob();
  const base = name.replace(/\.[^.]+$/, "") || "clip";
  return new File([blob], `${base}.mp4`, { type: blob.type || "video/mp4" });
}

/** Where each destination opens with the handed clip. */
export const CLIP_DESTINATION = { rotoscope: "/rotoscope?clip=1", flipbook: "/flipbook?clip=1" } as const;
export type ClipDestination = keyof typeof CLIP_DESTINATION;
