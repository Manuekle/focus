/**
 * The truth behind Fig 05.4, kept apart from the drawing so every slot the
 * card shows comes from one place.
 *
 * What the product does (`agent/tools/calendar.ts`). `check_slots` reads the
 * calendar's events in the range — an all-day event is busy too
 * (`lib/calendar.ts`) — and keeps the gaps at least `duration_min` long, 30 by
 * default. `concreteAppointmentSlots` (`lib/action-runtime/appointment-slots.ts`)
 * turns them into starts on a 15-minute grid inside the booking hours, at most
 * 40. The customer picks one, and `book_event` books exactly an offered slot,
 * invites the contact and attaches a Meet link.
 *
 * The drawing is a booking board with a go/no-go gauge. Each rail is a day,
 * cut in quarter hours across the booking hours, and the calendar's events
 * stand in it as blocks. A gantry carries one 30-minute feeler per day across
 * the board: a feeler drops wherever its length fits between blocks and rides
 * over them where it does not, and each place it drops leaves a pin — an
 * offered slot. Then it goes back to the slot the customer chose and presses a
 * new block in: booked, and busy for the next search.
 */

/** Monday to Friday. */
export const DAYS = 5;
/** Quarter hours in the booking day, 9:00 to 17:00. */
export const QUARTERS = 32;
export const OPENS = 9;
/** The search's grid, and the appointment's length, in quarters: 15 minutes, 30 minutes. */
export const STEP_MIN = 15;
export const LENGTH = 2;
/** `concreteAppointmentSlots` offers at most this many. */
export const LIMIT = 40;

export type Block = { readonly day: number; readonly from: number; readonly to: number };

/** What the calendar already has, in quarters from opening. Wednesday is blocked all day. */
export const BUSY: readonly Block[] = [
  { day: 0, from: 0, to: 4 },
  { day: 0, from: 8, to: 14 },
  { day: 0, from: 20, to: 27 },
  { day: 1, from: 0, to: 3 },
  { day: 1, from: 4, to: 9 },
  { day: 1, from: 13, to: 18 },
  { day: 1, from: 24, to: 32 },
  { day: 2, from: 0, to: 32 },
  { day: 3, from: 0, to: 5 },
  { day: 3, from: 9, to: 12 },
  { day: 3, from: 16, to: 23 },
  { day: 3, from: 28, to: 32 },
  { day: 4, from: 0, to: 7 },
  { day: 4, from: 12, to: 20 },
  { day: 4, from: 26, to: 32 },
];

/** The slots the customer picks, one search after another: Thursday 10:30 first. */
export const CHOICES: readonly { readonly day: number; readonly at: number }[] = [
  { day: 3, at: 6 },
  { day: 0, at: 6 },
  { day: 4, at: 22 },
  { day: 1, at: 11 },
];

/** Whether a 30-minute appointment fits at quarter `at` of `day`, given the blocks. */
export function fits(blocks: readonly Block[], day: number, at: number) {
  if (at < 0 || at + LENGTH > QUARTERS) return false;
  return !blocks.some((block) => block.day === day && block.from < at + LENGTH && block.to > at);
}

/**
 * Every slot a search offers, in the order the gauge finds them (by time,
 * then day). The product lists them day by day and stops at `LIMIT`; this
 * week never reaches it, so the two orders offer the same slots.
 */
export function offered(blocks: readonly Block[]): { day: number; at: number }[] {
  const out: { day: number; at: number }[] = [];
  for (let at = 0; at + LENGTH <= QUARTERS; at++) for (let day = 0; day < DAYS; day++) if (fits(blocks, day, at)) out.push({ day, at });
  return out.slice(0, LIMIT);
}

/** The calendar after `searches` bookings: what was busy, and what has been booked since. */
export function blocksAfter(searches: number): Block[] {
  const booked = CHOICES.slice(0, searches % (CHOICES.length + 1)).map(({ day, at }) => ({ day, from: at, to: at + LENGTH }));
  return [...BUSY, ...booked];
}

/** "10:30" for quarter `at`. */
export const clockOf = (at: number) => {
  const minutes = OPENS * 60 + at * STEP_MIN;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
};
