"use client";

import "../product.css";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/icon";
import {
  CheckIcon,
  AuthorizedIcon,
  WhatsappIcon,
  AiWiperIcon,
  InstagramIcon,
  Cancel01Icon,
  GoogleSheetIcon,
  Calendar03Icon,
  GoogleDriveIcon,
  Mail02Icon,
  MetaIcon,
  StripeIcon,
  CreditCardIcon,
  Store01Icon,
  VolumeHighIcon,
  CallIcon,
  DatabaseIcon,
  SquareLock02Icon,
  Blockchain05Icon,
  ArrowRight01Icon,
  ArrowDown01Icon,
  ScanHeartIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Skeleton, SettingsSkeleton } from "@/components/ai-elements/skeleton";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { type CredentialGroup } from "@/lib/credentials";
import { GROUP_I18N, VALIDATION_ERROR_KEYS } from "@/lib/settings-i18n";
import { CredentialField } from "@/app/_components/credential-field";
import { describePostgresTarget, type PostgresKind } from "@/lib/postgres-target";
import { WhatsAppMark, InstagramMark, StripeMark, MetaMark } from "@/app/landing/_components/brand-marks";
import { ElevenLabsLogo, TypeSafeLogo } from "@/components/provider-logo";
import {
  TwilioBrandIcon,
  PostgresqlBrandIcon,
  GoogleCalendarBrandIcon,
  GoogleSheetsBrandIcon,
  GoogleDriveBrandIcon,
  MercadoPagoBrandIcon,
  ShopifyBrandIcon,
  ResendBrandIcon,
  DockerBrandIcon,
  SupabaseBrandIcon,
} from "@/components/icons/connection-icons";
import { ModelHealthCard } from "@/components/ai-elements/model-health-card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { fetchJson, type UiError } from "@/lib/api-error-message";
import { notifyCredentialsChanged } from "@/lib/credentials-changed";
import { TutorialTrigger } from "../../_components/tutorial-video-dialog";
import { WebhookUrlNote, type WebhookChannel } from "../../_components/webhook-url-note";
import { PageContainer } from "../../_components/page-container";
import { Card, CardHeader, CardDescription } from "../../_components/dashboard-card";
import { useEnterpriseAllowed } from "@/components/enterprise-gate";
import { Spinner } from "@/components/ui/spinner";
import { HostedChannelCards } from "./_components/hosted-channel-cards";
import { AiCreditsCard } from "./_components/ai-credits-card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useModules } from "@/lib/modules-context";
import type { ModuleId } from "@/lib/modules";

type CredentialStatus = Record<string, boolean>;

type ButtonPhase = "idle" | "saving" | "saved";


/** Groups whose card should show the callback URL for their Eve webhook. */
const WEBHOOK_CHANNELS: readonly WebhookChannel[] = ["whatsapp", "instagram"];

function isWebhookChannel(id: string): id is WebhookChannel {
  return (WEBHOOK_CHANNELS as readonly string[]).includes(id);
}

const GROUP_ICONS: Record<string, IconSvgElement> = {
  "ai-provider": AiWiperIcon,
  database: DatabaseIcon,
  whatsapp: WhatsappIcon,
  instagram: InstagramIcon,
  "google-sheets": GoogleSheetIcon,
  "google-calendar": Calendar03Icon,
  "google-drive": GoogleDriveIcon,
  stripe: StripeIcon,
  mercadopago: CreditCardIcon,
  shopify: Store01Icon,
  elevenlabs: VolumeHighIcon,
  twilio: CallIcon,
  smtp: Mail02Icon,
  resend: Mail02Icon,
  "meta-ads": MetaIcon,
  integrations: Blockchain05Icon,
  storage: DatabaseIcon,
  "oauth-apps": AuthorizedIcon,
};

/** Groups with a real brand mark on hand — everything else falls back to the
 *  generic Hugeicons glyph in `GROUP_ICONS`. `ai-provider` stays generic on
 *  purpose: it bundles several vendors, so no single mark fits the card. */
const GROUP_BRAND_ICONS: Record<string, (props: { size: number }) => React.JSX.Element> = {
  whatsapp: WhatsAppMark,
  instagram: InstagramMark,
  stripe: StripeMark,
  mercadopago: MercadoPagoBrandIcon,
  shopify: ShopifyBrandIcon,
  elevenlabs: ElevenLabsLogo,
  twilio: TwilioBrandIcon,
  "meta-ads": MetaMark,
  "google-sheets": GoogleSheetsBrandIcon,
  "google-calendar": GoogleCalendarBrandIcon,
  "google-drive": GoogleDriveBrandIcon,
  resend: ResendBrandIcon,
  database: PostgresqlBrandIcon,
  triage: TypeSafeLogo,
};

