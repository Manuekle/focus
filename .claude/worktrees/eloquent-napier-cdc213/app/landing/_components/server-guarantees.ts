import type { IconSvgElement } from "@/components/icons/icon";
import { Activity01Icon, Database01Icon, InternetIcon, Key01Icon, SourceCodeIcon, WebhookIcon } from "@hugeicons/core-free-icons";

/**
 * The glyph for each self-hosted guarantee. The drawing uses them and so does
 * the list under it, so a reader can match a line of text to a part of the
 * machine without either one needing a label.
 */
export const GUARANTEE_ICONS: Record<string, IconSvgElement> = {
  allowlist: InternetIcon,
  database: Database01Icon,
  keys: Key01Icon,
  sandbox: SourceCodeIcon,
  traces: Activity01Icon,
  webhooks: WebhookIcon,
};
