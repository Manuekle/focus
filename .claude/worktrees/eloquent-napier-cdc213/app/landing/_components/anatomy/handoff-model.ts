/**
 * The truth behind Fig 05.2, kept apart from the drawing so what the card
 * shows and what it says come from one place.
 *
 * What the product does. `transfer_human` (`agent/tools/transfer_human.ts`)
 * sets the contact to `waiting_human`, keeps the reason as its note, flags the
 * chat in the inbox and tells the owner. From then on the agent's turn is
 * hard-blocked (`agent/instructions/automations.ts`): it acknowledges once that
 * a teammate will take over, calls no tools and does not resume the flow, and
 * every automation step on the contact fails with "A human owns this
 * conversation" (`lib/automation-runner.ts`). It stays that way until a person
 * sets the contact back to open.
 *
 * The drawing is a tape transport with a manual override. The tape is the
 * conversation: the customer's messages come in printed on its upper lane, and
 * the agent's head prints a reply on the lower lane under each one. A motor
 * (the agent) drives the take-up drum through a gear; a hand crank (a person)
 * waits beside it, out of mesh. One rocker holds the two pinions, so lowering
 * one into the gear lifts the other out: the conversation has one owner. Hand
 * it off and the head prints one short acknowledgement, the motor lets go and
 * stops, the crank drops in, the flag goes up and the note card is lit.
 */

export type Owner = "agent" | "person";

/** The contact's status for each owner, as `lib/types.ts` names them. */
export const STATUS: Readonly<Record<Owner, "open" | "waiting_human">> = { agent: "open", person: "waiting_human" };

/** Tape travelled between two of the customer's messages, in world units. */
export const GAP = 17;
/** How far behind its message the reply starts, so it reads as an answer to it. */
export const LAG = 3.5;
/** How fast the motor runs the tape, in units a second. */
export const SPEED = 6.5;
/** How many messages are already on the tape when the figure first draws. */
export const BACKLOG = 3;
/** The acknowledgement: one short line, against a reply's two. */
export const ACK = 3.2;

/** Line lengths of a message (two lines) or a reply (two lines), seeded so no two read alike. */
export function linesOf(seed: number, long: number, short: number): [number, number] {
  let value = (seed * 7919 + 104729) % 2147483647;
  const next = () => (value = (value * 16807) % 2147483647) / 2147483647;
  return [long * (0.7 + 0.3 * next()), short * (0.45 + 0.55 * next())];
}

/** A mark the head has printed: a reply under message `message`, or the one acknowledgement. */
export type Printed = { readonly kind: "reply" | "ack"; readonly at: number; readonly message: number };

/**
 * The tape's state: how far it has run, and what the head has printed. `run`
 * moves it; `handOff` prints the acknowledgement. Replies are printed only
 * while the agent owns the conversation, one under each message as it reaches
 * the head.
 */
export class Tape {
  travelled = BACKLOG * GAP;
  printed: Printed[] = Array.from({ length: BACKLOG }, (_, index) => ({ kind: "reply" as const, at: index * GAP + LAG, message: index }));
  replies = BACKLOG;

  /** Where message `index` starts on the tape. */
  static messageAt = (index: number) => index * GAP;

  run(distance: number, owner: Owner) {
    const from = this.travelled;
    this.travelled += distance;
    if (owner !== "agent") return;
    for (let index = Math.ceil((from - LAG) / GAP); index * GAP + LAG <= this.travelled; index++) {
      if (index < 0 || this.printed.some((mark) => mark.kind === "reply" && mark.message === index)) continue;
      this.printed.push({ kind: "reply", at: index * GAP + LAG, message: index });
      this.replies++;
    }
    this.forget();
  }

  /** The agent's last word on a handed-off conversation: once, from where the tape stands. Returns where it ends. */
  handOff() {
    const message = Math.floor(this.travelled / GAP);
    this.printed.push({ kind: "ack", at: this.travelled, message });
    return this.travelled + ACK;
  }

  /** Drops what has run far past the drum. */
  private forget() {
    const keep = this.travelled - GAP * 6;
    if (this.printed.length > 24) this.printed = this.printed.filter((mark) => mark.at > keep);
  }
}
