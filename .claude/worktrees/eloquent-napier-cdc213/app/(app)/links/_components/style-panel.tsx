"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Image01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/icon";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { LiquidSlider } from "@/components/ui/liquid-slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FONT_GROUPS,
  LINK_PAGE_AVATAR_SIZES,
  LINK_PAGE_BUTTON_BORDERS,
  LINK_PAGE_BUTTON_FILLS,
  LINK_PAGE_BUTTON_SHADOWS,
  LINK_PAGE_BUTTON_SHAPES,
  LINK_PAGE_PRESETS,
  LINK_PAGE_TEMPLATES,
  LINK_PAGE_TEMPLATE_CATEGORIES,
  BUTTON_RADIUS,
  FONT_STACKS,
  buttonBorderCss,
  buttonShadowCss,
  defaultLinkPageStyle,
} from "@/lib/link-page-style";
import { useT } from "@/lib/i18n/provider";
import type { LinkPage, LinkPageStyle, LinkPageTemplateCategory, LinkPageTheme } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ImagePicker } from "./image-picker";
import { Group, PanelShell } from "./panel";

/**
 * Everything the operator can change about how their page looks.
 *
 * The controls are the app's own — `Select`, `LiquidSlider`, the sliding
 * segmented bar — and not the browser's. The first version of this panel
 * reached for raw `<select>`, `<input type="color">` and `<input
 * type="range">`, which render as the operating system's widgets: three
 * different type faces, three different heights and a grey that belongs to
 * nobody's design system. On a screen whose whole job is showing taste, that
 * was the one place with none.
 */
