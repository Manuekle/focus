"use client";

import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import { SmartPhone01Icon } from "@hugeicons/core-free-icons";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleChip } from "@/components/ui/toggle-chip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/provider";
import type { Agent, NumberCapability, NumberProvider, PhoneNumber } from "@/lib/types";

// Add or edit one line in the directory.
//
// The availability check is the reason this is a dialog with logic in it
// rather than a form that posts and hopes. A number typed here is almost
// always one that already exists somewhere — on a Meta account, on a Twilio
// console — and the failure worth catching early is "this is already in the
// directory under another name". The check runs as you type, against
// `GET /api/numbers?check=`, and the save is still validated server-side: the
// live check is a courtesy, never the guarantee.

const CAPABILITIES: readonly { readonly id: NumberCapability; readonly labelKey: string }[] = [
  { id: "whatsapp", labelKey: "numbers.capWhatsapp" },
  { id: "sms", labelKey: "numbers.capSms" },
  { id: "voice", labelKey: "numbers.capVoice" },
  { id: "instagram", labelKey: "numbers.capInstagram" },
];

const PROVIDERS: readonly { readonly id: NumberProvider; readonly labelKey: string }[] = [
  { id: "meta", labelKey: "numbers.providerMeta" },
  { id: "twilio", labelKey: "numbers.providerTwilio" },
  { id: "elevenlabs", labelKey: "numbers.providerElevenlabs" },
  { id: "manual", labelKey: "numbers.providerManual" },
];

export type NumberDraft = {
  readonly e164: string;
  readonly label: string;
  readonly capabilities: readonly NumberCapability[];
  readonly provider: NumberProvider;
  readonly providerNumberId: string;
  readonly agentId: string | null;
  readonly notes: string;
};

function draftFrom(number: PhoneNumber | null): NumberDraft {
  return {
    e164: number?.e164 ?? "",
    label: number?.label ?? "",
    capabilities: number?.capabilities ?? ["whatsapp"],
    provider: number?.provider ?? "meta",
    providerNumberId: number?.providerNumberId ?? "",
    agentId: number?.agentId ?? null,
    notes: number?.notes ?? "",
  };
}

type Availability =
  | { readonly state: "idle" }
  | { readonly state: "checking" }
  | { readonly state: "free" }
  | { readonly state: "taken"; readonly holder: string; readonly agent: string };

