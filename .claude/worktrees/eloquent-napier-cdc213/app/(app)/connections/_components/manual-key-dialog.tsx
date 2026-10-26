"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { AuthorizedIcon } from "@hugeicons/core-free-icons";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { fetchJson, type UiError } from "@/lib/api-error-message";
import { notifyCredentialsChanged } from "@/lib/credentials-changed";
import { useHosted } from "@/lib/hosted-context";
import { useT } from "@/lib/i18n/provider";
import { VALIDATION_ERROR_KEYS } from "@/lib/settings-i18n";
import { CredentialField } from "@/app/_components/credential-field";
import type { CredentialGroup } from "@/lib/credentials";
import { Spinner } from "@/components/ui/spinner";

type SettingsResponse = {
  readonly groups?: CredentialGroup[];
  readonly credentials?: Record<string, boolean>;
  /** Set anywhere, store or environment. */
  readonly configured?: Record<string, boolean>;
  readonly sources?: Record<string, "store" | "env">;
  readonly values?: Record<string, string>;
  readonly previews?: Record<string, string>;
};

/**
 * The "Agregar clave" / "Revisar" action for a manual (API-key) connection,
 * inline instead of a detour through Settings. It shows exactly the fields
 * that one vendor's `CredentialGroup` carries — same catalog, same POST
 * /api/settings, same local storage — so nothing here is a second source of
 * truth for what a field is called or how it validates.
 *
 * `onlyKeys` narrows that group to a subset. The OAuth-app group is one list
 * of every provider's client ID and secret, so a card that only wants to
 * register *its* app passes its own two keys rather than opening a form for
 * all six vendors at once.
 */