export function StylePanel({
  onChange,
  page,
}: {
  readonly onChange: (updater: (current: LinkPage) => LinkPage) => void;
  readonly page: LinkPage;
}) {
  const t = useT();
  const style = page.style;
  const [picking, setPicking] = useState<"background" | "avatar" | null>(null);
  /** Which slot the dialog is filling, kept past the close so its title does
   *  not flip to the other one while the panel animates away. */
  const [pickingSlot, setPickingSlot] = useState<"background" | "avatar">("background");
  const openPicker = (slot: "background" | "avatar") => {
    setPickingSlot(slot);
    setPicking(slot);
  };
  const [shelf, setShelf] = useState<LinkPageTemplateCategory | "all">("all");

  /** Every edit below marks the style custom: a preset is where the page
   *  started, not a box it has to stay in. */
  const set = (patch: Partial<LinkPageStyle>) =>
    onChange((current) => ({ ...current, style: { ...current.style, ...patch, preset: "custom" } }));

  const applyPreset = (theme: LinkPageTheme) =>
    onChange((current) => ({ ...current, theme, style: defaultLinkPageStyle(theme) }));

  return (
    <PanelShell title={t("links.sectionStyle")} description={t("links.styleHint")}>
      <Group label={t("links.templates")}>
        <p className="-mt-1 mb-3 text-xs leading-5 text-muted-foreground">{t("links.templatesHint")}</p>
        <div className="-mx-1 mb-3 overflow-x-auto px-1 scrollbar-hide">
          <Segmented
            options={[
              { id: "all" as const, label: t("links.shelf.all") },
              ...LINK_PAGE_TEMPLATE_CATEGORIES.map((category) => ({
                id: category,
                label: t(`links.shelf.${category}`),
              })),
            ]}
            value={shelf}
            onChange={setShelf}
          />
        </div>
        <div className="@container">
          <div className="grid grid-cols-2 gap-3 @min-[420px]:grid-cols-3 @min-[560px]:grid-cols-4">
            {LINK_PAGE_TEMPLATES.filter((template) => shelf === "all" || template.category === shelf).map(
              (template) => (
                <PresetCard
                  key={template.id}
                  label={t(`links.theme.${template.id}`)}
                  onSelect={() => applyPreset(template.id)}
                  selected={style.preset === template.id}
                  style={LINK_PAGE_PRESETS[template.id]}
                />
              ),
            )}
          </div>
        </div>
        {style.preset === "custom" ? (
          <p className="mt-3 text-xs leading-5 text-muted-foreground">{t("links.customStyle")}</p>
        ) : null}
      </Group>

      <Group label={t("links.fonts")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Labeled label={t("links.headingFont")}>
            <FontSelect value={style.headingFont} onChange={(headingFont) => set({ headingFont })} />
          </Labeled>
          <Labeled label={t("links.bodyFont")}>
            <FontSelect value={style.bodyFont} onChange={(bodyFont) => set({ bodyFont })} />
          </Labeled>
        </div>
      </Group>

      <Group label={t("links.colors")}>
        <div className="grid gap-2 sm:grid-cols-2">
          <ColorField label={t("links.colorCanvas")} value={style.canvas} onChange={(canvas) => set({ canvas })} />
          <ColorField
            label={t("links.colorCanvasEnd")}
            value={style.canvasEnd}
            onChange={(canvasEnd) => set({ canvasEnd })}
          />
          <ColorField label={t("links.colorInk")} value={style.ink} onChange={(ink) => set({ ink })} />
          <ColorField label={t("links.colorAccent")} value={style.accent} onChange={(accent) => set({ accent })} />
          <ColorField
            label={t("links.colorAccentInk")}
            value={style.accentInk}
            onChange={(accentInk) => set({ accentInk })}
          />
          <ColorField label={t("links.colorSurface")} value={style.surface} onChange={(surface) => set({ surface })} />
        </div>
      </Group>

      <Group label={t("links.buttons")}>
        <div className="flex flex-col gap-4">
          <Labeled label={t("links.buttonShape")}>
            <Segmented
              options={LINK_PAGE_BUTTON_SHAPES.map((shape) => ({ id: shape, label: t(`links.shape.${shape}`) }))}
              value={style.buttonShape}
              onChange={(buttonShape) => set({ buttonShape })}
            />
          </Labeled>
          <Labeled label={t("links.buttonFill")}>
            <Segmented
              options={LINK_PAGE_BUTTON_FILLS.map((fill) => ({ id: fill, label: t(`links.fill.${fill}`) }))}
              value={style.buttonFill}
              onChange={(buttonFill) => set({ buttonFill })}
            />
          </Labeled>
          <Labeled label={t("links.buttonBorder")}>
            <Segmented
              options={LINK_PAGE_BUTTON_BORDERS.map((border) => ({
                id: border,
                label: t(`links.border.${border}`),
              }))}
              value={style.buttonBorder}
              onChange={(buttonBorder) => set({ buttonBorder })}
            />
          </Labeled>
          <Labeled label={t("links.buttonShadow")}>
            <Segmented
              options={LINK_PAGE_BUTTON_SHADOWS.map((shadow) => ({
                id: shadow,
                label: t(`links.shadow.${shadow}`),
              }))}
              value={style.buttonShadow}
              onChange={(buttonShadow) => set({ buttonShadow })}
            />
          </Labeled>
          <ButtonPreview style={style} />
          <SliderRow
            label={t("links.surfaceOpacity")}
            max={100}
            onChange={(surfaceOpacity) => set({ surfaceOpacity })}
            suffix="%"
            value={style.surfaceOpacity}
          />
        </div>
      </Group>

      <Group label={t("links.background")}>
        <Segmented
          options={[
            { id: "grid", label: t("links.bgGrid") },
            { id: "plain", label: t("links.bgPlain") },
            { id: "image", label: t("links.bgImage") },
          ]}
          value={style.background.kind}
          onChange={(kind) => {
            if (kind === "image") {
              if (style.background.kind === "image") return;
              openPicker("background");
              return;
            }
            set({ background: { kind: kind as "grid" | "plain" } });
          }}
        />

        {style.background.kind === "image" ? (
          <div className="mt-4 flex flex-col gap-4">
            <ImageRow
              onChange={() => openPicker("background")}
              // Library bytes are served by id, never from /public.
              src={`/api/media/${style.background.assetId}/file`}
              wide
            />
            <SliderRow
              label={t("links.bgDim")}
              max={100}
              onChange={(dim) =>
                set({
                  background: style.background.kind === "image" ? { ...style.background, dim } : style.background,
                })
              }
              suffix="%"
              value={style.background.dim}
            />
            <SliderRow
              label={t("links.bgBlur")}
              max={20}
              onChange={(blur) =>
                set({
                  background: style.background.kind === "image" ? { ...style.background, blur } : style.background,
                })
              }
              suffix="px"
              value={style.background.blur}
            />
          </div>
        ) : null}
      </Group>

      <Group label={t("links.avatar")}>
        <Segmented
          options={[
            { id: "business", label: t("links.avatarBusiness") },
            { id: "asset", label: t("links.avatarAsset") },
            { id: "initials", label: t("links.avatarInitials") },
          ]}
          value={style.avatar.kind}
          onChange={(kind) => {
            if (kind === "asset") {
              if (style.avatar.kind === "asset") return;
              openPicker("avatar");
              return;
            }
            set({ avatar: { kind: kind as "business" | "initials" } });
          }}
        />
        {style.avatar.kind === "asset" ? (
          <div className="mt-4">
            <ImageRow
              onChange={() => openPicker("avatar")}
              src={`/api/media/${style.avatar.assetId}/file`}
              wide={style.avatarSize === "wide"}
            />
          </div>
        ) : null}

        <div className="mt-4 flex flex-col gap-4">
          <Labeled label={t("links.avatarSize")}>
            <Segmented
              options={LINK_PAGE_AVATAR_SIZES.map((size) => ({
                id: size,
                label: t(size === "wide" ? "links.avatarSizeWide" : "links.avatarSizeIcon"),
              }))}
              value={style.avatarSize}
              onChange={(avatarSize) => set({ avatarSize })}
            />
            <p className="text-xs leading-5 text-muted-foreground">{t("links.avatarSizeHint")}</p>
          </Labeled>
          <ToggleRow
            checked={style.avatarSurface}
            hint={t("links.avatarSurfaceHint")}
            label={t("links.avatarSurface")}
            onChange={(avatarSurface) => set({ avatarSurface })}
          />
          <ToggleRow
            checked={style.avatarBorder}
            label={t("links.avatarBorder")}
            onChange={(avatarBorder) => set({ avatarBorder })}
          />
        </div>
      </Group>

      <ImagePicker
        open={picking !== null}
        purpose={pickingSlot}
        onOpenChange={(next) => {
          if (!next) setPicking(null);
        }}
        onPick={(asset) => {
          if (picking === "background") {
            set({ background: { kind: "image", assetId: asset.id, dim: 45, blur: 0 } });
          } else if (picking === "avatar") {
            set({ avatar: { kind: "asset", assetId: asset.id } });
          }
          setPicking(null);
        }}
        selectedId={
          picking === "background" && style.background.kind === "image"
            ? style.background.assetId
            : picking === "avatar" && style.avatar.kind === "asset"
              ? style.avatar.assetId
              : undefined
        }
      />
    </PanelShell>
  );
}

/** A label over a control that is not an `<input>` — a `<label>` wrapping a
 *  listbox trigger or a group of toggles points at nothing. */
function Labeled({ children, label }: { readonly children: ReactNode; readonly label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}

function ToggleRow({
  checked,
  hint,
  label,
  onChange,
}: {
  readonly checked: boolean;
  readonly hint?: string;
  readonly label: string;
  readonly onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-medium">{label}</span>
        {hint ? <span className="text-xs leading-5 text-muted-foreground">{hint}</span> : null}
      </span>
      <Switch checked={checked} label={label} onCheckedChange={onChange} />
    </div>
  );
}

/** A starting point, shown as the thing it makes rather than named: the
 *  gradient with its real background texture, the accent button at its real
 *  radius, fill and heading face, and one ordinary button under it. */
function PresetCard({
  label,
  onSelect,
  selected,
  style,
}: {
  readonly label: string;
  readonly onSelect: () => void;
  readonly selected: boolean;
  readonly style: LinkPageStyle;
}) {
  const radius = BUTTON_RADIUS[style.buttonShape];
  const border = buttonBorderCss(style);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group rounded-xl border p-2 text-left",
        "transition-[background-color,border-color,box-shadow,scale] duration-150 ease-out active:scale-[0.96]",
        selected
          ? "border-foreground/30 bg-muted shadow-[var(--shadow-inset)]"
          : "border-border hover:border-input hover:bg-accent",
      )}
    >
      <span
        className="relative flex h-20 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-lg ring-1 ring-black/10 dark:ring-white/10"
        style={{ background: `linear-gradient(to bottom, ${style.canvas}, ${style.canvasEnd})` }}
      >
        {style.background.kind === "grid" ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: `linear-gradient(to right, ${style.ink}12 1px, transparent 1px), linear-gradient(to bottom, ${style.ink}12 1px, transparent 1px)`,
              backgroundSize: "14px 14px",
              maskImage: "linear-gradient(to bottom, black, transparent)",
              WebkitMaskImage: "linear-gradient(to bottom, black, transparent)",
            }}
          />
        ) : null}
        <span
          className="relative px-3 py-1 text-[11px] font-medium"
          style={{
            background: style.accent,
            border: border === "none" ? `1px solid ${style.accent}` : border,
            borderRadius: radius,
            boxShadow: buttonShadowCss(style, true),
            color: style.accentInk,
            fontFamily: FONT_STACKS[style.headingFont],
          }}
        >
          Aa
        </span>
        <span
          className="relative px-3 py-1 text-[10px]"
          style={{
            borderRadius: radius,
            border: border === "none" ? `1px solid ${style.ink}1f` : border,
            background: `${style.surface}1f`,
            color: style.ink,
          }}
        >
          ·····
        </span>
      </span>
      <span className="mt-2 flex items-center gap-1.5 px-1 pb-0.5">
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full transition-colors duration-150",
            selected ? "bg-foreground" : "bg-border",
          )}
        />
        <span className="truncate text-sm font-medium">{label}</span>
      </span>
    </button>
  );
}

