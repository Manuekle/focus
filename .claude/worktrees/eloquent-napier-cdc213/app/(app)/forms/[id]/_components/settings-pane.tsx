"use client";

import { useState } from "react";
import { AnimatedQR } from "@/components/motion/animated-qr";
import { DownloadAnimation } from "@/components/motion/download-animation";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  AlertCircleIcon,
  CheckIcon,
  Copy01Icon,
  Download04Icon,
  LinkSquare02Icon,
  PencilEdit01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/provider";
import type { FormDraft } from "@/lib/forms/draft";
import type { FormIssue } from "@/lib/forms/schema";
import type { Form } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useSound } from "@/components/sound-provider";

/**
 * The dock's settings tab: everything about the form that isn't a question.
 *
 * Two kinds of field live here and they behave differently on purpose. The
 * name, description, closing message and thresholds are part of the draft and
 * ride along with the toolbar's Save — they change what a respondent sees, and
 * a half-typed threshold should not reach a published form. The link, the
 * webhook and the published switch save on their own, because each is a single
 * decision with nothing to batch it with.
 */
export function SettingsPane({
  active,
  form,
  draft,
  ceiling,
  origin,
  issues,
  onDraftChange,
  onSlugSave,
  onWebhookSave,
}: {
  readonly active: boolean;
  readonly form: Form;
  readonly draft: FormDraft;
  readonly ceiling: number;
  readonly origin: string;
  /** Scoring problems only — everything else belongs next to the step that
   *  caused it. */
  readonly issues: readonly FormIssue[];
  readonly onDraftChange: (patch: Partial<FormDraft>) => void;
  readonly onSlugSave: (slug: string) => Promise<boolean>;
  readonly onWebhookSave: (url: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [editingSlug, setEditingSlug] = useState(false);
  const [slugDraft, setSlugDraft] = useState(form.slug);
  const [savingSlug, setSavingSlug] = useState(false);
  const [webhookDraft, setWebhookDraft] = useState(form.webhookUrl ?? "");
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [webhookSaved, setWebhookSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const { cue } = useSound();

  const publicUrl = `${origin}/f/${form.slug}`;
  const qrSrc = `/api/forms/${form.id}/qr?v=${encodeURIComponent(form.slug)}`;
  const unreachable = ceiling > 0 && draft.scoring.hot > ceiling;

  const downloadQr = () => {
    const link = document.createElement("a");
    link.href = `${qrSrc}&download`;
    link.download = "";
    link.click();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      cue("success", { emphasis: "subtle" });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The link is on screen either way.
    }
  };

  const saveSlug = async () => {
    const next = slugDraft.trim();
    if (!next || next === form.slug) {
      setEditingSlug(false);
      return;
    }
    setSavingSlug(true);
    const ok = await onSlugSave(next);
    setSavingSlug(false);
    if (ok) setEditingSlug(false);
  };

  const saveWebhook = async () => {
    const next = webhookDraft.trim();
    if (next === (form.webhookUrl ?? "")) return;
    setSavingWebhook(true);
    const ok = await onWebhookSave(next);
    setSavingWebhook(false);
    if (!ok) return;
    setWebhookSaved(true);
    setTimeout(() => setWebhookSaved(false), 2000);
  };

  return (
    <div className="y-fade h-full overflow-y-auto scrollbar-hide px-3 pb-6">
      <Section label={t("forms.builder.basicsTitle")}>
        <Input
          aria-label={t("forms.builder.name")}
          value={draft.name}
          placeholder={t("forms.builder.name")}
          onChange={(event) => onDraftChange({ name: event.target.value })}
          className="h-8"
        />
        <Input
          aria-label={t("forms.builder.description")}
          value={draft.description}
          placeholder={t("forms.builder.descriptionPlaceholder")}
          onChange={(event) => onDraftChange({ description: event.target.value })}
          className="h-8"
        />
        <Textarea
          aria-label={t("forms.builder.thankYou")}
          value={draft.thankYou ?? ""}
          rows={2}
          placeholder={t("forms.builder.thankYouPlaceholder")}
          onChange={(event) => onDraftChange({ thankYou: event.target.value || undefined })}
        />
      </Section>

      <Section
        label={t("forms.builder.scoringTitle")}
        hint={
          ceiling > 0
            ? t("forms.builder.scoringDescription", { max: ceiling })
            : t("forms.builder.scoringUnscored")
        }
      >
        <div className="flex items-end gap-3">
          <label className="flex flex-1 flex-col gap-1 text-[11px] text-muted-foreground">
            {t("forms.builder.hotFrom")}
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={String(draft.scoring.hot)}
              onChange={(event) =>
                onDraftChange({
                  scoring: {
                    ...draft.scoring,
                    hot: Number.isFinite(event.target.valueAsNumber)
                      ? Math.max(0, Math.trunc(event.target.valueAsNumber))
                      : 0,
                  },
                })
              }
              className="h-8"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-[11px] text-muted-foreground">
            {t("forms.builder.warmFrom")}
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={String(draft.scoring.warm)}
              onChange={(event) =>
                onDraftChange({
                  scoring: {
                    ...draft.scoring,
                    warm: Number.isFinite(event.target.valueAsNumber)
                      ? Math.max(0, Math.trunc(event.target.valueAsNumber))
                      : 0,
                  },
                })
              }
              className="h-8"
            />
          </label>
        </div>

        {issues.map((issue) => (
          <p
            key={`${issue.path}:${issue.code}`}
            className="flex items-start gap-1.5 text-[11px] text-destructive"
          >
            <HugeiconsIcon
              icon={AlertCircleIcon}
              size={12}
              strokeWidth={1.75}
              className="mt-0.5 shrink-0"
            />
            {t(`forms.builder.issue.${issue.code}`, {}, issue.message)}
          </p>
        ))}

        {unreachable ? (
          <p className="flex items-center gap-1.5 text-[11px] text-[var(--status-review-fg)]">
            <HugeiconsIcon icon={AlertCircleIcon} size={12} strokeWidth={1.75} />
            {t("forms.builder.hotUnreachable", { max: ceiling })}
          </p>
        ) : null}

        {ceiling > 0 ? (
          <div>
            {/* Cold, warm and hot as the share of the ceiling each one owns —
                two numbers in boxes don't show that "warm" is most of the
                range and "hot" is a sliver. */}
            <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <span
                className="bg-muted-foreground/30"
                style={{ width: `${(Math.min(draft.scoring.warm, ceiling) / ceiling) * 100}%` }}
              />
              <span
                className="bg-[var(--status-review-fg)]/60"
                style={{
                  width: `${(Math.max(0, Math.min(draft.scoring.hot, ceiling) - Math.min(draft.scoring.warm, ceiling)) / ceiling) * 100}%`,
                }}
              />
              <span className="flex-1 bg-[var(--status-success-fg)]/70" />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
              <span>{t("forms.temperature.cold")}</span>
              <span>{t("forms.temperature.warm")}</span>
              <span>{t("forms.temperature.hot")}</span>
            </div>
          </div>
        ) : null}
      </Section>

      <Section label={t("forms.detail.publicLink")}>
        {editingSlug ? (
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-[10px] text-muted-foreground">/f/</span>
            <Input
              aria-label={t("forms.detail.slugLabel")}
              autoFocus
              value={slugDraft}
              onChange={(event) => setSlugDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveSlug();
                if (event.key === "Escape") setEditingSlug(false);
              }}
              className="h-8 min-w-0 flex-1"
            />
            <Button variant="outline" size="sm" className="h-8" disabled={savingSlug} onClick={() => void saveSlug()}>
              <HugeiconsIcon icon={CheckIcon} size={13} strokeWidth={1.75} />
            </Button>
          </div>
        ) : (
          <code className="block truncate rounded-lg bg-muted px-2.5 py-1.5 text-[11px]">
            {publicUrl}
          </code>
        )}

        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => void copyLink()}>
            <HugeiconsIcon icon={copied ? CheckIcon : Copy01Icon} size={13} strokeWidth={1.75} />
            {copied ? t("forms.linkCopied") : t("forms.copyLink")}
          </Button>
          <Button asChild variant="outline" size="sm" className="h-8 text-xs">
            <a href={`/f/${form.slug}`} target="_blank" rel="noreferrer">
              <HugeiconsIcon icon={LinkSquare02Icon} size={13} strokeWidth={1.75} />
              {t("forms.openPublic")}
            </a>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setSlugDraft(form.slug);
              setEditingSlug(true);
            }}
          >
            <HugeiconsIcon icon={PencilEdit01Icon} size={13} strokeWidth={1.75} />
            {t("forms.detail.editSlug")}
          </Button>
        </div>

        <div className="flex flex-wrap items-start gap-3 pt-1">
          {/* The canvas and printable SVG encode the same complete matrix.
              Keep a light background in both themes for reliable scanning. */}
          {/* Replay only the QR on tab entry; keep unsaved settings mounted. */}
          {active ? (
            <AnimatedQR
              source={`/api/forms/${form.id}/qr?v=${encodeURIComponent(form.slug)}`}
              size={180}
              label={t("forms.detail.qrAlt", { name: form.name })}
              downloadLabel={t("forms.detail.qrDownload")}
              className="shrink-0"
              onDownload={downloadQr}
            />
          ) : null}
          <div className="flex min-w-32 flex-1 flex-col items-start gap-1.5">
            <DownloadAnimation onDownload={downloadQr}>
              <Button variant="outline" size="sm" className="h-8 text-xs">
                <HugeiconsIcon icon={Download04Icon} size={13} strokeWidth={1.75} />
                {t("forms.detail.qrDownload")}
              </Button>
            </DownloadAnimation>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              {form.status === "published"
                ? t("forms.detail.qrHint")
                : t("forms.detail.qrDraftWarning")}
            </p>
          </div>
        </div>
      </Section>

      <Section
        label={t("forms.detail.webhookTitle")}
        hint={t("forms.detail.webhookDescription")}
      >
        <div className="flex items-center gap-1.5">
          <Input
            aria-label={t("forms.detail.webhookPlaceholder")}
            type="url"
            inputMode="url"
            value={webhookDraft}
            onChange={(event) => setWebhookDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void saveWebhook();
            }}
            placeholder={t("forms.detail.webhookPlaceholder")}
            className="h-8 min-w-0 flex-1 font-mono text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => void saveWebhook()}
            disabled={savingWebhook || webhookDraft.trim() === (form.webhookUrl ?? "")}
          >
            <HugeiconsIcon icon={CheckIcon} size={13} strokeWidth={1.75} />
            {webhookSaved ? t("forms.detail.webhookSaved") : t("forms.detail.slugSave")}
          </Button>
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {t("forms.detail.webhookHint")}
        </p>
      </Section>
    </div>
  );
}

function Section({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className={cn("border-b border-border/60 py-4 last:border-0")}>
      <p className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
        {label}
      </p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
      <div className="mt-2.5 space-y-2">{children}</div>
    </section>
  );
}
