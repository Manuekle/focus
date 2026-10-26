/** Motion shared by the landing's Anatomy figures. */

export type Motion = { x: number; v: number };

/** How near its target, in world units (and units a second), a settle counts as arrived. */
const REST = 5e-3;

/**
 * A critically damped settle: arrives without overshoot, velocity
 * continuous. `seconds` is the time constant. True while still moving; under
 * reduced motion it lands at once.
 */
export function settle(state: Motion, target: number, dt: number, seconds: number, calm: boolean) {
  if (calm) {
    state.x = target;
    state.v = 0;
    return false;
  }
  const w = 1 / seconds;
  const slice = dt / 4;
  for (let step = 0; step < 4; step++) {
    state.v += (w * w * (target - state.x) - 2 * w * state.v) * slice;
    state.x += state.v * slice;
  }
  // Within a fiftieth of a pixel it has arrived: chasing the last thousandths
  // kept a figure's loop running seconds after anything visibly moved.
  if (Math.abs(target - state.x) < REST && Math.abs(state.v) < REST) {
    state.x = target;
    state.v = 0;
    return false;
  }
  return true;
}

/**
 * Keeps a figure's loop asleep while nothing on it moves: `for(seconds,
 * slept)` lets the loop stop now and wakes it `seconds` later, after handing
 * the time it slept to `slept` (so the tour's clock lands on its next event).
 * A figure that is out of view when the time comes keeps its clock but is not
 * woken; coming back into view wakes it as usual.
 */
export class Nap {
  private timer = 0;

  constructor(private readonly wake: () => void) {}

  for(seconds: number, slept: (seconds: number) => void) {
    this.cancel();
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      slept(seconds);
      this.wake();
    }, seconds * 1000);
  }

  cancel() {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = 0;
  }
}
