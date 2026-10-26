// UI error vocabulary only. Server response helpers stay in Oruka.
export type ApiErrorCode =
  | "account_suspended"
  | "invalid_json"
  | "invalid_body"
  | "missing_field"
  | "invalid_field"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "unprocessable"
  | "too_large"
  | "not_configured"
  | "rate_limited"
  | "upstream_failed"
  | "timeout"
  | "server_error"
  | "method_not_allowed"
  // Domain-specific failures that deserve their own wording rather than the
  // generic sentence for their status.
  | "no_credentials"
  | "model_unavailable"
  | "generation_failed"
  | "no_file"
  | "unsupported_format"
  | "nothing_to_update"
  | "no_recognized_keys"
  | "wrong_password"
  | "workspace_unavailable"
  | "workspace_creation_closed"
  // Vendor refusals the operator fixes in the vendor's own console. The
  // code carries the instruction so the UI can word it in either language
  // instead of falling back to the generic "not allowed" sentence.
  | "elevenlabs_permission"
  | "telephony_quote_expired"
  | "telephony_purchase_review"
  | "telephony_regulatory"
  | "twilio_geo_blocked"
  | "twilio_trial_unverified"
  | "twilio_trial_audio"
  | "twilio_account_inactive"
  // Out of included AI credits. Its own code so the UI can print the two
  // ways forward, instead of the generic 422 sentence.
  | "no_credits"
  // A flow switched on while it still has a template's `[completar]` blank:
  // it would send that literal word to a customer.
  | "automation_has_blanks"
  // A feature an Oruka-hosted tenant does not offer yet (lib/hosted.ts).
  | "hosted_unavailable"
  | "hosted_managed_channel"
  | "plan_limit";
