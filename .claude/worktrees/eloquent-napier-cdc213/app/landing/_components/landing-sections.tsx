"use client";

import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/icon";
import {
  ArrowRight01Icon,
  BubbleChatIcon,
  ChartIncreaseIcon,
  RepeatIcon,
  WebhookIcon,
} from "@hugeicons/core-free-icons";
import { type ReactNode, useState } from "react";
import { ChromaticTextReveal } from "@/components/motion/chromatic-text-reveal";
import { TextReveal } from "@/components/motion/text-reveal";
import { AnthropicLogo, DeepSeekLogo, GeminiLogo, OllamaLogo, OpenAiLogo, VercelLogo } from "@/components/provider-logo";
import { useT } from "@/lib/i18n/provider";
import { PrincipleVignette } from "./story/principle-vignette";
import { StoryFrame, type StoryScene } from "./story/story-frame";
import {
  ElevenLabsMark,
  GoogleMark,
  InstagramMark,
  MetaMark,
  StripeMark,
  WhatsAppMark,
} from "./brand-marks";
import { MercadoPagoBrandIcon } from "@/components/icons/connection-icons";
import { BrandGlow } from "./lighting";
import styles from "./editorial.module.css";
import { GUARANTEE_ICONS } from "./server-guarantees";
import { DeferredLicenseCard, DeferredServerArt } from "./deferred-art";
import hairline from "./hairline/hairline.module.css";
import { HumanVisual } from "./human-visual";
import {
  Disclosure,
  FigureLabel,
  Reveal,
  SectionIntro,
  Shell,
} from "./primitives";

// ── Channel band ────────────────────────────────────────────────────

/**
 * The places a customer already writes to you, in the platforms' own colours
 * and at a size you can read across a room.
 *
 * It used to be a four-item marquee of monochrome glyphs at 15px, printed four
 * times so the track was wide enough to scroll. Two things were wrong with it:
 * a strip that moves on its own asks to be watched and then says nothing worth
 * watching, and "Chat web" alongside three product names is a feature standing
 * in a line of brands.
 *
 * Meta stands for the leads a Meta Ads form collects, which is what the line
 * underneath says instead of the old sentence about webhooks. A webhook is an
 * automation trigger; it was never somewhere a customer writes to you, which
 * is the claim this section makes.
 */
const CHANNELS: readonly {
  /** The mark's own brand value, for the bloom under it. */
  readonly glow: string;
  readonly label: string;
  readonly mark: ReactNode;
}[] = [
  { glow: "#25D366", label: "WhatsApp", mark: <WhatsAppMark size={34} /> },
  // The magenta from the middle of the ramp, not the orange at its end: the
  // gradient runs yellow through magenta to violet, and magenta is the one
  // anybody would name if you asked them what colour Instagram is.
  { glow: "#FC01D8", label: "Instagram", mark: <InstagramMark size={34} /> },
  { glow: "#0081FB", label: "Meta", mark: <MetaMark size={38} /> },
];

/** The six routes `lib/provider-catalog.ts` can be pointed at. Keep in step
 *  with AI_PROVIDERS in lib/model-catalog.ts. */
const PROVIDERS: readonly { readonly label: string; readonly mark: ReactNode }[] = [
  { label: "Anthropic", mark: <AnthropicLogo size={20} /> },
  { label: "OpenAI", mark: <OpenAiLogo size={20} /> },
  { label: "Gemini", mark: <GeminiLogo size={20} /> },
  { label: "DeepSeek", mark: <DeepSeekLogo size={20} /> },
  { label: "Ollama", mark: <OllamaLogo size={20} /> },
  { label: "Vercel AI Gateway", mark: <VercelLogo size={18} /> },
];

