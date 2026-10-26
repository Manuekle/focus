"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/provider";
import { fetchJson } from "@/lib/api-error-message";
import { useToast } from "@/components/toast-provider";
import { appointmentMode, validateBookingPolicy, type AppointmentMode, type BookingPolicy } from "@/lib/action-runtime/booking-policy";
import type { BusinessIdentity } from "@/lib/business-profile-store";
import type { SaveState } from "./business-card";

const DEFAULT_POLICY: BookingPolicy = { timeZone: "America/Bogota", hours: [] };
const DAY_KEYS = [
  "business.bookingSunday", "business.bookingMonday", "business.bookingTuesday",
  "business.bookingWednesday", "business.bookingThursday", "business.bookingFriday",
  "business.bookingSaturday",
];

type DraftWindow = { weekday: number; start: string; end: string };
type Draft = { timeZone: string; mode: AppointmentMode; onlineServices: string; hours: DraftWindow[] };

function asTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function asMinutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

/** The mode shown is the one bookings use today, saved or inferred from the address. */
function draftFrom(policy: BookingPolicy | null, address: string): Draft {
  const source = policy ?? DEFAULT_POLICY;
  return {
    timeZone: source.timeZone,
    mode: appointmentMode(policy, address),
    onlineServices: source.onlineServices?.join("\n") ?? "",
    hours: source.hours.map((window) => ({
      weekday: window.weekday,
      start: asTime(window.startMinute),
      end: asTime(window.endMinute),
    })),
  };
}

export function BookingPolicyForm({ identity, onChange, onSaveRef, onSaveState }: {
  readonly identity: BusinessIdentity;
  readonly onChange: (identity: BusinessIdentity) => void;
  readonly onSaveRef: React.MutableRefObject<(() => void) | null>;
  readonly onSaveState: (state: SaveState) => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(identity.bookingPolicy, identity.address));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const saved = useMemo(() => draftFrom(identity.bookingPolicy, identity.address), [identity.bookingPolicy, identity.address]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const save = useCallback(async () => {
    let policy: BookingPolicy;
    try {
      policy = validateBookingPolicy({
        timeZone: draft.timeZone.trim(),
        mode: draft.mode,
        onlineServices: draft.onlineServices.split("\n").map((name) => name.trim()).filter(Boolean),
        hours: draft.hours.map((window) => ({
          weekday: window.weekday,
          startMinute: asMinutes(window.start),
          endMinute: asMinutes(window.end),
        })),
      });
    } catch {
      setError(t("business.bookingInvalid"));
      errorRef.current?.focus();
      return;
    }
    setSaving(true);
    setError("");
    const result = await fetchJson<{ policy: BookingPolicy }>("/api/business-profile/booking-policy", t, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(policy),
    });
    setSaving(false);
    if (!result.ok) {
      setError(t("business.bookingSaveFailed"));
      return;
    }
    onChange({ ...identity, bookingPolicy: result.data.policy });
    setDraft(draftFrom(result.data.policy, identity.address));
    toast({ title: t("common.saved"), status: "success" });
  }, [draft, identity, onChange, t, toast]);

  useEffect(() => {
    onSaveRef.current = () => void save();
    return () => { onSaveRef.current = null; };
  }, [onSaveRef, save]);

  useEffect(() => {
    onSaveState({ dirty, saving, canSave: dirty && !saving });
  }, [dirty, saving, onSaveState]);

  function updateWindow(index: number, patch: Partial<DraftWindow>) {
    setDraft((current) => ({
      ...current,
      hours: current.hours.map((window, position) => position === index ? { ...window, ...patch } : window),
    }));
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t("business.bookingHint")}</p>
      <div className="space-y-1.5">
        <label htmlFor="booking-mode" className="text-sm font-medium">{t("business.bookingMode")}</label>
        <Select value={draft.mode} onValueChange={(value) => setDraft((current) => ({ ...current, mode: value as AppointmentMode }))}>
          <SelectTrigger id="booking-mode" className="w-full" aria-describedby="booking-mode-hint">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="in_person">{t("business.bookingModeInPerson")}</SelectItem>
            <SelectItem value="online">{t("business.bookingModeOnline")}</SelectItem>
          </SelectContent>
        </Select>
        <p id="booking-mode-hint" className="text-xs text-muted-foreground">{t("business.bookingModeHint")}</p>
      </div>
      {draft.mode === "in_person" ? (
        <div className="space-y-1.5">
          <label htmlFor="booking-online-services" className="text-sm font-medium">{t("business.bookingOnlineServices")}</label>
          <Textarea id="booking-online-services" value={draft.onlineServices}
            onChange={(event) => setDraft((current) => ({ ...current, onlineServices: event.target.value }))}
            aria-describedby="booking-online-services-hint" />
          <p id="booking-online-services-hint" className="text-xs text-muted-foreground">{t("business.bookingOnlineServicesHint")}</p>
        </div>
      ) : null}
      <div className="space-y-1.5">
        <label htmlFor="booking-time-zone" className="text-sm font-medium">{t("business.bookingTimeZone")}</label>
        <Input
          id="booking-time-zone"
          value={draft.timeZone}
          onChange={(event) => setDraft((current) => ({ ...current, timeZone: event.target.value }))}
          placeholder="America/Bogota"
          autoComplete="off"
          aria-describedby="booking-time-zone-hint"
        />
        <p id="booking-time-zone-hint" className="text-xs text-muted-foreground">{t("business.bookingZoneHint")}</p>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium">{t("business.bookingWindows")}</h3>
            <p className="text-xs text-muted-foreground">{t("business.bookingEmptyHint")}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={draft.hours.length >= 28}
            onClick={() => setDraft((current) => ({
              ...current,
              hours: [...current.hours, { weekday: 1, start: "09:00", end: "17:00" }],
            }))}
          >
            {t("business.bookingAddWindow")}
          </Button>
        </div>
        {draft.hours.map((window, index) => (
          <div key={index} className="grid gap-3 rounded-xl bg-muted/60 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <div className="space-y-1">
              <label htmlFor={`booking-day-${index}`} className="text-xs font-medium">{t("business.bookingDay")}</label>
              <Select value={String(window.weekday)} onValueChange={(value) => updateWindow(index, { weekday: Number(value) })}>
                <SelectTrigger id={`booking-day-${index}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAY_KEYS.map((key, day) => <SelectItem key={key} value={String(day)}>{t(key)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label htmlFor={`booking-start-${index}`} className="text-xs font-medium">{t("business.bookingFrom")}</label>
              <Input id={`booking-start-${index}`} type="time" value={window.start}
                onChange={(event) => updateWindow(index, { start: event.target.value })} />
            </div>
            <div className="space-y-1">
              <label htmlFor={`booking-end-${index}`} className="text-xs font-medium">{t("business.bookingTo")}</label>
              <Input id={`booking-end-${index}`} type="text" inputMode="numeric" placeholder="17:00" value={window.end}
                onChange={(event) => updateWindow(index, { end: event.target.value })} />
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraft((current) => ({
              ...current, hours: current.hours.filter((_, position) => position !== index),
            }))}>
              {t("business.bookingRemoveWindow")}
            </Button>
          </div>
        ))}
      </div>
      <p ref={errorRef} id="booking-policy-error" tabIndex={-1} role={error ? "alert" : undefined}
        className="text-sm text-destructive">{error}</p>
    </div>
  );
}
