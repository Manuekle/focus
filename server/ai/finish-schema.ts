// Strict-mode JSON schema pieces shared by the planner and the AI editor.

export const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

/** Every key required, null meaning "leave as is". Mirrors FinishSchema. */
export const FINISH_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["look", "subject", "accent", "accentStrength", "vignette", "grain", "letterbox"],
  properties: {
    look: nullable({ type: "string", enum: ["natural", "cinematic", "noir", "warm", "cool", "vintage", "vivid"] }),
    subject: nullable({ type: "string", enum: ["none", "glow", "outline"] }),
    accent: nullable({ type: "string", enum: ["white", "gold", "cyan", "magenta", "lime"] }),
    accentStrength: nullable({ type: "number" }),
    vignette: nullable({ type: "number" }),
    grain: nullable({ type: "number" }),
    letterbox: nullable({ type: "boolean" }),
  },
} as const;
