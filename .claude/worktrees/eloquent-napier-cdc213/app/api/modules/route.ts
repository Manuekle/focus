import { type NextRequest, NextResponse } from "next/server";
import { apiError, withApiErrors } from "@/lib/api-error";
import { isModuleId } from "@/lib/modules";
import { getModuleState, saveEnabledModules, setModuleEnabled } from "@/lib/modules-store";

// Which modules this business shows (lib/modules.ts). Read by the sidebar,
// written by onboarding, the "Personalizar menú" dialog and the gate a
// switched-off page shows.

export const GET = withApiErrors(async function GET() {
  return NextResponse.json(await getModuleState());
});

/** `{ enabled: string[] }` replaces the choice; `{ id, on }` flips one module. */
export const PUT = withApiErrors(async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (Array.isArray(body?.enabled)) {
    if (!body.enabled.every(isModuleId)) return apiError("invalid_field", { field: "enabled" });
    return NextResponse.json(await saveEnabledModules(body.enabled));
  }
  if (isModuleId(body?.id) && typeof body?.on === "boolean") {
    return NextResponse.json(await setModuleEnabled(body.id, body.on));
  }
  return apiError("invalid_field", { field: "enabled" });
});