/**
 * A button pair painted with the live style, under the controls that change
 * it.
 *
 * Shape, border and shadow are the three settings whose names mean least —
 * "thin", "hard", "round" describe nothing until you see them — and the phone
 * preview sits in a different column, sometimes scrolled away entirely. This
 * is the same geometry as the real page, over the real canvas, three
 * centimetres from the control being dragged.
 */
function ButtonPreview({ style }: { readonly style: LinkPageStyle }) {
  const radius = BUTTON_RADIUS[style.buttonShape];
  const border = buttonBorderCss(style);
  return (
    <span
      aria-hidden="true"
      className="flex flex-col items-stretch gap-2 rounded-xl p-4 ring-1 ring-black/10 dark:ring-white/10"
      style={{ background: `linear-gradient(to bottom, ${style.canvas}, ${style.canvasEnd})` }}
    >
      <span
        className="px-3 py-2 text-center text-[12px] font-medium"
        style={{
          background: style.accent,
          border: border === "none" ? `1px solid ${style.accent}` : border,
          borderRadius: radius,
          boxShadow: buttonShadowCss(style, true),
          color: style.accentInk,
          fontFamily: FONT_STACKS[style.headingFont],
        }}
      >
        Aa
      </span>
      <span
        className="px-3 py-2 text-center text-[12px]"
        style={{
          background:
            style.buttonFill === "outline"
              ? "transparent"
              : style.buttonFill === "tint"
                ? `${style.accent}2b`
                : `${style.surface}${Math.round((style.surfaceOpacity / 100) * 255)
                    .toString(16)
                    .padStart(2, "0")}`,
          border,
          borderRadius: radius,
          boxShadow: buttonShadowCss(style, false),
          color: style.ink,
          fontFamily: FONT_STACKS[style.bodyFont],
        }}
      >
        ·····
      </span>
    </span>
  );
}