export function ChannelBand() {
  const t = useT();

  return (
    <section className="border-border border-y py-20 sm:py-24">
      <Shell>
        <TextReveal
          as="h2"
          blur={6}
          className="mx-auto max-w-[22ch] text-balance text-center font-cooper text-[clamp(1.75rem,3.8vw,2.75rem)] text-foreground leading-[1.06] font-medium tracking-[-0.02em]"
          stagger={0.045}
          text={t("landing.channels.heading")}
          whileInView
          yOffset="24%"
        />

        <Reveal delay={80}>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-x-14 gap-y-9 sm:gap-x-20">
            {CHANNELS.map((channel) => (
              <span className="flex items-center gap-3.5" key={channel.label}>
                {/* The one hue the rig allows. These marks were already the
                    page's exception — full colour, on a product that has none
                    — and they were the only bright objects on a lit page
                    throwing no light of their own, which is what made them
                    read as three stickers rather than three things in the
                    room. The label beside each one stays plain: a glowing
                    logo is a light source, a glowing word is a neon sign. */}
                <BrandGlow colour={channel.glow}>{channel.mark}</BrandGlow>
                <span className="whitespace-nowrap font-cooper text-[clamp(1.25rem,2.4vw,1.75rem)] text-foreground leading-none tracking-[-0.02em]">
                  {channel.label}
                </span>
              </span>
            ))}
          </div>
        </Reveal>

        <Reveal delay={140}>
          <p className="mx-auto mt-11 max-w-[52ch] text-center text-[15px] leading-relaxed text-muted-foreground">
            {t("landing.channels.body")}
          </p>
        </Reveal>

        {/* The other half of the claim: the channels are theirs, the model is
            yours. Same hairline the feature sections use, so the two halves
            read as one section rather than as two bands stacked.

            The line names one route at a time and the row shows all three
            marks, so neither repeats the other. It is the one moving thing
            left in this section, and it moves for a reason the copy needs:
            "the model is your choice" is a list, and a list read aloud is
            what a cycling word is. */}
        <Reveal delay={200}>
          {/* The rule under the channel row, with a source on it. It is the
              one divider on the page that is also a hinge — everything above
              it is what oruka connects to and everything below is what runs
              the replies — and the hot spot at its centre is where the light
              that lit the hero enters this section. A plain hairline here read
              as the section ending twice. */}
          <div className="lp-filament mt-14 border-border border-t pt-10">
            <p className="text-center text-[13px] text-muted-foreground">
              {/* The prefix cannot wrap — the component keeps it on one line so
                  the sweep has a stable box to travel across — and the word
                  slot always reserves the width of the longest option. Kept
                  short so prefix plus «Vercel AI Gateway» still fits inside a
                  360px phone's rail. */}
              <ChromaticTextReveal
                pauseDuration={1.6}
                prefix={t("landing.channels.modelPrefix")}
                words={PROVIDERS.map((provider) => provider.label)}
              />
            </p>
            <div className="mt-6 flex items-center justify-center gap-9 text-muted-foreground">
              {PROVIDERS.map((provider) => (
                <span key={provider.label} title={provider.label}>
                  {provider.mark}
                </span>
              ))}
            </div>
          </div>
        </Reveal>
      </Shell>
    </section>
  );
}

// ── Principles ──────────────────────────────────────────────────────

/**
 * The three jobs, and the section that shows each one. The feature sections
 * below follow this order and carry the job's name over their figure number,
 * so the page reads as three answers rather than a list of features.
 */
const PRINCIPLES: readonly {
  readonly figure: string;
  readonly href: string;
  readonly icon: IconSvgElement;
  readonly id: "attend" | "follow" | "sell";
}[] = [
  { figure: "Fig 0.1", href: "#bandeja", icon: BubbleChatIcon, id: "attend" },
  { figure: "Fig 0.2", href: "#ads", icon: ChartIncreaseIcon, id: "sell" },
  { figure: "Fig 0.3", href: "#automatizaciones", icon: RepeatIcon, id: "follow" },
];

