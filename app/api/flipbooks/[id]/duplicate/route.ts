import { currentUser } from "../../../../../server/auth/users";
import { requireFlipbookAccess } from "../../../../../server/animation/access";
import { assertFlipbookEnabled } from "../../../../../server/animation/store";
import { duplicateFlipbook, DuplicateTargetSchema } from "../../../../../server/animation/duplicate";
import { errorResponse, AppError } from "../../../../../server/errors";
import { guardAiRequest, readJsonBody } from "../../../../../server/guard";
import { activeWorkCount } from "../../../../../server/jobs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertFlipbookEnabled();
    const source = await requireFlipbookAccess(request, (await params).id);
    const parsed = DuplicateTargetSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_character", 400, "Choose an illustration or one of your character versions.");
    const user = await currentUser(request);
    await guardAiRequest(request, { activeJobs: activeWorkCount(), estimatedFrames: 0 });
    return Response.json(await duplicateFlipbook(source, parsed.data, user?.id ?? null), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
