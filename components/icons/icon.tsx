import { HugeiconsIcon as BaseIcon } from "@hugeicons/react";
import type { ComponentProps } from "react";

export type { IconSvgElement } from "@hugeicons/react";

/**
 * Every icon in the app, hidden from the accessibility tree by default.
 *
 * `@hugeicons/react` renders a bare `<svg>` with no `aria-hidden`, and Chrome
 * maps that to `graphics-document` — an exposed node. With 524 icons across 97
 * files, the landing page alone put 281 unlabeled graphics in front of a screen
 * reader, none of which carry meaning: the icon is always beside a label, or
 * inside a control that already has one.
 *
 * Hiding them is safe precisely because they never named anything. An icon has
 * no `<title>` and no `aria-label`, so it could not contribute an accessible
 * name even before this — a control whose only content is an icon was unnamed
 * either way, and those are fixed at their call sites instead.
 *
 * `{...props}` comes last on purpose: a caller that passes its own
 * `aria-hidden` or `aria-label` still wins. `focusable="false"` keeps the SVG
 * out of the tab order, which some engines otherwise put it in.
 */
export function HugeiconsIcon(props: ComponentProps<typeof BaseIcon>) {
  return <BaseIcon aria-hidden="true" focusable="false" {...props} />;
}
