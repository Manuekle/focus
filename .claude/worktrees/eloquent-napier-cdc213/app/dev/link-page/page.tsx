"use client";

import { useEffect, useState } from "react";
import { LinkPageView } from "@/app/l/[slug]/link-page-view";
import { LINK_PAGE_THEMES, defaultLinkPageStyle } from "@/lib/link-page-style";
import type { LinkPageStyle, LinkPageTheme, PublicLinkPage } from "@/lib/types";

/**
 * The public link page, on its own, at real viewport width.
 *
 * `/l/[slug]` only renders for a published page owned by a signed-in
 * workspace, which makes the premium surface the hardest part of the feature
 * to look at while building it. This is the contact sheet: one theme at a
 * time, chosen by the hash, with the same content in each so the themes can
 * be compared rather than described.
 *
 * Dev only, like everything under /dev — the layout 404s this in production.
 */

/** A style nobody could reach by picking a preset: proof that the colour,
 *  type and button controls actually reach the page. */
const CUSTOM: LinkPageStyle = {
  ...defaultLinkPageStyle("oruka-noir"),
  preset: "custom",
  headingFont: "serif",
  bodyFont: "mono",
  canvas: "#123b2f",
  canvasEnd: "#05150f",
  ink: "#f2ffe9",
  accent: "#e9ff6b",
  accentInk: "#0b1f17",
  surface: "#9fffd0",
  surfaceOpacity: 12,
  buttonShape: "pill",
  buttonFill: "outline",
  background: { kind: "plain" },
  avatar: { kind: "initials" },
};

const LOOKS: readonly Look[] = [...LINK_PAGE_THEMES, "custom"];

type Look = LinkPageTheme | "custom";

function sample(theme: Look): PublicLinkPage {
  return {
    slug: "casa-mora",
    theme: theme === "custom" ? "oruka-noir" : theme,
    style: theme === "custom" ? CUSTOM : defaultLinkPageStyle(theme),
    profile: {
      title: "Casa Mora",
      description: "Panadería de masa madre en Chapinero. Horneamos todos los días desde las 6 a. m.",
    },
    featured: {
      id: "f1",
      kind: "whatsapp",
      title: "Pedir por WhatsApp",
      destination: "https://wa.me/573000000000",
      enabled: true,
      featured: true,
    },
    links: [
      { id: "l1", kind: "website", title: "casamora.co", destination: "https://casamora.co", enabled: true, featured: false },
      { id: "l2", kind: "instagram", title: "@casamora", destination: "https://instagram.com/casamora", enabled: true, featured: false },
      { id: "l3", kind: "maps", title: "Cómo llegar", destination: "https://maps.google.com/?q=Chapinero", enabled: true, featured: false },
      { id: "l4", kind: "phone", title: "Llamar al local", destination: "tel:+573000000000", enabled: true, featured: false },
      { id: "l5", kind: "email", title: "Pedidos para eventos", destination: "mailto:hola@casamora.co", enabled: true, featured: false },
    ],
  };
}

export default function DevLinkPage() {
  const [theme, setTheme] = useState<Look>("oruka-noir");

  // Clicks on the switcher have to survive the page under them, so the theme
  // travels in the hash the same way /dev/screens does.
  useEffect(() => {
    const read = () => {
      const value = window.location.hash.slice(1) as Look;
      if (LOOKS.includes(value)) setTheme(value);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  return (
    <div className="relative">
      <nav className="fixed top-3 left-1/2 z-50 flex -translate-x-1/2 gap-1 rounded-full border border-zinc-500/40 bg-zinc-900/85 p-1 text-xs text-white backdrop-blur">
        {LOOKS.map((value) => (
          <a
            key={value}
            href={`#${value}`}
            className={`rounded-full px-3 py-1.5 ${theme === value ? "bg-white text-zinc-950" : "hover:bg-white/10"}`}
          >
            {value}
          </a>
        ))}
      </nav>
      <LinkPageView page={sample(theme)} mediaSrc={(assetId) => `/api/media/${assetId}/file`} />
    </div>
  );
}
