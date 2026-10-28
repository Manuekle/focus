import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFlipbook } from "./store";
import { currentUser } from "../auth/users";
import { requireFlipbookAccess } from "./access";

vi.mock("./store", () => ({ getFlipbook: vi.fn() }));
vi.mock("../auth/users", () => ({ currentUser: vi.fn() }));

const ownerId = randomUUID();
const id = randomUUID();
const request = new Request("http://localhost/api/flipbooks/test");
beforeEach(() => { vi.mocked(currentUser).mockResolvedValue(null); });

describe("private character-derived animations", () => {
  it("allows the owning account and denies anonymous or other-account access", async () => {
    const saved = { id, ownerId, cast: [], characterSource: { characterId: randomUUID(), versionId: "v-123456789abc", name: "Elf-chan", versionName: "Winter" } } as unknown as Awaited<ReturnType<typeof getFlipbook>>;
    vi.mocked(getFlipbook).mockResolvedValue(saved);
    await expect(requireFlipbookAccess(request, id)).rejects.toMatchObject({ code: "flipbook_not_found" });
    vi.mocked(currentUser).mockResolvedValue({ id: randomUUID() } as NonNullable<Awaited<ReturnType<typeof currentUser>>>);
    await expect(requireFlipbookAccess(request, id)).rejects.toMatchObject({ code: "flipbook_not_found" });
    vi.mocked(currentUser).mockResolvedValue({ id: ownerId } as NonNullable<Awaited<ReturnType<typeof currentUser>>>);
    expect(await requireFlipbookAccess(request, id)).toBe(saved);
  });
  it("retains the existing anonymous-upload workflow", async () => {
    const legacy = { id, ownerId: null, cast: [] } as unknown as Awaited<ReturnType<typeof getFlipbook>>;
    vi.mocked(getFlipbook).mockResolvedValue(legacy);
    expect(await requireFlipbookAccess(request, id)).toBe(legacy);
  });
  it("keeps a scene of several saved characters private to its owner", async () => {
    const member = { characterId: randomUUID(), versionId: "v-123456789abc", name: "Elf-chan", versionName: "Winter", analysis: null };
    const scene = { id, ownerId, cast: [member, { ...member, characterId: randomUUID(), name: "Robo" }] } as unknown as Awaited<ReturnType<typeof getFlipbook>>;
    vi.mocked(getFlipbook).mockResolvedValue(scene);
    await expect(requireFlipbookAccess(request, id)).rejects.toMatchObject({ code: "flipbook_not_found" });
    vi.mocked(currentUser).mockResolvedValue({ id: randomUUID() } as NonNullable<Awaited<ReturnType<typeof currentUser>>>);
    await expect(requireFlipbookAccess(request, id)).rejects.toMatchObject({ code: "flipbook_not_found" });
    vi.mocked(currentUser).mockResolvedValue({ id: ownerId } as NonNullable<Awaited<ReturnType<typeof currentUser>>>);
    expect(await requireFlipbookAccess(request, id)).toBe(scene);
  });
});
