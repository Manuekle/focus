"use client";

import { useMemo, useState } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { HugeiconsIcon } from "../icons/icon";
import { ArrowLeft01Icon, ArrowRight01Icon, Calendar03Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { cn } from "../../lib/utils";

// The product's date field: the month grid the pipeline's close date opened
// (app/(app)/pipeline/_components/deal-dialog.tsx), as one component, with an
// optional time. Values are local wall-clock strings, the same shapes the
// native inputs used: "YYYY-MM-DD", or "YYYY-MM-DDTHH:mm" with `withTime`.
// It opens in a portal, so a card with overflow hidden never clips it.

export type DatePickerLabels = {
  readonly placeholder: string;
  readonly previousMonth: string;
  readonly nextMonth: string;
  readonly clear: string;
  readonly today: string;
  readonly time?: string;
};

function dayKey(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function parseDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function monthGrid(viewDate: Date, weekStart: number): Date[] {
  const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const offset = (first.getDay() - weekStart + 7) % 7;
  return Array.from({ length: 42 }, (_, index) => addDays(first, index - offset));
}

/** "Octubre de 2026": only the first letter up, not every word. */
function monthTitle(date: Date, locale: string): string {
  const text = date.toLocaleDateString(locale, { month: "long", year: "numeric" });
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

/** Every half hour of the day, "00:00" … "23:30". */
const TIMES = Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`);

export function DatePicker({
  value,
  onChange,
  locale,
  labels,
  withTime = false,
  defaultTime = "09:00",
  min,
  max,
  name,
  id,
  className,
  "aria-label": ariaLabel,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly locale: string;
  readonly labels: DatePickerLabels;
  readonly withTime?: boolean;
  /** The time a freshly picked day starts at. */
  readonly defaultTime?: string;
  /** "YYYY-MM-DD": days before it cannot be picked. */
  readonly min?: string;
  readonly max?: string;
  /** Submits the value with a plain `<form method="get">`. */
  readonly name?: string;
  readonly id?: string;
  readonly className?: string;
  readonly "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseDay(value);
  const time = withTime ? (value.slice(11, 16) || defaultTime) : "";
  // Empty, it opens where a day can be picked: the first allowed month, or today's.
  const startView = () => {
    const today = new Date();
    const floor = min ? parseDay(min) : null;
    return selected ?? (floor && floor > today ? floor : today);
  };
  const [viewDate, setViewDate] = useState(startView);
  const [direction, setDirection] = useState<1 | -1>(1);
  const weekStart = locale.startsWith("es") ? 1 : 0;
  const days = useMemo(() => monthGrid(viewDate, weekStart), [viewDate, weekStart]);
  const weekdays = useMemo(() => {
    const sunday = new Date(2024, 0, 7);
    return Array.from({ length: 7 }, (_, index) =>
      addDays(sunday, (weekStart + index) % 7).toLocaleDateString(locale, { weekday: "short" }),
    );
  }, [locale, weekStart]);
  const today = dayKey(new Date());

  const emit = (day: string, at: string) => onChange(withTime ? `${day}T${at}` : day);
  const move = (months: number) => {
    setDirection(months > 0 ? 1 : -1);
    setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + months, 1));
  };

  const shown = selected
    ? `${selected.toLocaleDateString(locale, { dateStyle: "medium" })}${withTime ? ` · ${time}` : ""}`
    : null;

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setViewDate(startView());
        setOpen(next);
      }}
    >
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <div className={cn("relative", className)}>
        <PopoverPrimitive.Trigger
          id={id}
          type="button"
          aria-label={ariaLabel}
          className="flex h-8 w-full items-center gap-2 rounded-lg border border-input bg-muted pl-3 pr-8 text-left text-[length:var(--field-text-size)] leading-5 shadow-[var(--shadow-inset)] transition-[background-color,border-color,box-shadow] duration-150 outline-none hover:bg-card focus-visible:border-[var(--field-focus-border)] focus-visible:bg-card focus-visible:shadow-[var(--field-focus-shadow)] data-[state=open]:border-[var(--field-focus-border)] data-[state=open]:bg-card"
        >
          <HugeiconsIcon icon={Calendar03Icon} size={15} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />
          <span className={cn("min-w-0 truncate tabular-nums", !shown && "text-muted-foreground")}>{shown ?? labels.placeholder}</span>
        </PopoverPrimitive.Trigger>
        {value ? (
          <button
            type="button"
            aria-label={labels.clear}
            onClick={() => onChange("")}
            className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
          </button>
        ) : null}
      </div>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="t-dropdown z-50 w-[18.5rem] rounded-2xl border border-border bg-popover p-3 text-popover-foreground shadow-[var(--shadow-float)] outline-none"
        >
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label={labels.previousMonth}
              onClick={() => move(-1)}
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={16} strokeWidth={1.75} />
            </button>
            <span key={`${viewDate.getFullYear()}-${viewDate.getMonth()}`} className="date-picker-month text-sm font-medium">
              {monthTitle(viewDate, locale)}
            </span>
            <button
              type="button"
              aria-label={labels.nextMonth}
              onClick={() => move(1)}
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
            >
              <HugeiconsIcon icon={ArrowRight01Icon} size={16} strokeWidth={1.75} />
            </button>
          </div>
          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase tracking-[-0.02em] text-muted-foreground">
            {weekdays.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div
            key={`${viewDate.getFullYear()}-${viewDate.getMonth()}`}
            className="date-picker-grid mt-1 grid grid-cols-7 gap-1"
            style={{ "--date-picker-from": `${direction * 10}px` } as React.CSSProperties}
          >
            {days.map((day) => {
              const key = dayKey(day);
              const outside = day.getMonth() !== viewDate.getMonth();
              const disabled = Boolean((min && key < min) || (max && key > max));
              const isSelected = selected ? key === dayKey(selected) : false;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={disabled}
                  aria-pressed={isSelected}
                  aria-label={day.toLocaleDateString(locale, { dateStyle: "full" })}
                  onClick={() => {
                    emit(key, time || defaultTime);
                    if (!withTime) setOpen(false);
                  }}
                  className={cn(
                    "relative size-9 rounded-xl text-xs font-medium tabular-nums transition-[background-color,color,transform] duration-150 active:scale-95 disabled:pointer-events-none disabled:opacity-30",
                    outside ? "text-muted-foreground/45" : "text-foreground",
                    isSelected ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  {day.getDate()}
                  {key === today && !isSelected ? (
                    <span aria-hidden className="absolute bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-foreground/60" />
                  ) : null}
                </button>
              );
            })}
          </div>
          {withTime ? (
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">{labels.time}</span>
              <Select
                value={time}
                disabled={!selected}
                onValueChange={(next) => selected && emit(dayKey(selected), next)}
              >
                <SelectTrigger aria-label={labels.time} className="w-28 tabular-nums">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="end" className="max-h-60">
                  {(TIMES.includes(time) ? TIMES : [...TIMES, time].sort()).map((option) => (
                    <SelectItem key={option} value={option} className="tabular-nums">
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {labels.clear}
            </button>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                setViewDate(now);
                emit(dayKey(now), time || defaultTime);
                if (!withTime) setOpen(false);
              }}
              className="rounded-md px-1.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
            >
              {labels.today}
            </button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
