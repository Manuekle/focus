import { expect, it, vi } from "vitest";
import { shareRender } from "./render-tasks";

it("shares one render and one allowance slot across subscribers", async () => {
  let finish!: (value: number) => void;
  const work = vi.fn(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
  );
  const allowance = vi.fn();
  const first = shareRender("dedup", work, { beforeStart: allowance });
  const second = shareRender("dedup", work, { beforeStart: allowance });
  await Promise.resolve();
  finish(60);
  expect(await Promise.all([first, second])).toEqual([60, 60]);
  expect(work).toHaveBeenCalledTimes(1);
  expect(allowance).toHaveBeenCalledTimes(1);
});

it("does not cancel another subscriber's export when a preview disconnects", async () => {
  let finish!: () => void;
  let running!: AbortSignal;
  const firstClient = new AbortController();
  const work = (signal: AbortSignal) => {
    running = signal;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  };
  const first = shareRender("keep-subscriber", work, {
    signal: firstClient.signal,
  });
  const second = shareRender("keep-subscriber", work);
  await Promise.resolve();
  firstClient.abort();
  await expect(first).rejects.toMatchObject({ code: "canceled" });
  expect(running.aborted).toBe(false);
  finish();
  await second;
});

it("kills a render after its last subscriber disconnects and allows retry", async () => {
  const client = new AbortController();
  let running!: AbortSignal;
  const first = shareRender(
    "cancel",
    (signal) => {
      running = signal;
      return new Promise<void>((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      });
    },
    { signal: client.signal },
  );
  await Promise.resolve();
  client.abort();
  await expect(first).rejects.toMatchObject({ code: "canceled" });
  expect(running.aborted).toBe(true);
  expect(await shareRender("cancel", async () => 42)).toBe(42);
});

it("does not run work when the allowance rejects it", async () => {
  const work = vi.fn();
  await expect(
    shareRender("limited", work, {
      beforeStart: () => {
        throw new Error("limit");
      },
    }),
  ).rejects.toThrow("limit");
  expect(work).not.toHaveBeenCalled();
});
