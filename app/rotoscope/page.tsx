import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { rotoscopeEnabled } from "../../shared/features";
import { RotoscopeStudio } from "./rotoscope-studio";

export const metadata: Metadata = {
  title: "Rotoscope · Focus",
  description: "Redraw a video frame by frame with your character.",
};

type Props = { searchParams: Promise<{ run?: string | string[]; batch?: string | string[] }> };

export default async function Page({ searchParams }: Props) {
  if (!rotoscopeEnabled()) notFound();
  const { run, batch } = await searchParams;
  const id = (value: string | string[] | undefined) => (typeof value === "string" && /^[0-9a-f-]{36}$/.test(value) ? value : null);
  const [runId, batchId] = [id(run), id(batch)];
  return <RotoscopeStudio key={runId ?? batchId ?? "new"} initialRunId={runId} initialBatchId={batchId} />;
}
