"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  Call02Icon,
  Globe02Icon,
  Mail02Icon,
  Store01Icon,
  AiSearch02Icon,
} from "@hugeicons/core-free-icons";
import { SlidingTabs } from "@/components/ai-elements/sliding-tabs";
import { SkeletonBar } from "@/components/ai-elements/skeleton";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/provider";
import { fetchJson } from "@/lib/api-error-message";
import { ErrorBanner } from "@/components/ui/error-banner";
import type { BusinessIdentity, BusinessProfileRecord } from "@/lib/business-profile-store";
import { BusinessIdentityForm, LogoPreview } from "./business-identity-form";
import { BusinessLegalForm } from "./business-legal-form";
import { BusinessProfilePanel } from "./business-profile-panel";
import { BookingPolicyForm } from "./booking-policy-form";

type Tab = "identity" | "profile" | "booking" | "legal";

function blankIdentity(): BusinessIdentity {
  return {
    name: "",
    description: "",
    websiteUrl: "",
    email: "",
    phone: "",
    address: "",
    hours: "",
    bookingPolicy: null,
    logo: null,
    terms: null,
    privacy: null,
    updatedAt: null,
  };
}

const TABS = [
  { id: "identity", labelKey: "business.tabIdentity" },
  { id: "profile", labelKey: "business.tabProfile" },
  { id: "booking", labelKey: "business.tabBooking" },
  { id: "legal", labelKey: "business.tabLegal" },
] as const satisfies readonly { id: Tab; labelKey: string }[];

/** Save state bubble from child forms up to the card footer. */
export type SaveState = {
  dirty: boolean;
  saving: boolean;
  canSave: boolean;
};

export function BusinessCard() {
  const { t } = useI18n();

  const [identity, setIdentity] = useState<BusinessIdentity>(blankIdentity);
  const [record, setRecord] = useState<BusinessProfileRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [tab, setTab] = useState<Tab>("identity");

  // The footer Save button delegates to whichever form is active via this ref.
  const saveRef = useRef<(() => void) | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({
    dirty: false,
    saving: false,
    canSave: false,
  });

  const load = useCallback(async () => {
    const result = await fetchJson<{
      record: BusinessProfileRecord | null;
      identity: BusinessIdentity;
    }>("/api/business-profile", t);
    if (result.ok) {
      setRecord(result.data.record);
      setIdentity(result.data.identity);
      setLoadFailed(false);
    } else {
      setLoadFailed(true);
    }
    setLoading(false);
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reset footer state when the tab changes — the new form will push its own.
  useEffect(() => {
    saveRef.current = null;
    setSaveState({ dirty: false, saving: false, canSave: false });
  }, [tab]);

  const displayName = identity.name || record?.profile.name || "";
  const displayDescription = identity.description || record?.profile.description || "";

  // Identity and Legal get the unified footer Save. Profile drives the same
  // footer strip with its Analyze action instead of its old inline button.
  const showFooter = !loading;

  return (
    <div className="mb-6 rounded-[20px] border border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]">
      <div className="flex flex-col">
        <div className="overflow-hidden rounded-[14px] border border-border/50 bg-card shadow-xs">
          {/* Card header — logo + name + contact chips */}
          <div className="flex items-start gap-3 px-5 pt-5 pb-4">
            {loading ? (
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                <HugeiconsIcon icon={Store01Icon} size={17} strokeWidth={1.75} />
              </div>
            ) : (
              <LogoPreview identity={identity} className="size-11" />
            )}
            <div className="min-w-0 flex-1">
              {loading ? (
                <div className="space-y-2 py-1">
                  <SkeletonBar className="h-4 w-40" />
                  <SkeletonBar className="h-3 w-64" />
                </div>
              ) : (
                <>
                  <p className="text-sm font-medium">{displayName || t("business.title")}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {displayDescription || t("business.subtitle")}
                  </p>
                  <ContactChips identity={identity} />
                </>
              )}
            </div>
          </div>
          <div className="mx-5 h-px bg-border/50" />

          {/* Tabs + content body */}
          <div className="space-y-4 px-5 py-4">
            {loadFailed ? (
              <ErrorBanner messageKey="business.loadFailed" onRetry={() => void load()} />
            ) : null}

            <SlidingTabs
              tabs={TABS.map(({ id, labelKey }) => ({ id, label: t(labelKey) }))}
              value={tab}
              onValueChange={(value) => setTab(value as Tab)}
            />

            {loading ? (
              <div className="space-y-3 py-2">
                <SkeletonBar className="h-9 w-full rounded-lg" />
                <SkeletonBar className="h-9 w-3/4 rounded-lg" />
              </div>
            ) : tab === "identity" ? (
              <BusinessIdentityForm
                identity={identity}
                onChange={setIdentity}
                onSaveRef={saveRef}
                onSaveState={setSaveState}
              />
            ) : tab === "profile" ? (
              <BusinessProfilePanel
                record={record}
                onChange={setRecord}
                onSaveRef={saveRef}
                onSaveState={setSaveState}
              />
            ) : tab === "booking" ? (
              <BookingPolicyForm
                identity={identity}
                onChange={setIdentity}
                onSaveRef={saveRef}
                onSaveState={setSaveState}
              />
            ) : (
              <BusinessLegalForm
                identity={identity}
                onChange={setIdentity}
                onSaveRef={saveRef}
                onSaveState={setSaveState}
              />
            )}
          </div>
        </div>

        {/* Footer action strip — Save for identity/legal, Analyze for profile. */}
        {showFooter ? (
          <div className="flex flex-wrap items-center gap-2 px-2.5 pt-2 pb-0.5">
            {tab === "profile" ? (
              <>
                <Button
                  variant="ai"
                  size="sm"
                  disabled={!saveState.canSave || saveState.saving}
                  onClick={() => saveRef.current?.()}
                >
                  {saveState.saving ? (
                    <Spinner size={15} strokeWidth={2} />
                  ) : (
                    <HugeiconsIcon icon={AiSearch02Icon} size={15} strokeWidth={1.75} />
                  )}
                  {record ? t("businessProfile.reanalyze") : t("businessProfile.analyzeAction")}
                </Button>
                {!saveState.dirty && !saveState.saving ? (
                  <p className="text-xs text-muted-foreground">{t("businessProfile.emptyHint")}</p>
                ) : null}
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  disabled={!saveState.canSave || saveState.saving}
                  onClick={() => saveRef.current?.()}
                >
                  {saveState.saving ? <Spinner size={15} strokeWidth={2} /> : null}
                  {t("common.save")}
                </Button>
                {saveState.dirty && !saveState.saving ? (
                  <p className="text-xs text-muted-foreground">{t("business.unsaved")}</p>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ContactChips({ identity }: { readonly identity: BusinessIdentity }) {
  const chips = [
    identity.websiteUrl
      ? {
          icon: Globe02Icon,
          label: identity.websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""),
        }
      : null,
    identity.email ? { icon: Mail02Icon, label: identity.email } : null,
    identity.phone ? { icon: Call02Icon, label: identity.phone } : null,
  ].filter((chip): chip is { icon: typeof Globe02Icon; label: string } => chip !== null);

  if (chips.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {chips.map((chip) => (
        <span key={chip.label} className="flex min-w-0 items-center gap-1.5">
          <HugeiconsIcon icon={chip.icon} size={13} strokeWidth={1.75} />
          <span className="truncate">{chip.label}</span>
        </span>
      ))}
    </div>
  );
}
