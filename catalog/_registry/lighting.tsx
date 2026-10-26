"use client";

// The landing's lighting rig. Six fixtures and one rule: the page has one
// lamp, hanging above it, and every piece here is that lamp seen from a
// different distance.
//
// Every demo is wrapped in `.lp`. The tokens these read — `--lp-beam-*`,
// `--lp-halo-ink`, `--lp-lumen-*` — are declared on the marketing wrapper and
// nowhere else, so a fixture rendered outside it resolves every colour to
// nothing and draws a blank box. That is deliberate at the source: this is a
// landing-page rig, not an app one, and a component that lit up anywhere would
// be an invitation to put a beam behind an inbox.

import { ZapIcon } from "@hugeicons/core-free-icons";
import {
  BrandGlow,
  GlowMark,
  Halo,
  LightBar,
  LuminousText,
  Spotlight,
} from "../../components/marketing/lighting";
import { InstagramMark, MetaMark, WhatsAppMark } from "../../components/marketing/brand-marks";
import { ct } from "../_lib/catalog-i18n";
import type { Section } from "../_lib/types";

/** The dark stage a fixture has to be seen on. `.lp` is what carries the
 *  tokens; the height is what gives a cone somewhere to fall. */
function Stage({
  children,
  className = "",
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={`lp relative w-full overflow-hidden rounded-xl border border-border ${className}`}
    >
      {children}
    </div>
  );
}

