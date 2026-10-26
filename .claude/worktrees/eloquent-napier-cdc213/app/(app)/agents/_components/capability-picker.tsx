"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  AlertCircleIcon,
  ArrowDown01Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { CategoryBadge } from "@/components/ui/category-badge";
import { CheckboxMark } from "@/components/motion/checkbox";
import { CAPABILITY_HUES, isCapabilityId } from "@/lib/agent-capabilities";
import { useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

// What this agent is allowed to reach for.
//
// A multi-select rather than a wall of checkboxes. The list is fourteen rows
// long and growing, and every one of them was on screen at all times — so the
// two fields either side of it (the prompt above, the model below) were a
// screenful apart, and the answer to "what can this agent do?" meant reading
// fourteen rows to find the three that were ticked. The trigger now answers
// that question in one line, and the choosing happens in a searchable dialog,
// the same shape as the model picker next to it.
//
// The dialog deliberately does not close on a pick: this is a multi-select,
// and re-opening it per capability is the thing that made the old inline list
// feel less bad than it was.
//
// Each row still says what the capability is for, and one whose integration is
// missing still says so and links to where it is configured — the picker is
// where someone finds out that "Cobrar" needs a Stripe key, not the transcript
// where the agent failed to send a link.

export type CapabilityOption = {
  readonly id: string;
  readonly labelKey: string;
  readonly descriptionKey: string;
  readonly sensitive: boolean;
  readonly configured: boolean;
};

/** Chips shown on the trigger before it gives up and counts the rest. Four
 *  fits the narrow inline editor on one line at its smallest useful width. */
const MAX_CHIPS = 4;

export function CapabilityPicker({
  options,
  value,
  onChange,
  compact = false,
}: {
  readonly options: readonly CapabilityOption[];
  readonly value: readonly string[];
  readonly onChange: (next: string[]) => void;
  /** The inline editor is narrower than the create form. */
  readonly compact?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const selected = useMemo(() => new Set(value), [value]);

  // Trigger order follows the catalog, not the click order: a chip row that
  // reshuffles itself every time something is ticked is unreadable.
  const chosen = useMemo(
    () => options.filter((option) => selected.has(option.id)),
    [options, selected],
  );

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Catalog order again, so the saved value is stable regardless of the
    // order things were ticked in.
    onChange(options.filter((option) => next.has(option.id)).map((option) => option.id));
  };

  /** Ticked, but the integration behind it is not set up. Counted for the
   *  trigger, because that warning used to be visible without opening
   *  anything and should not become something you have to go and look for. */
  const unconfigured = chosen.filter((option) => !option.configured).length;

  if (options.length === 0) {
    return <p className="text-muted-foreground text-xs">{t("agents.capabilitiesLoading")}</p>;
  }

  const shown = chosen.slice(0, MAX_CHIPS);
  const overflow = chosen.length - shown.length;

  return (
    <div className="flex flex-col gap-1.5">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          "border-border bg-card flex w-full items-center gap-2 rounded-lg border text-left transition-colors",
          "shadow-[var(--shadow-inset)] hover:border-input hover:bg-accent/40",
          compact ? "px-2.5 py-2" : "px-3 py-2.5",
        )}
        onClick={() => setOpen(true)}
        type="button"
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {chosen.length === 0 ? (
            // Not "nothing selected": nothing selected is a real setting with
            // real consequences, and the help line below spells them out.
            <span className="text-muted-foreground text-[13px]">
              {t("agents.capabilitiesAllPlaceholder")}
            </span>
          ) : (
            <>
              {shown.map((option) => (
                option.configured ? (
                  <CategoryBadge
                    key={option.id}
                    hue={isCapabilityId(option.id) ? CAPABILITY_HUES[option.id] : undefined}
                    size="sm"
                    className="max-w-[12rem]"
                  >
                    <span className="truncate">{t(option.labelKey)}</span>
                  </CategoryBadge>
                ) : (
                  <span key={option.id} className="pill pill-sm tone-pill tone-pending max-w-[12rem]">
                    <span className="truncate">{t(option.labelKey)}</span>
                  </span>
                )
              ))}
              {overflow > 0 ? (
                <span className="text-muted-foreground text-[12px]">
                  {t("agents.capabilitiesMore", { count: overflow })}
                </span>
              ) : null}
            </>
          )}
        </span>
        <HugeiconsIcon
          className="text-muted-foreground shrink-0"
          icon={ArrowDown01Icon}
          size={14}
          strokeWidth={1.75}
        />
      </button>

      <CommandDialog
        description={t("agents.capabilitiesPickDescription")}
        onOpenChange={setOpen}
        open={open}
        title={t("agents.capabilitiesPick")}
      >
        <CommandInput placeholder={t("agents.capabilitiesSearch")} />
        {/* Taller than the 300px default: this list is fourteen two-line rows,
            and five of them on screen turns a multi-select into a scroll hunt.
            Capped against the viewport so a short window still fits. */}
        <CommandList className="max-h-[min(28rem,60vh)]">
          <CommandEmpty>{t("agents.capabilitiesNoneFound")}</CommandEmpty>
          <CommandGroup>
            {options.map((option) => {
              const on = selected.has(option.id);
              return (
                <CommandItem
                  key={option.id}
                  // Searched by label and description, not by the internal id:
                  // someone looking for the calendar types "agenda", not
                  // "calendar".
                  value={`${option.id} ${t(option.labelKey)} ${t(option.descriptionKey)}`}
                  // cmdk calls this on Enter as well as on click, so keyboard
                  // and mouse toggle identically. It does not close the dialog.
                  onSelect={() => toggle(option.id)}
                >
                  {/* `self-start`, not the row's own `items-center`: against a
                      two-line row a centred box floats between the title and
                      the description instead of reading as that title's tick. */}
                  <span aria-hidden data-state={on ? "checked" : "unchecked"} className="ui-check t-check mt-px self-start">
                    {/* cmdk sizes descendant SVGs; keep the shared mark at 16px. */}
                    <CheckboxMark className="size-4!" />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium">{t(option.labelKey)}</span>
                      {/* State for a screen reader, read straight after the
                          name it belongs to. It cannot ride on the box:
                          `role="checkbox"` inside cmdk's `role="option"` is
                          invalid ARIA (an option holds text, not nested
                          widgets), and cmdk spends `aria-selected` on whichever
                          row is *highlighted*. So the state joins the option's
                          accessible name as text. */}
                      <span className="sr-only">
                        {on ? t("agents.capabilityOn") : t("agents.capabilityOff")}
                      </span>
                      {option.sensitive ? (
                        <span className="text-[10px] font-medium text-amber-600 dark:text-amber-500">
                          {t("agents.capabilitySensitive")}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground text-[11px] leading-snug">
                      {t(option.descriptionKey)}
                    </span>
                    {/* Only worth saying once it is ticked: an unticked
                        capability nobody wants does not need a warning about a
                        key nobody was going to add. */}
                    {on && !option.configured ? (
                      <Link
                        className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-600 hover:underline dark:text-amber-500"
                        href="/settings"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <HugeiconsIcon icon={AlertCircleIcon} size={11} strokeWidth={2} />
                        {t("agents.capabilityNotConfigured")}
                      </Link>
                    ) : null}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>

        <div className="border-border flex items-center justify-between gap-3 border-t px-3 py-2">
          <span className="text-muted-foreground text-[12px]">
            {chosen.length === 0
              ? t("agents.capabilitiesAllPlaceholder")
              : t("agents.capabilitiesSelected", { count: chosen.length })}
          </span>
          {chosen.length > 0 ? (
            <button
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[12px] transition-colors"
              onClick={() => onChange([])}
              type="button"
            >
              <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.75} />
              {t("agents.capabilitiesClear")}
            </button>
          ) : null}
        </div>
      </CommandDialog>

      <p
        className={cn(
          "text-[11px]",
          unconfigured > 0 ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground",
        )}
      >
        {unconfigured > 0
          ? t("agents.capabilitiesUnconfigured", { count: unconfigured })
          : chosen.length === 0
            ? t("agents.capabilitiesNoneHelp")
            : t("agents.capabilitiesHelp")}
      </p>
    </div>
  );
}
