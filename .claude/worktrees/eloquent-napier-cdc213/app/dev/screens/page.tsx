"use client";

import { useEffect, useState } from "react";
import {
  AdsScreen,
  ChatScreen,
  FlowScreen,
  InboxScreen,
} from "@/app/landing/_components/app-screens";
import { ScreenFrame } from "@/app/landing/_components/primitives";
import { AgentsScreen } from "@/app/landing/_components/screen-agents";

/**
 * Every landing mockup, on its own, at the real viewport width.
 *
 * The landing renders these five screens thousands of pixels down a page,
 * each one inside `ScreenFrame` — a bezel, a strip light, a progressive veil
 * over the bottom quarter, and five stacked `backdrop-filter` layers. That is
 * the right dressing for the marketing page and the wrong place to judge the
 * interface underneath it: half the screen is deliberately washed out, and the
 * frame's fixed 38rem crop hides whatever the layout does below it.
 *
 * This is the bare version. No frame, no light, no veil, no reveals — one
 * screen at a time, at the browser's own width, so the mockups can be checked
 * against the pages they claim to mirror (`/dashboard`, `/inbox`, `/agents`,
 * `/ads`, `/automations/[id]`, `/chat`) by opening the two side by side, and
 * so a phone or tablet width shows what it actually shows rather than what the
 * bezel is cropping.
 *
 * Dev only, like everything under /dev — the layout 404s this in production.
 */

const SCREENS = {
  chat: { Screen: ChatScreen, route: "/chat", url: "oruka.si" },
  inbox: { Screen: InboxScreen, route: "/inbox", url: "oruka.si/inbox" },
  agents: { Screen: AgentsScreen, route: "/agents", url: "oruka.si/agents" },
  ads: { Screen: AdsScreen, route: "/ads", url: "oruka.si/ads" },
  flow: { Screen: FlowScreen, route: "/automations/[id]", url: "oruka.si/automations" },
} as const;

type ScreenId = keyof typeof SCREENS;

type View = { readonly framed: boolean; readonly id: ScreenId };

/** `location.hash` — `#inbox`, or `#inbox!` for the framed version.
 *
 *  The state lives in the URL so a screen can be opened straight from the
 *  address bar, and so switching does not depend on a click landing on the
 *  strip: `FlowCanvas` installs capturing pointer handlers on the document,
 *  and with the flow mounted a click on the tabs above it never reached
 *  React. */
function useHashView(): readonly [View, (next: View) => void] {
  const [view, setView] = useState<View>({ framed: false, id: "chat" });

  useEffect(() => {
    const read = () => {
      const raw = decodeURIComponent(location.hash.slice(1));
      const framed = raw.endsWith("!");
      const id = (framed ? raw.slice(0, -1) : raw) as ScreenId;
      if (id in SCREENS) setView({ framed, id });
    };
    read();
    addEventListener("hashchange", read);
    return () => removeEventListener("hashchange", read);
  }, []);

  return [
    view,
    (next) => {
      location.hash = next.framed ? `${next.id}!` : next.id;
      setView(next);
    },
  ];
}

export default function ScreensPage() {
  const [{ framed, id }, setView] = useHashView();
  const { Screen, route, url } = SCREENS[id];

  return (
    /* `lp` is the landing's own wrapper class, and some of the mockups'
       responsive rules are scoped to it — `.lp .lp-kpi-row .kpi-value` shrinks
       the KPI number below 768px. Without it this page shows a dashboard the
       landing never renders. */
    <div className="lp min-h-dvh bg-neutral-950 text-foreground">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        {(Object.keys(SCREENS) as ScreenId[]).map((key) => (
          <button
            className={`rounded-lg px-2.5 py-1 font-medium text-[12px] ${
              key === id ? "bg-white text-neutral-950" : "bg-white/10 text-white/70"
            }`}
            key={key}
            onClick={() => setView({ framed, id: key })}
            type="button"
          >
            {key}
          </button>
        ))}
        <button
          className={`rounded-lg px-2.5 py-1 font-medium text-[12px] ${
            framed ? "bg-white text-neutral-950" : "bg-white/10 text-white/70"
          }`}
          onClick={() => setView({ framed: !framed, id })}
          type="button"
        >
          frame
        </button>
        <a
          className="ml-auto text-[12px] text-white/50 underline underline-offset-4"
          href={route.includes("[") ? "/automations" : route}
        >
          real page: {route}
        </a>
      </div>

      {/* The screens paint their own `--background`; the strip above is on a
          fixed dark ground so the frame boundary stays visible at any width.

          `frame` puts the screen back inside `ScreenFrame` — bezel, toolbar,
          strip light and the veil over the bottom quarter — which is the only
          part of the landing composition that changes what the mockup looks
          like. Off by default: the veil is there to wash the bottom of the
          window out, and working under it means judging an interface through
          a blur. */}
      {framed ? (
        <div className="px-4 py-10">
          <ScreenFrame label={id} url={url}>
            <Screen />
          </ScreenFrame>
        </div>
      ) : (
        <div className="border-white/10 border-y">
          <Screen />
        </div>
      )}
    </div>
  );
}
