import HL from "../marketing/hairline/kernel.js";
import { hairline } from "../marketing/hairline/define.js";

/** Open paper trays, with a floor, three raised walls, a lowered lip and an inset finger pull. */
const { Cam, fit, facing, prism, proj, put, rings, ringAt, poly, seg, solid,
  tdone, tset, tval, tween, disposer, mk, pointer, register } = HL;
const W = 88, D = 66, GAP = 30, REST = [17, 5, 0];

function mount({ stage, svg, read, empty = false }, value) {
  const bag = disposer();
  let travel = value;
  const C = Cam(45, 0.5, 1.9);
  fit(C, [[-5, -7, -6], [93, 109, -6], [93, -7, -6], [-5, 109, -6], [0, 0, 85]], 200, 166);
  const P = proj(C), front = facing(C), g = mk("g", {}, svg);
  put(solid(g), prism(P, front, ...rings(-5, -7, 93, 91, 8, 1.6), -6, -1));
  // Rear uprights are painted first, so the trays in front hide them.
  for (const x of [3, W - 9]) put(solid(g), prism(P, front, ...rings(x, -3, x + 6, 4, 2, 0.7), 0, 80));
  const trays = [0, 1, 2].map((i) => {
    const z = i * GAP, group = mk("g", {}, g);
    const floor = solid(group), back = solid(group), left = solid(group), right = solid(group);
    const sheet = empty ? null : solid(group), lines = empty ? null : mk("path", { class: "nf lo" }, group);
    const lip = solid(group), pull = mk("path", { class: "nf lo" }, group);
    function draw(slide) {
      const y = REST[i] + slide * travel;
      const slab = (el, x0, y0, x1, y1, r, bottom, top) => put(el, prism(P, front, ...rings(x0, y0 + y, x1, y1 + y, r, Math.min(1.2, r / 2)), bottom, top));
      slab(floor, 0, 0, W, D, 5, z, z + 3);
      slab(back, 0, 0, W, 5, 2, z + 3, z + 16);
      slab(left, 0, 4, 5, D - 4, 2, z + 3, z + 16);
      slab(right, W - 5, 4, W, D - 4, 2, z + 3, z + 16);
      if (sheet) {
        const top = z + 4.5, x0 = 17 + i * 2, x1 = W - 15, y0 = 13, y1 = D - 9;
        slab(sheet, x0, y0, x1, y1, 1.6, z + 3, top);
        const w = (x, v) => P(x, v + y, top);
        lines.setAttribute("d", seg(w(x1 - 7, y0), w(x1 - 7, y0 + 7)) + seg(w(x1 - 7, y0 + 7), w(x1, y0 + 7))
          + [24, 32, 40].map((v, n) => seg(w(x0 + 7, v), w(x1 - 8 - n * 4, v))).join(""));
      }
      slab(lip, 0, D - 5, W, D, 2, z + 3, z + 9);
      const [ring] = rings(33, z + 4.5, 55, z + 7.5, 1.4, 0.5);
      pull.setAttribute("d", poly(ringAt((x, v) => P(x, D + y, v), ring, 0)));
    }
    return { i, lip, draw, centre: P(W / 2, D / 2 + REST[i], z + 10), out: tween(0), drawn: NaN };
  });
  const B = register(stage, (_dt, now) => {
    let moving = false;
    for (const tray of trays) {
      const v = tval(tray.out, now);
      if (v !== tray.drawn) { tray.drawn = v; tray.draw(v); }
      if (!tdone(tray.out, now)) moving = true;
    }
    return moving;
  });
  bag.add(B.unregister);
  let active;
  function choose(index) {
    if (index === active) return;
    const from = index ?? active ?? 1, now = performance.now();
    active = index;
    for (const tray of trays) {
      const distance = index == null ? 0 : Math.abs(tray.i - index);
      tset(tray.out, index == null ? 0 : 1 / (1 + distance * 4), now, Math.abs(tray.i - from) * 40);
      tray.lip.sil.classList.toggle("hi", tray.i === (index ?? 1));
    }
    read.textContent = index == null ? "rest" : `bandeja ${index + 1}${empty ? " · 0" : ""}`;
    B.wake();
  }
  function hit([x, y]) {
    let best = null, distance = 66;
    for (const tray of trays) {
      const d = Math.hypot(x - tray.centre[0], y - tray.centre[1]);
      if (d < distance) { distance = d; best = tray.i; }
    }
    return best;
  }
  choose(null);
  bag.add(pointer(stage, { move: (p) => choose(hit(p)), leave: () => choose(null) }));
  bag.add(() => svg.replaceChildren());
  return { set: (v) => { travel = v; trays.forEach((p) => { p.drawn = NaN; }); B.wake(); }, destroy: bag.dispose };
}

export const emptyArchive = {
  name: "empty-archive",
  means: "Tres bandejas sin documentos: la elegida se abre para mostrar lo que todavía falta.",
  rules: [1, 2, 4, 5, 6, 7, 9],
  range: [8, 14, 22],
  mount: (host, value) => mount({ ...host, empty: true }, value),
};

export default hairline({
  name: "archive",
  means: "Un archivo de tres bandejas con documentos: la elegida se abre y las vecinas se desplazan un poco.",
  rules: [1, 2, 4, 5, 6, 7, 9],
  range: [8, 14, 22],
  mount,
});
