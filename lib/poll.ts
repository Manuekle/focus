// While the tab is hidden nobody sees a progress update, so a status poll waits:
// it runs again as soon as the tab comes back, or after this long at most.
const HIDDEN_MS = 30_000;

const hidden = () => typeof document !== "undefined" && document.hidden;

/** `setTimeout` for a status poll that goes quiet while the tab is hidden. Returns a cancel. */
export function pollAfter(run: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", wake);
  };
  const fire = () => {
    stop();
    run();
  };
  function wake() {
    if (hidden()) return;
    clearTimeout(timer);
    timer = setTimeout(fire, Math.min(ms, 250));
  }
  if (hidden()) {
    timer = setTimeout(fire, HIDDEN_MS);
    document.addEventListener("visibilitychange", wake);
  } else timer = setTimeout(fire, ms);
  return stop;
}

/** For `setInterval` polls: true while the tab is hidden, so the tick can skip its request. */
export const pageHidden = hidden;