export function lighting(_locale?: string): Section {
  return {
    id: "lighting",
    title: ct("lighting.title"),
    desc: ct("lighting.desc"),
    entries: [
      {
        id: "light-bar",
        name: "LightBar",
        source: "components/marketing/lighting.tsx",
        importLine: 'import { LightBar } from "@focus/ui/marketing/lighting";',
        desc: ct("lighting.lightBar.desc"),
        props: [
          {
            name: "className",
            type: "string",
            desc: ct("lighting.lightBar.prop.className"),
          },
          {
            name: "drop",
            type: "string",
            def: '"18rem"',
            desc: ct("lighting.lightBar.prop.drop"),
          },
          {
            name: "intensity",
            type: "number",
            def: "1",
            desc: ct("lighting.lightBar.prop.intensity"),
          },
        ],
        notes: [ct("lighting.note.lpOnly"), ct("lighting.lightBar.note.paintOrder")],
        demos: [
          {
            id: "light-bar-over-card",
            title: ct("lighting.lightBar.demo.title"),
            desc: ct("lighting.lightBar.demo.desc"),
            code: `<div className="relative">
  <LightBar className="inset-x-[14%] top-0 z-10" drop="14rem" gap="0px" intensity={0.9} />
  <div className="lp-cap p-6">…</div>
</div>`,
            surface: "page",
            render: (
              <Stage className="p-10">
                <div className="relative mx-auto max-w-[22rem]">
                  <LightBar className="inset-x-[14%] top-0 z-10" drop="14rem" gap="0px"
                    intensity={0.9} />
                  <div className="lp-cap flex-col p-6">
                    <p className="font-medium text-sm">Fig 0.1</p>
                    <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                      {ct("lighting.lightBar.demo.body")}
                    </p>
                  </div>
                </div>
              </Stage>
            ),
          },
        ],
      },
      {
        id: "spotlight",
        name: "Spotlight",
        source: "components/marketing/lighting.tsx",
        importLine: 'import { Spotlight } from "@focus/ui/marketing/lighting";',
        desc: ct("lighting.spotlight.desc"),
        props: [
          { name: "className", type: "string", desc: ct("lighting.spotlight.prop.className") },
          {
            name: "intensity",
            type: "number",
            def: "1",
            desc: ct("lighting.spotlight.prop.intensity"),
          },
        ],
        notes: [ct("lighting.note.lpOnly"), ct("lighting.spotlight.note.apex")],
        demos: [
          {
            id: "spotlight-headline",
            title: ct("lighting.spotlight.demo.title"),
            desc: ct("lighting.spotlight.demo.desc"),
            code: `<section className="relative overflow-hidden">
  <Spotlight className="-top-12 left-1/2 h-[24rem] w-[32rem] -translate-x-1/2" />
  <h2 className="relative">…</h2>
</section>`,
            surface: "page",
            render: (
              <Stage className="h-56">
                <Spotlight className="-top-12 left-1/2 h-[22rem] w-[26rem] -translate-x-1/2" />
                <p className="relative pt-16 text-center font-cooper text-2xl tracking-[-0.02em]">
                  {ct("lighting.spotlight.demo.body")}
                </p>
              </Stage>
            ),
          },
        ],
      },
      {
        id: "halo",
        name: "Halo",
        source: "components/marketing/lighting.tsx",
        importLine: 'import { Halo } from "@focus/ui/marketing/lighting";',
        desc: ct("lighting.halo.desc"),
        props: [{ name: "className", type: "string", desc: ct("lighting.halo.prop.className") }],
        notes: [ct("lighting.note.lpOnly"), ct("lighting.halo.note.gradient")],
        demos: [
          {
            id: "halo-under-card",
            title: ct("lighting.halo.demo.title"),
            code: `<div className="relative">
  <Halo className="-inset-x-8 -bottom-10 h-32" />
  <div className="lp-cap p-6">…</div>
</div>`,
            surface: "page",
            render: (
              <Stage className="p-12">
                <div className="relative mx-auto max-w-[18rem]">
                  <Halo className="-inset-x-10 -bottom-12 h-32" />
                  <div className="lp-cap flex-col p-6 text-center">
                    <p className="font-medium text-sm">{ct("lighting.halo.demo.body")}</p>
                  </div>
                </div>
              </Stage>
            ),
          },
        ],
      },
      {
        id: "glow-mark",
        name: "GlowMark",
        source: "components/marketing/lighting.tsx",
        importLine: 'import { GlowMark } from "@focus/ui/marketing/lighting";',
        desc: ct("lighting.glowMark.desc"),
        props: [
          { name: "icon", type: "IconSvgElement", required: true, desc: ct("lighting.glowMark.prop.icon") },
          { name: "size", type: "number", def: "20", desc: ct("lighting.glowMark.prop.size") },
          {
            name: "strokeWidth",
            type: "number",
            def: "1.75",
            desc: ct("lighting.glowMark.prop.strokeWidth"),
          },
          {
            name: "intensity",
            type: "number",
            def: "1",
            desc: ct("lighting.glowMark.prop.intensity"),
          },
        ],
        notes: [ct("lighting.note.lpOnly"), ct("lighting.glowMark.note.silhouette")],
        demos: [
          {
            id: "glow-mark-plate",
            title: ct("lighting.glowMark.demo.title"),
            desc: ct("lighting.glowMark.demo.desc"),
            code: `<div className="lp-plate size-10 rounded-xl">
  <GlowMark icon={ZapIcon} size={18} />
</div>`,
            surface: "page",
            render: (
              <Stage className="flex items-center justify-center gap-10 py-12">
                {[0.35, 0.7, 1].map((intensity) => (
                  <span
                    className="lp-plate flex size-10 items-center justify-center rounded-xl"
                    key={intensity}
                  >
                    <GlowMark icon={ZapIcon} intensity={intensity} size={18} />
                  </span>
                ))}
              </Stage>
            ),
          },
        ],
      },
      {
        id: "luminous-text",
        name: "LuminousText",
        source: "components/marketing/lighting.tsx",
        importLine: 'import { LuminousText } from "@focus/ui/marketing/lighting";',
        desc: ct("lighting.lumen.desc"),
        props: [
          { name: "text", type: "string", required: true, desc: ct("lighting.lumen.prop.text") },
          { name: "children", type: "ReactNode", desc: ct("lighting.lumen.prop.children") },
          { name: "className", type: "string", desc: ct("lighting.lumen.prop.className") },
        ],
        notes: [
          ct("lighting.note.lpOnly"),
          ct("lighting.lumen.note.perGlyph"),
          ct("lighting.lumen.note.figuresOnly"),
        ],
        demos: [
          {
            id: "luminous-text-figure",
            title: ct("lighting.lumen.demo.title"),
            code: '<LuminousText text="$249" className="font-cooper text-5xl" />',
            surface: "page",
            render: (
              <Stage className="flex items-center justify-center gap-10 py-12">
                <LuminousText
                  className="font-cooper font-medium text-5xl tracking-[-0.02em]"
                  text="$249"
                />
                <LuminousText
                  className="font-cooper font-medium text-5xl tracking-[-0.02em]"
                  text="99,9%"
                />
              </Stage>
            ),
          },
        ],
      },
      {
        id: "brand-glow",
        name: "BrandGlow",
        source: "components/marketing/lighting.tsx",
        importLine: 'import { BrandGlow } from "@focus/ui/marketing/lighting";',
        desc: ct("lighting.brand.desc"),
        props: [
          { name: "colour", type: "string", required: true, desc: ct("lighting.brand.prop.colour") },
          {
            name: "intensity",
            type: "number",
            def: "1",
            desc: ct("lighting.brand.prop.intensity"),
          },
        ],
        notes: [ct("lighting.note.lpOnly"), ct("lighting.brand.note.dropShadow")],
        demos: [
          {
            id: "brand-glow-channels",
            title: ct("lighting.brand.demo.title"),
            desc: ct("lighting.brand.demo.desc"),
            code: '<BrandGlow colour="#25D366"><WhatsAppMark size={34} /></BrandGlow>',
            surface: "page",
            render: (
              <Stage className="flex flex-wrap items-center justify-center gap-12 py-12">
                <BrandGlow colour="#25D366">
                  <WhatsAppMark size={34} />
                </BrandGlow>
                <BrandGlow colour="#FC01D8">
                  <InstagramMark size={34} />
                </BrandGlow>
                <BrandGlow colour="#0081FB">
                  <MetaMark size={38} />
                </BrandGlow>
              </Stage>
            ),
          },
        ],
      },
    ],
  };
}
