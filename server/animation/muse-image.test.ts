import OpenAI from "openai";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The Muse Image request contract (what is sent, in which order, at which size) and the
// one-generation guarantee, with the provider replaced by a stub: no paid call.

const create = vi.fn();
vi.mock("../ai/usage", () => ({ recordUsage: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../ai/meta", async (original) => {
  const actual = await original<typeof import("../ai/meta")>();
  const config = { apiKey: "test", baseUrl: "https://example.test/v1", imageModel: "muse-image-1.0", plannerModel: "muse-spark" };
  return { ...actual, requireMetaConfig: () => config, readMetaConfig: () => config, metaClient: () => ({ responses: { create } }) };
});

const { generateImage, imageRequestBody } = await import("./muse-image");

const solid = (width: number, height: number, alpha = 1) => sharp({ create: { width, height, channels: 4, background: { r: 200, g: 40, b: 90, alpha } } }).png().toBuffer();
const decode = (url: string) => Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
type Content = { type: string; text?: string; image_url?: string };
/** The error a call ends with, as a plain object of its fields (null when it succeeds). */
async function failureOf(call: Promise<unknown>): Promise<Record<string, unknown> | null> {
  try {
    await call;
    return null;
  } catch (error) {
    return { ...(error as object), message: (error as Error).message };
  }
}

describe("Muse Image request", () => {
  it("labels and sends every reference in order, then the prompt; tools locked down", async () => {
    const [a, b, c] = await Promise.all([solid(600, 800), solid(400, 400), solid(300, 200)]);
    const body = await imageRequestBody({ prompt: "Draw it.", references: [{ png: a, role: "THE CHARACTER." }, { png: b, role: "THE POSE." }, { png: c, role: "THE VIDEO FRAME.", label: "Image Z" }], size: "1024x1536" }, "muse-image-1.0") as unknown as { model: string; store: boolean; input: { content: Content[] }[]; tools: Record<string, unknown>[] };
    const content = body.input[0].content;
    expect(content.map((part) => part.type)).toEqual(["input_text", "input_image", "input_text", "input_image", "input_text", "input_image", "input_text"]);
    expect(content.filter((part) => part.type === "input_text").map((part) => part.text)).toEqual(["Image 1: THE CHARACTER.", "Image 2: THE POSE.", "Image Z: THE VIDEO FRAME.", "Draw it."]);
    // Small references travel byte for byte, as PNG data URLs.
    const images = content.filter((part) => part.type === "input_image").map((part) => part.image_url!);
    expect(images.every((url) => url.startsWith("data:image/png;base64,"))).toBe(true);
    expect(decode(images[0]).equals(a)).toBe(true);
    expect(body).toMatchObject({ model: "muse-image-1.0", store: false });
    expect(body.tools).toEqual([{ type: "image_generation", size: "1024x1536", output_format: "png", reasoning_strength: "high", enable_image_search: false, enable_web_search: false, enable_shell: false }]);
  });

  it("shrinks a reference over 1024 px to 1024 on its long side, keeping its aspect and its transparency", async () => {
    const big = await solid(1600, 2400, 0.5);
    const body = await imageRequestBody({ prompt: "p", references: [{ png: big, role: "THE CHARACTER." }] }, "m") as unknown as { input: { content: Content[] }[]; tools: Record<string, unknown>[] };
    const sent = decode(body.input[0].content[1].image_url!);
    const meta = await sharp(sent).metadata();
    expect([meta.width, meta.height]).toEqual([683, 1024]);
    expect(meta.hasAlpha).toBe(true);
    // No size given and an edit: the tool keeps Image 1's aspect.
    expect(body.tools[0]).not.toHaveProperty("size");
  });
});

describe("Muse Image call", () => {
  beforeEach(() => { create.mockReset(); });
  // A dropped connection: the transient failure withRetry retries (a timeout is one of these).
  const transient = () => new OpenAI.APIConnectionError({ message: "connection dropped" });

  it("attempts: 1 makes exactly one request even after a transient error: at most one generation", async () => {
    create.mockImplementation(async () => { throw transient(); });
    expect(await failureOf(generateImage({ prompt: "p", references: [], attempts: 1 }))).toMatchObject({ code: "meta_unreachable" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("by default one transient error is retried once (two requests at most)", async () => {
    create.mockImplementation(async () => { throw transient(); });
    expect(await failureOf(generateImage({ prompt: "p", references: [] }))).toMatchObject({ code: "meta_unreachable" });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("returns the provider's bytes untouched beside the converted PNG, with the response's metadata", async () => {
    const returned = await sharp({ create: { width: 64, height: 96, channels: 3, background: "#336699" } }).jpeg().toBuffer();
    create.mockResolvedValue({ id: "resp_1", status: "completed", model: "muse-image-1.0", usage: { input_tokens: 1200, output_tokens: 4000 }, output: [{ type: "image_generation_call", result: returned.toString("base64") }] });
    const image = await generateImage({ prompt: "p", references: [], attempts: 1 });
    expect(image.raw!.equals(returned)).toBe(true);
    expect((await sharp(image.png).metadata()).format).toBe("png");
    expect(image.response).toMatchObject({ id: "resp_1", status: "completed", usage: { inputTokens: 1200, outputTokens: 4000 }, requests: 1 });
  });

  it("a response without a drawing is an API failure, not a drawing to judge", async () => {
    create.mockResolvedValue({ id: "resp_2", status: "incomplete", output: [{ type: "image_generation_call", status: "failed" }] });
    await expect(generateImage({ prompt: "p", references: [], attempts: 1 })).rejects.toMatchObject({ code: "image_incomplete" });
  });
});
