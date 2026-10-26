import type { ActivityPoint, Automation, ChannelInfo, ChatSummary, DashboardStats } from "@/lib/types";
import type { OnboardingProfile } from "@/lib/onboarding/types";

export type DashboardData = {
  readonly chats: ChatSummary[];
  readonly channels: ChannelInfo[];
  readonly stats: DashboardStats;
  readonly automations: Automation[];
  readonly activity: ActivityPoint[];
  readonly onboardingProfile: OnboardingProfile | null;
};