export function Principles() {
  const t = useT();

  return (
    <section className="relative isolate overflow-hidden py-24 sm:py-32">
      <div aria-hidden="true" className="bg-pattern bg-pattern-dots pointer-events-none absolute inset-0 -z-10 opacity-45" />
      <Shell className="relative">
        <TextReveal
          as="h2"
          blur={6}
          className="max-w-[18ch] text-balance font-heading font-cooper text-[clamp(2rem,4.4vw,3rem)] text-foreground leading-[1.02] font-medium tracking-[-0.02em]"
          stagger={0.045}
          text={t("landing.principles.heading")}
          whileInView
          yOffset="24%"
        />

        {/* Rules, not cards.

            The section used to be three `lp-cap` cards — the app's KPI tile,
            with its surface, its radius, its double edge and its sheen. That
            tile earns its weight where it holds something: a number, a
            screenshot, a scene the cursor resolves. Here it holds a sentence,
            and a filled box around a sentence is packaging.

            What is left is the measurement itself: `.lp-line` puts a hairline
            over each column, the columns sit flush so those three hairlines
            read as one rule across the row, a vertical hairline separates
            them, and the container closes the block underneath. The columns
            are the same width they were, so the rhythm of the section does not
            move — only the box around it goes.

            The leftmost column carries no left inset: its heading has to start
            on the same rail as the section's own, or the whole row reads as
            indented from the page. */}
        <div className="mt-14 grid border-border border-b sm:grid-cols-3">
          {PRINCIPLES.map((principle, index) => (
            <Reveal
              key={principle.id}
              className="lp-line group flex flex-col py-8 sm:border-border sm:border-l sm:px-7 sm:py-9 sm:first:border-l-0 sm:first:pl-0 sm:last:pr-0"
              delay={index * 70}
            >
              <div className="flex items-center justify-between">
                <FigureLabel>{principle.figure}</FigureLabel>
                <HugeiconsIcon
                  className="text-muted-foreground transition-colors duration-200 group-hover:text-foreground"
                  icon={principle.icon}
                  size={16}
                  strokeWidth={1.5}
                />
              </div>
              <div className="mt-6">
                <PrincipleVignette id={principle.id} delay={index * 250} />
              </div>
              <h3 className="mt-6 text-lg font-medium tracking-[-0.02em]">
                {t(`landing.principles.${principle.id}.title`)}
              </h3>
              <p className="mt-2.5 text-[15px] text-muted-foreground leading-relaxed">
                {t(`landing.principles.${principle.id}.body`)}
              </p>
              <a
                className="lp-focus group/link mt-auto inline-flex min-h-6 w-fit items-center gap-1.5 pt-5 font-medium text-foreground text-sm"
                href={principle.href}
              >
                {t(`landing.principles.${principle.id}.link`)}
                <HugeiconsIcon
                  className="transition-transform duration-200 ease-[var(--lp-ease)] group-hover/link:translate-x-1"
                  icon={ArrowRight01Icon}
                  size={15}
                  strokeWidth={2}
                />
              </a>
            </Reveal>
          ))}
        </div>
      </Shell>
    </section>
  );
}

// ── Feature section shell ───────────────────────────────────────────

/**
 * One feature: introduction, its story loop on the dot plate, then
 * disclosures for the details. The label tells the story for anyone who
 * cannot see it; the picture itself stays inert.
 */
