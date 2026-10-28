import { z } from "zod";
import { AppError, errorResponse } from "../../../../../../../server/errors";
import { guardUpload, readJsonBody } from "../../../../../../../server/guard";
import { currentUser } from "../../../../../../../server/auth/users";
import { livingToEditor } from "../../../../../../../server/animation/living-pictures";
import { assertFlipbookEnabled } from "../../../../../../../server/animation/store";

type Context = { params: Promise<{ id: string }> };

const BodySchema = z.object({ key: z.string().regex(/^[a-f0-9]{16}$/) }).strict();

/** Opens a rendered animation in the video editor; signed in, it is saved as a project. Local work only. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    const parsed = BodySchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_living", 400, "Render the animation first.");
    // A new editor clip is an upload, as when a flipbook is sent there.
    await guardUpload(request);
    const user = await currentUser(request);
    return Response.json(await livingToEditor(id, parsed.data.key, user?.id ?? null), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
