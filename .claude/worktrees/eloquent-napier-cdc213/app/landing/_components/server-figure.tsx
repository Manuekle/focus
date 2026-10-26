"use client";

import { FigureStage } from "./hairline/figure-stage";
import { SERVER_FRAME } from "./hairline/frames";
import server from "./hairline/server.js";

/**
 * The self-hosted machine as a Hairline figure, in the neutral ink. It has no
 * callouts: the guarantees listed beside it are its legend, and the part under
 * the pointer is handed to the page so the matching guarantee can answer.
 */
export function ServerFigure({ onActive }: { readonly onActive?: (part: string | null) => void }) {
  return <FigureStage figure={server} frame={SERVER_FRAME} onActive={onActive} tone="neutral" />;
}
