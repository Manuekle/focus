"use client";

import { Alert } from "@/components/ui/alert";
import { FIELD_I18N } from "@/lib/settings-i18n";
import { useT } from "@/lib/i18n/provider";

// "Connected" and "receiving messages" are two different things, and the gap
// between them is where the one-click flows used to leave people.
//
// Both Meta signups store a token and paint a green tick. Neither can supply
// the App Secret that verifies Meta's webhook HMAC or the verify token Meta
// challenges the callback URL with — those are app-level values the operator
// sets once. Without them the Eve channel mounts no route at all, so the
// drawer said "listo" over a channel that could not receive a single message.
//
// This says what is still missing, by the same field name Settings uses.

export function ChannelIncompleteNotice({
  missing,
  settingsPath,
  hosted = false,
}: {
  /** Credential keys the channel still needs, as the API reported them. */
  readonly missing: readonly string[];
  /** Where those fields live, e.g. "Configuración → WhatsApp Business". */
  readonly settingsPath: string;
  readonly hosted?: boolean;
}) {
  const t = useT();
  if (missing.length === 0) return null;

  const fields = missing
    .map((key) => {
      const label = FIELD_I18N[key]?.label;
      return label ? t(label) : key;
    })
    .join(", ");

  return (
    <Alert tone="warning">
      {hosted
        ? t("numbers.hostedChannelIncomplete")
        : t("numbers.channelIncomplete", { fields, settings: settingsPath })}
    </Alert>
  );
}
