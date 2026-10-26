import type { IconSvgElement } from "@hugeicons/react";
import {
  MessageSquareIcon,
  Timer01Icon,
  GitBranchIcon,
  AiElementsIcon,
  UserIcon,
  Image01Icon,
  Video01Icon,
  AiAudioIcon,
  WebhookIcon,
  WhatsappIcon,
  UserEdit01Icon,
  SlackIcon,
  GoogleSheetIcon,
  StripeIcon,
  Calendar03Icon,
} from "@hugeicons/core-free-icons";
import type { WorkflowStepType } from "./types";

// Shared between app/automations/page.tsx (card previews), the flow canvas,
// and the automation detail page — one source of truth for step type
// metadata so all three stay in sync.

/**
 * Grouping used by the canvas step picker, so the palette reads as a
 * catalogue rather than a flat ring of icons.
 */
export const STEP_GROUPS: readonly { readonly labelKey: string; readonly types: readonly WorkflowStepType[] }[] = [
  { labelKey: "automations.groupConversation", types: ["message", "ai_response", "transfer_human"] },
  { labelKey: "automations.groupLogic", types: ["condition", "wait"] },
  { labelKey: "automations.groupConnectors", types: ["notify_whatsapp", "notify_team", "notify_email", "http_request", "update_contact", "log_sheet", "send_payment_link", "book_meeting"] },
  { labelKey: "automations.groupMedia", types: ["send_image", "send_video", "send_audio"] },
];

export const STEP_ICONS: Record<WorkflowStepType, IconSvgElement> = {
  message: MessageSquareIcon,
  wait: Timer01Icon,
  condition: GitBranchIcon,
  ai_response: AiElementsIcon,
  transfer_human: UserIcon,
  send_audio: AiAudioIcon,
  send_image: Image01Icon,
  send_video: Video01Icon,
  http_request: WebhookIcon,
  notify_whatsapp: WhatsappIcon,
  notify_team: SlackIcon,
  notify_email: WebhookIcon, // Reuse webhook icon for email
  update_contact: UserEdit01Icon,
  log_sheet: GoogleSheetIcon,
  send_payment_link: StripeIcon,
  book_meeting: Calendar03Icon,
};

/** One type palette for canvas nodes, list badges and the step picker. */
export const STEP_HUES: Record<WorkflowStepType, number> = {
  message: 250,
  wait: 345,
  condition: 165,
  ai_response: 295,
  transfer_human: 65,
  send_audio: 295,
  send_image: 295,
  send_video: 295,
  http_request: 220,
  notify_whatsapp: 165,
  notify_team: 250,
  notify_email: 250,
  update_contact: 65,
  log_sheet: 165,
  send_payment_link: 295,
  book_meeting: 220,
};

/**
 * Every step type there is, for callers that need the full set — the flow
 * assistant tells the model which types it may propose.
 *
 * Derived from {@link STEP_ICONS} rather than written out again: that map is
 * a `Record<WorkflowStepType, …>`, so the compiler makes it exhaustive and a
 * new step type cannot go missing here. The hand-maintained list this
 * replaces had fallen five types behind — the assistant was told it could not
 * use notify_team, notify_email, log_sheet, send_payment_link or book_meeting
 * while the very same prompt went on to document three of them.
 */
export const STEP_TYPES: readonly WorkflowStepType[] = Object.keys(STEP_ICONS) as WorkflowStepType[];

export const STEP_LABEL_KEYS: Record<WorkflowStepType, string> = {
  message: "automations.stepMessage",
  wait: "automations.stepWait",
  condition: "automations.stepCondition",
  ai_response: "automations.stepAiResponse",
  transfer_human: "automations.stepTransferHuman",
  send_audio: "automations.stepSendAudio",
  send_image: "automations.stepSendImage",
  send_video: "automations.stepSendVideo",
  http_request: "automations.stepHttpRequest",
  notify_whatsapp: "automations.stepNotifyWhatsapp",
  notify_team: "automations.stepNotifyTeam",
  notify_email: "automations.stepNotifyEmail",
  update_contact: "automations.stepUpdateContact",
  log_sheet: "automations.stepLogSheet",
  send_payment_link: "automations.stepSendPaymentLink",
  book_meeting: "automations.stepBookMeeting",
};

