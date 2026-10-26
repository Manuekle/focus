export const CELL = 16;
export const FLIGHT = 620;
export const STAGGER = 700;
export const TOTAL = FLIGHT + STAGGER;
export const FADE = 200;
export const EXIT_SPEED = 1.7;
const INK = "#141416";
const BG = "#FCFCFC";

export function isQrMatrix(value: unknown): value is boolean[][] {
  return Array.isArray(value) && value.length >= 21 && value.length <= 177 &&
    (value.length - 21) % 4 === 0 && value.every((row) =>
      Array.isArray(row) && row.length === value.length &&
      row.every((cell) => typeof cell === "boolean"),
    );
}

export function createQrScene(modules: boolean[][]) {
  // Version 1 uses the reference's 460px stage. Larger URLs need more modules,
  // with a full four-module quiet zone; never crop them to a demo's 21x21.
  const origin = modules.length === 21 ? 62 : CELL * 4;
  const stage = modules.length * CELL + origin * 2;
  const marks = [];
  let nearest = Infinity;
  let farthest = 0;

  for (let row = 0; row < modules.length; row++) {
    for (let column = 0; column < modules.length; column++) {
      if (!modules[row][column]) continue;
      const x = origin + column * CELL;
      const y = origin + row * CELL;
      const dx = x + CELL / 2 - stage / 2;
      const dy = y + CELL / 2 - stage;
      const distance = Math.hypot(dx, dy);
      nearest = Math.min(nearest, distance);
      farthest = Math.max(farthest, distance);
      marks.push({ x, y, dx, dy, distance, angle: Math.atan2(dy, dx), start: 0 });
    }
  }
  for (const mark of marks) {
    mark.start = ((mark.distance - nearest) / (farthest - nearest || 1)) * STAGGER;
  }
  return { stage, marks };
}

export type QrScene = ReturnType<typeof createQrScene>;

export function advanceQrClock(clock: number, elapsed: number, open: boolean, reduced: boolean) {
  const duration = reduced ? FADE : TOTAL;
  // Reduced motion always uses a 200ms fade in either direction.
  const speed = open || reduced ? 1 : EXIT_SPEED;
  return Math.max(0, Math.min(duration, clock + (open ? 1 : -1) * elapsed * speed));
}

export function drawQrFrame(
  ctx: CanvasRenderingContext2D,
  scene: QrScene,
  clock: number,
  reduced: boolean,
) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, scene.stage, scene.stage);
  ctx.fillStyle = INK;

  if (reduced) {
    ctx.globalAlpha = Math.max(0, Math.min(1, clock / FADE));
    for (const mark of scene.marks) ctx.fillRect(mark.x, mark.y, CELL, CELL);
  } else {
    for (const mark of scene.marks) {
      const t = Math.max(0, Math.min(1, (clock - mark.start) / FLIGHT));
      if (t <= 0) continue;
      if (t === 1) {
        ctx.fillRect(mark.x, mark.y, CELL, CELL);
        continue;
      }
      const remaining = (1 - t) ** 5;
      const eased = 1 - remaining;
      const velocity = (1 - t) ** 4;
      const length = CELL * (1 + 1.8 * velocity);
      const width = CELL * (1 - 0.7 * velocity);
      ctx.save();
      ctx.translate(scene.stage / 2 + mark.dx * eased, scene.stage + mark.dy * eased);
      // Follow the flight, then settle square without snapping at touchdown.
      ctx.rotate(mark.angle * (1 - eased ** 8));
      ctx.globalAlpha = 0.25 + 0.75 * eased;
      ctx.fillRect(-length / 2, -width / 2, length, width);
      ctx.restore();
    }
  }
  ctx.restore();
}
