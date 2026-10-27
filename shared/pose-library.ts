import { z } from "zod";
import imageIds from "./pose-ids.json";

export const POSE_GALLERY_URL = "https://ai-pose-gallery.pages.dev/";

// All 1,439 known image identifiers. Names, categories and matching stay in
// the server catalog; no gallery images or selection UI reach the client.
export const PoseIdSchema = z.enum(imageIds);
export type PoseId = z.infer<typeof PoseIdSchema>;
