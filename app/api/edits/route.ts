import { EditRequestSchema } from "../../../shared/schemas";
import { AppError, errorResponse } from "../../../server/errors";
import { getVideo } from "../../../server/videos";

// The request contract is final; the processing pipeline arrives in Phase 2.
// Until then this route validates the edit and answers honestly instead of
// returning an invented result.
export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => {
      throw new AppError("invalid_json", 400, "No pudimos leer la solicitud.");
    });
    const parsed = EditRequestSchema.safeParse(json);
    if (!parsed.success) {
      throw new AppError("invalid_edit", 400, "Describe el cambio con al menos 3 caracteres y elige un efecto.");
    }
    await getVideo(parsed.data.videoId);
    throw new AppError(
      "processing_unavailable",
      501,
      "La edición con Meta AI todavía no está conectada en esta versión. Tu video y tu instrucción están listos; el procesamiento llega en la siguiente fase.",
    );
  } catch (error) {
    return errorResponse(error);
  }
}