function FeatureSection({
  body,
  disclosures,
  figure,
  footer,
  id,
  label,
  scene,
  title,
  visual,
}: {
  readonly body: ReactNode;
  readonly disclosures: readonly { readonly detail: string; readonly label: ReactNode }[];
  readonly figure: ReactNode;
  /** Optional block between the screen and the disclosures. */
  readonly footer?: ReactNode;
  readonly id: string;
  /** Names the screen for anyone who cannot see it. */
  readonly label: string;
  readonly scene: StoryScene;
  readonly title: readonly string[];
  readonly visual?: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 border-border border-t py-24 sm:py-32">
      <Shell>
        <SectionIntro figure={figure} title={title} body={body} visual={visual} />
      </Shell>

      {/* The screen sits on the wide rail, not on the copy rail — the same
          `1240px` the hero mockup uses. Every figure on the page is then the
          same object photographed from the same distance; running the first
          one 120px wider than the four below it read as four screenshots that
          had been shrunk to fit. */}
      {/* Leave clearance for the frame's light. Image fades already provide
          visual separation, so those sections need a smaller following gap. */}
      <div className={`relative mx-auto w-full max-w-[1240px] px-6 sm:px-8 ${visual ? "mt-12 sm:mt-16" : "mt-20 sm:mt-24"}`}>
        <Reveal delay={60} lift={false}>
          <StoryFrame scene={scene} label={label} />
        </Reveal>
      </div>

      <Shell>
        {footer}
        <Reveal delay={80}>
          <div className="mt-16 grid gap-x-10 sm:mt-20 sm:grid-cols-2 lg:grid-cols-3">
            {disclosures.map((item) => (
              <Disclosure key={item.detail} label={item.label}>
                {item.detail}
              </Disclosure>
            ))}
          </div>
        </Reveal>
      </Shell>
    </section>
  );
}

// ── Bandeja ─────────────────────────────────────────────────────────

export function InboxSection() {
  const t = useT();

  return (
    <FeatureSection
      id="bandeja"
      scene="inbox"
      figure={`Fig 01 · ${t("landing.principles.attend.title")}`}
      label={t("landing.story.inbox.label")}
      title={[t("landing.features.inbox.titleLine1"), t("landing.features.inbox.titleLine2")]}
      body={t("landing.features.inbox.body")}
      visual={<HumanVisual scene="care" />}
      disclosures={[
        {
          label: t("landing.features.inbox.disclosure1.label"),
          detail: t("landing.features.inbox.disclosure1.detail"),
        },
        {
          label: t("landing.features.inbox.disclosure2.label"),
          detail: t("landing.features.inbox.disclosure2.detail"),
        },
        {
          label: t("landing.features.inbox.disclosure3.label"),
          detail: t("landing.features.inbox.disclosure3.detail"),
        },
      ]}
    />
  );
}

// ── Automatizaciones ────────────────────────────────────────────────


/**
 * What a flow can do at its far end, and nothing it cannot.
 *
 * Every entry here is a credential group in Configuración with a step or a
 * tool behind it — `send_payment_link` calls `lib/stripe.ts`, `log_sheet`
 * calls `lib/google-sheets.ts`, the calendar tools call `lib/calendar.ts` off
 * the same Google service account, `send_audio` reaches ElevenLabs through
 * `lib/elevenlabs.ts`, and `http_request` is bounded by the host allowlist. A logo strip on a landing page is a promise about integrations,
 * and it is the easiest one on a page like this to write ahead of the code.
 */
/* Same rule as the channel row: a mark that carries its own colour carries its
   own light. `glow` is `null` for the two that are monochrome — a neutral
   bloom under a grey wordmark is a smudge, and this row is a footnote, not a
   light show. The three that do glow run at a third of the channel row's
   brightness, which is what puts them further away rather than making them a
   second claim. */
