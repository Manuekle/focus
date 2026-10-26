"use client";

import { AppIcon } from "../icons/app-icon";
import type { AppIconBrand } from "../../lib/app-icon-assets";
import { StatusBadge, type StatusVariant } from "../ui/status-badge";
import { useT } from "../../lib/i18n/provider";
import type { ChannelId, ChannelStatus, ContactChannel } from "../../lib/types";
import { cn } from "../../lib/utils";
import { CategoryBadge } from "../ui/category-badge";

const CHANNEL_HUES: Record<ContactChannel, number> = {
  web: 250,
  whatsapp: 165,
  instagram: 345,
  form: 65,
  voice: 295,
};

const CHANNEL_ICONS: Record<ContactChannel, AppIconBrand> = {
  web: "safari",
  whatsapp: "whatsapp",
  instagram: "instagram",
  // Neither is a place you can reply, so neither has an entry in
  // CHANNEL_LABELS with the messaging products — but contacts do arrive both
  // ways and have to be drawn.
  form: "notes",
  voice: "phone",
};

/** An icon we can always render. `channel` comes off API data, so a value
 *  outside the union is a data problem — and an undefined icon throws inside
 *  the icon renderer, which takes the whole page down with it. */
const iconFor = (channel: ContactChannel): AppIconBrand =>
  CHANNEL_ICONS[channel] ?? "safari";

/** Product names, so they stay as they are in every language. */
export const CHANNEL_LABELS: Record<ChannelId, string> = {
  web: "Web",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
};

/** Compatibility name for channel slots: channels keep their app artwork. */
export function ChannelGlyph(props: Parameters<typeof ChannelIcon>[0]) {
  return <ChannelIcon {...props} />;
}

/**
 * The channel as its own app artwork, shared by lists, badges and pickers.
 */
export function ChannelIcon({ channel, className, size = 16 }: {
  readonly channel: ContactChannel;
  readonly className?: string;
  readonly size?: number;
}) {
  return <AppIcon brand={iconFor(channel)} size={size} className={cn("shrink-0", className)} />;
}

export function ChannelBadge({ channel }: { readonly channel: ContactChannel }) {
  const t = useT();
  // The messaging channels are products and keep their names; "form" and
  // "voice" are common nouns, so they are the labels here that get translated.
  const label =
    channel === "form" ? t("channel.form")
    : channel === "voice" ? t("channel.voice")
    : (CHANNEL_LABELS[channel] ?? channel);
  return (
    <CategoryBadge hue={CHANNEL_HUES[channel]}>
      <ChannelGlyph channel={channel} size={12} />
      {label}
    </CategoryBadge>
  );
}

// ── Status badges ────────────────────────────────────────────────────
// The badge system itself moved to components/ui/status-badge.tsx so surfaces
// outside app/ can use it. Re-exported here because every existing caller
// imports it from this file.

export { StatusBadge, type StatusVariant } from "../ui/status-badge";

/** Legacy channel status badge — maps ChannelStatus to StatusBadge. */
export function ChannelStatusBadge({ status }: { readonly status: ChannelStatus }) {
  const variant: StatusVariant =
    status === "connected" ? "connected" : status === "error" ? "error" : "disconnected";
  return <StatusBadge status={variant} />;
}