export function NumberDialog({
  open,
  onOpenChange,
  editing,
  agents,
  onSave,
  saving,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** `null` is "new". The dialog is remounted per target by its `key` at the
   *  call site, so this only has to seed the initial state. */
  readonly editing: PhoneNumber | null;
  readonly agents: readonly Agent[];
  readonly onSave: (draft: NumberDraft) => Promise<boolean>;
  readonly saving: boolean;
}) {
  const t = useT();
  const [draft, setDraft] = useState<NumberDraft>(() => draftFrom(editing));
  const [availability, setAvailability] = useState<Availability>({ state: "idle" });

  const patch = useCallback(
    (updates: Partial<NumberDraft>) => setDraft((current) => ({ ...current, ...updates })),
    [],
  );

  // Debounced, because this fires on every keystroke of a phone number and
  // each one is a request. 400ms is long enough that typing a full number is
  // one check, short enough that it lands before you reach for Save.
  useEffect(() => {
    const value = draft.e164.trim();
    if (value.length < 7) {
      setAvailability({ state: "idle" });
      return;
    }
    setAvailability({ state: "checking" });
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ check: value });
      if (editing) params.set("ignoreId", editing.id);
      try {
        const response = await fetch(`/api/numbers?${params}`);
        if (!response.ok) {
          setAvailability({ state: "idle" });
          return;
        }
        const data = (await response.json()) as {
          available?: boolean;
          holder?: { label?: string };
          holderAgent?: string;
        };
        setAvailability(
          data.available
            ? { state: "free" }
            : {
                state: "taken",
                holder: data.holder?.label ?? t("numbers.holderNobody"),
                agent: data.holderAgent ?? t("numbers.holderNobody"),
              },
        );
      } catch {
        // A failed check is not a failed save. Fall back to letting the
        // server be the judge.
        setAvailability({ state: "idle" });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [draft.e164, editing, t]);

  const toggleCapability = (id: NumberCapability) =>
    patch({
      capabilities: draft.capabilities.includes(id)
        ? draft.capabilities.filter((entry) => entry !== id)
        : [...draft.capabilities, id],
    });

  const submit = async () => {
    const saved = await onSave(draft);
    if (saved) onOpenChange(false);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-w-2xl">
        <DrawerHeader>
          <DrawerTitle icon={<HugeiconsIcon icon={SmartPhone01Icon} size={18} strokeWidth={1.75} />}>
            {t(editing ? "numbers.dialogEditTitle" : "numbers.dialogNewTitle")}
          </DrawerTitle>
          <DrawerDescription>{t("numbers.dialogDescription")}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="min-h-0">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="number-e164" className="text-xs font-medium text-foreground">
                {t("numbers.fieldNumber")}
              </label>
              <Input
                id="number-e164"
                value={draft.e164}
                onChange={(event) => patch({ e164: event.target.value })}
                placeholder="+54 9 11 5555 5555"
                inputMode="tel"
                autoComplete="off"
              />
              <p
                className={cn(
                  "min-h-4 text-[11px]",
                  availability.state === "taken"
                    ? "text-[color:var(--status-failed-fg)]"
                    : availability.state === "free"
                      ? "text-[color:var(--status-success-fg)]"
                      : "text-muted-foreground",
                )}
              >
                {availability.state === "checking" ? t("numbers.checking") : null}
                {availability.state === "free" ? t("numbers.free") : null}
                {availability.state === "taken"
                  ? t("numbers.taken", { label: availability.holder, agent: availability.agent })
                  : null}
                {availability.state === "idle" ? t("numbers.fieldNumberHint") : null}
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="number-label" className="text-xs font-medium text-foreground">
                {t("numbers.fieldLabel")}
              </label>
              <Input
                id="number-label"
                value={draft.label}
                onChange={(event) => patch({ label: event.target.value })}
                placeholder={t("numbers.fieldLabelPlaceholder")}
              />
            </div>

            <div className="space-y-1.5">
              <span className="text-xs font-medium text-foreground">
                {t("numbers.fieldCapabilities")}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {CAPABILITIES.map((capability) => (
                  <ToggleChip
                    key={capability.id}
                    selected={draft.capabilities.includes(capability.id)}
                    onClick={() => toggleCapability(capability.id)}
                  >
                    {t(capability.labelKey)}
                  </ToggleChip>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-foreground">
                  {t("numbers.fieldProvider")}
                </span>
                <Select
                  value={draft.provider}
                  onValueChange={(value) => patch({ provider: value as NumberProvider })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {t(provider.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="number-provider-id" className="text-xs font-medium text-foreground">
                  {t("numbers.fieldProviderId")}
                </label>
                <Input
                  id="number-provider-id"
                  value={draft.providerNumberId}
                  onChange={(event) => patch({ providerNumberId: event.target.value })}
                  placeholder="phone_number_id"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-xs font-medium text-foreground">
                {t("numbers.fieldAgent")}
              </span>
              <Select
                value={draft.agentId ?? "none"}
                onValueChange={(value) => patch({ agentId: value === "none" ? null : value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("numbers.unassigned")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("numbers.unassigned")}</SelectItem>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {t("numbers.fieldAgentHint")}
              </p>
            </div>
          </div>
        </DrawerBody>
        <DrawerFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={saving || !draft.e164.trim() || availability.state === "taken"}
          >
            {saving ? t("settings.saving") : t("common.save")}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