const CONNECTORS: readonly {
  readonly detailKey: string;
  /** The mark's brand value, or `null` when the mark has no colour of its own. */
  readonly glow: string | null;
  /** `null` for a literal brand name — nothing to translate. */
  readonly labelKey: string | null;
  readonly label: string;
  readonly mark: ReactNode;
}[] = [
  {
    detailKey: "landing.features.automation.connectorStripe",
    // Stripe's violet. The slot holds two marks and one light; Mercado Pago's
    // cyan under the same bloom would be two lamps in one 48px box.
    glow: "#635BFF",
    labelKey: "landing.features.automation.connectorPaymentsLabel",
    label: "",
    mark: (
      <span className="flex items-center gap-1.5">
        <StripeMark size={26} />
        <MercadoPagoBrandIcon size={22} />
      </span>
    ),
  },
  {
    detailKey: "landing.features.automation.connectorSheets",
    glow: "#4285F4",
    labelKey: "landing.features.automation.connectorSheetsLabel",
    label: "",
    mark: <GoogleMark size={26} />,
  },
  {
    detailKey: "landing.features.automation.connectorVoice",
    glow: "#FF5C35",
    labelKey: "landing.features.automation.connectorVoiceLabel",
    label: "",
    mark: <ElevenLabsMark height={15} />,
  },
  {
    detailKey: "landing.features.automation.connectorApi",
    glow: null,
    labelKey: "landing.features.automation.connectorApiLabel",
    label: "",
    mark: (
      <HugeiconsIcon
        className="shrink-0 text-muted-foreground"
        icon={WebhookIcon}
        size={22}
        strokeWidth={1.5}
      />
    ),
  },
];

