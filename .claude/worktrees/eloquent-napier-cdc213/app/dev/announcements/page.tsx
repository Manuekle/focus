"use client";

import { useState } from "react";
import { AnnouncementDialog } from "@/components/announcements/announcement-dialog";
import { BillingLockBanner, BillingLockDialog } from "@/components/billing-lock";
import { Button } from "@/components/ui/button";
import { ToggleChip } from "@/components/ui/toggle-chip";
import type { Announcement } from "@/lib/announcement-content";
import { useAppLocale } from "@/lib/i18n/provider";

// The announcement dialog customers see (components/announcements), with
// sample content: one announcement or several, each kind, with and without
// an image, and the unpaid-subscription lock (components/billing-lock.tsx).
// Development only (app/dev/layout.tsx).

const SAMPLES: readonly Announcement[] = [
  {
    id: "a_0000000000000001",
    kind: "feature",
    content: {
      es: { title: "Tu agente ya atiende llamadas", body: "Ahora tu agente puede contestar llamadas de WhatsApp con voz.\n\n- Configúralo en Agentes\n- Elige la voz que más te guste", ctaLabel: "Probarlo" },
      en: { title: "Your agent now answers calls", body: "Your agent can now pick up WhatsApp calls by voice.\n\n- Set it up in Agents\n- Pick the voice you like", ctaLabel: "Try it" },
    },
    ctaUrl: "/agents",
    imageUrl: null,
    ownersOnly: false,
    startsAt: null,
    endsAt: null,
    publishedAt: "2026-10-08T12:00:00.000Z",
  },
  {
    id: "a_0000000000000002",
    kind: "promo",
    content: {
      es: { title: "20% en el plan anual", body: "Solo esta semana: paga el año y ahorra dos meses.", ctaLabel: "Ver planes" },
      en: { title: "20% off the yearly plan", body: "This week only: pay for the year and save two months.", ctaLabel: "See plans" },
    },
    ctaUrl: "https://oruka.si/precios",
    imageUrl: null,
    ownersOnly: true,
    startsAt: null,
    endsAt: null,
    publishedAt: "2026-10-07T12:00:00.000Z",
  },
  {
    id: "a_0000000000000003",
    kind: "notice",
    content: {
      es: { title: "Mantenimiento el domingo", body: "El domingo de 2 a 4 a. m. la app puede tardar en responder. Tus agentes siguen atendiendo." },
      en: { title: "Maintenance on Sunday", body: "On Sunday from 2 to 4 a.m. the app may be slow. Your agents keep answering." },
    },
    ctaUrl: null,
    imageUrl: null,
    ownersOnly: false,
    startsAt: null,
    endsAt: null,
    publishedAt: "2026-10-06T12:00:00.000Z",
  },
];

export default function AnnouncementsDevPage() {
  const { locale, setLocale } = useAppLocale();
  const [count, setCount] = useState<1 | 3>(1);
  const [first, setFirst] = useState(0);
  const [image, setImage] = useState(false);
  const [open, setOpen] = useState(true);
  const [index, setIndex] = useState(0);
  const [lock, setLock] = useState<"off" | "dialog" | "banner">("off");

  const list = (count === 1 ? [SAMPLES[first]] : SAMPLES).map((item) =>
    image ? { ...item, imageUrl: "https://images.unsplash.com/photo-1557683316-973673baf926?w=1200&q=80" } : item,
  );

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {lock === "banner" ? <BillingLockBanner /> : null}
      {lock === "dialog" ? <BillingLockDialog /> : null}
      <div className="p-8">
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="text-lg font-medium">Announcement dialog</h1>
        <div className="flex flex-wrap gap-1.5">
          <ToggleChip selected={count === 1} onClick={() => setCount(1)}>One</ToggleChip>
          <ToggleChip selected={count === 3} onClick={() => setCount(3)}>Three</ToggleChip>
          {count === 1
            ? SAMPLES.map((sample, position) => (
                <ToggleChip key={sample.id} selected={first === position} onClick={() => setFirst(position)}>
                  {sample.kind}
                </ToggleChip>
              ))
            : null}
          <ToggleChip selected={image} onClick={() => setImage((value) => !value)}>Image</ToggleChip>
          <ToggleChip selected={locale === "en"} onClick={() => setLocale(locale === "en" ? "es" : "en")}>EN</ToggleChip>
          <ToggleChip selected={lock === "dialog"} onClick={() => { setOpen(false); setLock(lock === "dialog" ? "off" : "dialog"); }}>Lock</ToggleChip>
          <ToggleChip selected={lock === "banner"} onClick={() => setLock(lock === "banner" ? "off" : "banner")}>Lock banner</ToggleChip>
        </div>
        <Button
          onClick={() => {
            setIndex(0);
            setOpen(true);
          }}
        >
          Open
        </Button>
      </div>
      </div>
      <AnnouncementDialog
        announcements={list}
        index={Math.min(index, list.length - 1)}
        open={open}
        onSelect={setIndex}
        onNext={() => setIndex((value) => Math.min(value + 1, list.length - 1))}
        onFollow={() => setOpen(false)}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
