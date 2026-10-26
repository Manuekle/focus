import type { CSSProperties } from "react";
import {
  ArrowUpRight01Icon,
  Call02Icon,
  Facebook01Icon,
  Globe02Icon,
  InstagramIcon,
  LinkSquare02Icon,
  Location01Icon,
  Mail02Icon,
  TiktokIcon,
  WhatsappIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/icon";
import {
  BUTTON_RADIUS,
  FONT_STACKS,
  buttonBorderCss,
  buttonShadowCss,
  isLight,
  withAlpha,
} from "@/lib/link-page-style";
import type { LinkKind, LinkPageItem, LinkPageStyle, PublicLinkPage } from "@/lib/types";

const ICONS: Record<LinkKind, IconSvgElement> = {
  website: Globe02Icon,
  instagram: InstagramIcon,
  facebook: Facebook01Icon,
  tiktok: TiktokIcon,
  whatsapp: WhatsappIcon,
  phone: Call02Icon,
  email: Mail02Icon,
  maps: Location01Icon,
  custom: LinkSquare02Icon,
};

function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0] ?? ""}${words[1][0] ?? ""}` : words[0]?.slice(0, 2) ?? "·").toUpperCase();
}

function isExternal(destination: string): boolean {
  return destination.startsWith("https://") || destination.startsWith("http://");
}

/**
 * Every colour, radius and type family the page paints with, as inline values.
 *
 * Tailwind cannot compile a class for a colour the operator typed a second
 * ago, and an arbitrary `border-[var(--x)]` silently computes to the default
 * (see the project's own note on that). So the style becomes real CSS values
 * here, once, and every element reads them from this object.
 */
function surfaces(style: LinkPageStyle) {
  const lightCanvas = isLight(style.canvas);
  const radius = BUTTON_RADIUS[style.buttonShape];
  const border = buttonBorderCss(style);

  // Four fills, one geometry: the border and the radius are the same on all
  // of them, so switching fill never changes a button's size — only what is
  // inside its outline.
  const paint: CSSProperties =
    style.buttonFill === "outline"
      ? { background: "transparent" }
      : style.buttonFill === "tint"
        ? { background: withAlpha(style.accent, Math.max(6, Math.min(style.surfaceOpacity, 26))) }
        : style.buttonFill === "glass"
          ? {
              background: withAlpha(style.surface, Math.max(4, Math.min(style.surfaceOpacity, 22))),
              backdropFilter: "blur(18px)",
            }
          : { background: withAlpha(style.surface, style.surfaceOpacity) };

  const ordinary: CSSProperties = { ...paint, border, borderRadius: radius, color: style.ink };

  return {
    accentIconTile: { background: withAlpha(style.accentInk, 14), color: style.accentInk },
    // The plate behind the picture, which the operator can take away
    // entirely: a logo exported with a transparent background wants to sit on
    // the page, not on a tile that hides the transparency it was drawn for.
    avatar: {
      background: style.avatarSurface ? withAlpha(style.surface, Math.max(8, style.surfaceOpacity)) : "transparent",
      border: style.avatarBorder ? `1px solid ${withAlpha(style.ink, lightCanvas ? 12 : 16)}` : "none",
      color: style.ink,
    },
    featured: {
      background: style.accent,
      // The featured button keeps the same line as the others so the two sit
      // at identical heights; only its fill sets it apart.
      border: border === "none" ? `1px solid ${style.accent}` : border,
      borderRadius: radius,
      color: style.accentInk,
    },
    lightCanvas,
    ordinary,
    ordinaryIconTile: { background: withAlpha(style.ink, 10), color: style.ink },
    radius,
  };
}

function LinkButton({
  copy,
  featured = false,
  item,
  style,
  paint,
}: {
  readonly copy: PublicLinkPageCopy;
  readonly featured?: boolean;
  readonly item: LinkPageItem;
  readonly paint: ReturnType<typeof surfaces>;
  readonly style: LinkPageStyle;
}) {
  const external = isExternal(item.destination);
  return (
    <a
      href={item.destination}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      aria-label={external ? `${item.title} ${copy.newTab}` : item.title}
      className="link-page-button group relative flex min-h-14 items-center px-4 py-3 text-left transition duration-200 hover:-translate-y-0.5"
      style={{
        ...(featured ? paint.featured : paint.ordinary),
        boxShadow: buttonShadowCss(style, featured),
        ["--link-page-focus" as string]: featured ? style.accent : style.ink,
      }}
    >
      <span
        className="grid size-9 shrink-0 place-items-center rounded-xl"
        style={featured ? paint.accentIconTile : paint.ordinaryIconTile}
      >
        <HugeiconsIcon icon={ICONS[item.kind]} size={18} strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1 px-3 text-sm font-medium tracking-[-0.01em]">{item.title}</span>
      <HugeiconsIcon
        aria-hidden="true"
        className="shrink-0 opacity-60 transition-transform duration-200 group-hover:translate-x-0.5"
        icon={ArrowUpRight01Icon}
        size={16}
        strokeWidth={1.8}
      />
    </a>
  );
}

/** The visitor-facing strings. A link page is read by the business's own
 *  customers, not by whoever is signed in to the workspace, so the caller
 *  supplies the wording instead of the operator's UI locale deciding it. */
export type PublicLinkPageCopy = {
  readonly empty: string;
  readonly links: string;
  readonly logoAlt: string;
  readonly newTab: string;
};

export const DEFAULT_LINK_PAGE_COPY: PublicLinkPageCopy = {
  empty: "Esta página todavía no tiene enlaces activos.",
  links: "Enlaces",
  logoAlt: "Logo",
  newTab: "(abre en una pestaña nueva)",
};

/** Shared by the actual public route and the authenticated phone preview. */
export function LinkPageView({
  compact = false,
  copy = DEFAULT_LINK_PAGE_COPY,
  hasLogo = false,
  logoSrc,
  mediaSrc,
  page,
}: {
  readonly compact?: boolean;
  readonly copy?: PublicLinkPageCopy;
  readonly hasLogo?: boolean;
  /** The editor previews a draft, whose public logo route answers 404 until
   *  the page is published, so it passes the authenticated URL instead. */
  readonly logoSrc?: string;
  /** Same reason, for media-library pictures: `(assetId) => url`. */
  readonly mediaSrc?: (assetId: string) => string;
  readonly page: PublicLinkPage;
}) {
  const style = page.style;
  const paint = surfaces(style);
  const asset = mediaSrc ?? ((assetId: string) => `/l/${encodeURIComponent(page.slug)}/media/${assetId}`);
  const logoUrl = logoSrc ?? `/l/${encodeURIComponent(page.slug)}/logo`;

  // Cast by the plate, not by the picture: a transparent logo with no plate
  // would otherwise drop a rectangular shadow around nothing.
  const avatarShadow = style.avatarSurface ? `0 18px 45px ${withAlpha(style.canvasEnd, 45)}` : undefined;

  const avatarSrc =
    style.avatar.kind === "asset"
      ? asset(style.avatar.assetId)
      : style.avatar.kind === "business" && hasLogo
        ? logoUrl
        : null;

  return (
    <main
      // In the editor the page fills the phone screen rather than the
      // browser viewport: `svh` inside a scaled preview is the wrong ruler.
      className={`relative isolate overflow-hidden ${compact ? "min-h-full" : "min-h-svh"}`}
      style={{
        background: `linear-gradient(to bottom, ${style.canvas}, ${style.canvasEnd})`,
        color: style.ink,
        fontFamily: FONT_STACKS[style.bodyFont],
      }}
    >
      {style.background.kind === "image" ? (
        <>
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: `url(${asset(style.background.assetId)})`,
              filter: style.background.blur > 0 ? `blur(${style.background.blur}px)` : undefined,
              // A blurred layer shows its own soft edges; scaling it past the
              // viewport keeps the corners covered.
              transform: style.background.blur > 0 ? "scale(1.06)" : undefined,
            }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{ background: withAlpha(style.canvas, style.background.dim) }}
          />
        </>
      ) : null}

      {style.background.kind === "grid" ? (
        <>
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              background: `radial-gradient(60% 38% at 50% 0%, ${withAlpha(paint.lightCanvas ? "#ffffff" : style.accent, paint.lightCanvas ? 85 : 14)}, transparent 70%)`,
            }}
          />
          {/* One texture, fading out before it reaches the links: a
              full-viewport grid at full strength reads as graph paper and
              competes with the buttons. */}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-[520px]"
            style={{
              backgroundImage: `linear-gradient(to right, ${withAlpha(style.ink, 7)} 1px, transparent 1px), linear-gradient(to bottom, ${withAlpha(style.ink, 7)} 1px, transparent 1px)`,
              backgroundSize: "32px 32px",
              maskImage: "linear-gradient(to bottom, black, transparent)",
              WebkitMaskImage: "linear-gradient(to bottom, black, transparent)",
            }}
          />
        </>
      ) : null}

      <div
        className={`relative mx-auto flex w-full max-w-xl flex-col px-5 ${compact ? "min-h-full pt-16 pb-12" : "min-h-svh py-12 sm:py-16"}`}
      >
        <section className="mx-auto w-full max-w-md text-center">
          {avatarSrc && style.avatarSize === "wide" ? (
            // A wordmark is not a square. It keeps its own proportions inside
            // the frame, and the frame is what carries the padding — padding
            // on the image itself would eat into its height instead.
            <span
              className="mx-auto flex w-fit max-w-full items-center justify-center"
              style={{
                ...paint.avatar,
                borderRadius: "18px",
                padding: style.avatarSurface || style.avatarBorder ? "10px 18px" : undefined,
                boxShadow: avatarShadow,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={avatarSrc}
                alt={`${copy.logoAlt} ${page.profile.title}`}
                className="h-[56px] w-auto max-w-full object-contain"
              />
            </span>
          ) : avatarSrc ? (
            // Served at runtime by a slug-scoped route, so it cannot use the
            // app's static Next Image allowlist.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarSrc}
              alt={`${copy.logoAlt} ${page.profile.title}`}
              className="mx-auto size-[78px] rounded-[28px] object-cover"
              style={{ ...paint.avatar, boxShadow: avatarShadow }}
            />
          ) : (
            <div
              aria-hidden="true"
              className="mx-auto grid size-[78px] place-items-center rounded-[28px] text-2xl font-medium tracking-[-0.08em]"
              style={{
                ...paint.avatar,
                boxShadow: avatarShadow,
                fontFamily: FONT_STACKS[style.headingFont],
              }}
            >
              {initials(page.profile.title)}
            </div>
          )}

          <h1
            className={`mt-5 text-balance text-3xl leading-[1.05] font-medium tracking-[-0.02em] ${compact ? "sm:text-3xl" : "sm:text-4xl"}`}
            style={{ fontFamily: FONT_STACKS[style.headingFont] }}
          >
            {page.profile.title}
          </h1>
          {page.profile.description ? (
            <p
              className="mx-auto mt-3 max-w-sm text-pretty text-[0.9375rem] leading-6"
              style={{ color: withAlpha(style.ink, 72) }}
            >
              {page.profile.description}
            </p>
          ) : null}
        </section>

        <section
          aria-label={`${copy.links} ${page.profile.title}`}
          className="mx-auto mt-9 flex w-full max-w-md flex-col gap-3"
        >
          {page.featured ? (
            <LinkButton copy={copy} featured item={page.featured} paint={paint} style={style} />
          ) : null}
          {page.links.map((item) => (
            <LinkButton copy={copy} item={item} key={item.id} paint={paint} style={style} />
          ))}
          {!page.featured && page.links.length === 0 ? (
            <p
              className="px-4 py-5 text-center text-sm"
              style={{ ...paint.ordinary, color: withAlpha(style.ink, 65) }}
            >
              {copy.empty}
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
