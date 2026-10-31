import { loadSkills, type SkillSet } from "./loader";
import { RULES, type PlanDecision, type Policy, type PolicyContext, type PolicyOutcome, type PolicyStage } from "./rules";

// The policy registry and its execution hooks. The mapping engine calls
// run(stage, context) at pose planning, frame preparation, rendering and
// validation; each rule for that stage evaluates and reports. Advisory rules
// add at most one short line each to a generator's prompt (hints): the
// SKILL.md documents themselves are never sent to a model.

export class PolicyRegistry {
  private readonly rules: readonly Policy[];

  constructor(readonly skills: SkillSet, rules: readonly Policy[] = RULES) {
    for (const rule of rules) {
      const skill = skills.skills.get(rule.skill);
      if (!skill) throw new Error(`policy ${rule.id}: skill ${rule.skill} isn't loaded`);
      if (!skill.sections.includes(rule.section)) throw new Error(`policy ${rule.id}: ${rule.skill} has no section "${rule.section}"`);
    }
    this.rules = rules;
  }

  list(stage?: PolicyStage): readonly Policy[] {
    return stage ? this.rules.filter((rule) => rule.stage === stage) : this.rules;
  }

  run<C extends PolicyContext>(stage: C["stage"], context: C): { outcomes: PolicyOutcome[]; decision: PlanDecision | null } {
    const outcomes: PolicyOutcome[] = [];
    let decision: PlanDecision | null = null;
    for (const rule of this.list(stage)) {
      const result = (rule as unknown as Policy<C>).evaluate(context);
      if (!result) continue;
      const { decision: made, ...rest } = result;
      if (made) decision = made;
      outcomes.push({ id: rule.id, skill: rule.skill, section: rule.section, kind: rule.kind, stage: rule.stage, ...rest });
    }
    return { outcomes, decision };
  }

  /** The advisory lines for a generator's prompt at a stage. */
  hints(stage: PolicyStage): string[] {
    return this.list(stage).flatMap((rule) => (rule.kind === "advisory" && rule.hint ? [rule.hint] : []));
  }
}

/** A failed constraint rejects; advisory outcomes never do. */
export const constraintFailures = (outcomes: readonly PolicyOutcome[]) => outcomes.filter((outcome) => outcome.kind === "constraint" && !outcome.passed);

let shared: PolicyRegistry | null = null;

export function policyRegistry(): PolicyRegistry {
  shared ??= new PolicyRegistry(loadSkills());
  return shared;
}
