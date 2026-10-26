"use client";

import { useMemo } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { AiReplaceIcon, EyeIcon, EyeOffIcon } from "@hugeicons/core-free-icons";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProviderLogo } from "@/components/provider-logo";
import { useModelCatalog } from "@/components/ai-elements/model-picker";
import { useT } from "@/lib/i18n/provider";
import { DEFAULT_MODELS, type AiProvider } from "@/lib/model-catalog";
import { FIELD_I18N, OPTION_I18N } from "@/lib/settings-i18n";
import { cn } from "@/lib/utils";
import type { CredentialGroup } from "@/lib/credentials";

// One credential input, rendered the same way everywhere.
//
// This used to be written twice: once on the Settings page and once in the
// "add key" dialog on Connections. They drifted, as two copies of a form
// always do — the dialog rendered `AI_MODEL` as an empty text box while
// Settings showed a populated model picker, rendered a `select` as a text
// box, and swapped the show-password icon with no transition. Nothing about
// a field's appearance should depend on which page you opened it from, so
// there is one copy now.

type CredentialFieldSpec = CredentialGroup["fields"][number];

/** Sentinel for "no explicit model": an empty string is not a legal Radix
 *  Select value, so the auto option needs an id of its own. */
export const AUTO_MODEL = "__auto__";

/**
 * A secret for the fields nobody copies from a vendor — the webhook verify
 * tokens. 24 random bytes as base64url: 32 characters, URL-safe, and safe to
 * paste into a provider dashboard that may not accept punctuation.
 */
function generateSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function CredentialField({
  field,
  value,
  onChange,
  activeProvider,
  preview,
  error,
  show = false,
  onToggleShow,
  headerExtra,
  hint,
  className,
}: {
  readonly field: CredentialFieldSpec;
  readonly value: string;
  readonly onChange: (key: string, value: string, pattern?: string) => void;
  /** Drives both the model catalog and which provider-scoped fields apply. */
  readonly activeProvider: string;
  readonly preview?: string;
  readonly error?: string;
  readonly show?: boolean;
  readonly onToggleShow?: (key: string) => void;
  /** Right-hand side of the label row — the Settings page puts its "not set"
   *  badge and Clear button here; the dialog puts its "Configured" pill. */
  readonly headerExtra?: React.ReactNode;
  /** Replaces the field's own help text when present. */
  readonly hint?: React.ReactNode;
  readonly className?: string;
}) {
  const t = useT();
  const fi = FIELD_I18N[field.key];
  const label = fi?.label ? t(fi.label) : field.label;
  const help = fi?.help ? t(fi.help) : field.help;
  const isPassword = field.type === "password";
  const isModel = field.key === "AI_MODEL";
  const helpId = `${field.key}-help`;
  const errorId = `${field.key}-error`;
  const describedBy = error ? errorId : hint || help ? helpId : undefined;

  // Only the model field needs the catalog, and only it pays for the fetch.
  const { data: catalog } = useModelCatalog(isModel ? activeProvider : undefined);

  // Whatever is saved stays selectable even when the catalog no longer lists
  // it — otherwise opening this form would silently drop a working value.
  const modelChoices = useMemo(() => {
    if (!isModel) return [];
    const live = (catalog?.models ?? []).filter((model) => !model.restrictedReason);
    const options = live.map((model) => ({ id: model.id, vendor: model.vendor }));
    if (!value || options.some((option) => option.id === value)) return options;
    return [
      { id: value, vendor: value.includes("/") ? value.split("/")[0] : activeProvider },
      ...options,
    ];
  }, [isModel, catalog, value, activeProvider]);

  return (
    <div className={cn("t-input-wrap", error && "is-error", className)}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-1 text-sm font-medium" htmlFor={field.key}>
          {label}
          {field.required ? <span className="text-destructive">*</span> : null}
        </label>
        <div className="flex items-center gap-2">
          {field.generate ? (
            <button
              type="button"
              onClick={() => {
                onChange(field.key, generateSecret(), field.pattern);
                // Reveal it: the whole point of this value is being copied
                // into the provider's dashboard, and a masked field cannot be.
                if (!show) onToggleShow?.(field.key);
              }}
              className="min-h-8 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 md:min-h-9"
            >
              {t("settings.generate")}
            </button>
          ) : null}
          {headerExtra}
        </div>
      </div>

      {isModel ? (
        <Select
          value={value || AUTO_MODEL}
          onValueChange={(next) => onChange(field.key, next === AUTO_MODEL ? "" : next)}
        >
          <SelectTrigger
            aria-label={label}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            id={field.key}
            className="min-h-8 w-full text-sm focus-visible:outline-2"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTO_MODEL}>
              <span className="flex items-center gap-2">
                <HugeiconsIcon icon={AiReplaceIcon} size={15} strokeWidth={1.75} />
                {t("settings.modelDefault", {
                  model: DEFAULT_MODELS[activeProvider as AiProvider] ?? DEFAULT_MODELS.gateway,
                })}
              </span>
            </SelectItem>
            {modelChoices.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                <span className="flex items-center gap-2">
                  <ProviderLogo vendor={option.vendor} size={15} />
                  {option.id}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.type === "select" ? (
        <Select
          value={value || field.options?.[0]?.value || ""}
          onValueChange={(next) => {
            onChange(field.key, next);
            // A Gateway model id means nothing to the direct Anthropic API,
            // so the model resets with the provider rather than carrying over.
            if (field.key === "AI_PROVIDER") onChange("AI_MODEL", "");
          }}
        >
          <SelectTrigger
            aria-label={label}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            id={field.key}
            className="min-h-8 w-full text-sm focus-visible:outline-2"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span className="flex items-center gap-2">
                  {field.key === "AI_PROVIDER" ? (
                    <ProviderLogo vendor={option.value} size={15} />
                  ) : null}
                  {/* Some options are prose, not a vendor name, so they
                      follow the language toggle like everything else. */}
                  {OPTION_I18N[option.value] ? t(OPTION_I18N[option.value]) : option.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div className="relative">
          <Input
            id={field.key}
            name={field.key}
            type={isPassword && !show ? "password" : "text"}
            // A saved secret is never echoed back, so its masked preview
            // stands in as the placeholder — that is the only hint the field
            // already holds something.
            placeholder={(isPassword && preview) || field.placeholder || ""}
            value={value}
            onChange={(event) => onChange(field.key, event.target.value, field.pattern)}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            autoComplete="one-time-code"
            data-1p-ignore="true"
            data-lpignore="true"
            className={cn(
              "h-8 text-sm focus-visible:outline-2",
              isPassword && "pr-11",
              error && "border-destructive",
            )}
          />
          {isPassword && onToggleShow ? (
            <button
              type="button"
              onClick={() => onToggleShow(field.key)}
              className="absolute top-1/2 right-2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground after:absolute after:-inset-1.5 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-1"
              title={show ? t("settings.hide") : t("settings.show")}
              aria-label={show ? t("settings.hide") : t("settings.show")}
            >
              {/* Cross-fade rather than a hard swap: both icons are stacked
                  and `data-state` picks which one is visible. */}
              <span className="t-icon-swap" data-state={show ? "b" : "a"}>
                <span className="t-icon" data-icon="a">
                  <HugeiconsIcon icon={EyeIcon} size={16} strokeWidth={1.75} />
                </span>
                <span className="t-icon" data-icon="b">
                  <HugeiconsIcon icon={EyeOffIcon} size={16} strokeWidth={1.75} />
                </span>
              </span>
            </button>
          ) : null}
        </div>
      )}

      {error ? (
        <p id={errorId} className="t-error-msg mt-1.5 text-[13px] leading-relaxed text-destructive">{error}</p>
      ) : hint ? (
        <p id={helpId} className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{hint}</p>
      ) : help ? (
        <p id={helpId} className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{help}</p>
      ) : null}
    </div>
  );
}
