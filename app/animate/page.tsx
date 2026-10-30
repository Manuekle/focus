import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { referenceMotionEnabled } from "../../shared/features";
import { ReferenceMotionStudio } from "./reference-motion-studio";

export const metadata: Metadata = {
  title: "Reference Motion · Focus",
  description: "Make a character follow the movement of a video.",
};

type Props = { searchParams: Promise<{ job?: string | string[] }> };

export default async function Page({ searchParams }: Props) {
  if (!referenceMotionEnabled()) notFound();
  const { job } = await searchParams;
  const jobId = typeof job === "string" && /^[0-9a-f-]{36}$/.test(job) ? job : null;
  return <ReferenceMotionStudio key={jobId ?? "new"} initialJobId={jobId} />;
}
