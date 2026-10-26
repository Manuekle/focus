---
name: app-screens-demo
description: Self-playing app-screen demos for landing pages. Use when animating product mockups with a simulated cursor, typewriter input, streaming answers, scroll reveals, or automation-run figures. Triggers on "animate the screens", "demo loop", "simulated cursor", "typewriter demo", "streaming answer demo", "screen autoplay", "app screens animation", "dev screens motion", "landing mockup plays itself", "automation run figure".
---

# App Screens Demo Motion

Self-playing product screens inside a landing page. Each screen renders the app's real components over fixed demo data, then performs one user flow on a loop: a cursor travels, clicks, types, watches tools run, reads the answer, resets. No video. No screenshots. No React state per frame.

Source of truth in this repo: `app/landing/_components/demo-cursor.tsx`, `screen-chat.tsx`, `screen-chrome.tsx`, `primitives.tsx`, `deferred-screens.tsx`, `deferred-demo.tsx`, `automation-run.tsx`, `lib/hooks/use-animation-active.ts`, `lib/hooks/use-reveal.ts`, `app/globals.css` (`.lp [data-reveal]`, `.lp-veil`).

## Stack

- Next.js + React 19, `gsap` ^3.15, `motion` 12.x, `lenis` ^1.3 (marketing only).
- Cursor, typing, and streaming run on GSAP tweens writing to the DOM. React re-renders only on phase changes (~15 per lap), never per frame.
- Scroll reveals are CSS transitions flipped by one `IntersectionObserver`. Micro-expands (inbox rows) use `motion` springs.

## The four pieces (every demo needs all four)

1. `useDemoLoop(script, live)` — the script. Ordered phases plus hold time per phase. One `setTimeout` at a time. Returns `{ phase, step, cycle }`. `cycle` counts laps; per-lap state (typed text, streams) keys off it. Held at step 0 while `!live`.
2. `useStageLive(stageRef)` / `useAnimationActive(ref)` — the gate. `true` only when on screen (`IntersectionObserver`) + tab visible (`visibilitychange` / `pageshow`) + `!prefers-reduced-motion`. Timer does not run otherwise.
3. `DemoCursor` + `CursorApi` — the hand. One absolutely positioned arrow (`z-50`, `pointer-events-none`), driven through `{ travelTo, press, show }`. See spec below.
4. `useTypewriter` / `useStreamedWords` — arriving text. Writes go straight to the node. See spec below.

## Script pattern

```ts
const SCRIPT = [
  { phase: "rest", ms: 1500 },
  { phase: "reachPicker", ms: 950 },
  { phase: "openPicker", ms: 1100 },
  { phase: "reachModel", ms: 1000 },
  { phase: "pickModel", ms: 620 },
  { phase: "reachInput", ms: 800 },
  { phase: "typing", ms: 2200 },
  { phase: "reachSend", ms: 700 },
  { phase: "send", ms: 480 },
  { phase: "search", ms: 1800 },
  { phase: "handoff", ms: 1900 },
  { phase: "answer", ms: 4200 },
  { phase: "read", ms: 3000 },
  { phase: "reachNew", ms: 1000 },
  { phase: "newChat", ms: 560 },
] as const;
```

Rules:

- Phases come in `reach*` + action pairs. Cursor lands during `reach*`, clicks during the action phase. Never land and click in the same beat — reads as a cut between screenshots.
- `TRAVEL[phase]` (cursor flight time) stays under the phase hold so the pointer stands still when the press fires.
- Long holds where a person reads: answer 3000–4200ms, rest 900–1500ms. Chat lap ≈ 22s; automation-run lap ≈ 10s.
- Derive UI from phase, never duplicate state:

```ts
const step = ORDER.indexOf(shown);
const from = (mark: Phase) => step >= ORDER.indexOf(mark);
const on = (...marks: readonly Phase[]) => marks.includes(shown);
```

- Parked state (`!live`, background tab, reduced motion) shows the most informative still frame — finished conversation / finished run — never the empty state. Add `data-demo={live ? "playing" : "still"}` on the stage so timed animation stays testable from outside React.
- Measure targets in `requestAnimationFrame` after the phase change. Half the targets are mounted by the phase just started; measuring synchronously measures nothing. Phases with no target hold last position.

## Cursor spec (GSAP, exact)

```ts
pointAt(stage, target, bias = { x: 0.42, y: 0.45 }): Point | null
// stage-relative coords from getBoundingClientRect diffs. Returns null on 0x0.
// Default bias is above-left of center. Dead-center reads as pasted icon.
// Composer/caret targets use { x: 0.08, y: 0.3 } (line start).
```