function AutomationConnectors() {
  const t = useT();

  return (
    <Reveal delay={80}>
      <div className="mt-16 border-border border-t pt-10 sm:mt-20">
        <p className="text-center text-[13px] text-muted-foreground">
          {t("landing.features.automation.connectorsIntro")}
        </p>
        <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {CONNECTORS.map((connector) => (
            <div className="flex flex-col items-center gap-2.5 text-center" key={connector.detailKey}>
              {/* Fixed-height slot: the marks have wildly different aspect
                  ratios — a square G, a wide parallelogram, a wordmark seven
                  times wider than it is tall — and without it the labels sit
                  at four different heights. */}
              <span className="flex h-7 items-center">
                {connector.glow ? (
                  <BrandGlow colour={connector.glow} intensity={0.34}>
                    {connector.mark}
                  </BrandGlow>
                ) : (
                  connector.mark
                )}
              </span>
              <p className="mt-1 font-medium text-[15px] text-foreground">
                {connector.labelKey ? t(connector.labelKey) : connector.label}
              </p>
              <p className="max-w-[26ch] text-[13px] leading-relaxed text-muted-foreground">
                {t(connector.detailKey)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </Reveal>
  );
}

export function AutomationSection() {
  const t = useT();

  return (
    <section
      id="automatizaciones"
      className={`${styles.automation} scroll-mt-20 border-border border-t py-24 sm:py-32`}
    >
      <Shell>
        <div className={styles.automationHead}>
          <Reveal>
            <FigureLabel>{`Fig 03 · ${t("landing.principles.follow.title")}`}</FigureLabel>
            <TextReveal
              as="h2"
              className="mt-5 max-w-[15ch] font-cooper text-[clamp(2.5rem,4.4vw,3.5rem)] leading-[1.12] font-medium tracking-[-0.02em]"
              text={[t("landing.features.automation.titleLine1"), t("landing.features.automation.titleLine2")]}
              whileInView
            />
          </Reveal>
          <Reveal delay={60}>
            <p className="max-w-[46ch] text-[15px] leading-relaxed text-muted-foreground">
              {t("landing.features.automation.body")}
            </p>
          </Reveal>
        </div>

      </Shell>

      {/* The same wide rail and dot plate as the other four stories. */}
      <div className="relative mx-auto mt-20 w-full max-w-[1240px] px-6 sm:mt-24 sm:px-8">
        <Reveal delay={60} lift={false}>
          <StoryFrame scene="automation" label={t("landing.story.automation.label")} />
        </Reveal>
      </div>

      <Shell>
        <Reveal>
          <div className="mt-10 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((index) => (
              <Disclosure key={index} label={t(`landing.features.automation.disclosure${index}.label`)}>
                {t(`landing.features.automation.disclosure${index}.detail`)}
              </Disclosure>
            ))}
          </div>
        </Reveal>
        <AutomationConnectors />
      </Shell>
    </section>
  );
}

// ── Agentes ─────────────────────────────────────────────────────────

export function AgentsSection() {
  const t = useT();

  return (
    <FeatureSection
      id="agentes"
      scene="agents"
      figure="Fig 04"
      label={t("landing.story.agents.label")}
      title={[t("landing.features.agents.titleLine1"), t("landing.features.agents.titleLine2")]}
      body={t("landing.features.agents.body")}
      visual={<HumanVisual scene="team" />}
      disclosures={[
        {
          label: t("landing.features.agents.disclosure1.label"),
          detail: t("landing.features.agents.disclosure1.detail"),
        },
        {
          label: t("landing.features.agents.disclosure2.label"),
          detail: t("landing.features.agents.disclosure2.detail"),
        },
        {
          label: t("landing.features.agents.disclosure3.label"),
          detail: t("landing.features.agents.disclosure3.detail"),
        },
      ]}
    />
  );
}

// ── Meta Ads ────────────────────────────────────────────────────────

export function AdsSection() {
  const t = useT();

  return (
    <FeatureSection
      id="ads"
      scene="ads"
      figure={`Fig 02 · ${t("landing.principles.sell.title")}`}
      label={t("landing.story.ads.label")}
      title={[t("landing.features.ads.titleLine1"), t("landing.features.ads.titleLine2")]}
      body={t("landing.features.ads.body")}
      disclosures={[
        {
          label: t("landing.features.ads.disclosure1.label"),
          detail: t("landing.features.ads.disclosure1.detail"),
        },
        {
          label: t("landing.features.ads.disclosure2.label"),
          detail: t("landing.features.ads.disclosure2.detail"),
        },
        {
          label: t("landing.features.ads.disclosure3.label"),
          detail: t("landing.features.ads.disclosure3.detail"),
        },
      ]}
    />
  );
}

// ── Autoalojado ─────────────────────────────────────────────────────

/**
 * The six guarantees, as properties of one machine.
 *
 * They used to be six cards, each with its own drawing. Six drawings of six
 * things read as six products; what a buyer's technical person is actually
 * looking at is one install, so it is drawn once — the `server` Hairline
 * figure — and the guarantees are listed beside it. Pointing at a part of the
 * machine lights the lines that part holds (`PART_GUARANTEES`).
 *
 * Two entries here were true long before they were said: every inbound webhook
 * is verified by an HMAC over the raw body before it is parsed, and every
 * outbound call the agent makes is bounded by an allowlist that also refuses
 * loopback, private ranges and raw IPs.
 */
const STACK: readonly {
  readonly bodyKey: string;
  /** Keys the glyph in `GUARANTEE_ICONS`. */
  readonly id: string;
  readonly titleKey: string;
}[] = [
  {
    id: "database",
    bodyKey: "landing.selfHosted.database.body",
    titleKey: "landing.selfHosted.database.title",
  },
  {
    id: "sandbox",
    bodyKey: "landing.selfHosted.sandbox.body",
    titleKey: "landing.selfHosted.sandbox.title",
  },
  {
    id: "webhooks",
    bodyKey: "landing.selfHosted.webhooks.body",
    titleKey: "landing.selfHosted.webhooks.title",
  },
  {
    id: "keys",
    bodyKey: "landing.selfHosted.keys.body",
    titleKey: "landing.selfHosted.keys.title",
  },
  {
    id: "allowlist",
    bodyKey: "landing.selfHosted.allowlist.body",
    titleKey: "landing.selfHosted.allowlist.title",
  },
  {
    id: "traces",
    bodyKey: "landing.selfHosted.traces.body",
    titleKey: "landing.selfHosted.traces.title",
  },
];

/**
 * Which guarantees each part of the machine holds: the figure names the part
 * under the pointer, and these are the lines beside it that answer.
 */
const PART_GUARANTEES: Readonly<Record<string, readonly string[]>> = {
  control: ["keys", "traces"],
  host: ["allowlist"],
  runtime: ["sandbox"],
  storage: ["database"],
  webhook: ["webhooks"],
};

export function SelfHostedSection() {
  const t = useT();
  const [part, setPart] = useState<string | null>(null);
  const lit = part ? PART_GUARANTEES[part] ?? [] : [];

  return (
    <section id="autoalojado" className={`${styles.surface} ${styles.hosting} scroll-mt-20 border-border border-t py-24 sm:py-32`}>
      <Shell className={styles.hostingContent}>
        <div className={styles.hostingIntro}>
          <Reveal>
            <FigureLabel>Enterprise</FigureLabel>
            <TextReveal
              as="h2"
              className="mt-5 font-cooper text-[clamp(2.5rem,4.4vw,3.5rem)] leading-[1.25] overflow-visible pb-[0.12em] font-medium tracking-[-0.02em]"
              text={[t("landing.selfHosted.titleLine1"), t("landing.selfHosted.titleLine2")]}
              whileInView
            />
            <p className="mt-6 max-w-[48ch] text-[15px] leading-relaxed text-muted-foreground">
              {t("landing.selfHosted.body")}
            </p>
          </Reveal>

          <Reveal lift={false} delay={80}>
            <figure className={styles.installation}>
              {/* The licence itself — the one thing Enterprise sells. It turns
                  over on click and does nothing else: a drag here would fight
                  the page's scroll. The numbers on it are a sample. */}
              <DeferredLicenseCard
                className="w-full"
                flipOnly
                info={{
                  daysUntilMaintenanceEnds: null,
                  installationMatches: null,
                  maintenanceActive: true,
                  payload: {
                    company: t("landing.selfHosted.license.company"),
                    customerEmail: "",
                    deploymentType: "self-hosted",
                    edition: "enterprise",
                    features: [],
                    issuedAt: "2026-01-01T00:00:00.000Z",
                    licenseId: "5f3a9c2e-7b41-4d8a-9e06-c1d2b3a4f5e6",
                    maintenanceUntil: "2030-12-31T00:00:00.000Z",
                    schemaVersion: 1,
                  },
                  status: "valid",
                }}
                installationId="a3f9c1d0-77b2-4e58-9c31-6de0f28a4b17"
              />
              <figcaption className={styles.modelConnection}>
                <span>{t("landing.selfHosted.installation.connection")}</span>
                <div aria-hidden="true" className="mt-1 flex items-center gap-5">
                  {PROVIDERS.map((provider) => <span key={provider.label}>{provider.mark}</span>)}
                </div>
              </figcaption>
            </figure>
          </Reveal>
        </div>

        {/* One machine beside what it guarantees. The drawing is the list's
            picture: point at a part and the lines it holds answer. */}
        <div className={styles.serverRow}>
          <Reveal lift={false}>
            <figure className={`${hairline.plate} ${styles.serverPlan}`} data-tone="neutral">
              <DeferredServerArt onActive={setPart} />
            </figure>
          </Reveal>

          <div className={styles.guarantees} data-lit={lit.length > 0 || undefined}>
          {STACK.map((item, index) => {
            const icon = GUARANTEE_ICONS[item.id];
            return (
              <Reveal key={item.id} delay={(index % 2) * 60}>
                <article className={styles.guarantee} data-active={lit.includes(item.id) || undefined}>
                  {icon ? (
                    <HugeiconsIcon className="text-muted-foreground" icon={icon} size={18} strokeWidth={1.5} />
                  ) : null}
                  <h3 className="mt-3 text-[15px] font-medium tracking-[-0.02em]">{t(item.titleKey)}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{t(item.bodyKey)}</p>
                </article>
              </Reveal>
            );
          })}
          </div>
        </div>
      </Shell>
    </section>
  );
}
// The closing call to action used to live here as `ClosingSection`: a
// full-bleed band with a beam down its centre, sitting immediately above a
// footer that then said nothing. It is `ClosingPanel` in `landing-footer.tsx`
// now — one ending instead of two, and on every marketing page rather than
// only this one.
