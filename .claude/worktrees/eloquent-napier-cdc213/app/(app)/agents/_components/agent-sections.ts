import type { IconSvgElement } from "@hugeicons/react";
import {
  AiImagineIcon,
  Target01Icon,
  ShieldKeyIcon,
  FileEditIcon,
  Blockchain05Icon,
  BubbleChatIcon,
  Call02Icon,
  AiPaintbrushIcon,
  LibraryIcon,
} from "@hugeicons/core-free-icons";

// The nine decisions an agent is made of, and the shape they are drawn in.
//
// One list, shared by the flow on the left and the editor in the dock, for the
// reason the nav groups are shared with the command palette: two copies of
// "which section is which" is how the same thing ends up drawn one way on the
// left and another on the right.

export type SectionId =
  | "identity"
  | "brief"
  | "rules"
  | "prompt"
  | "capabilities"
  | "channels"
  | "model"
  | "voice"
  | "business";

export const SECTION_ICONS: Record<SectionId, IconSvgElement> = {
  identity: AiImagineIcon,
  brief: Target01Icon,
  rules: ShieldKeyIcon,
  prompt: FileEditIcon,
  capabilities: Blockchain05Icon,
  channels: BubbleChatIcon,
  model: AiPaintbrushIcon,
  voice: Call02Icon,
  business: LibraryIcon,
};

/**
 * The static flow the agent is drawn as, band by band, top to bottom.
 *
 * It is a real reading of what happens, not decoration: a message arrives on a
 * channel, meets an agent that has a name and a job, is answered under rules
 * written into a prompt and run through a model, using the capabilities and
 * the business knowledge it was given. Drawing it in that order is what makes
 * nine settings legible as one thing.
 *
 * Static on purpose. An automation's canvas is draggable because the shape of
 * a flow *is* the thing being edited; an agent's shape is fixed, so a canvas
 * that could be rearranged would promise an edit that does not exist.
 */
export const FLOW_BANDS: readonly (readonly SectionId[])[] = [
  ["channels", "voice"],
  ["identity", "brief"],
  ["rules", "prompt", "model"],
  ["capabilities", "business"],
];
