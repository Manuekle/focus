import HL from "./kernel.js";
import { hairline } from "./define.js";

/**
 * Server: the self-hosted install as one machine, exploded into three rack
 * units. Bottom to top: storage (a stack of disks and its bays), runtime (the
 * sandbox, caged, beside the processor) and control (the dashboard and the
 * vault the keys live in). Each unit has its drive bays and light on the front
 * and vents down the side. Level with the runtime, a webhook comes in on the
 * left, through its signature seal, and calls go out on the right to a host
 * that is allowed. The pointer picks a part: a unit slides out of the rack
 * toward you, a satellite lifts, and the bright edge goes with it. The slider
 * is how far a unit slides out.
 */
const {
  Cam, circ, extremes, fillet, fit, facing, poly, prism, proj, put, rings, ringAt, seg, solid, tdone, tset, tval, tween, unproj,
  disposer, mk, place, pointer, register,
} = HL;

const U = 78, H = 12, G = 74, MID = U / 2, SZ = G + 4, SAT = 11, LIFT = 9, OUT_MAX = 32, S = 1.4, CH = 18, LINE = 8;
const UNITS = ["storage", "runtime", "control"], SATS = { webhook: [-17, 95], host: [95, -17] };

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let reach = value;
  const C = Cam(45, 0.5, S);
  fit(C, [[0, 0, 0], [U, 0, 0], [0, U + OUT_MAX, 0], [U, U + OUT_MAX, 0], [0, 0, 2 * G + H + 8], [U, 0, 2 * G + H + 8],
    [-28, 106, SZ], [-6, 84, SZ], [106, -28, SZ + LIFT + 20], [84, -6, SZ]], 200, 162);
  const P = proj(C), front = facing(C);
  const g = mk("g", {}, svg);

  // Behind everything: the stack's corner drops, and the network line through the runtime.
  const [left, right] = extremes(P, rings(0, 0, U, U, 6, 1.6)[0]);
  const W = P(...SATS.webhook, SZ), O = P(...SATS.host, SZ), M = P(MID, MID, SZ);
  mk("path", { class: "dash nf", d: seg(P(left.u, left.v, 2 * G), P(left.u, left.v, H)) + seg(P(right.u, right.v, 2 * G), P(right.u, right.v, H))
    + seg([W[0] - (SAT * 2 + LINE) * S, W[1]], W) + seg(W, M) + seg(M, O) + seg(O, [O[0] + (SAT * 2 + LINE) * S, O[1]]) }, g);

  /** A rack unit: its body, bays and light on the front, vents down the side, and what stands on its top, all drawn at a pull of oy. */
  function unit(k, parts) {
    const z0 = k * G, top = z0 + H, ug = mk("g", {}, g), body = solid(ug);
    const bays = mk("path", { class: "nf lo" }, ug), vents = mk("path", { class: "nf lo" }, ug);
    const light = mk("circle", { r: 1.3, class: "dot m" }, ug);
    const items = parts.map(([kind, cls]) => (kind === "solid" ? solid(ug) : mk(kind, { class: cls }, ug)));
    const draw = (oy) => {
      const w = (x, y, z) => P(x, y + oy, z), R = (x0, y0, x1, y1, r, b) => rings(x0, y0 + oy, x1, y1 + oy, r, b);
      put(body, prism(P, front, ...R(0, 0, U, U, 6, 1.6), z0, top));
      bays.setAttribute("d", Array.from({ length: 8 }, (_, i) => poly(fillet([[0, 0], [5, 0], [5, 6], [0, 6]], [1, 1, 1, 1]).map(([x, z]) => w(7 + i * 7.4 + x, U, z0 + 3 + z)))).join(""));
      vents.setAttribute("d", Array.from({ length: 12 }, (_, j) => seg(w(U, 8 + j * 5.4, z0 + 3), w(U, 8 + j * 5.4, z0 + 9))).join(""));
      place(light, w(U - 7, U, z0 + H / 2));
      parts.forEach(([kind, , make], n) => {
        const out = make(w, R, top);
        if (kind === "solid") put(items[n], out);
        else if (kind === "circle") place(items[n], out);
        else items[n].setAttribute("d", out);
      });
    };
    return { id: UNITS[k], ug, body, light, items, draw, out: tween(0), drawn: NaN };
  }
  const flat = (w, x0, y0, x1, y1, z) => poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => w(x, y, z)));
  const cage = (w, top, edges) => edges.map(([a, b]) => seg(w(a[0], a[1], top + (a[2] ?? 0)), w(b[0], b[1], top + (b[2] ?? 0)))).join("");
  const CA = [12, 30], CB = [40, 58];

  const units = [];
  // Storage: three disks stacked, and a grid of bays, one taken.
  units.push(unit(0, [
    ...[0, 1, 2].map((n) => ["solid", "", (w, R, top) => prism(P, front, ...R(8, 8, 34, 34, 4, 1.2), top + n * 4.6, top + n * 4.6 + 3)]),
    ["path", "nf lo", (w, R, top) => Array.from({ length: 15 }, (_, i) => flat(w, 44 + (i % 5) * 5.8, 10 + Math.floor(i / 5) * 7, 48 + (i % 5) * 5.8, 14 + Math.floor(i / 5) * 7, top)).join("")],
    ["circle", "dot m", (w, R, top) => w(57.6, 19, top)],
  ]));

  // Satellites: the webhook through its seal on the left, the allowed host's globe on the right.
  const sats = Object.entries(SATS).map(([id, [cx, cy]]) => {
    const sg = mk("g", {}, g), el = solid(sg), a = mk("path", { class: "nf" }, sg);
    const b = id === "host" ? mk("ellipse", { class: "sil", rx: 6.5 * S, ry: 6.5 * S }, sg) : mk("circle", { r: 1.4, class: "dot m" }, sg);
    const c = mk("path", { class: "nf lo" }, sg);
    const draw = (lift) => {
      const z = SZ + 2 + lift, ring = (r) => circ(r, 16).map((q) => ({ ...q, u: q.u + cx, v: q.v + cy }));
      put(el, prism(P, front, ...rings(cx - SAT, cy - SAT, cx + SAT, cy + SAT, 4, 1.2), SZ - 2 + lift, z));
      if (id === "webhook") { a.setAttribute("d", poly(ringAt(P, ring(6.5), z)) + poly(ringAt(P, ring(4), z))); place(b, P(cx, cy, z)); return; }
      a.setAttribute("d", seg(P(cx, cy, z), P(cx, cy, z + 5)));
      place(b, P(cx, cy, z + 11.5));
      c.setAttribute("d", poly(ringAt(P, ring(6.5), z + 11.5)) + poly(Array.from({ length: 17 }, (_, i) => P(cx + 6.5 * Math.cos((Math.PI * i) / 8) * 0.45, cy - 6.5 * Math.cos((Math.PI * i) / 8) * 0.45, z + 11.5 + 6.5 * Math.sin((Math.PI * i) / 8)))));
    };
    return { id, sg, el, draw, out: tween(0), drawn: NaN };
  });

  // Runtime: the sandbox, a cube in its cage, and the processor with its pins.
  units.push(unit(1, [
    ["path", "dash nf", (w, R, top) => cage(w, top, [[[...CA], [...CA, CH]], [[...CA], [CB[0], CA[1]]], [[...CA], [CA[0], CB[1]]]])],
    ["solid", "", (w, R, top) => prism(P, front, ...R(18, 36, 34, 52, 2.5, 1), top, top + 12)],
    ["path", "dash nf", (w, R, top) => cage(w, top, [[[...CB], [...CB, CH]], [[CB[0], CA[1]], [CB[0], CA[1], CH]], [[CA[0], CB[1]], [CA[0], CB[1], CH]], [[...CB], [CB[0], CA[1]]], [[...CB], [CA[0], CB[1]]],
      [[...CA, CH], [CB[0], CA[1], CH]], [[CB[0], CA[1], CH], [...CB, CH]], [[...CB, CH], [CA[0], CB[1], CH]], [[CA[0], CB[1], CH], [...CA, CH]]])],
    ["solid", "", (w, R, top) => prism(P, front, ...R(48, 12, 66, 30, 2.5, 1), top, top + 2.4)],
    ["path", "nf lo", (w, R, top) => [0, 1, 2, 3].map((i) => seg(w(51 + i * 4, 9, top), w(51 + i * 4, 12, top)) + seg(w(66, 15 + i * 4, top), w(69, 15 + i * 4, top))).join("")
      + seg(w(46, 44, top), w(70, 44, top)) + seg(w(46, 50, top), w(62, 50, top))],
  ]));
  const cube = units[1].items[1];

  // Control: the dashboard and its bars, the vault with its dial, the dots of a key, and a row of ports.
  units.push(unit(2, [
    ["path", "nf lo", (w, R, top) => poly(ringAt(P, R(6, 8, 44, 48, 3, 1)[0], top))],
    ...[28, 21, 14, 9].map((len, i) => ["solid", "", (w, R, top) => prism(P, front, ...R(11, 14 + i * 8, 11 + len, 18.5 + i * 8, 1.6, 0.6), top, top + 1.4)]),
    ["solid", "", (w, R, top) => prism(P, front, ...R(52, 8, 72, 28, 3, 1.2), top, top + 7)],
    ["path", "nf", (w, R, top) => poly(circ(5, 16).map((q) => w(62 + q.u, 18 + q.v, top + 7)))],
    ["circle", "dot m", (w, R, top) => w(62, 18, top + 7)],
    ["path", "nf lo", (w, R, top) => Array.from({ length: 5 }, (_, i) => flat(w, 53 + i * 4, 33, 55.4 + i * 4, 35.4, top)).join("")
      + Array.from({ length: 9 }, (_, i) => flat(w, 8 + i * 7, 60, 12 + i * 7, 64, top)).join("")],
  ]));

  const parts = [...units, ...sats];
  const B = register(stage, (_dt, now) => {
    let moving = false;
    for (const p of parts) {
      const v = tval(p.out, now);
      if (v !== p.drawn) { p.drawn = v; p.draw(v * (p.ug ? reach : LIFT)); }
      if (!tdone(p.out, now)) moving = true;
    }
    return moving;
  });
  bag.add(B.unregister);

  let act;
  /** Picks a part: a unit slides out, a satellite lifts, the bright edge goes with it; at rest it marks the sandbox. */
  function choose(id) {
    if (id === act) return;
    act = id;
    const now = performance.now();
    for (const p of parts) {
      tset(p.out, p.id === id ? 1 : 0, now, 0);
      (p.ug ? p.body : p.el).sil.classList.toggle("hi", p.id === id);
      if (p.light) p.light.setAttribute("class", p.id === id ? "dot" : "dot m");
    }
    cube.sil.classList.toggle("hi", !id || id === "runtime");
    read.textContent = id ?? "rest";
    B.wake();
  }
  choose(null);

  // Picked on each part's own resting top: the part whose middle the pointer falls nearest to there.
  function hit([sx, sy]) {
    let best = null, bd = 1.15;
    const near = (id, z, cx, cy, half) => {
      const [x, y] = unproj(C, sx, sy, z), d = Math.max(Math.abs(x - cx), Math.abs(y - cy)) / half;
      if (d < bd) { bd = d; best = id; }
    };
    UNITS.forEach((id, k) => near(id, k * G + H, MID, MID, U / 2));
    for (const [id, [cx, cy]] of Object.entries(SATS)) near(id, SZ + 2, cx, cy, SAT + 5);
    return best;
  }
  bag.add(pointer(stage, { move: (p) => choose(hit(p)), leave: () => choose(null) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { reach = v; parts.forEach((p) => (p.drawn = NaN)); B.wake(); },
    destroy: bag.dispose,
  };
}

export default hairline({
  name: "server",
  means: "The self-hosted machine in three rack units, a webhook in and a host out: the part under the pointer slides out toward you.",
  rules: [1, 5, 6, 9],
  range: [14, 22, 32],
  mount,
});
