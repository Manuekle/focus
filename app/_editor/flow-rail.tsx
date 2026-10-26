import { Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "../../components/icons/icon";
import { cn } from "../../lib/utils";
import { FLOW_STEPS, type FlowStepId } from "../../shared/pipeline";

/** Where the clip is in Upload → Describe → … → Export. Reflects real state only. */
export function FlowRail({ current }: { readonly current: FlowStepId }) {
  const currentIndex = FLOW_STEPS.findIndex((step) => step.id === current);
  return (
    <ol aria-label="Flujo de edición" className="x-fade flex items-center gap-1 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {FLOW_STEPS.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <li key={step.id} className="flex shrink-0 items-center gap-1" aria-current={active ? "step" : undefined}>
            <span
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs",
                active && "bg-accent font-medium text-accent-foreground",
                done && "text-foreground",
                !active && !done && "text-muted-foreground",
              )}
            >
              {done ? (
                <HugeiconsIcon icon={Tick02Icon} size={13} strokeWidth={2} className="text-primary" />
              ) : (
                <span className="tabular-nums opacity-70">{String(index + 1).padStart(2, "0")}</span>
              )}
              {step.label}
            </span>
            {index < FLOW_STEPS.length - 1 ? <span aria-hidden className="h-px w-3 bg-border" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
