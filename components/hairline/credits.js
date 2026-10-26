import HL from "../marketing/hairline/kernel.js";
import { hairline } from "../marketing/hairline/define.js";

/** Three piles of rimmed tokens. Picking uses their resting lids, never their moving ones. */
const { Cam, circ, fit, facing, prism, proj, put, ringAt, rings, poly, seg, solid,
  tdone, tset, tval, tween, disposer, mk, pointer, register } = HL;
const PILES = [[-40, 8, 4], [0, -8, 7], [40, 8, 3]], R = 17, STEP = 5.5, THICK = 3.8;

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let lift = value;
  const C = Cam(45, 0.5, 1.9);
  fit(C, [[-64, -34, -7], [64, 34, -7], [64, -34, -7], [-64, 34, -7], [0, -8, 62]], 200, 166);
  const P = proj(C), front = facing(C), g = mk("g", {}, svg);
  put(solid(g), prism(P, front, ...rings(-64, -34, 64, 34, 9, 1.8), -7, -2));
  const piles = PILES.map(([x, y, count], i) => {
    const group = mk("g", {}, g);
    const ring = circ(R, 48).map((p) => ({ ...p, u: p.u + x, v: p.v + y }));
    const inner = circ(R - 1.8, 48).map((p) => ({ ...p, u: p.u + x, v: p.v + y }));
    const coins = Array.from({ length: count }, () => solid(group));
    const rim = mk("path", { class: "nf lo" }, group);
    const draw = (offset) => {
      coins.forEach((coin, k) => put(coin, prism(P, front, ring, inner, k * STEP + offset, k * STEP + THICK + offset)));
      const z = (count - 1) * STEP + THICK + offset;
      const inset = circ(R - 5, 48).map((p) => ({ ...p, u: p.u + x, v: p.v + y }));
      rim.setAttribute("d", poly(ringAt(P, inset, z)) + seg(P(x - 3, y - R + 3, z), P(x + 3, y - R + 3, z)));
    };
    return { i, coins, draw, top: (count - 1) * STEP + THICK, centre: P(x, y, (count - 1) * STEP + THICK), out: tween(0), drawn: NaN };
  });
  // Back to front: the middle pile is the furthest one.
  g.append(piles[1].coins[0].g.parentNode, piles[0].coins[0].g.parentNode, piles[2].coins[0].g.parentNode);
  const B = register(stage, (_dt, now) => {
    let moving = false;
    for (const pile of piles) {
      const v = tval(pile.out, now);
      if (v !== pile.drawn) { pile.drawn = v; pile.draw(v * lift); }
      if (!tdone(pile.out, now)) moving = true;
    }
    return moving;
  });
  bag.add(B.unregister);
  let active;
  function choose(index) {
    if (index === active) return;
    const from = index ?? active ?? 1, now = performance.now();
    active = index;
    for (const pile of piles) {
      const distance = index == null ? 0 : Math.abs(pile.i - index);
      tset(pile.out, index == null ? 0 : 1 / (1 + distance * 3), now, Math.abs(pile.i - from) * 40);
      pile.coins.at(-1).sil.classList.toggle("hi", pile.i === (index ?? 1));
    }
    read.textContent = index == null ? "rest" : `pila ${index + 1}`;
    B.wake();
  }
  function hit([x, y]) {
    let best = null, distance = 64;
    for (const pile of piles) {
      const d = Math.hypot(x - pile.centre[0], y - pile.centre[1]);
      if (d < distance) { distance = d; best = pile.i; }
    }
    return best;
  }
  choose(null);
  bag.add(pointer(stage, { move: (p) => choose(hit(p)), leave: () => choose(null) }));
  bag.add(() => svg.replaceChildren());
  return { set: (v) => { lift = v; piles.forEach((p) => { p.drawn = NaN; }); B.wake(); }, destroy: bag.dispose };
}

export default hairline({
  name: "credits",
  means: "Tres pilas de fichas: la elegida se eleva y sus vecinas la acompañan con un movimiento menor.",
  rules: [1, 2, 4, 5, 7, 9],
  range: [10, 16, 22],
  mount,
});
