"use client";

import { useCallback, useEffect, useState } from "react";
import type React from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Delete02Icon, Edit02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/provider";
import { useSound } from "@/components/sound-provider";
import { useCelebrate } from "@/components/use-celebrate";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast-provider";
import { fetchJson, type UiError } from "@/lib/api-error-message";
import { ErrorBanner } from "@/components/ui/error-banner";
import type { BusinessProfile, BusinessProfileRecord } from "@/lib/business-profile-store";
import { Spinner } from "@/components/ui/spinner";

/**
 * Feeds the AI analyzer whatever the owner has on hand — a website, a Google
 * Maps listing, free-text notes — and shows the structured profile it comes
 * back with. Nothing here is required on its own: the analyze button only
 * needs one of the three, and the documents already uploaded below are folded
 * in automatically on the server side.
 *
 * Every generated field can then be corrected by hand. The model reads a
 * website well and still gets the odd thing wrong, and re-analysing to fix one
 * word would throw away everything else it got right.
 */

/** The generated lists are edited as one-per-line text — a chip editor for
 *  five short strings is more machinery than the job needs. */
function linesToList(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

type Draft = {
  name: string;
  industry: string;
  description: string;
  tone: string;
  location: string;
  hours: string;
  services: string;
  highlights: string;
};

function toDraft(profile: BusinessProfile): Draft {
  return {
    name: profile.name,
    industry: profile.industry,
    description: profile.description,
    tone: profile.tone,
    location: profile.location ?? "",
    hours: profile.hours ?? "",
    services: profile.services.join("\n"),
    highlights: profile.highlights.join("\n"),
  };
}

export function BusinessProfilePanel({
  record,
  onChange,
  onSaveRef,
  onSaveState,
}: {
  readonly record: BusinessProfileRecord | null;
  readonly onChange: (record: BusinessProfileRecord | null) => void;
  readonly onSaveRef?: React.MutableRefObject<(() => void) | null>;
  readonly onSaveState?: (state: { dirty: boolean; saving: boolean; canSave: boolean }) => void;
}) {
  const { t, locale } = useI18n();
  const { cue } = useSound();
  const celebrate = useCelebrate();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const { toast } = useToast();

  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  const [websiteUrl, setWebsiteUrl] = useState("");
  const [mapsUrl, setMapsUrl] = useState("");
  const [notes, setNotes] = useState("");

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const canAnalyze = Boolean(websiteUrl.trim() || mapsUrl.trim() || notes.trim());

  const analyze = useCallback(async () => {
    if (!canAnalyze) return;
    setAnalyzing(true);
    setError(null);
    const result = await fetchJson<{ record: BusinessProfileRecord }>("/api/business-profile", t, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        websiteUrl: websiteUrl.trim() || undefined,
        mapsUrl: mapsUrl.trim() || undefined,
        notes: notes.trim() || undefined,
      }),
    });
    setAnalyzing(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    celebrate();
    setEditing(false);
    onChange(result.data.record);
    setWebsiteUrl("");
    setMapsUrl("");
    setNotes("");
  }, [canAnalyze, websiteUrl, mapsUrl, notes, t, cue, celebrate, onChange]);

  // The Analyze action lives in the card footer (like Save on the other
  // tabs), so bubble its state up and wire the footer button to it.
  useEffect(() => {
    onSaveState?.({ dirty: canAnalyze, saving: analyzing, canSave: canAnalyze && !analyzing });
  }, [canAnalyze, analyzing, onSaveState]);

  useEffect(() => {
    if (onSaveRef) onSaveRef.current = () => void analyze();
  }, [onSaveRef, analyze]);

  const startEditing = useCallback(() => {
    if (!record) return;
    setDraft(toDraft(record.profile));
    setEditing(true);
  }, [record]);

  const saveEdits = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const result = await fetchJson<{ record: BusinessProfileRecord }>("/api/business-profile", t, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.name,
        industry: draft.industry,
        description: draft.description,
        tone: draft.tone,
        location: draft.location,
        hours: draft.hours,
        services: linesToList(draft.services),
        highlights: linesToList(draft.highlights),
      }),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    cue("success");
    setEditing(false);
    onChange(result.data.record);
    toast({ title: t("common.saved"), status: "success" });
  }, [cue, draft, onChange, t, toast]);

  const clear = useCallback(async () => {
    if (!(await confirm({ title: t("businessProfile.confirmClear") }))) return;
    cue("close");
    const previous = record;
    setEditing(false);
    onChange(null);
    try {
      const res = await fetch("/api/business-profile", { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
    } catch {
      onChange(previous);
      setError({ messageKey: "businessProfile.clearFailed" });
    }
  }, [confirm, cue, onChange, record, t]);

  const formattedDate = record
    ? new Date(record.editedAt ?? record.generatedAt).toLocaleString(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "";

  return (
    <div className="space-y-4">
      {confirmDialog}
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="bp-website" className="mb-1.5 block text-sm font-medium">
            {t("businessProfile.websiteLabel")}
          </label>
          <Input
            id="bp-website"
            value={websiteUrl}
            onChange={(event) => setWebsiteUrl(event.target.value)}
            placeholder={t("businessProfile.websitePlaceholder")}
            type="url"
          />
        </div>
        <div>
          <label htmlFor="bp-maps" className="mb-1.5 block text-sm font-medium">
            {t("businessProfile.mapsLabel")}
          </label>
          <Input
            id="bp-maps"
            value={mapsUrl}
            onChange={(event) => setMapsUrl(event.target.value)}
            placeholder={t("businessProfile.mapsPlaceholder")}
            type="url"
          />
        </div>
      </div>

      <div>
        <label htmlFor="bp-notes" className="mb-1.5 block text-sm font-medium">
          {t("businessProfile.notesLabel")}
        </label>
        <Textarea
          id="bp-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder={t("businessProfile.notesPlaceholder")}
          rows={2}
        />
      </div>

      {record ? (
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          <div className="space-y-4 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{record.profile.name}</p>
                <p className="text-xs text-muted-foreground">{record.profile.industry}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {!editing ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("businessProfile.edit")}
                    onClick={startEditing}
                  >
                    <HugeiconsIcon icon={Edit02Icon} size={15} strokeWidth={1.75} />
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("businessProfile.clear")}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => void clear()}
                >
                  <HugeiconsIcon icon={Delete02Icon} size={15} strokeWidth={1.75} />
                </Button>
              </div>
            </div>

            {editing && draft ? (
              <ProfileEditor
                draft={draft}
                saving={saving}
                onChange={setDraft}
              />
            ) : (
              <ProfileView profile={record.profile} />
            )}

            {record.sources.websiteError || record.sources.mapsError ? (
              <div className="space-y-1 text-xs text-amber-600 dark:text-amber-400">
                {record.sources.websiteError ? (
                  <p>{t("businessProfile.websiteError", { detail: record.sources.websiteError })}</p>
                ) : null}
                {record.sources.mapsError ? (
                  <p>{t("businessProfile.mapsError", { detail: record.sources.mapsError })}</p>
                ) : null}
              </div>
            ) : null}

            <p className="text-[11px] text-muted-foreground">
              {record.editedAt
                ? t("businessProfile.editedAt", { date: formattedDate })
                : t("businessProfile.generatedAt", { date: formattedDate })}{" "}
              · {t("businessProfile.usedInAgent")}
            </p>
          </div>

          {/* Footer action strip — only when editing */}
          {editing && draft ? (
            <div className="flex items-center gap-2 border-t border-border bg-muted/30 px-4 py-3">
              <Button
                type="button"
                size="sm"
                disabled={saving || !draft.name.trim()}
                onClick={() => void saveEdits()}
              >
                {saving ? <Spinner size={14} strokeWidth={2} /> : null}
                {t("common.save")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                {t("common.cancel")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ProfileView({ profile }: { readonly profile: BusinessProfile }) {
  const { t } = useI18n();

  return (
    <>
      <p className="text-sm leading-6 text-muted-foreground">{profile.description}</p>

      {profile.services.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {profile.services.map((service) => (
            <span key={service} className="rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs">
              {service}
            </span>
          ))}
        </div>
      ) : null}

      <dl className="grid gap-2 text-xs sm:grid-cols-2">
        {profile.location ? (
          <div>
            <dt className="text-muted-foreground">{t("businessProfile.fieldLocation")}</dt>
            <dd className="mt-0.5 font-medium">{profile.location}</dd>
          </div>
        ) : null}
        {profile.hours ? (
          <div>
            <dt className="text-muted-foreground">{t("businessProfile.fieldHours")}</dt>
            <dd className="mt-0.5 font-medium">{profile.hours}</dd>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">{t("businessProfile.fieldTone")}</dt>
          <dd className="mt-0.5 font-medium">{profile.tone}</dd>
        </div>
      </dl>

      {profile.highlights.length > 0 ? (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            {t("businessProfile.fieldHighlights")}
          </p>
          <ul className="space-y-1 text-sm">
            {profile.highlights.map((highlight) => (
              <li key={highlight} className="flex gap-2">
                <span className="text-muted-foreground">·</span>
                {highlight}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {profile.faqs.length > 0 ? (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("businessProfile.fieldFaqs")}</p>
          <ul className="space-y-2">
            {profile.faqs.map((faq) => (
              <li key={faq.question} className="rounded-lg bg-muted/50 p-2.5 text-xs">
                <p className="font-medium">{faq.question}</p>
                <p className="mt-0.5 text-muted-foreground">{faq.answer}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

const TEXT_ROWS = [
  { key: "name", labelKey: "businessProfile.fieldName" },
  { key: "industry", labelKey: "businessProfile.fieldIndustry" },
  { key: "location", labelKey: "businessProfile.fieldLocation" },
  { key: "hours", labelKey: "businessProfile.fieldHours" },
] as const;

const AREA_ROWS = [
  { key: "description", labelKey: "businessProfile.fieldDescription", rows: 3, hint: null },
  { key: "tone", labelKey: "businessProfile.fieldTone", rows: 2, hint: null },
  { key: "services", labelKey: "businessProfile.fieldServices", rows: 3, hint: "businessProfile.onePerLine" },
  {
    key: "highlights",
    labelKey: "businessProfile.fieldHighlights",
    rows: 3,
    hint: "businessProfile.onePerLine",
  },
] as const;

function ProfileEditor({
  draft,
  saving: _saving,
  onChange,
}: {
  readonly draft: Draft;
  readonly saving: boolean;
  readonly onChange: (draft: Draft) => void;
}) {
  const { t } = useI18n();
  const set = (key: keyof Draft, value: string) => onChange({ ...draft, [key]: value });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {TEXT_ROWS.map(({ key, labelKey }) => (
          <div key={key}>
            <label htmlFor={`bp-edit-${key}`} className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t(labelKey)}
            </label>
            <Input id={`bp-edit-${key}`} value={draft[key]} onChange={(event) => set(key, event.target.value)} />
          </div>
        ))}
      </div>

      {AREA_ROWS.map(({ key, labelKey, rows, hint }) => (
        <div key={key}>
          <label htmlFor={`bp-edit-${key}`} className="mb-1.5 block text-xs font-medium text-muted-foreground">
            {t(labelKey)}
            {hint ? <span className="ml-1.5 font-normal opacity-70">{t(hint)}</span> : null}
          </label>
          <Textarea
            id={`bp-edit-${key}`}
            rows={rows}
            value={draft[key]}
            onChange={(event) => set(key, event.target.value)}
          />
        </div>
      ))}
    </div>
  );
}
