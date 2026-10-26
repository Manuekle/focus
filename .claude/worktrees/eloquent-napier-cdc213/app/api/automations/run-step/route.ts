import { listAutomations } from "@/lib/business-store";
import { runAutomationSteps } from "@/lib/automation-runner";
import { getStepAt, type StepPath } from "@/lib/workflow-tree";
import { type NextRequest, NextResponse } from "next/server";
import { apiError, missingField, withApiErrors } from "@/lib/api-error";

/**
 * Run a single saved step, for the canvas's per-node "run" action.
 *
 * The body addresses a step by automation id + tree path rather than sending
 * the step itself: a step is allowed to fetch a URL or post to a webhook, so
 * accepting one off the wire would let any caller aim this endpoint wherever
 * it liked. Resolving from storage means only steps the user already saved
 * can run.
 */
export const POST = withApiErrors(async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json");
  }
  if (!body || typeof body !== "object") {
    return apiError("invalid_body");
  }
  const { id, path } = body as { id?: unknown; path?: unknown };
  if (typeof id !== "string") return missingField("id");
  if (!Array.isArray(path) || path.length === 0) {
    return missingField("path");
  }
  const validPath = path.every(
    (seg) => (typeof seg === "number" && Number.isInteger(seg) && seg >= 0) || seg === "then" || seg === "else",
  );
  if (!validPath) return apiError("invalid_field", { field: "path" });

  const automation = (await listAutomations()).find((a) => a.id === id);
  if (!automation) return apiError("not_found");

  let step;
  try {
    step = getStepAt(automation.steps ?? [], path as StepPath);
  } catch {
    return apiError("not_found");
  }
  if (!step) return apiError("not_found");

  const [outcome] = await runAutomationSteps([step], undefined);
  return NextResponse.json({ outcome });
});
