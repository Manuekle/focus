import { NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-error";
import { channelReadiness } from "@/lib/channel-readiness";
import { hostedChannelStates, type HostedChannelState } from "@/lib/hosted-channels";
import { channelAccounts } from "@/lib/channel-accounts";
import { whatsappHealth } from "@/lib/whatsapp-health";

// GET /api/channels/status
// Reports whether each channel's credentials are fully configured.
// The dashboard uses this to show real connected/disconnected state
// instead of hardcoding everything as "connected".
//
// "Fully configured" is not defined here: lib/channel-readiness.ts owns it, so
// this route, the agent's own brief and the Eve channel that mounts the
// webhook all answer the same question the same way.

type ChannelStatus = {
  id: "web" | "whatsapp" | "instagram";
  label: string;
  connected: boolean;
  missing: string[];
  /** Hosted tenants only: disconnected, registering, connected (routed) or failed. */
  hosted?: HostedChannelState;
  /** Who the channel is connected as: "@username", or the E.164 line. */
  account?: string;
};

export const GET = withApiErrors(async function GET() {
  const readiness = await channelReadiness();
  // On a hosted tenant, saved credentials are not yet a live channel: it is
  // connected once Meta routing points here through the fleet's router (the
  // routes themselves always exist). Self-hosted: null, and readiness alone
  // decides, as before.
  const [hosted, accounts] = await Promise.all([hostedChannelStates(), channelAccounts().catch((): Awaited<ReturnType<typeof channelAccounts>> => ({}))]);
  const whatsapp = !hosted && readiness.whatsapp.ready ? await whatsappHealth() : null;
  const live = (id: "whatsapp" | "instagram") =>
    readiness[id].ready && (!hosted || hosted[id].state === "connected") && (id !== "whatsapp" || !whatsapp || whatsapp.ok);

  const channels: ChannelStatus[] = [
    {
      id: "web",
      label: "Web Chat",
      connected: true,
      missing: [],
    },
    {
      id: "whatsapp",
      label: "WhatsApp",
      connected: live("whatsapp"),
      missing: [...readiness.whatsapp.missing],
      ...(hosted ? { hosted: hosted.whatsapp } : {}),
      ...(accounts.whatsapp ? { account: accounts.whatsapp } : {}),
    },
    {
      id: "instagram",
      label: "Instagram",
      connected: live("instagram"),
      missing: [...readiness.instagram.missing],
      ...(hosted ? { hosted: hosted.instagram } : {}),
      ...(accounts.instagram ? { account: accounts.instagram } : {}),
    },
  ];

  // Return a simple map for the dashboard to consume.
  const statusMap: Record<string, boolean> = {};
  for (const ch of channels) {
    statusMap[ch.id] = ch.connected;
  }

  return NextResponse.json({ channels, status: statusMap });
});
