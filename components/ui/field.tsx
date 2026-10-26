"use client";
import { useId, type ReactNode } from "react";
import { cn } from "../../lib/utils";
export type FieldControl = { id: string; "aria-describedby"?: string; "aria-invalid"?: true; required?: boolean; disabled?: boolean };
/** Pass the supplied props to the control so label, hint and error stay connected. */
export function Field({label, hint, error, required, disabled, id: suppliedId, children, className}: {
  readonly label: string; readonly hint?: string; readonly error?: string;
  readonly required?: boolean; readonly disabled?: boolean; readonly id?: string;
  readonly children: (props: FieldControl) => ReactNode; readonly className?: string;
}) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return <div className={cn("flex flex-col gap-1.5", disabled && "opacity-60", className)}>
    <label htmlFor={id} className="text-[13px] font-medium">{label}{required && <span aria-hidden="true" className="ml-1 text-destructive">*</span>}</label>
    {children({id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined, required, disabled})}
    {hint && <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">{hint}</p>}
    {error && <p id={`${id}-error`} role="alert" className="text-xs leading-5 text-destructive">{error}</p>}
  </div>;
}
