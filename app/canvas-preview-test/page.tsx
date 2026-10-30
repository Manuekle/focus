"use client";

import { useState } from "react";
import type { RotoscopeRun } from "../../shared/rotoscope";
import { RotoscopeEditor } from "../rotoscope/rotoscope-editor";

const frames = Array.from({ length: 36 }, (_, index) => ({
  index: index + 1,
  status: index < 12 ? "approved" as const : "pending" as const,
  approvedAttempt: index < 12 ? 1 : null,
  manual: false, correction: null,
  attempts: index < 12 ? [{ attempt: 1, at: new Date(0).toISOString(), passed: true, checks: [] }] : [],
}));

const run: RotoscopeRun = {
  id: "00000000-0000-4000-8000-000000000000",
  name: "Rooftop spin · test",
  createdAt: new Date(0).toISOString(),
  phase: "generating",
  total: frames.length,
  approved: 12,
  fps: 9,
  start: 0,
  seconds: 4,
  maxAttempts: 3,
  error: null,
  halted: null,
  live: { frame: 13, attempt: 2, tries: 2, stage: "checking", image: true, at: new Date().toISOString() },
  log: ["extracted", "DWPose", "describing", "drawing frame 13"],
  frames,
  dual: false,
  dualAvailable: false,
  guidesVersion: "",
};

export default function CanvasPreview() {
  const [value, setValue] = useState(run);
  return (
    <div style={{ height: "100dvh", containerType: "inline-size", containerName: "flipbook-workspace", padding: "16px", display: "flex", flexDirection: "column" }}>
      <RotoscopeEditor run={value} onChange={setValue} />
    </div>
  );
}
