import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { characterUser } from "./http";

vi.mock("../auth/require", () => ({ requireUser: async () => ({ id: "owner" }) }));
vi.mock("../animation/store", () => ({ assertFlipbookEnabled: () => undefined }));

beforeEach(() => {
  vi.stubEnv("FOCUS_PUBLIC_URL", "https://focusmeta.up.railway.app/");
  vi.stubEnv("FOCUS_TRUST_PROXY", "0");
});
afterEach(() => vi.unstubAllEnvs());

function request(origin: string, headers: Record<string, string> = {}, method = "POST") {
  return new Request("http://localhost:3000/api/characters", {
    method,
    headers: { origin, host: "focusmeta.up.railway.app", "x-forwarded-proto": "https", ...headers },
  });
}

describe("character request origin", () => {
  it.each(["POST", "PATCH", "DELETE"])("accepts %s from the configured HTTPS origin behind Railway without trusting IP headers", async (method) => {
    await expect(characterUser(request("https://focusmeta.up.railway.app", {}, method))).resolves.toEqual({ id: "owner" });
  });
  it("rejects an external origin even when Host and proxy headers are spoofed", async () => {
    await expect(characterUser(request("https://other.example", { host: "other.example", "x-forwarded-host": "other.example" }))).rejects.toMatchObject({ code: "invalid_origin", status: 403 });
  });
  it("keeps the normal development-origin check when no public URL is configured", async () => {
    vi.stubEnv("FOCUS_PUBLIC_URL", "");
    await expect(characterUser(request("http://127.0.0.1:3200", { host: "127.0.0.1:3200" }))).resolves.toEqual({ id: "owner" });
    await expect(characterUser(request("https://other.example"))).rejects.toMatchObject({ code: "invalid_origin" });
  });
});
