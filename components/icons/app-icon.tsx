import { HugeiconsIcon as SvgIcon, type HugeiconsIconProps, type IconSvgElement } from "@hugeicons/react";
import { APP_ICON_ASSETS, type AppIconBrand } from "../../lib/app-icon-assets";
import { cn } from "../../lib/utils";

type AppIconProps = Omit<HugeiconsIconProps, "icon"> & {
  readonly brand: AppIconBrand;
};

export const APP_ICON_GLYPHS: Record<string, IconSvgElement> = Object.fromEntries(
  Object.entries(APP_ICON_ASSETS).map(([brand, href]) => [
    brand, [["image", { key: brand, href, width: 24, height: 24 }]] as const,
  ]),
);

/** An SVG frame also works inside the automation canvas's SVG figures.
 * Artwork keeps its own colours; controls still own labels and focus. */
export function AppIcon({ brand, size = 24, className, ...props }: AppIconProps) {
  return (
    <SvgIcon
      aria-hidden="true"
      focusable="false"
      size={size}
      icon={APP_ICON_GLYPHS[brand]}
      className={cn("shrink-0", className)}
      {...props}
    />
  );
}
