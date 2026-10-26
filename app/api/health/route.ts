import { healthReport } from "../../../server/health";

/** 200 when FFmpeg, FFprobe and storage work; 503 otherwise. Safe to expose. */
export async function GET() {
  const report = await healthReport();
  return Response.json(report, { status: report.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
