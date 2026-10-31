import { afterEach, describe, expect, it } from "vitest";
import { drawFrontView, FRONT_VIEW_INSTRUCTION, frontViewServices } from "./front-view";

const original = frontViewServices.generate;
afterEach(() => {
  frontViewServices.generate = original;
});

describe("front view", () => {
  it("sends the upload as the only reference and asks for a front-on neutral pose", async () => {
    const seen: Parameters<typeof frontViewServices.generate>[0][] = [];
    const drawn = Buffer.from("front");
    frontViewServices.generate = async (input) => {
      seen.push(input);
      return { png: drawn, width: 1, height: 1 };
    };
    const upload = Buffer.from("side");
    expect(await drawFrontView({ png: upload })).toBe(drawn);
    expect(seen).toHaveLength(1);
    expect(seen[0].references).toHaveLength(1);
    expect(seen[0].references[0].png).toBe(upload);
    expect(seen[0].references[0].role).toContain("NOT its pose or camera angle");
    expect(seen[0].prompt).toContain(FRONT_VIEW_INSTRUCTION);
    expect(seen[0].size).toBe("1024x1536");
    expect(seen[0].action).toBeUndefined();
  });

  it("lets a failed redraw reach the caller so it can keep the upload", async () => {
    frontViewServices.generate = async () => {
      throw new Error("blocked");
    };
    await expect(drawFrontView({ png: Buffer.from("x") })).rejects.toThrow("blocked");
  });
});
