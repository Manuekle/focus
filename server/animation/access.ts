import { currentUser } from "../auth/users";
import { AppError } from "../errors";
import { getFlipbook } from "./store";

/** Legacy anonymous animations keep their capability URLs. Character-derived
 * animations, and scenes made of several saved characters, are private,
 * including their copied references and exports. */
export async function requireFlipbookAccess(request: Request, id: string) {
  const flipbook = await getFlipbook(id);
  if (flipbook.characterSource || flipbook.cast.length) {
    const user = await currentUser(request);
    if (!user || user.id !== flipbook.ownerId)
      throw new AppError(
        "flipbook_not_found",
        404,
        "This animation doesn’t exist.",
      );
  }
  return flipbook;
}
