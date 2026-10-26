import { OnboardingFlow } from "@/app/onboarding/onboarding-flow";
import type { Answers } from "@/app/onboarding/_lib/questions";
import { BrowserStorageScopeProvider } from "@/lib/browser-storage-scope";

/**
 * The onboarding flow with no account behind it.
 *
 * `/onboarding` sits behind the session gate, so the one screen whose whole
 * job is to make a first impression could only be looked at by signing up
 * again. This mounts the same `OnboardingFlow` in preview mode — no settled
 * check, a simulated save, "skip" and "go to dashboard" start over — and can
 * open straight on any screen:
 *
 *   /dev/onboarding                      the welcome screen
 *   /dev/onboarding?q=channels           a question, with sample answers so far
 *   /dev/onboarding?stage=review         the "reviewing your profile" beat
 *   /dev/onboarding?stage=review&fail=1  the same, with the first save failing
 *   /dev/onboarding?stage=result         the profile and plan
 *
 * Dev only, like everything under /dev — the layout 404s this in production.
 */

const SAMPLE: Answers = {
  businessName: "Café Rosa",
  industry: "hospitality",
  description: "Café de especialidad y pastelería artesanal, con delivery en Palermo.",
  channels: ["whatsapp", "instagram", "phone", "google"],
  messageVolume: "50to150",
  callVolume: "5to20",
  teamSize: "2to5",
  responseTime: "hours",
  goals: ["inbox", "automations"],
  crm: "none",
  modules: ["crm", "automations", "reminders", "calendar"],
};

const QUESTION_IDS = [
  "businessName",
  "industry",
  "description",
  "channels",
  "messageVolume",
  "callVolume",
  "teamSize",
  "responseTime",
  "goals",
  "modules",
  "crm",
] as const;

export default async function DevOnboardingPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const question = QUESTION_IDS.find((id) => id === params.q);
  const stage =
    params.stage === "review" || params.stage === "result"
      ? ({ kind: params.stage } as const)
      : question
        ? ({ id: question, kind: "question" } as const)
        : undefined;

  return (
    <BrowserStorageScopeProvider scope="dev:onboarding">
      <OnboardingFlow
        initial={
          stage
            ? {
                // A question shows the answers given before it, not after.
                answers: question
                  ? Object.fromEntries(
                      QUESTION_IDS.slice(0, QUESTION_IDS.indexOf(question)).map((id) => [id, SAMPLE[id]]),
                    )
                  : SAMPLE,
                failFirstSave: params.fail === "1",
                stage,
              }
            : undefined
        }
        key={JSON.stringify(params)}
        preview
      />
    </BrowserStorageScopeProvider>
  );
}
