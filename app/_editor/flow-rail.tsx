import { cn } from "../../lib/utils";
import { FLOW_STEPS, type FlowStepId } from "../../shared/pipeline";

/**
 * Where the clip is in Upload → Describe → … → Export. Reflects real state
 * only. A segmented line plus the current step's name: seven labelled pills
 * never fit beside the player, and a scrolling rail hid the active step.
 */
export function FlowRail({ current }: { readonly current: FlowStepId }) {
  const currentIndex = FLOW_STEPS.findIndex((step) => step.id === current);
  const step = FLOW_STEPS[currentIndex];
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <ol aria-label="Editing progress" className="flex min-w-24 flex-1 items-center gap-1">
        {FLOW_STEPS.map((entry, index) => (
          <li
            key={entry.id}
            title={entry.label}
            aria-current={index === currentIndex ? "step" : undefined}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-300",
              index < currentIndex && "bg-primary",
              index === currentIndex && "bg-[color-mix(in_srgb,var(--primary)_55%,var(--foreground))]",
              index > currentIndex && "bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)]",
            )}
          >
            <span className="sr-only">
              {entry.label}
              {index < currentIndex ? " (done)" : ""}
            </span>
          </li>
        ))}
      </ol>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {currentIndex + 1}/{FLOW_STEPS.length} · <span className="text-foreground">{step?.label}</span>
      </span>
    </div>
  );
}
