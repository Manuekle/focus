"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/icon";
import {
  Delete02Icon,
  Download03Icon,
  LegalDocument01Icon,
  SecurityCheckIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/provider";
import { useSound } from "@/components/sound-provider";
import { useToast } from "@/components/toast-provider";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { fetchJson, type UiError } from "@/lib/api-error-message";
import { ErrorBanner } from "@/components/ui/error-banner";
import type { BusinessIdentity, LegalPageKind } from "@/lib/business-profile-store";
import { Spinner } from "@/components/ui/spinner";

const KINDS = [
  { kind: "terms", icon: LegalDocument01Icon, titleKey: "business.legalTerms" },
  { kind: "privacy", icon: SecurityCheckIcon, titleKey: "business.legalPrivacy" },
] as const satisfies readonly { kind: LegalPageKind; icon: IconSvgElement; titleKey: string }[];

/**
 * Draft state for both legal pages, managed at the form level so a single
 * Save in the card footer commits both at once (or only the dirty ones).
 */
type PageDraft = { url: string; text: string };

export function BusinessLegalForm({
  identity,
  onChange,
  onSaveRef,
  onSaveState,
}: {
  readonly identity: BusinessIdentity;
  readonly onChange: (identity: BusinessIdentity) => void;
  readonly onSaveRef?: React.MutableRefObject<(() => void) | null>;
  readonly onSaveState?: (state: { dirty: boolean; saving: boolean; canSave: boolean }) => void;
}) {
  const { t } = useI18n();
  const { cue } = useSound();
  const { toast } = useToast();

  // One draft per page kind, keyed by kind.
  const [drafts, setDrafts] = useState<Record<LegalPageKind, PageDraft>>(() => ({
    terms: { url: identity.terms?.url ?? "", text: identity.terms?.text ?? "" },
    privacy: { url: identity.privacy?.url ?? "", text: identity.privacy?.text ?? "" },
  }));

  const [busy, setBusy] = useState<"import-terms" | "import-privacy" | "save" | null>(null);
  const [error, setError] = useState<UiError | null>(null);

  // Re-sync drafts when stored identity changes (e.g. after a save elsewhere).
  const savedRef = useRef(identity);
  useEffect(() => {
    savedRef.current = identity;
  });

  const dirty = useMemo(() => {
    return (
      drafts.terms.url !== (identity.terms?.url ?? "") ||
      drafts.terms.text !== (identity.terms?.text ?? "") ||
      drafts.privacy.url !== (identity.privacy?.url ?? "") ||
      drafts.privacy.text !== (identity.privacy?.text ?? "")
    );
  }, [drafts, identity]);

  const saving = busy === "save";

  const canSave = dirty && !saving && (
    !!(drafts.terms.url.trim() || drafts.terms.text.trim()) ||
    !!(drafts.privacy.url.trim() || drafts.privacy.text.trim())
  );

  // Bubble state up to card footer.
  useEffect(() => {
    onSaveState?.({ dirty, saving, canSave });
  }, [dirty, saving, canSave, onSaveState]);

  const save = useCallback(async () => {
    setBusy("save");
    setError(null);

    // Save both pages in parallel. A page is only sent if it has content or
    // its URL changed.
    const tasks: Promise<BusinessIdentity | null>[] = KINDS.map(async ({ kind }) => {
      const draft = drafts[kind];
      const stored = identity[kind];
      const changed =
        draft.url !== (stored?.url ?? "") || draft.text !== (stored?.text ?? "");
      if (!changed) return null;
      const result = await fetchJson<{ identity: BusinessIdentity }>(
        "/api/business-profile/legal",
        t,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, url: draft.url.trim(), text: draft.text }),
        },
      );
      if (!result.ok) throw result.error;
      return result.data.identity;
    });

    try {
      const results = await Promise.all(tasks);
      // The last non-null result carries the final identity state.
      const final = results.filter(Boolean).at(-1);
      if (final) onChange(final);
      cue("success");
      toast({ title: t("common.saved"), status: "success" });
    } catch (err) {
      setError(
        err && typeof err === "object" && "messageKey" in err
          ? (err as UiError)
          : { messageKey: "common.somethingWentWrong" },
      );
    } finally {
      setBusy(null);
    }
  }, [drafts, identity, t, onChange, cue, toast]);

  // Wire save into the card footer ref.
  useEffect(() => {
    if (onSaveRef) onSaveRef.current = () => void save();
  }, [onSaveRef, save]);

  const importFromUrl = useCallback(
    async (kind: LegalPageKind) => {
      const url = drafts[kind].url.trim();
      if (!url) return;
      setBusy(`import-${kind}`);
      setError(null);
      const result = await fetchJson<{ text: string }>("/api/business-profile/legal", t, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      setBusy(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDrafts((prev) => ({ ...prev, [kind]: { ...prev[kind], text: result.data.text } }));
      cue("success");
      toast({ title: t("business.legalImported"), status: "success" });
    },
    [cue, drafts, t, toast],
  );

  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const removePage = useCallback(
    async (kind: LegalPageKind, title: string) => {
      if (!(await confirm({ title: t("business.legalConfirmRemove", { title }) }))) return;
      cue("close");
      const result = await fetchJson<{ identity: BusinessIdentity }>(
        `/api/business-profile/legal?kind=${kind}`,
        t,
        { method: "DELETE" },
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDrafts((prev) => ({ ...prev, [kind]: { url: "", text: "" } }));
      onChange(result.data.identity);
    },
    [confirm, cue, onChange, t],
  );

  return (
    <div className="space-y-6">
      {confirmDialog}
      <p className="text-xs text-muted-foreground">{t("business.legalHint")}</p>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {KINDS.map(({ kind, icon, titleKey }) => {
        const title = t(titleKey);
        const page = identity[kind];
        const draft = drafts[kind];
        const importing = busy === `import-${kind}`;

        return (
          <div key={kind} className="space-y-3">
            {/* Header */}
            <div className="flex items-center gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground shadow-[var(--shadow-inset)]">
                <HugeiconsIcon icon={icon} size={15} strokeWidth={1.75} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {page
                    ? t("business.legalUpdatedAt", {
                        date: new Date(page.updatedAt).toLocaleDateString(undefined, {
                          dateStyle: "medium",
                        }),
                      })
                    : t("business.legalEmpty")}
                  {page?.documentId ? (
                    <span className="pill pill-sm tone-pill tone-success ml-1.5">
                      {t("business.legalIndexed")}
                    </span>
                  ) : null}
                </p>
              </div>
              {page ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("business.legalRemove")}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => void removePage(kind, title)}
                >
                  <HugeiconsIcon icon={Delete02Icon} size={15} strokeWidth={1.75} />
                </Button>
              ) : null}
            </div>

            {/* URL + Pull from site */}
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <label
                  htmlFor={`legal-url-${kind}`}
                  className="mb-1.5 block text-xs font-medium text-muted-foreground"
                >
                  {t("business.legalUrl")}
                </label>
                <Input
                  id={`legal-url-${kind}`}
                  type="url"
                  value={draft.url}
                  onChange={(e) =>
                    setDrafts((prev) => ({ ...prev, [kind]: { ...prev[kind], url: e.target.value } }))
                  }
                  placeholder={
                    identity.websiteUrl
                      ? `${identity.websiteUrl.replace(/\/$/, "")}/${kind}`
                      : "https://…"
                  }
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy !== null || !draft.url.trim()}
                onClick={() => void importFromUrl(kind)}
                className="shrink-0"
              >
                {importing ? (
                  <Spinner size={14} strokeWidth={2} />
                ) : (
                  <HugeiconsIcon icon={Download03Icon} size={14} strokeWidth={1.75} />
                )}
                {t("business.legalImport")}
              </Button>
            </div>

            {/* Text paste area */}
            <div>
              <Textarea
                id={`legal-text-${kind}`}
                value={draft.text}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, [kind]: { ...prev[kind], text: e.target.value } }))
                }
                placeholder={t("business.legalTextPlaceholder")}
                rows={3}
                className="max-h-48 resize-none"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
