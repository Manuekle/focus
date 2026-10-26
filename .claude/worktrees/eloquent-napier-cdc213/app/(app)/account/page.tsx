"use client";

import "../product.css";
import { AccountSkeleton } from "./page-skeleton";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  AuthorizedIcon,
  Logout01Icon,
  Invoice04Icon,
  Camera01Icon,
} from "@hugeicons/core-free-icons";
import type { BillingOverview } from "@/lib/billing-summary";
import { getPlan } from "@/lib/plans";
import { PageContainer } from "../../_components/page-container";
import { Card } from "../../_components/dashboard-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/error-banner";
import Image from "next/image";
import { SignOutButton } from "@/components/sign-out-button";
import { Skeleton } from "@/components/ai-elements/skeleton";
import { LicenseCard } from "@/components/ai-elements/license-card";
import { SoundSettings } from "../../_components/sound-settings";
import { BusinessesCard } from "../../_components/businesses-card";
import { CreditsOverviewCard } from "../../_components/credits-overview-card";
import { TwoFactorCard } from "@/components/account/two-factor-card";
import { useT } from "@/lib/i18n/provider";
import { fetchJson, type UiError } from "@/lib/api-error-message";
import { Spinner } from "@/components/ui/spinner";
import { AvatarCropDialog } from "@/components/avatar-crop-dialog";

