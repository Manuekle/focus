import HL from "../marketing/hairline/kernel.js";
import { hairline } from "../marketing/hairline/define.js";

/** A three-jack switchboard: sockets, metal tips, grip sleeves and flexible leads. */
const { Cam, circ, fit, facing, prism, proj, put, rings, ringAt, poly, seg, solid,
  tdone, tset, tval, tween, disposer, mk, pointer, register } = HL;
const XS = [19, 62, 105], REST = [14, 5, 19];

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let travel = value;
  const C = Cam(45, 0.5, 1.75);
  fit(C, [[-6, -4, 0], [130, 120, 0], [130, -4, 0], [-6, 120, 0], [19, 26, 34]], 200, 166);
  const P = proj(C), front = facing(C), g = mk("g", {}, svg);
  put(solid(g), prism(P, front, ...rings(-6, -4, 130, 82, 9, 1.8), 0, 7));
  const plugs = XS.map((x, i) => {
    const group = mk("g", {}, g);
    const ring = (r) => circ(r, 40).map((p) => ({ ...p, u: p.u + x, v: p.v + 16 }));
    mk("path", { class: "nf lo", d: poly(ringAt(P, ring(9), 7)) + poly(ringAt(P, ring(5.5), 7)) }, group);
    const cable = mk("path", { class: "nf lo" }, group), tip = solid(group), grip = solid(group);
    const grooves = mk("path", { class: "nf lo" }, group);
    function draw(slide) {
      const y = 18 + REST[i] - slide * travel;
      const start = P(x, y + 36, 11), end = P(x + 12, 113 - i * 8, 0);
      const a = P(x - 12, y + 60, 2), b = P(x + 30, 103 - i * 8, 0);
      cable.setAttribute("d", `M${start}C${a} ${b} ${end}`);
      put(tip, prism(P, front, ...rings(x - 4, y, x + 4, y + 17, 3, 0.8), 8, 13));
      put(grip, prism(P, front, ...rings(x - 9, y + 12, x + 9, y + 36, 5, 1.2), 7, 19));
      grooves.setAttribute("d", [19, 24, 29].map((dy) => seg(P(x - 5, y + dy, 19), P(x + 5, y + dy, 19))).join(""));
    }
    return { i, grip, draw, centre: P(x, 42 + REST[i], 19), out: tween(0), drawn: NaN };
  });
  const B = register(stage, (_dt, now) => {
    let moving = false;
    for (const plug of plugs) {
      const v = tval(plug.out, now);
      if (v !== plug.drawn) { plug.drawn = v; plug.draw(v); }
      if (!tdone(plug.out, now)) moving = true;
    }
    return moving;
  });
  bag.add(B.unregister);
  let active;
  function choose(index) {
    if (index === active) return;
    const from = index ?? active ?? 1, now = performance.now();
    active = index;
    for (const plug of plugs) {
      const distance = index == null ? 0 : Math.abs(plug.i - index);
      tset(plug.out, index == null ? 0 : 1 / (1 + distance * 4), now, Math.abs(plug.i - from) * 40);
      plug.grip.sil.classList.toggle("hi", plug.i === (index ?? 1));
    }
    read.textContent = index == null ? "rest" : `canal ${index + 1}`;
    B.wake();
  }
  function hit([x, y]) {
    let best = null, distance = 58;
    for (const plug of plugs) {
      const d = Math.hypot(x - plug.centre[0], y - plug.centre[1]);
      if (d < distance) { distance = d; best = plug.i; }
    }
    return best;
  }
  choose(null);
  bag.add(pointer(stage, { move: (p) => choose(hit(p)), leave: () => choose(null) }));
  bag.add(() => svg.replaceChildren());
  return { set: (v) => { travel = v; plugs.forEach((p) => { p.drawn = NaN; }); B.wake(); }, destroy: bag.dispose };
}

export default hairline({
  name: "channels",
  means: "Una centralita con tres conectores: el elegido se acerca a su toma y los vecinos lo acompañan.",
  rules: [1, 2, 4, 5, 7, 9],
  range: [4, 8, 12],
  mount,
});
