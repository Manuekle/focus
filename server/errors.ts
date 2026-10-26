import type { ApiErrorBody } from "../shared/schemas";

/** A failure the user can act on. `message` is shown as-is in the editor. */
export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    const body: ApiErrorBody = {
      error: { code: error.code, message: error.message, ...(error.detail ? { detail: error.detail } : {}) },
    };
    return Response.json(body, { status: error.status });
  }
  console.error("[focus] unexpected error", error);
  const body: ApiErrorBody = {
    error: { code: "internal_error", message: "Algo falló en el servidor. Vuelve a intentarlo en unos segundos." },
  };
  return Response.json(body, { status: 500 });
}