/** The font list, each name set in the family it picks. Naming a typeface is
 *  a poor way to choose one — and seventeen of them in one column is a wall,
 *  so they come filed under the five shelves `FONT_GROUPS` defines. */
function FontSelect({
  onChange,
  value,
}: {
  readonly onChange: (next: LinkPageStyle["headingFont"]) => void;
  readonly value: LinkPageStyle["headingFont"];
}) {
  const t = useT();
  return (
    <Select value={value} onValueChange={(next) => onChange(next as LinkPageStyle["headingFont"])}>
      <SelectTrigger className="w-full" style={{ fontFamily: FONT_STACKS[value] }}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {FONT_GROUPS.map((shelf) => (
          <SelectGroup key={shelf.group}>
            <SelectLabel>{t(`links.fontGroup.${shelf.group}`)}</SelectLabel>
            {shelf.fonts.map((font) => (
              <SelectItem key={font} value={font} style={{ fontFamily: FONT_STACKS[font] }}>
                {t(`links.font.${font}`)}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

const HEX = /^#[0-9a-f]{6}$/;

/**
 * One colour: a swatch that opens the picker, and the hex it is set to, typed
 * or pasted. The swatch used to carry a transparent `<input type="color">`,
 * which meant the last step of choosing a colour happened in a panel drawn by
 * macOS or by Windows. `ColorPicker` is the app's own, so the choice stays on
 * the page, next to the preview it changes.
 */
function ColorField({
  label,
  onChange,
  value,
}: {
  readonly label: string;
  readonly onChange: (next: string) => void;
  readonly value: string;
}) {
  const t = useT();
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);

  // The preset buttons and the picker both write the value from outside; the
  // field follows them unless the change came from this input.
  useEffect(() => {
    if (value !== committed.current) setDraft(value);
    committed.current = value;
  }, [value]);

  const type = (next: string) => {
    const candidate = next.startsWith("#") ? next : `#${next}`;
    setDraft(candidate);
    if (HEX.test(candidate.toLowerCase())) {
      committed.current = candidate.toLowerCase();
      onChange(candidate.toLowerCase());
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-xl border border-border bg-background p-2",
        "transition-[border-color] duration-150 ease-out hover:border-input",
        // The hex field has no border of its own, so its focus ring is drawn
        // on the row around it. Spelt `has-[input:…]` because the bare
        // `has-[:focus-visible]` variant compiles to no rule here.
        "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-1",
        "has-[input:focus-visible]:outline-[color:var(--ring)]",
      )}
    >
      <ColorPicker
        label={label}
        onChange={(next) => {
          committed.current = next;
          setDraft(next);
          onChange(next);
        }}
        value={value}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] leading-4 font-medium">{label}</span>
        <input
          value={draft}
          aria-label={t("links.colorValue", { label })}
          spellCheck={false}
          maxLength={7}
          onChange={(event) => type(event.target.value)}
          onBlur={() => setDraft(committed.current)}
          className="w-full bg-transparent font-mono text-xs tracking-wide text-muted-foreground uppercase outline-none"
        />
      </span>
    </div>
  );
}

/** The app's segmented bar, so a choice between three looks like every other
 *  choice between three in this product. */
function Segmented<T extends string>({
  onChange,
  options,
  value,
}: {
  readonly onChange: (next: T) => void;
  readonly options: readonly { readonly id: T; readonly label: string }[];
  readonly value: string;
}) {
  return (
    <SlidingTabs
      // The bar is inline-flex; in a stretching column it would run the full
      // width with the pill stranded at one end.
      className="w-fit max-w-full self-start"
      onValueChange={(next) => onChange(next as T)}
      tabs={options}
      value={value}
    />
  );
}

/** Label, track, reading — the row used everywhere a number is dragged rather
 *  than typed. The number lives at the end in tabular figures so it stops
 *  shifting the label as it changes. */
function SliderRow({
  label,
  max,
  min = 0,
  onChange,
  suffix,
  value,
}: {
  readonly label: string;
  readonly max: number;
  readonly min?: number;
  readonly onChange: (next: number) => void;
  readonly suffix: string;
  readonly value: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 shrink-0 text-[13px] text-muted-foreground">{label}</span>
      <LiquidSlider label={label} max={max} min={min} onValueChange={onChange} step={1} value={value} />
      <span className="w-11 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        {value}
        {suffix}
      </span>
    </div>
  );
}

/** A picture the operator chose, with the way to swap it. */
function ImageRow({
  onChange,
  src,
  wide = false,
}: {
  readonly onChange: () => void;
  readonly src: string;
  readonly wide?: boolean;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-3">
      {/* Library bytes are served by id from an authenticated route, so the
          static image allowlist never covers them. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className={cn(
          "shrink-0 rounded-lg object-cover ring-1 ring-black/10 dark:ring-white/10",
          wide ? "h-16 w-24" : "size-16",
        )}
      />
      <Button onClick={onChange} size="sm" type="button" variant="outline">
        <HugeiconsIcon icon={Image01Icon} size={14} strokeWidth={1.8} />
        {t("links.changeImage")}
      </Button>
    </div>
  );
}