function GroupIcon({
  groupId,
  size,
  databaseKind,
}: {
  readonly groupId: string;
  readonly size: number;
  /** Where WORKFLOW_POSTGRES_URL points, so the database card wears the mark
   *  of whatever is actually serving it. */
  readonly databaseKind?: PostgresKind;
}) {
  if (groupId === "database" && databaseKind === "supabase") {
    return <SupabaseBrandIcon size={size} />;
  }
  const Brand = GROUP_BRAND_ICONS[groupId];
  if (Brand) return <Brand size={size} />;
  return <HugeiconsIcon icon={GROUP_ICONS[groupId] ?? AuthorizedIcon} size={size} strokeWidth={1.75} />;
}

/**
 * How the page decides what to show.
 *
 * An owner opening Settings used to meet 41 credentials in six sections —
 * model keys, Postgres, S3, Twilio — most of which their business will never
 * touch. Now the page leads with the AI credits their plan includes, then the
 * channels, then only the integrations something they use needs: a group
 * shows up front when its module is switched on (lib/modules.ts) or when it
 * is already configured. The rest wait, folded, under "Más integraciones";
 * what only whoever runs the install cares about sits under "Avanzado".
 */
const MODEL_HEALTH_CARD = "model-health";
const CREDITS_CARD = "ai-credits";
const EXTRA_CARDS = new Set([MODEL_HEALTH_CARD, CREDITS_CARD]);

/** The modules that make a group worth showing before it is configured. */
const GROUP_MODULES: Record<string, readonly ModuleId[]> = {
  resend: ["emails", "automations"],
  smtp: ["emails", "automations"],
  stripe: ["catalog", "links"],
  mercadopago: ["catalog", "links"],
  shopify: ["catalog"],
};

/**
 * Accounts connected by signing in, from Conexiones, rather than by typing
 * keys here. Each stands in for the credential groups that are only its
 * fallback (a Google service account, a Meta token) — those move to
 * "Avanzado", and the card says whether the account itself is connected.
 */
const ACCOUNT_CARDS: readonly { readonly id: "google" | "meta"; readonly modules: readonly ModuleId[] }[] = [
  { id: "google", modules: ["calendar", "automations", "seo"] },
  { id: "meta", modules: ["ads"] },
];

const CHANNEL_GROUPS = ["whatsapp", "instagram"];

/** For whoever maintains the install, never for the owner. */
const ADVANCED_GROUPS = [
  "google-sheets",
  "google-calendar",
  "google-drive",
  "meta-ads",
  "triage",
  "apify",
  "twilio",
  "elevenlabs",
  "database",
  "storage",
];

/** Run by Oruka on a hosted install: there is nothing here for the owner to set. */
const HOSTED_HIDDEN_GROUPS = new Set(["database", "storage"]);

type SettingsSectionView = {
  readonly id: string;
  readonly labelKey: string;
  readonly descriptionKey?: string;
  readonly icon: IconSvgElement;
  readonly cards: readonly string[];
  /** Folded until opened: the integrations nobody asked for yet, and the plumbing. */
  readonly folded?: boolean;
};

/**
 * The one group that only makes sense for a self-hosted install: the local
 * Postgres connection. Every other group — the AI provider keys most of
 * all — is the account's own configuration and stays open regardless of
 * license. The OAuth app credentials (Google, HubSpot, Slack, Notion) are
 * registered from Conexiones instead — see the "Configurar app" dialog
 * there — so they no longer have a card on this page at all.
 */
const ENTERPRISE_ONLY_GROUPS = new Set(["database"]);

/** What GET and POST /api/settings both answer with. */
type SettingsResponse = {
  readonly hosted?: boolean;
  readonly groups?: CredentialGroup[];
  /** Set in ~/.oruka/credentials.json — the only ones this app can clear. */
  readonly credentials?: Record<string, boolean>;
  /** Set anywhere, store or environment. */
  readonly configured?: Record<string, boolean>;
  readonly sources?: Record<string, "store" | "env">;
  readonly values?: Record<string, string>;
  readonly previews?: Record<string, string>;
};

type CredentialCard = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly fields: CredentialGroup["fields"];
  readonly icon: React.ReactNode;
  readonly locked: boolean;
  readonly note?: React.ReactNode;
};

