import type { ReactNode } from "react";

// ── The catalog's data model ────────────────────────────────────────
//
// One entry per component, hand-written rather than derived from the source.
// A generator would have to resolve `React.ComponentProps<"button"> &
// VariantProps<typeof buttonVariants>` at build time to say anything useful,
// and what a developer opening this page needs is not the expanded type — it
// is which variant to reach for and what it looks like when it is on screen.

/** One row of a component's API table. */
export type PropDoc = {
  readonly name: string;
  /** Written as it appears in the source: `"default" | "sm" | "lg"`. */
  readonly type: string;
  /** Omitted when the prop has no default. */
  readonly def?: string;
  readonly required?: boolean;
  readonly desc: string;
};

/** One live example: what it renders, and the JSX that produced it. */
export type Demo = {
  readonly id: string;
  readonly title: string;
  readonly desc?: string;
  /** The snippet shown under "Código" — kept in sync with `render` by hand. */
  readonly code: string;
  readonly render: ReactNode;
  /** Lays the preview out on a dark-to-light checker instead of the card
   *  surface — for anything whose whole point is the surface it sits on. */
  readonly surface?: "plain" | "muted" | "page";
};

export type Entry = {
  /** Anchor id — also what the sidebar links to. */
  readonly id: string;
  readonly name: string;
  /** Repo-relative path, so a click here is one grep away from the source. */
  readonly source: string;
  /** The exact import line to paste. */
  readonly importLine: string;
  readonly desc: string;
  /** Everything the module exports, for the pieces with no demo of their own. */
  readonly exports?: readonly string[];
  readonly props?: readonly PropDoc[];
  readonly demos: readonly Demo[];
  /** Things that bite at the call site — a required provider, a layout
   *  constraint, an accessibility obligation. */
  readonly notes?: readonly string[];
};

export type Section = {
  readonly id: string;
  readonly title: string;
  readonly desc: string;
  readonly entries: readonly Entry[];
};
