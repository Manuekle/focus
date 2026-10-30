import { AppError } from "../errors";
import { clientKey, guardConfig, takeSlot } from "../guard";
import { assertGenerationAvailable, consumeGeneration } from "../quota";
import { assertStorageAvailable } from "../storage-budget";
import type { JobGate } from "./jobs";

// Abuse and cost protection for GPU renders, on top of the per-user and
// global active-job caps the job service enforces itself.
//
//   ANIMATION_JOBS_PER_HOUR=6   new renders per account per hour (retries are free)

export function renderGate(request: Request, userId: string): JobGate {
  return async () => {
    if (guardConfig().aiDisabled) throw new AppError("ai_disabled", 503, "AI generation is temporarily paused. Try again later.");
    await assertStorageAvailable(256 * 1024 * 1024);
    await assertGenerationAvailable(request);
    const perHour = Number(process.env.ANIMATION_JOBS_PER_HOUR);
    const wait = takeSlot("animation", `${userId}:${clientKey(request)}`, Number.isFinite(perHour) && perHour >= 0 ? perHour : 6);
    if (wait !== null) throw new AppError("rate_limited", 429, `You’ve reached the hourly limit for animations. Try again in ${Math.max(1, Math.ceil(wait / 60))} min.`);
    await consumeGeneration(request);
  };
}