- First `travelTo`: `gsap.set(node, { x, y, opacity: 1 })`. Pointer simply is where the flow starts; no flight in from 0,0.
- Later moves: two tweens, `duration = max(0.28, ms / 1000)`, `overwrite: "auto"`. X uses `power3.inOut`, Y uses `power1.inOut`. Split eases bend the path like a hand; `overwrite` lets an early phase steal the pointer instead of fighting the running tween.
- `press()`: 260ms total timeline. Icon dips to `scale: 0.8` in 50ms (`power3.in`), ring `fromTo scale 0.3 -> 2, opacity 0.85 -> 0` in 260ms (`power2.out`), icon returns in 160ms (`back.out(3)`). `transformOrigin: "0% 0%"` on the glyph so the tip (top-left) stays planted. Center-origin scaling slides the tip off the control and the click reads as missed.
- Ring is its own layer centered on the tip so it grows without moving the cursor.
- One glyph for the whole flow. Never swap arrow/hand shapes by phase.
- `show(visible)`: opacity tween 220ms `power2.out`.

## Text arrival

`useTypewriter(ref, text, { active, done, ms, resetKey })`:

- Uncontrolled field only. Controlled textarea re-renders the whole screen per letter. Write `node.value` directly inside a GSAP `to(state, { count })` tween with `ease: "none"`. `done` sets full text, `!active` clears. Nothing reads this value except pixels.
- Isolate accordingly: mock composers copy markup from the real input but skip its fetch/state (e.g. no `/api/chat/agents` request from a marketing page).

`useStreamedWords(text, { active, done, ms, resetKey })`:

- For content React must render (markdown bubbles). Stream by word, not letter: ~20 renders per answer instead of ~110. Same GSAP counter shape, `setCount` in `onUpdate`.
- Keep the streaming component (`<Answer>`) separate from the screen component so each word re-renders one paragraph, not sidebar + nav + composer + cards.

## Frame and chrome

- `ScreenFrame`: bezel + `BrowserChrome` toolbar + `LightBar` strip light + `.lp-veil` over the bottom. Veil is a sibling of the frame (measures from the frame, not the outer box) with 2 masked `backdrop-blur` layers (`3px` / `14px`) + wash. Two layers, not five: five stacked blurs cost ~47ms/scroll-frame, two cost ~32ms.
- Decorative frames: outer `role="img"` + `aria-label`, inner subtree `inert`. `inert` removes 100+ phantom controls from tab order, a11y tree, and pointer events at once (`pointer-events-none` alone only fixes mouse). Animations keep working — they write to nodes, never dispatch events.
- Operable screens on the page (tabs switch, rows expand) stay labelled groups with a one-line `hint`, not `aria-hidden`.
- `AppChrome`: fixed window height (`h-[38rem]`, `lg:h-[42rem]`), `overflow-hidden`, real `Sidebar` (read `NAV_GROUPS` so new pages appear), `MockTopBar` under `md`, standard page header with actions. Overlays that cover the window in the app (dialog + scrim) mount at window level so the scrim dims the sidebar too.
- Demo scrims: light `bg-black/5 + backdrop-blur 8px`, dark `bg-black/45 + blur 2px`. Full `bg-black/40` inside a small light rectangle reads as a slab, not a dim.
- Replicas over real components when the real one fights the page: `Command`/`cmdk` scrolls rows into view and yanks the page (Lenis smooths the jump into a slide); real dialogs portal to `document.body` and cover the landing. Copy cmdk markup/attributes/classes exactly, drop the store.

## Deferred loading

- `DeferredDemo`: `lazy()` per screen + `IntersectionObserver` (`rootMargin "200px 0px"`, hero threshold `0.1`). Fallback skeleton keeps the exact window height so sections below never shift and anchors hold. Once ready, keep mounted across scrolls.
- Copy stays server-rendered; only the demo subtree defers.

## Scroll reveals

- `useReveal(rootRef)`: one observer for the whole page (`rootMargin "0px 0px -12% 0px"`, `threshold 0.08`). Adds `.is-in` once per `[data-reveal]` node, then unobserves. No re-hide on scroll-up.
- CSS (`.lp [data-reveal]`): `opacity 0 + translate 0 10px` → `opacity 1 + translate 0`. Duration `420ms` (`--lp-reveal-dur`), ease `expo-out` (`--lp-ease-soft`). Stagger siblings with `--lp-d: 60–90ms`. Large surfaces (`lift={false}`) fade without travelling — a 900px screenshot sliding 10px reads as the window slipping.
- Never animate `filter: blur()` in reveals. It forces a filter pass per subtree, creates containing blocks, and reads as generated-page motion.
- Headings: word-by-word `TextReveal` (`stagger 0.045`, `blur 6`, `yOffset 24%`), ~400ms for six words. Body copy uses plain `Reveal`.
- `transitions.dev` effects reused here: `t-text-swap` (exit 150ms, reflow between swap and enter), `t-digit-group/.t-digit` number pop-in (70ms stagger via `animationDelay`), `t-acc` accordion (`grid-template-rows 0fr ↔ 1fr`, padding on inner only, chevron `scaleY(-1)` flip, never `d:` path morph), `t-icon-swap`, `t-shimmer`.
- `motion` springs for expanding rows: `stiffness 300, damping 25, mass 0.8`, `initial={false}`. Reduced motion → `duration: 0`.
- `SmoothScroll` (Lenis) wraps marketing pages only, never working app pages. Falls back to native scrolling under reduced motion.

