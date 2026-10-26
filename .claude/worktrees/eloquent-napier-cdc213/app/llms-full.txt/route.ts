import { llmsFullTxt } from "@/lib/llms-txt";

// Built once from the shared marketing copy; no function runs per request.
export const dynamic = "force-static";

export function GET() {
  return new Response(llmsFullTxt(), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
