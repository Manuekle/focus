import type { RotoscopeFrame, RotoscopeRun } from "../../shared/rotoscope";

/** What a frame is doing right now, as the canvas and the inspector show it. */
export type FrameState = "approved" | "drawing" | "halted" | "rejected" | "pending";

export function frameState(run: RotoscopeRun, frame: RotoscopeFrame): FrameState {
  if (frame.status === "approved") return "approved";
  if (run.live?.frame === frame.index) return "drawing";
  if (run.halted?.frame === frame.index) return "halted";
  return frame.attempts.length ? "rejected" : "pending";
}

export const STATE_LABEL: Record<FrameState, string> = {
  approved: "Approved",
  drawing: "Drawing",
  halted: "Stopped here",
  rejected: "Not approved",
  pending: "Not drawn",
};

export const time = (run: RotoscopeRun, index: number) => `${(run.start + (index - 1) / run.fps).toFixed(2)} s`;
