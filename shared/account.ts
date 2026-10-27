import { z } from "zod";
import { VideoAssetSchema, EditJobSchema, EffectIdSchema } from "./schemas";

// Accounts, free-use quota and saved projects. Shared by the API routes and
// the editor; everything crossing the network is parsed with these schemas.

export const UserSchema = z.object({
  id: z.uuid(),
  provider: z.literal("facebook"),
  /** Facebook's app-scoped user id, or "sim-…" for the local simulated login. */
  providerId: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  avatarUrl: z.url().nullable(),
  email: z.email().nullable(),
  /** True for accounts made by the local simulated Facebook login. */
  simulated: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type User = z.infer<typeof UserSchema>;

/** What the browser may know about the signed-in person. */
export const PublicUserSchema = UserSchema.pick({ id: true, name: true, avatarUrl: true, simulated: true });
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const QuotaSchema = z.object({
  /** Free AI edits without an account. */
  limit: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
});
export type Quota = z.infer<typeof QuotaSchema>;

export const SessionInfoSchema = z.object({
  user: PublicUserSchema.nullable(),
  /** Null when signed in: accounts have no free-edit limit. */
  quota: QuotaSchema.nullable(),
  /** "simulated" locally until a Facebook app is configured. */
  authMode: z.enum(["facebook", "simulated"]),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

export const PROJECT_TITLE_MAX = 80;

export const ProjectSchema = z.object({
  id: z.uuid(),
  ownerId: z.uuid(),
  title: z.string().trim().min(1).max(PROJECT_TITLE_MAX),
  videoId: z.uuid(),
  /** Every edit made on this clip, oldest first. */
  jobIds: z.array(z.uuid()).max(200),
  activeJobId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Project = z.infer<typeof ProjectSchema>;

/** A project as the sidebar lists it. */
export const ProjectSummarySchema = ProjectSchema.pick({ id: true, title: true, videoId: true, updatedAt: true, createdAt: true }).extend({
  posterUrl: z.string(),
  edits: z.number().int().nonnegative(),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

/** A project opened in the editor: the clip and every edit, newest first. */
export const ProjectDetailSchema = z.object({
  project: ProjectSchema,
  video: VideoAssetSchema,
  jobs: z.array(EditJobSchema),
});
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;

export const CreateProjectRequestSchema = z.object({ videoId: z.uuid() });
export const UpdateProjectRequestSchema = z.object({
  title: z.string().trim().min(1).max(PROJECT_TITLE_MAX).optional(),
  activeJobId: z.uuid().optional(),
});

/**
 * The hand-off from the home page to the editor, kept in localStorage so it
 * also survives the round trip through Facebook sign-in.
 */
export const EditorDraftSchema = z.object({
  videoId: z.uuid(),
  prompt: z.string().max(500),
  effect: EffectIdSchema,
  /** Start generating as soon as the editor opens (the person pressed Generate). */
  autostart: z.boolean(),
  savedAt: z.number().int().nonnegative(),
});
export type EditorDraft = z.infer<typeof EditorDraftSchema>;
export const EDITOR_DRAFT_KEY = "focus:editor-draft";
/** Older drafts are ignored: the clip behind them has likely expired. */
export const EDITOR_DRAFT_TTL_MS = 6 * 60 * 60 * 1000;

/** Only same-site relative paths may be a post-login destination. */
export function safeNextPath(value: string | null | undefined, fallback = "/editor"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || /[\r\n]/.test(value)) return fallback;
  return value.slice(0, 512);
}
