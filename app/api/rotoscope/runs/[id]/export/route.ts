import { errorResponse } from "../../../../../../server/errors";
import { requireUser } from "../../../../../../server/auth/require";
import { assertRotoscopeEnabled, exportZip } from "../../../../../../server/rotoscope/service";

type Context = { params: Promise<{ id: string }> };

/** The approved frames as transparent PNGs in one ZIP. */
export async function GET(request: Request, { params }: Context) {
  try {
    assertRotoscopeEnabled();
    const user = await requireUser(request);
    const { data, name } = await exportZip((await params).id, user.id);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