export default function AccountPage() {
  const t = useT();

  const [email, setEmail] = useState<string | null>(null);
  const [hasAvatar, setHasAvatar] = useState(false);
  const [googlePicture, setGooglePicture] = useState<string | null>(null);
  /** Bumped after a successful upload to bust the img cache. */
  const [avatarTs, setAvatarTs] = useState(0);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  /** File selected but not yet cropped — opens the crop dialog. */
  const [cropFile, setCropFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<UiError | null>(null);
  const [billing, setBilling] = useState<BillingOverview | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<UiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const result = await fetchJson<{ email: string; hasAvatar: boolean; googlePicture: string | null }>("/api/account", t);
    if (result.ok) {
      setEmail(result.data.email);
      setHasAvatar(result.data.hasAvatar);
      setGooglePicture(result.data.googlePicture);
      setLoadError(null);
    } else {
      setLoadError(result.error);
    }
    setLoading(false);
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void fetch("/api/billing/plan")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: BillingOverview | null) => {
        if (data) setBilling(data);
      })
      .catch(() => null);
  }, []);

  const handleAvatarChange = useCallback(async (file: File) => {
    if (!file) return;
    // Open the crop dialog instead of uploading directly.
    setCropFile(file);
    // Clear input so the same file can be re-selected later.
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  }, []);

  /** Called by AvatarCropDialog when the user confirms the crop. */
  const handleCroppedBlob = useCallback(async (blob: Blob) => {
    setCropFile(null);
    setUploadingAvatar(true);
    const form = new FormData();
    form.append("file", blob, "avatar.jpg");
    try {
      const res = await fetch("/api/account/avatar", { method: "POST", body: form });
      if (res.ok) {
        setHasAvatar(true);
        setAvatarTs(Date.now());
      }
    } finally {
      setUploadingAvatar(false);
    }
  }, []);

  const resetForm = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFieldError(null);
    setSaveError(null);
    setSaved(false);

    if (newPassword.length < 10) {
      setFieldError(t("auth.errorWeak"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setFieldError(t("auth.errorPasswordMismatch"));
      return;
    }

    setSaving(true);
    const result = await fetchJson("/api/account/password", t, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    setSaving(false);

    if (result.ok) {
      resetForm();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } else {
      setSaveError(result.error);
    }
  };

  // Plan line: the plan, then how it is held (lib/billing-summary.ts), so a
  // beta tenant reads "Pro · Beta privada" rather than "Sin plan" — the
  // licence the old line read only exists on self-hosted installs.
  const planParts = billing
    ? [
        billing.access === "operator"
          ? t("billing.operatorName")
          : billing.plan !== "none"
            ? t(getPlan(billing.plan).nameKey)
            : t("account.planNone"),
        billing.access === "none" ? undefined : t(`billing.access.${billing.access}`),
      ].filter(Boolean)
    : [t("account.planLoading")];

  const toneDot =
    billing?.paymentPastDue && billing.access === "subscription"
      ? "bg-amber-500"
      : billing?.access === "beta" || billing?.access === "subscription" || billing?.access === "license"
        ? "bg-emerald-500"
        : "bg-muted-foreground/40";

  return (
    <PageContainer
      maxWidth="max-w-4xl"
      title={t("account.title")}
      description={t("account.subtitle")}
    >
      <AvatarCropDialog
        file={cropFile}
        onConfirm={(blob) => void handleCroppedBlob(blob)}
        onCancel={() => setCropFile(null)}
        onReplace={(file) => setCropFile(file)}
      />
      <Skeleton className="min-h-[400px]" isLoading={loading} skeleton={<AccountSkeleton />}>
        <div className="content-enter">
          <ErrorBanner className="mb-4" error={loadError} onRetry={() => void load()} />

          {/* Identity and plan in one block. */}
          <Card className="mb-4">
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">

              {/* Avatar — uploaded photo > Google picture > initials fallback */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  aria-label={t("account.avatarChange")}
                  disabled={uploadingAvatar}
                  onClick={() => avatarInputRef.current?.click()}
                  className="group relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-muted to-accent text-lg font-medium text-foreground/70 shadow-[var(--shadow-inset)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {hasAvatar ? (
                    <Image
                      src={`/api/account/avatar?v=${avatarTs}`}
                      alt=""
                      fill
                      sizes="56px"
                      className="object-cover"
                    />
                  ) : googlePicture ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={googlePicture}
                      referrerPolicy="no-referrer"
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    (email ?? "?").charAt(0).toUpperCase()
                  )}
                  {/* Camera overlay on hover */}
                  <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                    {uploadingAvatar ? (
                      <Spinner size={16} strokeWidth={2} className="text-white" />
                    ) : (
                      <HugeiconsIcon icon={Camera01Icon} size={16} strokeWidth={1.75} className="text-white" />
                    )}
                  </span>
                </button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleAvatarChange(file);
                  }}
                />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-muted-foreground">
                  {t("account.emailCardTitle")}
                </p>
                <p className="mt-1 truncate text-base font-medium">{email ?? "—"}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={`size-1.5 shrink-0 rounded-full ${toneDot}`} />
                  <span className="truncate">{planParts.join(" · ")}</span>
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {billing?.access === "operator" ? null : (
                  <Button asChild variant="outline" size="sm" className="text-xs">
                    <a href="/pricing">{t("account.planViewPlans")}</a>
                  </Button>
                )}
                <Button asChild size="sm" className="text-xs">
                  <a href="/account/billing">
                    <HugeiconsIcon icon={Invoice04Icon} size={14} strokeWidth={1.75} />
                    {t("account.planManageBilling")}
                  </a>
                </Button>
              </div>
            </div>
          </Card>

          {/* Credits left this period sit next to the plan line that pays for
              them — the question people open this page with most often. */}
          <CreditsOverviewCard />

          {/* Right under the account it belongs to, and above the plan: which
              businesses this installation runs is a bigger fact about it than
              which tier it is on. */}
          <BusinessesCard />

          {/* The licence itself, drawn as the card it is — edition, holder,
              expiry and installation id all live on its two faces. Only a
              self-hosted install can hold one. */}
          {billing?.mode === "self-hosted" ? <LicenseCard /> : null}

          <Card className="mb-4 rounded-[20px] border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]">
            <div className="flex flex-col">
              <div className="overflow-hidden rounded-[14px] border border-border/50 bg-card p-5 shadow-xs">
                <div className="mb-4 flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                    <HugeiconsIcon icon={AuthorizedIcon} size={16} strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-medium">{t("account.changePasswordTitle")}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t("account.changePasswordDescription")}</p>
                  </div>
                </div>
                <form className="space-y-4" onSubmit={onSubmit}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <label htmlFor="current-password" className="text-sm font-medium">
                        {t("account.currentPassword")}
                      </label>
                      <Input
                        id="current-password"
                        type="password"
                        autoComplete="current-password"
                        value={currentPassword}
                        onChange={(event) => setCurrentPassword(event.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="new-password" className="text-sm font-medium">
                        {t("auth.newPassword")}
                      </label>
                      <Input
                        id="new-password"
                        type="password"
                        autoComplete="new-password"
                        minLength={10}
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        required
                      />
                      <p className="text-xs text-muted-foreground">{t("auth.passwordHint")}</p>
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="confirm-new-password" className="text-sm font-medium">
                        {t("auth.confirmPassword")}
                      </label>
                      <Input
                        id="confirm-new-password"
                        type="password"
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        required
                      />
                    </div>
                  </div>

                  {fieldError ? <p className="text-xs text-destructive">{fieldError}</p> : null}
                  <ErrorBanner error={saveError} onDismiss={() => setSaveError(null)} />
                </form>
              </div>
              {/* Actions row — outside the inner border, matching the skills card footer */}
              <div className="flex flex-wrap items-center gap-2 px-2.5 pt-2 pb-0.5">
                <Button
                  type="submit"
                  size="sm"
                  disabled={saving || !currentPassword || !newPassword || !confirmPassword}
                  onClick={onSubmit}
                >
                  {saving ? <Spinner size={15} strokeWidth={2} /> : null}
                  {t("account.changePasswordAction")}
                </Button>
                {saved ? (
                  <p className="text-xs text-muted-foreground">{t("account.changePasswordSuccess")}</p>
                ) : null}
              </div>
            </div>
          </Card>

          <TwoFactorCard />

          {/* Two short cards that were each spending a full page-width row. */}
          <div className="grid gap-4 lg:grid-cols-2 [&>*]:mb-0">
            <SoundSettings />

            <div className="rounded-[20px] border border-border/70 bg-muted/50 p-1.5 shadow-[var(--shadow-float)]">
              <div className="flex flex-col">
                <div className="overflow-hidden rounded-[14px] border border-border/50 bg-card p-5 shadow-xs">
                  <div className="flex items-start gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                      <HugeiconsIcon icon={Logout01Icon} size={16} strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-medium">{t("account.signOutCardTitle")}</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">{t("account.signOutCardDescription")}</p>
                    </div>
                  </div>
                </div>
                <div className="px-2.5 pt-2 pb-1">
                  <SignOutButton
                    className="w-full justify-center rounded-[10px] bg-[var(--btn-destructive-bg)] px-4 py-2.5 text-sm text-[var(--btn-destructive-fg)] shadow-[var(--btn-destructive-shadow)] hover:bg-[var(--btn-destructive-bg-hover)]"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </Skeleton>
    </PageContainer>
  );
}