export const STEP_DESCRIPTION_KEYS: Record<WorkflowStepType, string> = {
  message: "automations.stepMessageDesc",
  wait: "automations.stepWaitDesc",
  condition: "automations.stepConditionDesc",
  ai_response: "automations.stepAiResponseDesc",
  transfer_human: "automations.stepTransferHumanDesc",
  send_audio: "automations.stepSendAudioDesc",
  send_image: "automations.stepSendImageDesc",
  send_video: "automations.stepSendVideoDesc",
  http_request: "automations.stepHttpRequestDesc",
  notify_whatsapp: "automations.stepNotifyWhatsappDesc",
  notify_team: "automations.stepNotifyTeamDesc",
  notify_email: "automations.stepNotifyEmailDesc",
  update_contact: "automations.stepUpdateContactDesc",
  log_sheet: "automations.stepLogSheetDesc",
  send_payment_link: "automations.stepSendPaymentLinkDesc",
  book_meeting: "automations.stepBookMeetingDesc",
};

/**
 * Category shown as the small label on a node's header, mirroring how n8n /
 * Agent Builder group node types. Keys are i18n keys.
 */
export const STEP_CATEGORY_KEYS: Record<WorkflowStepType, string> = {
  message: "automations.catSend",
  wait: "automations.catFlow",
  condition: "automations.catFlow",
  ai_response: "automations.catAi",
  transfer_human: "automations.catHandoff",
  send_audio: "automations.catMedia",
  send_image: "automations.catMedia",
  send_video: "automations.catMedia",
  http_request: "automations.catIntegration",
  notify_whatsapp: "automations.catChannel",
  notify_team: "automations.catChannel",
  notify_email: "automations.catChannel",
  update_contact: "automations.catCrm",
  log_sheet: "automations.catIntegration",
  send_payment_link: "automations.catIntegration",
  book_meeting: "automations.catIntegration",
};

/**
 * The config field a node's body preview reads from, in priority order, plus
 * the i18n key for the placeholder shown when they're all empty. Keeps the
 * canvas and the AI-proposal preview rendering the same summary.
 */
const PREVIEW_FIELDS: Record<
  WorkflowStepType,
  ReadonlyArray<
    | "message"
    | "prompt"
    | "condition"
    | "duration"
    | "mediaUrl"
    | "mediaPrompt"
    | "mediaCaption"
    | "url"
    | "phone"
    | "emailTo"
    | "emailSubject"
    | "webhookUrl"
    | "contactStatus"
    | "contactNote"
    | "spreadsheetId"
    | "amount"
    | "productName"
    | "meetingSummary"
  >
> = {
  message: ["message"],
  ai_response: ["prompt"],
  wait: ["duration"],
  condition: ["condition"],
  transfer_human: ["message"],
  send_audio: ["mediaUrl", "mediaPrompt"],
  send_image: ["mediaUrl", "mediaPrompt", "mediaCaption"],
  send_video: ["mediaUrl", "mediaPrompt", "mediaCaption"],
  http_request: ["url"],
  notify_whatsapp: ["message", "phone"],
  notify_team: ["message", "webhookUrl"],
  notify_email: ["emailSubject", "message", "emailTo", "phone"],
  update_contact: ["contactNote", "contactStatus"],
  log_sheet: ["spreadsheetId"],
  send_payment_link: ["productName", "amount"],
  book_meeting: ["meetingSummary"],
};

export const STEP_EMPTY_KEYS: Record<WorkflowStepType, string> = {
  message: "automations.emptyMessage",
  ai_response: "automations.emptyPrompt",
  wait: "automations.emptyDuration",
  condition: "automations.emptyCondition",
  transfer_human: "automations.emptyTransfer",
  send_audio: "automations.emptyMedia",
  send_image: "automations.emptyMedia",
  send_video: "automations.emptyMedia",
  http_request: "automations.emptyUrl",
  notify_whatsapp: "automations.emptyWhatsapp",
  notify_team: "automations.emptyTeam",
  notify_email: "automations.emptyEmail",
  update_contact: "automations.emptyContact",
  log_sheet: "automations.emptySheet",
  send_payment_link: "automations.emptyPaymentLink",
  book_meeting: "automations.emptyMeeting",
};

/**
 * Body text for a node, or `null` when nothing is configured yet. `config`
 * accepts extra non-string keys so an AI plan step (which carries nested
 * thenSteps/elseSteps alongside its config fields) can be passed directly.
 */
export function stepPreview(step: {
  type: WorkflowStepType;
  config: Readonly<Record<string, unknown>>;
}): string | null {
  for (const field of PREVIEW_FIELDS[step.type]) {
    const value = step.config[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
