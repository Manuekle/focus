import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { rotoscopeEnabled } from "../../shared/features";
import { RotoscopeStudio } from "./rotoscope-studio";

export const metadata: Metadata = {
  title: "Rotoscope · Focus",
  description: "Redraw a video frame by frame with your character.",
};

type Props = { searchParams: Promise<{ run?: string | string[] }> };

export default async function Page({ searchParams }: Props) {
  if (!rotoscopeEnabled()) notFound();
  const { run } = await searchParams;
  const runId = typeof run === "string" && /^[0-9a-f-]{36}$/.test(run) ? run : null;
  return <RotoscopeStudio key={runId ?? "new"} initialRunId={runId} />;
}
