import type { IconSvgElement } from "@/components/icons/icon";
import {
  Briefcase01Icon,
  Building03Icon,
  Calendar03Icon,
  CallIcon,
  ChefHatIcon,
  Clock01Icon,
  CodeIcon,
  FlashIcon,
  GoogleIcon,
  GridIcon,
  HealthIcon,
  House01Icon,
  InboxIcon,
  InstagramIcon,
  Facebook01Icon,
  Globe02Icon,
  LibraryIcon,
  Mail01Icon,
  Megaphone01Icon,
  Moon02Icon,
  Mortarboard01Icon,
  Store01Icon,
  TiktokIcon,
  UserGroupIcon,
  UserIcon,
  UserMultipleIcon,
  WhatsappIcon,
  ZapIcon,
} from "@hugeicons/core-free-icons";
import {
  CALL_VOLUMES,
  CONTACT_CHANNELS,
  CRMS,
  GOALS,
  INDUSTRIES,
  MAX_DESCRIPTION_CHARS,
  MESSAGE_VOLUMES,
  RESPONSE_TIMES,
  TEAM_SIZES,
} from "@/lib/onboarding/options";
import type { OnboardingProfile } from "@/lib/onboarding/types";
import { MODULES } from "@/lib/modules";

/**
 * The questions, as data: what each one asks, where its answer goes and what
 * its options look like. The flow draws whatever this list says, so adding a
 * question is an entry here plus its copy — not a new branch in the component.
 */

export type Answers = {
  businessName: string;
  industry: string;
  description: string;
  channels: string[];
  messageVolume: string;
  callVolume: string;
  teamSize: string;
  responseTime: string;
  goals: string[];
  crm: string;
  modules: string[];
};

export const EMPTY_ANSWERS: Answers = {
  businessName: "",
  industry: "",
  description: "",
  channels: [],
  messageVolume: "",
  callVolume: "",
  teamSize: "",
  responseTime: "",
  goals: [],
  crm: "",
  modules: [],
};

export type Chapter = "business" | "customers" | "goals";
export const CHAPTERS: readonly Chapter[] = ["business", "customers", "goals"];

export type ChoiceOption = {
  readonly id: string;
  readonly icon?: IconSvgElement;
  /** Category hue for the icon tile — the channels wear their own colour. */
  readonly hue?: number;
  /** 1-based step on a volume scale, drawn as signal bars instead of an icon;
   *  the scale is as long as the option list. */
  readonly level?: number;
};

type Base = {
  readonly chapter: Chapter;
  /** Friendly line above the question, reacting to the answers so far. */
  readonly ack?: boolean;
  readonly required: boolean;
  /** Only asked when this says so, e.g. calls only when the phone rings. */
  readonly when?: (answers: Answers) => boolean;
};

export type TextQuestion = Base & {
  readonly kind: "text";
  readonly id: "businessName" | "description";
  readonly maxLength: number;
  readonly multiline: boolean;
};

export type ChoiceQuestion = Base & {
  readonly kind: "single" | "multi";
  readonly id: "industry" | "channels" | "messageVolume" | "callVolume" | "teamSize" | "responseTime" | "goals" | "modules" | "crm";
  readonly options: readonly ChoiceOption[];
  /** Translation prefix for option labels: `${labels}.${option.id}`. */
  readonly labels: string;
  /** Translation prefix for a second line under each label, when there is one. */
  readonly hints?: string;
  readonly layout: "list" | "grid" | "chips";
};

export type Question = TextQuestion | ChoiceQuestion;
export type QuestionId = Question["id"];

const INDUSTRY_ICONS: Record<(typeof INDUSTRIES)[number], IconSvgElement> = {
  retail: Store01Icon,
  services: Briefcase01Icon,
  health: HealthIcon,
  education: Mortarboard01Icon,
  realEstate: House01Icon,
  hospitality: ChefHatIcon,
  software: CodeIcon,
  other: GridIcon,
};

/** Hues follow `channel-badge.tsx` where a channel already has one. */
const CHANNEL_STYLE: Record<(typeof CONTACT_CHANNELS)[number], { icon: IconSvgElement; hue: number }> = {
  whatsapp: { icon: WhatsappIcon, hue: 165 },
  instagram: { icon: InstagramIcon, hue: 345 },
  facebook: { icon: Facebook01Icon, hue: 262 },
  phone: { icon: CallIcon, hue: 295 },
  website: { icon: Globe02Icon, hue: 220 },
  email: { icon: Mail01Icon, hue: 65 },
  tiktok: { icon: TiktokIcon, hue: 195 },
  google: { icon: GoogleIcon, hue: 25 },
};

const TEAM_ICONS: Record<(typeof TEAM_SIZES)[number], IconSvgElement> = {
  solo: UserIcon,
  "2to5": UserMultipleIcon,
  "6to15": UserGroupIcon,
  over15: Building03Icon,
};

const RESPONSE_ICONS: Record<(typeof RESPONSE_TIMES)[number], IconSvgElement> = {
  minutes: FlashIcon,
  hours: Clock01Icon,
  sameDay: Calendar03Icon,
  nextDay: Moon02Icon,
};

