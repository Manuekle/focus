import type { User } from "../../shared/account";
import { AppError } from "../errors";
import { currentUser } from "./users";

export async function requireUser(request: Request): Promise<User> {
  const user = await currentUser(request);
  if (!user) throw new AppError("login_required", 401, "Sign in with Facebook to view and save your projects.");
  return user;
}
