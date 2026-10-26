// The stages /start/ready draws, in the fleet's order (its
// src/signup-status.ts). Shared by the server page, which fetches their copy,
// and the client component, which draws them: a plain module, because a
// value exported from a "use client" file reaches the server as a client
// reference, not as the array.
export const STAGES = ["payment", "database", "workspace", "build", "checks", "invite"] as const;
export type StageName = (typeof STAGES)[number];
