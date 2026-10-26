/**
 * The truth behind Fig 05.3, kept apart from the drawing so every number the
 * card shows comes from one place.
 *
 * What the product does. A schedule (`agent/schedules/meta-leads.ts`, cron
 * `*\/5 * * * *`) reads the Page's lead forms every five minutes and takes in
 * every lead it has not seen before (keyed on `meta_lead_id`) from the last
 * day (`lib/meta-lead-intake.ts`). Each becomes a contact whose source is the
 * form it came from (`meta-ads:<form>`), and `intakeLead` (`lib/lead-intake.ts`)
 * fires the active automation that sends it the first message.
 *
 * The drawing is an indexing table on a Geneva drive. The drive wheel turns
 * once every five minutes; each turn its pin steps the table a quarter turn,
 * so a tray reaches each station once a poll. Leads wait in a channel by the
 * Meta feeder, each card tabbed with its campaign; at the intake station every
 * waiting card goes into the tray at once, the next station stamps them as
 * contacts, the next sends each its first message (a flag on the card), and
 * the last files them in the contacts box.
 */

/** Minutes between polls: one turn of the drive wheel. */
export const POLL_MINUTES = 5;
/** Hours a lead stays fresh enough to take in. */
export const FRESH_HOURS = 24;
/** The campaigns the cards are tabbed with. */
export const CAMPAIGNS = 3;
/** Trays on the table, one per station: intake, stamp, first message, file. */
export const STATIONS = 4;

/** Where in a turn each thing happens. The pin is in the slot for the first quarter. */
export const PHASE = { step: 0.25, intake: 0.3, file: 0.34, stamp: 0.48, message: 0.58 } as const;
/** How long, in turns, a card takes to slide, a plunger to press, a flag to rise. */
export const MOVE = 0.11;

/** Leads that come in between polls, poll by poll, by campaign: a loop of eight. */
const ARRIVALS: readonly (readonly number[])[] = [[0, 1], [2], [1, 0], [2, 1, 0], [0], [1, 2], [2, 0], [1]];

export type Lead = {
  readonly id: number;
  readonly campaign: number;
  /** When it reaches the feeder, in turns. */
  readonly arrives: number;
  /** Its place in the channel when it was taken, and when. */
  takenAt?: number;
  slot?: number;
  /** When it was filed, and from which place in its tray. */
  filedAt?: number;
  from?: number;
};

export type Tray = { cards: Lead[]; stampedAt: number | null; sentAt: number | null };

/** The leads that arrive during turn `turn`, numbered from `id`: after that turn's poll, so they wait for the next. */
function arrivalsIn(turn: number, id: number): Lead[] {
  return ARRIVALS[turn % ARRIVALS.length]!.map((campaign, index) => ({ id: id + index, campaign, arrives: turn + 0.62 + index * 0.12 }));
}

/**
 * The table, simulated: `advance` moves time forward (only forward, as a
 * clock does) and applies each event in the order it happens.
 */
export class Carousel {
  time = 0;
  /** Leads at the feeder that have not been taken yet, oldest first. */
  queue: Lead[] = [];
  trays: Tray[] = Array.from({ length: STATIONS }, () => ({ cards: [], stampedAt: null, sentAt: null }));
  filed: Lead[] = [];
  taken = 0;
  sent = 0;
  /** Leads still to arrive, and the first turn not yet scheduled. */
  private pending: Lead[] = [];
  private scheduled = 0;
  private nextId = 0;

  /** How many quarter turns the table has made by `time`. */
  static steps(time: number) {
    const turn = Math.floor(time);
    return turn + (time - turn >= PHASE.step ? 1 : 0);
  }

  /** Which station tray `tray` stands at after `steps` quarter turns: 0 intake, 1 stamp, 2 message, 3 file. */
  static stationOf(tray: number, steps: number) {
    return (((tray + steps) % STATIONS) + STATIONS) % STATIONS;
  }

  private trayAt(station: number, steps: number) {
    return this.trays.findIndex((_, tray) => Carousel.stationOf(tray, steps) === station);
  }

  advance(to: number) {
    if (to <= this.time) return;
    while (this.scheduled <= Math.ceil(to)) {
      const batch = arrivalsIn(this.scheduled++, this.nextId);
      this.nextId += batch.length;
      this.pending.push(...batch);
    }
    const events: { at: number; run: () => void }[] = [];
    for (const lead of this.pending) if (lead.arrives > this.time && lead.arrives <= to) events.push({ at: lead.arrives, run: () => this.queue.push(lead) });
    for (let turn = Math.floor(this.time); turn <= Math.floor(to); turn++) {
      const steps = turn + 1;
      const at = (phase: number) => turn + phase;
      events.push({
        at: at(PHASE.intake),
        run: () => {
          const tray = this.trays[this.trayAt(0, steps)]!;
          const time = at(PHASE.intake);
          this.queue.forEach((lead, slot) => {
            lead.takenAt = time;
            lead.slot = slot;
          });
          tray.cards = this.queue.slice(0, 3);
          this.queue = this.queue.slice(3);
          this.taken += tray.cards.length;
        },
      });
      events.push({
        at: at(PHASE.file),
        run: () => {
          const tray = this.trays[this.trayAt(3, steps)]!;
          tray.cards.forEach((lead, index) => {
            lead.filedAt = at(PHASE.file);
            lead.from = index;
            this.filed.push(lead);
          });
          tray.cards = [];
          tray.stampedAt = null;
          tray.sentAt = null;
        },
      });
      events.push({
        at: at(PHASE.stamp),
        run: () => {
          const tray = this.trays[this.trayAt(1, steps)]!;
          if (tray.cards.length) tray.stampedAt = at(PHASE.stamp);
        },
      });
      events.push({
        at: at(PHASE.message),
        run: () => {
          const tray = this.trays[this.trayAt(2, steps)]!;
          if (!tray.cards.length) return;
          tray.sentAt = at(PHASE.message);
          this.sent += tray.cards.length;
        },
      });
    }
    events
      .filter((event) => event.at > this.time && event.at <= to)
      .sort((a, b) => a.at - b.at)
      .forEach((event) => event.run());
    this.pending = this.pending.filter((lead) => lead.arrives > to);
    if (this.filed.length > 24) this.filed = this.filed.slice(-24);
    this.time = to;
  }
}
