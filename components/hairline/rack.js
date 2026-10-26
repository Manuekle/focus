import HL from "../marketing/hairline/kernel.js";
import { hairline } from "../marketing/hairline/define.js";

/** Three server blades: vented lids, drive bays and mounting screws on an open rack. */
const { Cam, fit, facing, prism, proj, put, rings, rrect, poly, seg, solid,
  tdone, tset, tval, tween, disposer, mk, place, pointer, register } = HL;
const W = 80, D = 62, H = 17, GAP = 26, REST = [9, 0, 4];

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let travel = value;
  const C = Cam(45, 0.5, 1.9);
  fit(C, [[-7, -8, -6], [87, 98, -6], [87, -8, -6], [-7, 98, -6], [0, -8, 77]], 200, 166);
  const P = proj(C), front = facing(C), g = mk("g", {}, svg);
  put(solid(g), prism(P, front, ...rings(-7, -8, 87, 85, 7, 1.5), -6, -1));
  // The rear rails sit behind the opaque blades, never through their faces.
  for (const x of [3, W - 9]) put(solid(g), prism(P, front, ...rings(x, -6, x + 6, 1, 2, 0.8), 0, 74));
  put(solid(g), prism(P, front, ...rings(3, -6, W - 3, 1, 2, 0.8), 74, 77));
  const blades = [0, 1, 2].map((i) => {
    const z = i * GAP, group = mk("g", {}, g), body = solid(group);
    const vents = mk("path", { class: "nf lo" }, group);
    const bays = mk("path", { class: "nf lo" }, group);
    const screws = [5, W - 5].map(() => mk("circle", { r: 1.2, class: "dot m" }, group));
    function draw(slide) {
      const y = REST[i] + slide * travel;
      put(body, prism(P, front, ...rings(0, y, W, D + y, 4, 1.2), z, z + H));
      vents.setAttribute("d", [18, 26, 34, 42].map((v) =>
        seg(P(23, v + y, z + H), P(57, v + y, z + H))).join(""));
      const face = (x, h) => P(x, D + y, z + h);
      const bay = (x0, x1) => poly(rrect(x0, 4, x1, 12.5, 1.8, 5).map((p) => face(p.u, p.v)));
      bays.setAttribute("d", bay(11, 40) + bay(46, 67)
        + seg(face(15, 8), face(35, 8)) + seg(face(50, 8), face(62, 8)));
      screws.forEach((el, n) => place(el, face(n === 0 ? 5 : W - 5, H / 2)));
    }
    return { i, body, draw, centre: P(W / 2, D / 2 + REST[i], z + H), out: tween(0), drawn: NaN };
  });
  const B = register(stage, (_dt, now) => {
    let moving = false;
    for (const blade of blades) {
      const v = tval(blade.out, now);
      if (v !== blade.drawn) { blade.drawn = v; blade.draw(v); }
      if (!tdone(blade.out, now)) moving = true;
    }
    return moving;
  });
  bag.add(B.unregister);
  let active;
  function choose(index) {
    if (index === active) return;
    const from = index ?? active ?? 1, now = performance.now();
    active = index;
    for (const blade of blades) {
      const distance = index == null ? 0 : Math.abs(blade.i - index);
      tset(blade.out, index == null ? 0 : 1 / (1 + distance * 4), now, Math.abs(blade.i - from) * 40);
      blade.body.sil.classList.toggle("hi", blade.i === (index ?? 1));
    }
    read.textContent = index == null ? "rest" : `servidor ${index + 1}`;
    B.wake();
  }
  // Fixed rest centres keep the choice stable while a blade slides out.
  function hit([x, y]) {
    let best = null, distance = 65;
    for (const blade of blades) {
      const d = Math.hypot(x - blade.centre[0], y - blade.centre[1]);
      if (d < distance) { distance = d; best = blade.i; }
    }
    return best;
  }
  choose(null);
  bag.add(pointer(stage, { move: (p) => choose(hit(p)), leave: () => choose(null) }));
  bag.add(() => svg.replaceChildren());
  return { set: (v) => { travel = v; blades.forEach((p) => { p.drawn = NaN; }); B.wake(); }, destroy: bag.dispose };
}

export default hairline({
  name: "rack",
  means: "Tres servidores en un rack abierto: el módulo elegido se extrae y sus vecinos se desplazan suavemente.",
  rules: [1, 2, 4, 5, 6, 7, 8, 9],
  range: [8, 14, 22],
  mount,
});
