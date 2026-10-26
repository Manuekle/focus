"use client";

import { useState } from "react";
import { PhoneFrame, PhoneStatusBar } from "@/components/phone-frame";
import { StylePanel } from "@/app/(app)/links/_components/style-panel";
import { ProfilePanel } from "@/app/(app)/links/_components/profile-panel";
import { LinkPanel } from "@/app/(app)/links/_components/link-panel";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import { LinkPageView } from "@/app/l/[slug]/link-page-view";
import { defaultLinkPageStyle } from "@/lib/link-page-style";
import type { LinkPage, PublicLinkPage } from "@/lib/types";

/**
 * The link page editor's right half and its style controls, side by side,
 * with no account behind them.
 *
 * `/links` is a signed-in screen, so the one surface whose entire job is
 * taste — the colours, the type, the phone the page is previewed in — could
 * only be looked at by logging in first. This renders the same `StylePanel`
 * and the same `PhoneFrame` against a sample page, which is what makes the
 * controls reviewable while they are being built.
 *
 * Dev only, like everything under /dev — the layout 404s this in production.
 */

const SAMPLE_LINKS: LinkPage["links"] = [
  { id: "f1", kind: "whatsapp", title: "Pedir por WhatsApp", destination: "https://wa.me/573000000000", enabled: true, featured: true },
  { id: "l1", kind: "website", title: "casamora.co", destination: "https://casamora.co", enabled: true, featured: false },
  { id: "l2", kind: "instagram", title: "@casamora", destination: "https://instagram.com/casamora", enabled: true, featured: false },
  { id: "l3", kind: "maps", title: "Cómo llegar", destination: "https://maps.google.com/?q=Chapinero", enabled: true, featured: false },
  { id: "l4", kind: "phone", title: "Llamar al local", destination: "tel:+573000000000", enabled: true, featured: false },
];

const SAMPLE: LinkPage = {
  id: "dev",
  businessId: "dev",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  slug: "casa-mora",
  status: "draft",
  theme: "oruka-noir",
  style: defaultLinkPageStyle("oruka-noir"),
  profile: { title: "Casa Mora", description: "Panadería de masa madre en Chapinero. Horneamos todos los días desde las 6 a. m." },
  links: SAMPLE_LINKS,
};

function preview(page: LinkPage): PublicLinkPage {
  const enabled = page.links.filter((item) => item.enabled && item.destination.trim());
  return {
    slug: page.slug,
    profile: page.profile,
    theme: page.theme,
    style: page.style,
    featured: enabled.find((item) => item.featured) ?? null,
    links: enabled.filter((item) => !item.featured),
  };
}

const DEFAULTS = {
  address: "Calle 70 #9-12, Bogotá",
  description: "Panadería de masa madre en Chapinero.",
  email: "hola@casamora.co",
  phone: "+57 300 000 0000",
  title: "Casa Mora",
  websiteUrl: "https://casamora.co",
};

export default function DevLinkEditor() {
  const [page, setPage] = useState<LinkPage>(SAMPLE);
  const [panel, setPanel] = useState("style");
  const publicPage = preview(page);
  const update = (updater: (current: LinkPage) => LinkPage) => setPage((current) => updater(current));

  return (
    <div className="flex h-svh min-h-0 bg-background text-foreground">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 flex justify-center bg-background/85 p-3 backdrop-blur">
          <SlidingTabs
            value={panel}
            onValueChange={setPanel}
            tabs={[
              { id: "profile", label: "Profile" },
              { id: "style", label: "Style" },
              { id: "link", label: "Link" },
            ]}
          />
        </div>
        {panel === "profile" ? (
          <ProfilePanel defaults={DEFAULTS} hasLogo={false} page={page} onChange={update} />
        ) : panel === "style" ? (
          <StylePanel page={page} onChange={update} />
        ) : (
          <LinkPanel
            index={1}
            item={page.links[1] ?? null}
            total={page.links.length}
            onChange={(id, patch) =>
              update((current) => ({
                ...current,
                links: current.links.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
              }))
            }
            onMove={() => {}}
            onRemove={() => {}}
          />
        )}
      </div>
      <aside className="hidden w-[420px] shrink-0 border-l border-border bg-card lg:block">
        <PhoneFrame
          className="p-4"
          maxWidth={360}
          screenBackground={page.style.canvas}
          scrollable
          surfaceStyle={{ background: page.style.canvasEnd }}
          overlay={<PhoneStatusBar color={page.style.ink} />}
        >
          <LinkPageView
            compact
            page={publicPage}
            logoSrc="/api/business-profile/logo"
            mediaSrc={(assetId) => `/api/media/${assetId}/file`}
          />
        </PhoneFrame>
      </aside>
    </div>
  );
}
