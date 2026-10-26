import { HugeiconsIcon as BaseIcon } from "@hugeicons/react";
import { InstagramIcon, MetaIcon, WhatsappIcon } from "@hugeicons/core-free-icons";
import type { ComponentProps } from "react";
import type { IconSvgElement } from "@hugeicons/react";
import type { AppIconBrand } from "../../lib/app-icon-assets";
import { APP_ICON_GLYPHS } from "./app-icon";

export type { IconSvgElement } from "@hugeicons/react";

/**
 * WhatsApp, Instagram and Meta are drawn in their own colours wherever they
 * appear; every other icon is a line icon. They are matched by the icon data
 * itself, so a slot that just says "WhatsappIcon" gets the right artwork.
 *
 * The sidebar and the command palette are the exception: navigation is always
 * line icons. They use `line(...)` (lib/line-icon.ts), a copy of the data, which this lookup
 * does not recognise. A coloured mark alone in a container loses the
 * container's fill: see `[data-brand-icon]` in globals.css.
 */
const BRAND_MARKS = new Map<IconSvgElement, AppIconBrand>([
  [WhatsappIcon, "whatsapp"],
  [InstagramIcon, "instagram"],
  [MetaIcon, "meta"],
]);

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
  const brand = BRAND_MARKS.get(props.icon);
  if (brand) {
    return (
      <BaseIcon aria-hidden="true" focusable="false" data-brand-icon="" {...props} icon={APP_ICON_GLYPHS[brand]} />
    );
  }
  return <BaseIcon aria-hidden="true" focusable="false" {...props} />;
}
