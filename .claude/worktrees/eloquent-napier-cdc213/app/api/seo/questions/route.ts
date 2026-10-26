import { NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-error";
import { featureGate } from "@/lib/features-gate";
import { siteQuestionsReport } from "@/lib/site-questions";

export const dynamic = "force-dynamic";
// Reading a 30-page site four pages at a time, then 150 questions in eight
// Jev requests three at a time: seconds normally, a minute on a slow site.
export const maxDuration = 120;

// GET  /api/seo/questions — the customer questions the site does not answer,
//      from what is already stored. Spends nothing.
// POST /api/seo/questions — reads the site when it is not on file and asks
//      Jev about the questions that have no match yet.

export const GET = withApiErrors(async function GET() {
  const off = await featureGate("seo.questions");
  if (off) return off;
  return NextResponse.json(await siteQuestionsReport());
});

export const POST = withApiErrors(async function POST() {
  const off = await featureGate("seo.questions");
  if (off) return off;
  return NextResponse.json(await siteQuestionsReport({ analyze: true }));
});