export default function SettingsPage() {
  const t = useT();
  const enterprise = useEnterpriseAllowed();
  const { isEnabled, sources: connectedAccounts } = useModules();
  const [groups, setGroups] = useState<CredentialGroup[]>([]);
  const [hosted, setHosted] = useState(false);
  const [status, setStatus] = useState<CredentialStatus>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [sources, setSources] = useState<Record<string, "store" | "env">>({});
  // Snapshot of what's actually been persisted this session, keyed by field.
  // Lets the input keep showing what you typed after a save (the server
  // never echoes secrets back) while still knowing when there's nothing new
  // to submit.
  const [savedValues, setSavedValues] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Portal target only exists on the client — gate the floating bar on mount
  // so SSR never touches `document`.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const [buttonPhase, setButtonPhase] = useState<ButtonPhase>("idle");
  const buttonLabelRef = useRef<HTMLSpanElement>(null);
  const buttonIconRef = useRef<HTMLSpanElement>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const focusEditor = useRef(false);
  const focusField = useRef<string | null>(null);

  const loadSettings = useCallback(async () => {
    // Whether Google is connected decides whether the service-account
    // fallback card even applies — see the HIDDEN_GROUPS comment below —
    // so this has to land before groups are filtered, not after.
    const googleConnected = await fetch("/api/connections")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { connections?: Array<{ id: string; status: string }> } | null) =>
        data?.connections?.some((c) => c.id === "google" && c.status === "connected") ?? false,
      )
      .catch(() => false);

    const result = await fetchJson<SettingsResponse>("/api/settings", t);
    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }
    const data = result.data;
    setHosted(data.hosted ?? false);
    const HIDDEN_GROUPS = new Set([
      "whatsapp-api",
      // The OAuth app credentials (Google, HubSpot, Slack, Notion) live
      // only in Conexiones now — see the "Configurar app" dialog there —
      // so this page never renders a second card for the same values.
      "oauth-apps",
      // HTTP_ALLOWLIST and LEAD_WEBHOOK_SECRET stay real and enforced —
      // the SSRF gate and the /api/leads auth don't move — this only
      // drops their card from Settings. Still settable via env var.
      "integrations",
      // A connected account always wins over the service account (see
      // getGoogleToken in lib/google-auth.ts) — with no way to prefer the
      // service account instead. Filling this in while Google is connected
      // can never take effect, so the card would be a lie. `google-calendar`
      // stays regardless: its calendar id still overrides even when
      // connected, pointing at a shared calendar instead of "primary".
      ...(googleConnected ? ["google-sheets"] : []),
    ]);
    setGroups((data.groups ?? []).filter((group) => !HIDDEN_GROUPS.has(group.id)));
    setStatus(data.credentials ?? {});
    setConfigured(data.configured ?? {});
    setSources(data.sources ?? {});
    const stored = data.values ?? {};
    setValues((prev) => ({ ...stored, ...prev }));
    setSavedValues((prev) => ({ ...stored, ...prev }));
    setPreviews(data.previews ?? {});
    setError(null);
    setLoading(false);
  }, [t]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!expandedCard || (!focusEditor.current && !focusField.current)) return;
    const targetId = focusField.current ?? "settings-drawer-title";
    focusEditor.current = false;
    focusField.current = null;
    const focusTarget = () => {
      const target = document.getElementById(targetId);
      if (!target) return false;
      target.focus();
      return true;
    };
    if (focusTarget()) return;
    // DrawerContent mounts after Drawer receives its open state. The observer
    // also covers a validation error that opens a different card.
    const observer = new MutationObserver(() => {
      if (focusTarget()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [expandedCard, fieldErrors]);

  const toggleEditor = (id: string) => {
    if (expandedCard === id) {
      setExpandedCard(null);
      return;
    }
    focusEditor.current = true;
    setExpandedCard(id);
  };

  const closeEditor = () => {
    const triggerId = expandedCard ? `settings-trigger-${expandedCard}` : null;
    setExpandedCard(null);
    if (triggerId) requestAnimationFrame(() => document.getElementById(triggerId)?.focus());
  };

  const validateField = useCallback((key: string, value: string, pattern?: string): string | null => {
    // Keys get pasted, and a paste carries whatever whitespace came with it —
    // a trailing newline from a terminal, a leading space from a doc. The
    // value is trimmed on save, so validate what will actually be stored.
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (pattern) {
      try {
        const regex = new RegExp(pattern);
        if (!regex.test(trimmed)) {
          return t(VALIDATION_ERROR_KEYS[key] ?? "settings.validate.generic");
        }
      } catch { /* skip */ }
    }
    return null;
  }, [t]);

  const validateAll = useCallback((): string | null => {
    const errors: Record<string, string> = {};
    let firstInvalid: string | null = null;
    const provider = values.AI_PROVIDER || "gateway";
    for (const group of groups) {
      if (ENTERPRISE_ONLY_GROUPS.has(group.id) && !enterprise.loading && !enterprise.allowed) continue;
      for (const field of group.fields) {
        if (field.showWhenProvider && !field.showWhenProvider.includes(provider)) continue;
        const value = values[field.key];
        if (value) {
          const err = validateField(field.key, value, field.pattern);
          if (err) {
            errors[field.key] = err;
            firstInvalid ??= field.key;
          }
        }
      }
    }
    setFieldErrors(errors);
    return firstInvalid;
  }, [groups, values, validateField, enterprise]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Trim on the way out: a pasted key drags whitespace with it and a stored
    // "re_abc\n" fails at the vendor with an opaque 401 nobody traces back
    // here. An empty string still means "clear this field".
    const payload = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, value.trim()]),
    );
    if (Object.keys(payload).length === 0) return;
    const invalidKey = validateAll();
    if (invalidKey) {
      focusField.current = invalidKey;
      setExpandedCard(groups.find((group) => group.fields.some((field) => field.key === invalidKey))?.id ?? null);
      return;
    }

    setSaving(true);
    setSaved(false);
    setError(null);

    const result = await fetchJson<SettingsResponse>("/api/settings", t, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (result.ok) {
      // POST answers with the same shape GET does, so the form repaints from
      // the server's own view: the "Configurado" badge, the "from env" hint
      // and — the one you actually notice — the masked preview standing in as
      // each secret's placeholder. Without this the page looked unchanged
      // until a reload, which reads as "it didn't save".
      const data = result.data;
      setStatus(data.credentials ?? {});
      setConfigured(data.configured ?? {});
      setSources(data.sources ?? {});
      setPreviews(data.previews ?? {});
      // A cleared field has to come back empty rather than keep the value the
      // operator just deleted, so the server's view wins for anything it
      // returns and the typed value stands only where it doesn't.
      const stored = data.values ?? {};
      setValues((prev) => {
        const next = { ...prev, ...stored };
        for (const key of Object.keys(payload)) {
          if (payload[key] === "" && !(key in stored)) next[key] = "";
        }
        return next;
      });
      setSavedValues((prev) => ({ ...prev, ...payload, ...stored }));
      setFieldErrors({});
      setSaved(true);
      // The model picker, the health dot and the provider badge all read a
      // credential they did not save. Tell them, instead of waiting for the
      // next poll or the next reload.
      notifyCredentialsChanged();
      setTimeout(() => setSaved(false), 3000);
    } else {
      // Says which credential the server rejected, instead of one flat
      // "couldn't save" for every possible cause.
      setError(result.error);
    }
    setSaving(false);
  };

  // Drive button text-swap animation via phases
  useEffect(() => {
    if (savedTimer.current) clearTimeout(savedTimer.current);

    if (saving) {
      setButtonPhase("saving");
    } else if (saved) {
      setButtonPhase("saved");
      savedTimer.current = setTimeout(() => setButtonPhase("idle"), 3000);
    } else {
      setButtonPhase("idle");
    }
    return () => { if (savedTimer.current) clearTimeout(savedTimer.current); };
  }, [saving, saved]);

  // Animate button text swap when phase changes
  const prevPhase = useRef<ButtonPhase>("idle");
  useEffect(() => {
    if (prevPhase.current === buttonPhase) return;
    prevPhase.current = buttonPhase;
    const label = buttonLabelRef.current;
    const icon = buttonIconRef.current;
    if (!label || !icon) return;

    // Phase 1: exit old text
    label.classList.add("is-exit");
    icon.classList.add("is-exit");

    const dur = 260; // matches --text-swap-dur
    const swapTimeout = setTimeout(() => {
      label.classList.remove("is-exit");
      icon.classList.remove("is-exit");
      label.classList.add("is-enter-start");
      icon.classList.add("is-enter-start");
      // Force reflow
      void label.offsetHeight;
      label.classList.remove("is-enter-start");
      icon.classList.remove("is-enter-start");
    }, dur);

    return () => clearTimeout(swapTimeout);
  }, [buttonPhase]);

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  // Clear a configured field — sets empty string value so it gets deleted on save
  const handleClearField = (key: string) => {
    setValues((prev) => ({ ...prev, [key]: "" }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const toggleSecret = (key: string) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // The provider select drives which API-key fields are worth showing.
  // Unset means the Gateway, matching resolveProvider()'s own default.
  const activeProvider = values.AI_PROVIDER && values.AI_PROVIDER.length > 0
    ? values.AI_PROVIDER
    : "gateway";

  // Read off the connection string rather than stored separately: a second
  // "I use Supabase" setting could disagree with the URL, and then the page
  // would be wrong in a way nobody could see.
  const databaseKind = useMemo(
    () => describePostgresTarget(values.WORKFLOW_POSTGRES_URL)?.kind,
    [values.WORKFLOW_POSTGRES_URL],
  );

  const visibleFields = useCallback(
    (group: CredentialGroup) =>
      group.fields.filter(
        (field) => !field.showWhenProvider || field.showWhenProvider.includes(activeProvider),
      ),
    [activeProvider],
  );

  const isConfigured = useCallback(
    (key: string) => configured[key] ?? status[key] ?? false,
    [configured, status],
  );

  // Locked (Enterprise-only) groups render no fields, so they count toward
  // neither total nor configured — the badge reflects what's on screen.
  const isLocked = useCallback(
    (groupId: string) => ENTERPRISE_ONLY_GROUPS.has(groupId) && !enterprise.loading && !enterprise.allowed,
    [enterprise],
  );

  const configuredFields = useMemo(
    () =>
      groups.reduce(
        (sum, g) => (isLocked(g.id) ? sum : sum + visibleFields(g).filter((f) => isConfigured(f.key)).length),
        0,
      ),
    [groups, visibleFields, isLocked, isConfigured],
  );

  // A field is "dirty" (has an unsaved edit worth submitting) when its
  // current value differs from what's actually been persisted — clearing an
  // unconfigured field, or retyping exactly what's already saved, isn't.
  const isDirty = useCallback(
    (key: string): boolean => {
      const value = values[key];
      if (value === undefined) return false;
      if (value === "") return Boolean(status[key]);
      return value !== (savedValues[key] ?? "");
    },
    [values, status, savedValues],
  );
  const dirtyKeys = useMemo(
    () => new Set(Object.keys(values).filter(isDirty)),
    [values, isDirty],
  );
  // Button should be enabled only while there's an actual unsaved edit
  const canSubmit = dirtyKeys.size > 0;
  // The floating bar stays visible through the save itself and its
  // confirmation — otherwise it would vanish the instant the request
  // succeeds and the "saved" state would never be seen.
  const showSaveBar = canSubmit || saving || saved;

  // Clear all configured fields at once
  const handleClearAll = () => {
    const clears: Record<string, string> = {};
    for (const group of groups) {
      if (isLocked(group.id)) continue;
      for (const field of group.fields) {
        if (status[field.key]) {
          clears[field.key] = "";
        }
      }
    }
    setValues(clears);
  };

  /** The shared description and field data for a group's summary and editor. */
  const credentialCard = (group: CredentialGroup): CredentialCard => {
    const gi = GROUP_I18N[group.id];
    return {
      id: group.id,
      label: gi?.label ? t(gi.label) : group.label,
      description: gi?.desc ? t(gi.desc) : group.description,
      fields: visibleFields(group),
      icon: <GroupIcon groupId={group.id} size={18} databaseKind={databaseKind} />,
      locked: isLocked(group.id),
      note: isWebhookChannel(group.id) ? (
          // The one value on this card that is derived, not typed: where the
          // provider has to send its webhook. See WebhookUrlNote.
          <WebhookUrlNote channel={group.id} />
        ) : group.id !== "database" ? null : (databaseKind ?? "local") === "local" ? (
            // Docker itself has nothing to type, so it has no group here — but
            // it is what serves this database, and /setup is where you can see
            // whether its daemon and container are actually up.
            <a
              href="/setup"
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
            >
              <DockerBrandIcon size={13} />
              {t("settings.dockerStatusLink")}
            </a>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {databaseKind === "supabase" ? <SupabaseBrandIcon size={13} /> : null}
              {t(
                databaseKind === "supabase"
                  ? "settings.databaseSupabaseNote"
                  : "settings.databaseRemoteNote",
              )}
            </p>
          ),
    };
  };

  /** Fields shared by the credential drawer and its compact summary. */
  const renderCredentialFields = (card: CredentialCard) => {
    const groupFields = card.fields;
    const locked = card.locked;

    return locked ? (
      <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">{t("settings.enterpriseLockedHint")}</p>
            <a
              href="/account/billing"
              className="inline-flex min-h-8 items-center rounded-lg text-sm font-medium underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1"
            >
              {t("settings.enterpriseLockedCta")}
            </a>
      </div>
    ) : (
      <div className="space-y-5">
          {groupFields.map((field) => {
            // Configured anywhere, store or environment — that is
            // what "is this set up?" means to whoever is reading it.
            const isSet = isConfigured(field.key);
            const fromEnv = sources[field.key] === "env";
            const show = showSecrets[field.key];
            const fieldError = fieldErrors[field.key];
            // A pending (unsaved) clear always displays as not-set;
            // otherwise trust the server-confirmed status, so a
            // freshly saved value shows "Configurado" right away
            // without wiping what's still sitting in the input.
            const displaySet = values[field.key] === "" ? false : isSet;
            // Keep showing whatever the user typed/saved this
            // session — the server never echoes secrets back, so
            // this local copy is the only place it's visible.
            const inputValue = values[field.key] ?? "";

            return (
              <CredentialField
                key={field.key}
                field={field}
                value={inputValue}
                onChange={handleChange}
                activeProvider={activeProvider}
                preview={previews[field.key]}
                error={fieldError}
                show={show}
                onToggleShow={toggleSecret}
                headerExtra={
                  field.type !== "select" && field.key !== "AI_MODEL" ? (
                    // Nothing here can remove an environment
                    // variable, so an env-provided value says where
                    // it came from instead of offering a Clear that
                    // would silently do nothing.
                    fromEnv ? (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                        {t("settings.fromEnv")}
                      </span>
                    ) : displaySet ? (
                      <button
                        type="button"
                        onClick={() => handleClearField(field.key)}
                        className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-1 md:min-h-9"
                        title={t("settings.clearField")}
                      >
                        <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
                        {t("settings.clearField")}
                      </button>
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="size-1.5 rounded-full bg-muted-foreground/30" />
                        {t("settings.notSet")}
                      </span>
                    )
                  ) : null
                }
              />
            );
          })}
        {card.note}
      </div>
    );
  };

  const groupById = new Map(groups.map((group) => [group.id, group]));
  const inUse = (group: CredentialGroup) => visibleFields(group).some((field) => isConfigured(field.key));
  const aiProvider = groupById.get("ai-provider");
  /** The owner brought their own model key: it is up front, beside the credits it replaces.
   *  Off the hosted platform a key in .env is the operator's own as much as one saved here;
   *  on a hosted tenant an env key is Oruka's, the one the included credits pay for. */
  const ownKey = aiProvider
    ? inUse(aiProvider) || (!hosted && visibleFields(aiProvider).some(
      (field) => field.key !== "AI_PROVIDER" && field.key !== "AI_MODEL" && sources[field.key] === "env",
    ))
    : false;
  const shown = (id: string) => groupById.has(id) && !(hosted && HOSTED_HIDDEN_GROUPS.has(id));
  const placed = new Set(["ai-provider", ...CHANNEL_GROUPS, ...ADVANCED_GROUPS]);
  const accounts = ACCOUNT_CARDS.filter(
    (account) => connectedAccounts.includes(account.id) || account.modules.some((id) => isEnabled(id)),
  ).map((account) => `account:${account.id}`);
  const business = [
    ...accounts,
    ...groups
      .filter((group) => !placed.has(group.id) && shown(group.id))
      .filter((group) => inUse(group) || (GROUP_MODULES[group.id] ?? []).some((id) => isEnabled(id)))
      .map((group) => group.id),
  ];
  const more = groups
    .filter((group) => !placed.has(group.id) && shown(group.id) && !business.includes(group.id))
    .map((group) => group.id);
  const sectionViews: SettingsSectionView[] = [
    {
      id: "intelligence",
      labelKey: "settings.section.intelligence",
      icon: AiWiperIcon,
      cards: [CREDITS_CARD, ...(ownKey ? ["ai-provider"] : [])],
    },
    {
      id: "channels",
      labelKey: "settings.section.channels",
      icon: CallIcon,
      cards: hosted ? ["hosted-channels"] : CHANNEL_GROUPS.filter(shown),
    },
    {
      id: "business",
      labelKey: "settings.section.business",
      descriptionKey: "settings.section.businessHint",
      icon: Store01Icon,
      cards: business,
    },
    {
      id: "more",
      labelKey: "settings.section.more",
      descriptionKey: "settings.section.moreHint",
      icon: Blockchain05Icon,
      cards: more,
      folded: true,
    },
    {
      id: "advanced",
      labelKey: "settings.section.advanced",
      descriptionKey: hosted ? "settings.section.advancedHostedHint" : "settings.section.advancedHint",
      icon: DatabaseIcon,
      cards: [...(ownKey ? [] : ["ai-provider"]), MODEL_HEALTH_CARD, ...ADVANCED_GROUPS.filter(shown)].filter(
        (id) => EXTRA_CARDS.has(id) || groupById.has(id),
      ),
      folded: true,
    },
  ].filter((view) => view.cards.length > 0);
  const openGroup = expandedCard ? groupById.get(expandedCard) : undefined;
  const openCredentialCard = openGroup ? credentialCard(openGroup) : null;
  const openIsModelHealth = expandedCard === MODEL_HEALTH_CARD;
  const openTitle = openIsModelHealth ? t("models.taskTitle") : openCredentialCard?.label ?? "";
  const openDescription = openIsModelHealth ? t("models.taskDescription") : openCredentialCard?.description ?? "";

  return (
    <PageContainer
      banner={<ErrorBanner layout="strip" error={error} onDismiss={() => setError(null)} />}
      maxWidth="max-w-6xl"
      title={t("settings.title")}
      description={t("settings.simpleSubtitle")}
    >
        <Skeleton
          className="min-h-[600px]"
          isLoading={loading}
          skeleton={<SettingsSkeleton />}
        >
        <div className="content-enter pb-24 [--ring:oklch(0.61_0_0)] [--btn-focus-ring:var(--ring)] dark:[--ring:oklch(0.55_0_0)]">
        {!loading ? (
        <form id="settings-form" onSubmit={handleSubmit}>
            <div className="space-y-10">
            {sectionViews.map((section) => {
              const grid = (
                <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
                  {section.cards.map((id) => {
                    if (id === "hosted-channels") return <HostedChannelCards key={id} />;
                    if (id.startsWith("account:")) {
                      const account = id.slice("account:".length) as "google" | "meta";
                      return <AccountCard key={id} account={account} connected={connectedAccounts.includes(account)} />;
                    }
                    if (id === CREDITS_CARD) return (
                      <AiCreditsCard key={id} ownKey={ownKey} onUseOwnKey={() => toggleEditor("ai-provider")} />
                    );
                    if (id === MODEL_HEALTH_CARD) return (
                      <SettingsSummaryCard
                        key={id}
                        id={id}
                        title={t("models.taskTitle")}
                        description={t("models.taskDescription")}
                        icon={<HugeiconsIcon icon={ScanHeartIcon} size={18} strokeWidth={1.75} />}
                        expanded={expandedCard === id}
                        onToggle={() => toggleEditor(id)}
                      />
                    );
                    const group = groupById.get(id);
                    if (!group) return null;
                    const card = credentialCard(group);
                    const active = card.fields.some((field) => isConfigured(field.key));
                    return (
                      <SettingsSummaryCard
                        key={id}
                        id={id}
                        title={card.label}
                        // The one-line version; the drawer keeps the full,
                        // step-by-step description.
                        description={t(`settings.short.${id}`, undefined, card.description)}
                        icon={card.locked ? <HugeiconsIcon icon={SquareLock02Icon} size={18} strokeWidth={1.75} /> : card.icon}
                        status={card.locked
                          ? t("settings.enterpriseOnly")
                          : t(active ? "settings.status.active" : "settings.status.off")}
                        complete={!card.locked && active}
                        pending={card.fields.some((field) => dirtyKeys.has(field.key))}
                        expanded={expandedCard === id}
                        onToggle={() => toggleEditor(id)}
                      />
                    );
                  })}
                </div>
              );
              const heading = (
                <span className="flex min-w-0 items-center gap-2.5">
                  <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                    <HugeiconsIcon icon={section.icon} size={15} strokeWidth={1.75} />
                  </span>
                  <span className="truncate text-sm font-medium text-foreground">{t(section.labelKey)}</span>
                </span>
              );
              const description = section.descriptionKey ? (
                <p className="mb-4 max-w-[70ch] text-sm leading-relaxed text-muted-foreground">{t(section.descriptionKey)}</p>
              ) : null;

              if (section.folded) {
                return (
                  <Collapsible key={section.id} id={`settings-${section.id}`} className="scroll-mt-24 border-t border-border pt-4">
                    <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 rounded-lg py-1 text-left">
                      {heading}
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
                        {t("settings.section.count", { count: section.cards.length })}
                        <HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={1.75} className="transition-transform duration-200 group-data-[state=open]:rotate-180" />
                      </span>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-4">
                      {description}
                      {grid}
                      {section.id === "advanced" ? (
                        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                          <p className="max-w-[70ch] text-xs leading-relaxed text-muted-foreground">
                            {hosted ? t("settings.hostedFooterText") : t("settings.footerText", { path: "~/.oruka/credentials.json" })}
                          </p>
                          {!hosted && configuredFields > 0 && !canSubmit ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={handleClearAll}
                              className="text-xs text-muted-foreground hover:bg-destructive/5 hover:text-destructive"
                            >
                              <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={1.75} />
                              {t("settings.clearAll")}
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </CollapsibleContent>
                  </Collapsible>
                );
              }

              return (
                <section key={section.id} id={`settings-${section.id}`} className="scroll-mt-24">
                  <h2 className="mb-4">{heading}</h2>
                  {description}
                  {grid}
                </section>
              );
            })}
            </div>
        </form>
        ) : null}

        <Drawer
          open={expandedCard !== null}
          onOpenChange={(next) => { if (!next) closeEditor(); }}
          ariaLabelledBy="settings-drawer-title"
          closeLabel={t("settings.closeEditor")}
        >
          <DrawerContent
            className="max-w-2xl"
          >
            <DrawerHeader>
              <div className="flex items-center gap-2 pr-8">
                <DrawerTitle id="settings-drawer-title" tabIndex={-1} icon={openCredentialCard?.icon ?? <HugeiconsIcon icon={ScanHeartIcon} size={18} strokeWidth={1.75} />}>
                  {openTitle}
                </DrawerTitle>
                {openCredentialCard && !openCredentialCard.locked ? (
                  <TutorialTrigger id={openCredentialCard.id} name={openCredentialCard.label} className="size-9 shrink-0" />
                ) : null}
              </div>
              {openCredentialCard ? (
                <DrawerDescription>
                  {openCredentialCard.locked
                    ? t("settings.enterpriseOnly")
                    : t(openCredentialCard.fields.some((field) => isConfigured(field.key)) ? "settings.status.active" : "settings.status.off")}
                </DrawerDescription>
              ) : null}
            </DrawerHeader>
            <DrawerBody id={expandedCard ? `settings-panel-${expandedCard}` : undefined} tabIndex={-1} className="focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--ring)]">
              <ErrorBanner className="mb-5" error={error} onDismiss={() => setError(null)} />
              <p className="mb-6 max-w-[70ch] text-sm leading-relaxed text-muted-foreground">{openDescription}</p>
              {openIsModelHealth ? <ModelHealthCard embedded /> : openCredentialCard ? renderCredentialFields(openCredentialCard) : null}
            </DrawerBody>
            <DrawerFooter>
              <Button type="button" variant="outline" className="focus-visible:outline-2 focus-visible:outline-offset-1" onClick={closeEditor}>
                {t("settings.closeEditor")}
              </Button>
              {!openIsModelHealth && openCredentialCard && !openCredentialCard.locked ? (
                <Button type="submit" form="settings-form" disabled={!canSubmit || saving} className="focus-visible:outline-2 focus-visible:outline-offset-1">
                  {saving ? t("settings.saving") : saved ? t("settings.saved") : t("settings.saveChanges")}
                </Button>
              ) : null}
            </DrawerFooter>
          </DrawerContent>
        </Drawer>

        <span role="status" className="sr-only">{saved ? t("settings.saved") : ""}</span>

        {/* The portal keeps the save action anchored to the viewport while
            the page's entrance animation transforms its content. */}
        {mounted ? createPortal(
          <div
            className={cn(
              "fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-border bg-card p-2 shadow-[var(--shadow-float)] transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none sm:inset-x-auto sm:left-1/2 sm:w-auto sm:max-w-none sm:-translate-x-1/2",
              showSaveBar && !expandedCard ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0",
            )}
            aria-hidden={!showSaveBar || Boolean(expandedCard)}
            inert={!showSaveBar || Boolean(expandedCard)}
          >
            <span className="hidden whitespace-nowrap px-2 text-sm text-muted-foreground sm:inline">
              {saved ? t("settings.saved") : t("settings.unsavedCount", { count: dirtyKeys.size })}
            </span>
            <Button
              type="submit"
              form="settings-form"
              disabled={saving}
              className="w-full focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--foreground)] sm:w-auto"
              tabIndex={showSaveBar && !expandedCard ? undefined : -1}
            >
                {/* Idle has no icon, and an empty span still eats the button's
                    gap. `hidden` can't do it: `.t-text-swap` sets
                    `display: inline-block` from the stylesheet and wins over
                    the utility class, so the display is set inline instead. */}
                <span
                  ref={buttonIconRef}
                  className="t-text-swap"
                  style={{ display: buttonPhase === "idle" ? "none" : "inline-block" }}
                >
                  {buttonPhase === "saving" ? (
                    <Spinner />
                  ) : buttonPhase === "saved" ? (
                    <HugeiconsIcon icon={CheckIcon} size={16} strokeWidth={1.75} />
                  ) : null}
                </span>
                <span ref={buttonLabelRef} className="t-text-swap">
                  {buttonPhase === "saving"
                    ? t("settings.saving")
                    : buttonPhase === "saved"
                      ? t("settings.saved")
                      : t("settings.saveChanges")}
                </span>
              </Button>
          </div>,
          document.body,
        ) : null}

        </div>
        </Skeleton>
    </PageContainer>
  );
}

/** An account the owner signs in to from Conexiones, with whether it is connected. */
function AccountCard({ account, connected }: { readonly account: "google" | "meta"; readonly connected: boolean }) {
  const t = useT();
  return (
    <Card interactive className="min-h-[170px] rounded-[20px] border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]">
      <Link href="/connections" className="flex h-full flex-col rounded-[14px] focus-visible:outline-2 focus-visible:outline-offset-[-4px]">
        <div className="flex min-h-[114px] flex-1 overflow-hidden rounded-[14px] border border-border/50 bg-card shadow-xs">
          <CardHeader className="w-full">
            <div aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
              {account === "google" ? <GoogleCalendarBrandIcon size={18} /> : <MetaMark size={18} />}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-medium">{t(`settings.account.${account}`)}</h3>
              <CardDescription className="mt-1 line-clamp-2 text-xs leading-relaxed">
                {t(`settings.account.${account}Hint`)}
              </CardDescription>
            </div>
          </CardHeader>
        </div>
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 px-2.5 pt-2 pb-0.5">
          <Badge variant="secondary">
            {connected ? <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" /> : null}
            {t(connected ? "settings.account.connected" : "settings.account.notConnected")}
          </Badge>
          <span className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-muted-foreground">
            {t(connected ? "settings.account.manage" : "settings.account.connect")}
            <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.75} aria-hidden="true" />
          </span>
        </div>
      </Link>
    </Card>
  );
}

function SettingsSummaryCard({
  id,
  title,
  description,
  icon,
  status,
  complete = false,
  pending = false,
  expanded,
  onToggle,
}: {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly icon: React.ReactNode;
  readonly status?: string;
  readonly complete?: boolean;
  readonly pending?: boolean;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  const t = useT();
  return (
    <Card interactive className={cn("min-h-[170px] rounded-[20px] border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]", expanded && "border-foreground/30")}>
      <div className="flex h-full flex-col">
        <div className="flex min-h-[114px] flex-1 overflow-hidden rounded-[14px] border border-border/50 bg-card shadow-xs">
          <CardHeader className="w-full">
            <div aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
              {icon}
            </div>
            <div className="min-w-0 flex-1">
              <h3 id={`settings-title-${id}`} className="text-sm font-medium">{title}</h3>
              <CardDescription className="mt-1 line-clamp-2 text-xs leading-relaxed">{description}</CardDescription>
            </div>
          </CardHeader>
        </div>
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 px-2.5 pt-2 pb-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {status ? (
              <Badge variant="secondary" className="tabular-nums">
                {complete ? <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" /> : null}
                {status}
              </Badge>
            ) : null}
            {pending ? (
              <Badge variant="warning">
                {t("settings.pending")}
              </Badge>
            ) : null}
          </div>
          <button
            id={`settings-trigger-${id}`}
            type="button"
            onClick={onToggle}
            aria-haspopup="dialog"
            aria-label={t("settings.editNamed", { name: title })}
            className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1"
          >
            {t("settings.edit")}
            <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>
    </Card>
  );
}
