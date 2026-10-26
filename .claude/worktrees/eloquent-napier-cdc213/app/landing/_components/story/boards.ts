import type { StoryScript } from "./kit";

/**
 * Each story's board height, wide and phone, measured from what it draws over
 * a whole lap plus a margin — so a story never sits in an empty band. Shared
 * with the frame, which reserves the space before a story's code has loaded.
 */
export const BOARDS = {
  chat: { wide: 444, tall: 606 },
  inbox: { wide: 438, tall: 442 },
  ads: { wide: 468, tall: 490 },
  agents: { wide: 434, tall: 414 },
  automation: { wide: 452, tall: 622 },
} as const satisfies Record<string, StoryScript["board"]>;
