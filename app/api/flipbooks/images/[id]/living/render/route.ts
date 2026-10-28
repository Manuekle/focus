import { LivingRequestSchema } from "../../../../../../../shared/living";
import { AppError, errorResponse } from "../../../../../../../server/errors";
import { guardRender, readJsonBody } from "../../../../../../../server/guard";
import { renderLiving } from "../../../../../../../server/animation/living-pictures";
import { assertFlipbookEnabled } from "../../../../../../../server/animation/store";

type Context = { params: Promise<{ id: string }> };

/**
 * Renders the picture in motion as the request says. Local work only; the
 * same request reuses its files. Asked for `application/x-ndjson`, it streams
 * one JSON line per percent of progress, then `{ render }` or `{ error }`;
 * closing the request cancels the render.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    assertFlipbookEnabled();
    const { id } = await params;
    const parsed = LivingRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_living", 400, "Those animation settings aren’t valid.");
    const admit = () => guardRender(request);
    if (!request.headers.get("accept")?.includes("application/x-ndjson")) {
      return Response.json({ render: await renderLiving(id, parsed.data, request.signal, admit) }, { headers: { "Cache-Control": "no-store" } });
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (value: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
        let percent = -1;
        try {
          const render = await renderLiving(id, parsed.data, request.signal, admit, (fraction) => {
            const next = Math.floor(fraction * 100);
            if (next !== percent) send({ progress: (percent = next) / 100 });
          });
          send({ render });
        } catch (error) {
          if (!request.signal.aborted) send(await errorResponse(error).json());
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
