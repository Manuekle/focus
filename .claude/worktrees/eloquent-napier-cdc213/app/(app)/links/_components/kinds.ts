import {
  Call02Icon,
  Facebook01Icon,
  Globe02Icon,
  InstagramIcon,
  LinkSquare02Icon,
  Location01Icon,
  Mail02Icon,
  TiktokIcon,
  WhatsappIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@/components/icons/icon";
import type { LinkKind } from "@/lib/types";

/** The kinds of link a page can carry, in the order the picker offers them,
 *  and the icon each one wears. Shared by the rail, the link panel and the
 *  public page's own icon set. */
export const KINDS: readonly LinkKind[] = [
  "website",
  "instagram",
  "facebook",
  "tiktok",
  "whatsapp",
  "phone",
  "email",
  "maps",
  "custom",
];

export const KIND_ICONS: Record<LinkKind, IconSvgElement> = {
  website: Globe02Icon,
  instagram: InstagramIcon,
  facebook: Facebook01Icon,
  tiktok: TiktokIcon,
  whatsapp: WhatsappIcon,
  phone: Call02Icon,
  email: Mail02Icon,
  maps: Location01Icon,
  custom: LinkSquare02Icon,
};
