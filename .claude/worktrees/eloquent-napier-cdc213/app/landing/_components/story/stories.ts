import type { ComponentType } from "react";
import type { StoryProps, StoryScript } from "./kit";
import { AdsStory, adsScript } from "./story-ads";
import { AgentsStory, agentsScript } from "./story-agents";
import { AutomationStory, automationScript } from "./story-automation";
import { ChatStory, chatScript } from "./story-chat";
import { InboxStory, inboxScript } from "./story-inbox";

/** Every story by id, for the dev scrubber. The landing imports each one on its own. */
export const STORIES = {
  chat: { script: chatScript, Story: ChatStory },
  inbox: { script: inboxScript, Story: InboxStory },
  ads: { script: adsScript, Story: AdsStory },
  agents: { script: agentsScript, Story: AgentsStory },
  automation: { script: automationScript, Story: AutomationStory },
} as const satisfies Record<string, { script: StoryScript; Story: ComponentType<StoryProps> }>;

export type StoryId = keyof typeof STORIES;