## Automation-run figure variant

Same loop idea without a cursor: `SEQUENCE` of `{ step, ms }`, `nodeState`/`wireState`/`phaseState` derived from the index, two alternating runs (e.g. client A / client B) sharing one layout cell so wires never move. Wires are SVG paths measured from `offsetLeft/offsetTop` (transform-immune) and re-measured on `ResizeObserver` (fonts, breakpoints). Side-by-side nodes connect edge-to-edge with S-curve control points; stacked nodes connect bottom-to-top. Reduced motion shows the finished run statically.

## Performance bans (all measured, not taste)

- No cursor position in React state. No controlled typing. No per-frame `setState`.
- No pulsing halo under a backdrop veil (60fps → 20fps for an invisible dot).
- No 5-layer veils. No blur-in reveals. No `will-change` on ~45 reveal nodes.
- No real `cmkd`/portal dialogs inside mockups.
- No header `setState` per scroll frame — toggle classes in `requestAnimationFrame`.

## Accessibility

- Decorative mockup: `role="img"` + named label outside, `inert` inside.
- Interactive figure: labelled group + visible hint line.
- Streaming text: `announce={false}` on live regions (per-word re-announce is noise).
- `prefers-reduced-motion`: stop loops, show final state, strip translate/scale/blur, keep opacity. Server + hydration render `false`, real value after mount (avoids hydration mismatch).

## Install into a project

1. Add `gsap`, `motion`, `lenis` (marketing only). Copy the four hooks/components (`useDemoLoop`, `useStageLive`, `DemoCursor`, `useTypewriter`/`useStreamedWords`) into one module.
2. Build one `ScreenFrame` + one `AppChrome` from the app's own `Card`, `Button`, `Tabs`, `FlowCanvas` equivalents. Fixed window height, `inert` + `role="img"` for stills.
3. Write one `SCRIPT` per screen following the product's real order of operations (empty state → action → tools → answer → reset). Keep travel < phase hold. Total lap 10–25s.
4. Wrap each screen in deferred loading with a fixed-height fallback.
5. Add the single-observer reveal system + `--lp-d` staggers. Headings word-by-word, surfaces fade-only.
6. Verify: block the main thread scroll (veil cost), toggle reduced motion (final frame shows), background the tab (timer stops), keyboard-tab through the page (zero phantom stops inside stills).

## Reusable build prompt (paste into another app)

```text
Implement self-playing app-screen demos using the app-screens-demo system.

Stack: Next.js + React 19, gsap 3.15, motion 12.x, Lenis on marketing pages only.

Build these four shared pieces first:
- useDemoLoop(script, live): ordered {phase, ms} script, single setTimeout, returns {phase, step, cycle}; parked at step 0 when !live.
- useStageLive(ref): true only when visible via IntersectionObserver + document visible + motion allowed.
- DemoCursor + CursorApi {travelTo, press, show}: GSAP transforms on a DOM node, never React state. First move gsap.set; later moves split x (power3.inOut) / y (power1.inOut), overwrite auto, min 280ms. Press is a 260ms timeline: icon dip scale 0.8 in 50ms, ring 0.3->2 with fade, icon back with back.out(3), tip-anchored transform origin.
- useTypewriter (direct node.value writes, uncontrolled field) + useStreamedWords (word chunks, isolated component).

Per screen: write a reach*-paired SCRIPT matching the product's real operation order (10-25s lap), derive UI from phase index, park on the finished frame when !live, measure targets in rAF. Frame it in a fixed-height window (38rem, 42rem lg) with browser chrome, strip light, 2-layer bottom veil; decorative frames get role=img + inert inner. Lazy-mount each screen near the viewport with a fixed-height skeleton fallback.

Page motion: one IntersectionObserver adding .is-in to [data-reveal] once; CSS opacity + 10px rise over 420ms expo-out, 60-90ms staggers, fade-only for large surfaces; word-by-word headings (45ms stagger, 6px blur). Respect prefers-reduced-motion by showing final state. Never put cursor position in state, never type into controlled inputs, never animate backdrop blur, never mount cmdk/portaled dialogs inside mockups.
```
