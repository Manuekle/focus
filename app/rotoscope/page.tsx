import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { rotoscopeEnabled } from "../../shared/features";
import { RotoscopeStudio } from "./rotoscope-studio";
import { RotoscopeTest } from "./rotoscope-test";

export const metadata: Metadata = {
  title: "Rotoscope · Focus",
  description: "Redraw a video frame by frame with your character.",
};

type Props = { searchParams: Promise<{ run?: string | string[]; batch?: string | string[]; test?: string | string[] }> };

export default async function Page({ searchParams }: Props) {
  if (!rotoscopeEnabled()) notFound();
  const { run, batch, test } = await searchParams;
  // ?test=<anything>: the prompt test page, one drawing from any frame and character.
  if (test !== undefined) return <RotoscopeTest />;
  const id = (value: string | string[] | undefined) => (typeof value === "string" && /^[0-9a-f-]{36}$/.test(value) ? value : null);
  const [runId, batchId] = [id(run), id(batch)];
  return <RotoscopeStudio key={runId ?? batchId ?? "new"} initialRunId={runId} initialBatchId={batchId} />;
}
