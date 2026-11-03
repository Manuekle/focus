import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { generateImage } from "../animation/muse-image";
import { CANVAS, toCanvas } from "./draw";
import { layoutRun } from "./pipeline";

// The preview's backgrounds behind the drawings. Both are one Muse Image picture per run, framed like the video frame
// letterboxed on the canvas (sourcePlaced): the preview shows the drawings at that framing too (RotoscopeRun.framing).
//   plate:   the video's own room with the person taken out (cloned from the video)
//   scenery: that room redrawn as a 2D anime background in the character sheet's style

export const BACKDROPS = ["plate", "scenery"] as const;
export type Backdrop = (typeof BACKDROPS)[number];

export const backdropFile = (dir: string, kind: Backdrop) => path.join(dir, "backdrop", `${kind}.png`);
export const hasBackdrop = (dir: string, kind: Backdrop) => existsSync(backdropFile(dir, kind));

const PLATE_PROMPT = "Image 1 is a still from a video. Remove the person completely and rebuild what was behind them, so the room is empty. Keep everything else exactly as it is: the same room, walls, floor, objects, lighting, colours, camera angle and framing. A photograph: no people, no shadows of people, nothing added.";
const SCENERY_PROMPT = "Redraw the empty room of Image 1 as a background painting for a 2D anime, in the art style of Image 2: its line work, colours and flat cel shading. Keep the same room, walls, floor, objects, layout, lighting, camera angle and framing. No people and no characters: the background alone.";

/** Draws one backdrop and keeps it in the run (backdrop/<kind>.png). The scenery is drawn from the plate when there is one. */
export async function makeBackdrop(dir: string, kind: Backdrop, signal?: AbortSignal): Promise<string> {
  const { sourcePlaced, character } = await layoutRun(dir);
  const room = kind === "scenery" && hasBackdrop(dir, "plate") ? await readFile(backdropFile(dir, "plate")) : await sourcePlaced(1);
  const references = kind === "plate"
    ? [{ png: room, role: "THE VIDEO FRAME: the room to keep, with a person to take out." }]
    : [{ png: room, role: "THE ROOM: its layout, objects and framing." }, { png: character, role: "THE ART STYLE: line work, colours and shading only; never draw this character." }];
  const image = await generateImage({ prompt: kind === "plate" ? PLATE_PROMPT : SCENERY_PROMPT, references, size: `${CANVAS.width}x${CANVAS.height}`, action: "edit", attempts: 1, signal });
  const file = backdropFile(dir, kind);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, await toCanvas(image.png));
  return file;
}