const GOAL_ICONS: Record<(typeof GOALS)[number], IconSvgElement> = {
  inbox: InboxIcon,
  ads: Megaphone01Icon,
  automations: ZapIcon,
  knowledge: LibraryIcon,
  commerce: Calendar03Icon,
};

export const QUESTIONS: readonly Question[] = [
  {
    chapter: "business",
    id: "businessName",
    kind: "text",
    maxLength: 120,
    multiline: false,
    required: true,
  },
  {
    ack: true,
    chapter: "business",
    id: "industry",
    kind: "single",
    labels: "onboarding.industry",
    layout: "grid",
    options: INDUSTRIES.map((id) => ({ icon: INDUSTRY_ICONS[id], id })),
    required: true,
  },
  {
    chapter: "business",
    id: "description",
    kind: "text",
    maxLength: MAX_DESCRIPTION_CHARS,
    multiline: true,
    required: false,
  },
  {
    ack: true,
    chapter: "customers",
    id: "channels",
    kind: "multi",
    labels: "onboarding.channel",
    layout: "grid",
    options: CONTACT_CHANNELS.map((id) => ({ ...CHANNEL_STYLE[id], id })),
    required: false,
  },
  {
    chapter: "customers",
    id: "messageVolume",
    kind: "single",
    labels: "onboarding.messages",
    layout: "list",
    options: MESSAGE_VOLUMES.map((id, index) => ({ id, level: index + 1 })),
    required: false,
  },
  {
    chapter: "customers",
    id: "callVolume",
    kind: "single",
    labels: "onboarding.calls",
    layout: "list",
    options: CALL_VOLUMES.map((id, index) => ({ id, level: index + 1 })),
    required: false,
    when: (answers) => answers.channels.includes("phone"),
  },
  {
    chapter: "customers",
    hints: "onboarding.teamHint",
    id: "teamSize",
    kind: "single",
    labels: "onboarding.team",
    layout: "grid",
    options: TEAM_SIZES.map((id) => ({ icon: TEAM_ICONS[id], id })),
    required: false,
  },
  {
    chapter: "customers",
    hints: "onboarding.responseHint",
    id: "responseTime",
    kind: "single",
    labels: "onboarding.response",
    layout: "grid",
    options: RESPONSE_TIMES.map((id) => ({ icon: RESPONSE_ICONS[id], id })),
    required: false,
  },
  {
    ack: true,
    chapter: "goals",
    hints: "onboarding.goalHint",
    id: "goals",
    kind: "multi",
    labels: "onboarding.goal",
    layout: "list",
    options: GOALS.map((id) => ({ icon: GOAL_ICONS[id], id })),
    required: false,
  },
  {
    // Preselected from the answers above (lib/modules.ts recommendModules),
    // so most owners only confirm. Whatever stays off is one switch away in
    // "Personalizar menú".
    chapter: "goals",
    hints: "onboarding.moduleHint",
    id: "modules",
    kind: "multi",
    labels: "onboarding.module",
    layout: "grid",
    // The advanced modules (team, skills, activity) stay out of the first
    // impression; they are in "Personalizar menú" for whoever looks.
    options: MODULES.filter((module) => module.group !== "advanced").map(({ icon, id }) => ({ icon, id })),
    required: false,
  },
  {
    ack: true,
    chapter: "goals",
    id: "crm",
    kind: "single",
    labels: "onboarding.crm",
    layout: "chips",
    options: CRMS.map(({ id }) => ({ id })),
    required: false,
  },
];

/** The questions this set of answers asks, in order. */
export function visibleQuestions(answers: Answers): readonly Question[] {
  return QUESTIONS.filter((question) => !question.when || question.when(answers));
}

export function isAnswered(question: Question, answers: Answers): boolean {
  const value = answers[question.id];
  return Array.isArray(value) ? value.length > 0 : value.trim().length > 0;
}

/** The profile these answers save as. Answers to questions that are no longer
 *  asked — calls after the phone was unticked — are dropped, not kept. */
export function toProfile(answers: Answers): OnboardingProfile {
  const asked = new Set(visibleQuestions(answers).map((question) => question.id));
  const keep = <T>(id: QuestionId, value: T, empty: T): T => (asked.has(id) ? value : empty);
  return {
    activation: { startedActionIds: [] },
    businessName: answers.businessName.trim(),
    industry: answers.industry,
    description: answers.description.trim().replace(/\s+/g, " "),
    channels: answers.channels,
    messageVolume: answers.messageVolume,
    callVolume: keep("callVolume", answers.callVolume, ""),
    teamSize: answers.teamSize,
    responseTime: answers.responseTime,
    goals: answers.goals,
    crm: answers.crm,
    modules: answers.modules,
  };
}

/** Initials for the profile monogram: the first letter of the first two words. */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => Array.from(word)[0] ?? "");
  return letters.join("").toLocaleUpperCase() || "·";
}
