import type { SolidPaths } from "@/components/iso/iso-kit";

/**
 * A solid whose paths are written from code each frame it moves: the kit's
 * `Solid` markup with every path present and in a fixed order, so `paint` can
 * fill them by position without React re-rendering anything.
 */
export function LiveSolid({
  tone = "mid",
  crease = "faint",
  lit = false,
  refer,
}: {
  tone?: "hi" | "mid" | "lo";
  crease?: "faint" | "lo";
  lit?: boolean;
  refer: (node: SVGGElement | null) => void;
}) {
  return (
    <g className="iso-solid" data-lit={lit ? "" : undefined} ref={refer}>
      <path className="iso-fill" />
      {[0, 1, 2, 3].map((shade) => (
        <path className="iso-shade" data-shade={shade} key={shade} />
      ))}
      <path className="iso-top" />
      <path className="iso-line iso-crease" data-tone={crease} />
      <path className="iso-line" data-tone="lo" />
      <path className="iso-line iso-edge" data-tone={tone} />
    </g>
  );
}

const EMPTY: SolidPaths = { fill: "", outline: "", crease: "", top: "", shades: ["", "", "", ""] };

/**
 * What each live element was last given, so a frame writes only what changed.
 * Every write of `d`, `transform` or a data attribute invalidates the element's
 * style, and a figure that rewrote its whole state each frame spent most of
 * the main thread recalculating style for paths that had not moved.
 */
const written = new WeakMap<Element, Map<string, string | null>>();

/** Sets `name` to `value` (null removes it) unless that is what it already holds. */
export function put(node: Element | null | undefined, name: string, value: string | null) {
  if (!node) return;
  let held = written.get(node);
  if (!held) written.set(node, (held = new Map()));
  if (held.has(name) ? held.get(name) === value : node.getAttribute(name) === value) return;
  held.set(name, value);
  if (value === null) node.removeAttribute(name);
  else node.setAttribute(name, value);
}

/** Shows or hides a part, through its `display` attribute. */
export const show = (node: Element | null | undefined, visible: boolean) => put(node, "display", visible ? null : "none");

/** Writes `paths` into a `LiveSolid`: fill, four shades, top, crease, ribs, outline. `null` empties it. */
export function paint(node: Element | null | undefined, paths: (SolidPaths & { ribs?: string }) | null) {
  if (!node) return;
  const solid = paths ?? EMPTY;
  const values = [solid.fill, ...[0, 1, 2, 3].map((shade) => solid.shades[shade] ?? ""), solid.top, solid.crease, (solid as { ribs?: string }).ribs ?? "", solid.outline];
  for (let index = 0; index < values.length; index++) put(node.children[index], "d", values[index] ?? "");
}

/**
 * Puts `nodes` into `parent` in this order, moving only when the order
 * differs: re-appending a node that is already in place still restyles it.
 */
export function arrange(parent: Element | null | undefined, nodes: readonly Element[]) {
  if (!parent) return;
  let at = 0;
  let same = true;
  for (const child of Array.from(parent.children)) {
    if (!nodes.includes(child)) continue;
    if (child !== nodes[at]) {
      same = false;
      break;
    }
    at++;
  }
  if (same && at === nodes.length) return;
  for (const node of nodes) parent.appendChild(node);
}

/**
 * A solid too small for its four side tones to show (a pin a few pixels
 * across): fill, one side tone, top and outline, so a board of them is a
 * third of the markup a `LiveSolid` each would be.
 */
export function SmallSolid({ tone = "mid", refer }: { tone?: "hi" | "mid" | "lo"; refer: (node: SVGGElement | null) => void }) {
  return (
    <g className="iso-solid" ref={refer}>
      <path className="iso-fill" />
      <path className="iso-shade" data-shade={1} />
      <path className="iso-top" />
      <path className="iso-line iso-edge" data-tone={tone} />
    </g>
  );
}

/** Writes `paths` into a `SmallSolid`, its side tones as one. */
export function paintSmall(node: Element | null | undefined, paths: SolidPaths | null) {
  if (!node) return;
  const solid = paths ?? EMPTY;
  const values = [solid.fill, solid.shades.join(""), solid.top, solid.outline];
  for (let index = 0; index < values.length; index++) put(node.children[index], "d", values[index] ?? "");
}