export function ManualKeyDialog({
  open,
  onOpenChange,
  settingsGroup,
  label,
  onSaved,
  onlyKeys,
  descriptionKey = "connections.manualDialogDescription",
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly settingsGroup: string;
  readonly label: string;
  readonly onSaved: () => void;
  readonly onlyKeys?: readonly string[];
  readonly descriptionKey?: string;
}) {
  const t = useT();
  // On a hosted tenant a key in the environment is one Oruka put there.
  const hosted = useHosted();
  const [group, setGroup] = useState<CredentialGroup | null>(null);
  // Every group's fields, for a key list that spans groups: Meta's login app
  // is its App ID (WhatsApp group) plus its secret and login configuration
  // (Meta Ads group), and the card asks for all three at once.
  const [allFields, setAllFields] = useState<CredentialGroup["fields"]>([]);
  const [loading, setLoading] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const [sources, setSources] = useState<Record<string, "store" | "env">>({});
  const [show, setShow] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Keep the last-opened props stable so the close animation doesn't reflow
  // when the parent nulls the target (label/settingsGroup become "" mid-exit).
  const stableSettingsGroup = useRef(settingsGroup);
  const stableLabel = useRef(label);
  const stableOnlyKeys = useRef(onlyKeys);
  const stableDescriptionKey = useRef(descriptionKey);
  if (open) {
    stableSettingsGroup.current = settingsGroup;
    stableLabel.current = label;
    stableOnlyKeys.current = onlyKeys;
    stableDescriptionKey.current = descriptionKey;
  }
  // Joined so the effect below re-runs on a genuine change of keys rather than
  // on every render that hands it a fresh array literal.
  const keyFilterId = stableOnlyKeys.current?.join(",");
  const keyFilter = useMemo(
    () => (keyFilterId ? keyFilterId.split(",") : undefined),
    [keyFilterId],
  );

  useEffect(() => {
    if (!open || !stableSettingsGroup.current) return;
    setGroup(null);
    setFieldErrors({});
    setError(null);
    setLoading(true);
    void fetchJson<SettingsResponse>("/api/settings", t).then((result) => {
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setGroup((result.data.groups ?? []).find((g) => g.id === stableSettingsGroup.current) ?? null);
      setAllFields((result.data.groups ?? []).flatMap((g) => g.fields));
      setStatus(result.data.configured ?? result.data.credentials ?? {});
      setSources(result.data.sources ?? {});
      setValues(result.data.values ?? {});
      setPreviews(result.data.previews ?? {});
    });
  }, [open, t]);

  // Same rule Settings uses: an unset provider means the Gateway, matching
  // resolveProvider()'s own default. Without it the select opens blank and
  // every provider-scoped key field below it hides.
  const activeProvider =
    values.AI_PROVIDER && values.AI_PROVIDER.length > 0 ? values.AI_PROVIDER : "gateway";

  // A group can carry one field per provider (the AI group carries three) and
  // only the chosen provider's key is worth asking for. Settings filters the
  // same way; this dialog used to show all three at once.
  const fields = useMemo(() => {
    const all = group?.fields ?? [];
    // An explicit key list is a deliberate choice and outranks the
    // provider-scoped visibility rule: the card asked for *these* fields, and
    // hiding one because a different provider is active is how the Anthropic
    // modal ended up with no Anthropic field in it.
    if (keyFilter) {
      return keyFilter.flatMap((key) => {
        const field = all.find((f) => f.key === key) ?? allFields.find((f) => f.key === key);
        return field ? [field] : [];
      });
    }
    return all.filter(
      (field) => !field.showWhenProvider || field.showWhenProvider.includes(activeProvider),
    );
  }, [group, allFields, activeProvider, keyFilter]);

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const submit = async () => {
    if (!group) return;
    const errors: Record<string, string> = {};
    for (const field of fields) {
      // Validate (and later store) the trimmed value: a pasted key carries
      // whatever whitespace came with it, and "re_abc\n" fails the prefix
      // pattern for a reason that is invisible in a password field.
      const value = values[field.key]?.trim();
      if (value && field.pattern) {
        try {
          if (!new RegExp(field.pattern).test(value)) {
            errors[field.key] = t(VALIDATION_ERROR_KEYS[field.key] ?? "settings.validate.generic");
          }
        } catch {
          // Unparseable pattern — nothing to enforce client-side.
        }
      }
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const payload: Record<string, string> = {};
    for (const field of fields) {
      if (values[field.key] !== undefined) payload[field.key] = values[field.key].trim();
    }
    if (Object.keys(payload).length === 0) {
      onOpenChange(false);
      return;
    }

    setSaving(true);
    setError(null);
    const result = await fetchJson<SettingsResponse>("/api/settings", t, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Repaint from what the server now holds before the dialog closes, so
    // reopening it shows the new masked preview and the "Configurado" pill
    // rather than the state from before the save.
    setStatus(result.data.configured ?? result.data.credentials ?? {});
    setSources(result.data.sources ?? {});
    setPreviews(result.data.previews ?? {});
    // The model picker and the health dot read these keys too.
    notifyCredentialsChanged();
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle icon={<HugeiconsIcon icon={AuthorizedIcon} size={20} strokeWidth={1.75} />}>
            {t("connections.manualDialogTitle", { provider: stableLabel.current })}
          </DialogTitle>
          <DialogDescription>{t(stableDescriptionKey.current)}</DialogDescription>
        </DialogHeader>

        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        {loading || !group ? (
          <div className="space-y-3 py-1">
            <div className="h-9 animate-pulse rounded-lg bg-muted" />
            <div className="h-9 animate-pulse rounded-lg bg-muted" />
          </div>
        ) : (
          <div className="space-y-4">
            {fields.map((field) => (
              <CredentialField
                key={field.key}
                field={field}
                value={values[field.key] ?? ""}
                onChange={handleChange}
                activeProvider={activeProvider}
                preview={previews[field.key]}
                error={fieldErrors[field.key]}
                show={show[field.key] ?? false}
                onToggleShow={(key) => setShow((prev) => ({ ...prev, [key]: !prev[key] }))}
                headerExtra={
                  status[field.key] ? (
                    <span className="pill pill-sm tone-pill tone-success gap-1.5">
                      <span className="size-1.5 rounded-full bg-current" />
                      {t("connections.statusConfigured")}
                    </span>
                  ) : null
                }
                hint={
                  sources[field.key] === "env"
                    ? t(hosted ? "settings.fromOrukaHint" : "settings.fromEnvHint")
                    : field.type === "password" && status[field.key]
                      ? t("connections.secretHiddenHint")
                      : undefined
                }
              />
            ))}
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" className="text-muted-foreground hover:text-foreground">
              {t("billing.cancel")}
            </Button>
          </DialogClose>
          <Button disabled={saving || loading || !group} onClick={() => void submit()}>
            {saving && <Spinner />}
            {saving ? t("settings.saving") : t("settings.saveChanges")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
