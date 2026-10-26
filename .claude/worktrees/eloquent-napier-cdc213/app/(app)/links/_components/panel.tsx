import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The chrome every editor panel shares — the profile, the style and one
 *  link each get the same column, the same heading and the same rhythm. */
export function PanelShell({
  children,
  description,
  title,
}: {
  readonly children: ReactNode;
  readonly description: string;
  readonly title: string;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
      <h2 className="font-heading text-lg font-medium tracking-[-0.02em]">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      <div className="mt-6 flex flex-col gap-5">{children}</div>
    </div>
  );
}

export function Field({
  children,
  hint,
  label,
}: {
  readonly children: ReactNode;
  readonly hint?: ReactNode;
  readonly label: string;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs leading-5 text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/** A labelled section inside a panel. `rounded-2xl` over `p-4` so the cards
 *  and controls inside can sit on `rounded-xl` and stay concentric. */
export function Group({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <MicroLabel className="block pb-3">{label}</MicroLabel>
      {children}
    </section>
  );
}

export function MicroLabel({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return (
    <span
      className={cn("font-mono text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase", className)}
    >
      {children}
    </span>
  );
}
