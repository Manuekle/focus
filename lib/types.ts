// UI vocabulary extracted from Oruka; backend models are intentionally omitted.
export type ChannelId = "web" | "whatsapp" | "instagram";

export type ContactChannel = ChannelId | "form" | "voice";

export type ChannelStatus = "connected" | "disconnected" | "error";

export type WorkflowStepType =
  | "message"
  | "wait"
  | "condition"
  | "ai_response"
  | "transfer_human"
  | "send_audio"
  | "send_image"
  | "send_video"
  | "http_request"
  | "notify_whatsapp"
  | "notify_team"
  | "notify_email"
  | "update_contact"
  | "log_sheet"
  | "send_payment_link"
  | "book_meeting";

export type ProspectStage =
  /** Bought, booked, signed — the conversation closed in a sale. */
  | "won"
  /** Said no, or bought elsewhere. */
  | "lost"
  /** Price sent, terms being discussed, decision pending. */
  | "negotiating"
  /** Asked real questions and is engaged, but nothing was quoted yet. */
  | "interested"
  /** Went quiet before it went anywhere. */
  | "no_response"
  /** Wrong fit: outside the service, the area, or the budget. */
  | "unqualified"
  /** Not a sale at all — an existing customer with a support question. */
  | "support";

export type ProspectAssessment = {
  readonly stage: ProspectStage;
  /** One line, in the conversation's own language, saying what decided it. */
  readonly reason: string;
  /** What should happen next, when anything should. */
  readonly nextStep?: string;
  readonly assessedAt: string;
  /** How many turns the assessment read. A longer transcript than this is
   *  what makes it stale and worth running again. */
  readonly turnCount: number;
  /** "ai" — the model read the transcript. "manual" — a person overrode it. */
  readonly source: "ai" | "manual";
};
