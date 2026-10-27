import { errorResponse } from "../../../../../server/errors";
import { guardUpload } from "../../../../../server/guard";
import { declaredLength, paidGate } from "../../../../../server/animation/http";
import { addExtraReference, changeReference, removeExtraReference } from "../../../../../server/animation/flipbooks";
import { readUpload } from "../../../../../server/animation/image-input";
import { assertFlipbookEnabled } from "../../../../../server/animation/store";

type Context = { params: Promise<{ id: string }> };

const noStore = { headers: { "Cache-Control": "no-store" } };

/** Uses an uploaded image as the character reference for new drawings. */
export async function PUT(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    guardUpload(request);
    const { id } = await params;
    const upload = await readUpload(request.body, declaredLength(request));
    const flipbook = await changeReference(id, "uploaded", { upload }, paidGate(request));
    return Response.json(flipbook, noStore);
  } catch (error) {
    return errorResponse(error);
  }
}

/** Adds one more image of the same character (another angle, hidden details) beside the reference. */
export async function POST(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    guardUpload(request);
    const { id } = await params;
    let name = "";
    try {
      name = decodeURIComponent(request.headers.get("x-focus-filename") ?? "").trim();
    } catch {
      // A name that doesn't decode is only a label: the bytes are what is checked.
    }
    const flipbook = await addExtraReference(id, request.body, declaredLength(request), name || "Reference");
    return Response.json(flipbook, noStore);
  } catch (error) {
    return errorResponse(error);
  }
}

/** Removes an extra reference (`?v=` names its version). */
export async function DELETE(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    const flipbook = await removeExtraReference(id, new URL(request.url).searchParams.get("v") ?? "");
    return Response.json(flipbook, noStore);
  } catch (error) {
    return errorResponse(error);
  }
}
